import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { checksForFiles } from "./checks";
import { changedFilesForPush } from "./git-hooks";

const workflow = Bun.YAML.parse(
  readFileSync(
    join(import.meta.dir, "../.github/workflows/quality.yml"),
    "utf8",
  ),
) as { jobs: Record<string, { steps: { id?: string; run?: string }[] }> };
const gate = workflow.jobs.quality?.steps.find((step) => step.run)?.run;

describe("변경 범위별 검사", () => {
  const cases: [string[], string[]][] = [
    [["apps/api/src/app.ts"], ["api:check"]],
    [["apps/android/app/build.gradle.kts"], ["android:check"]],
    [["infra/cloudflare/main.tf"], ["infra:check"]],
    [["apps/api/wrangler.jsonc"], ["api:check", "infra:check"]],
    [
      ["apps/api/src/app.ts", "infra/state/main.tf"],
      ["api:check", "infra:check"],
    ],
    [["scripts/android.ts"], ["api:check", "android:check"]],
    [["bun.lock", "biome.json", "tsconfig.json"], ["api:check"]],
    [[".github/workflows/deploy-api.yml"], ["api:check"]],
    [[".github/workflows/infra.yml"], ["infra:check"]],
    [["AGENTS.md", "docs/development.md", "infra/cloudflare/README.md"], []],
    [["mise.toml"], ["api:check", "android:check", "infra:check"]],
    [["package.json"], ["api:check", "android:check", "infra:check"]],
    [
      [".github/workflows/quality.yml"],
      ["api:check", "android:check", "infra:check"],
    ],
    [["unknown.config"], ["api:check", "android:check", "infra:check"]],
    [[], []],
  ];
  test.each(cases)("%j에 필요한 검사를 선택해요", (files, checks) => {
    expect(checksForFiles(files)).toEqual(checks);
  });
});

describe("품질 워크플로의 최종 판정", () => {
  function result(env: Record<string, string>) {
    if (!gate) throw new Error("quality 판정 명령이 없어요.");
    return Bun.spawnSync(["bash", "-e", "-o", "pipefail", "-c", gate], {
      env: {
        ...process.env,
        CHANGES_RESULT: "success",
        API_REQUIRED: "true",
        ANDROID_REQUIRED: "false",
        INFRA_REQUIRED: "false",
        API_RESULT: "success",
        ANDROID_RESULT: "skipped",
        INFRA_RESULT: "skipped",
        ...env,
      },
    }).exitCode;
  }
  test("필요한 검사가 성공하고 관련 없는 검사가 생략되면 통과해요", () => {
    expect(result({})).toBe(0);
  });
  test("문서만 바뀌어 모든 앱 검사가 생략되면 통과해요", () => {
    expect(result({ API_REQUIRED: "false", API_RESULT: "skipped" })).toBe(0);
  });
  test("필요한 검사가 생략되면 거부해요", () => {
    expect(result({ API_RESULT: "skipped" })).not.toBe(0);
  });
  test("모든 검사가 성공해도 범위 선택이 실패하거나 취소되면 거부해요", () => {
    for (const state of ["failure", "cancelled", "skipped"]) {
      expect(
        result({
          CHANGES_RESULT: state,
          ANDROID_RESULT: "success",
          INFRA_RESULT: "success",
        }),
      ).not.toBe(0);
    }
  });
  test("검사 결과가 실패·취소·누락 상태면 거부해요", () => {
    for (const state of ["failure", "cancelled", ""]) {
      expect(result({ API_RESULT: state })).not.toBe(0);
    }
  });
});

describe("워크플로의 변경 범위 선택", () => {
  const select = workflow.jobs.changes?.steps.find(
    (step) => step.id === "scopes",
  )?.run;
  const repos: string[] = [];
  function git(dir: string, ...args: string[]) {
    const result = Bun.spawnSync(["git", "-C", dir, ...args]);
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  }
  function repo() {
    const dir = mkdtempSync(join(tmpdir(), "qletter-ci-scopes-"));
    repos.push(dir);
    git(dir, "init", "-b", "main");
    git(dir, "config", "user.name", "Test");
    git(dir, "config", "user.email", "test@example.invalid");
    mkdirSync(join(dir, ".git", "bin"));
    writeFileSync(
      join(dir, ".git", "bin", "mise"),
      '#!/bin/sh\nexec "$QLETTER_TEST_BUN" "$QLETTER_CHECKS_SCRIPT"\n',
      { mode: 0o755 },
    );
    return dir;
  }
  function commit(dir: string, files: Record<string, string>) {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    git(dir, "add", "--", ...Object.keys(files));
    git(dir, "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
    return git(dir, "rev-parse", "HEAD");
  }
  function scopes(dir: string, event: string, base: string, head: string) {
    if (!select) throw new Error("변경 범위 판정 명령이 없어요.");
    const output = join(dir, ".git", "output");
    writeFileSync(output, "");
    const result = Bun.spawnSync(
      ["bash", "-e", "-o", "pipefail", "-c", select],
      {
        cwd: dir,
        env: {
          ...process.env,
          PATH: `${join(dir, ".git", "bin")}${delimiter}${process.env.PATH ?? ""}`,
          QLETTER_TEST_BUN: process.execPath,
          QLETTER_CHECKS_SCRIPT: join(import.meta.dir, "checks.ts"),
          GITHUB_EVENT_NAME: event,
          BASE_SHA: base,
          HEAD_SHA: head,
          GITHUB_OUTPUT: output,
          RUNNER_TEMP: join(dir, ".git"),
        },
      },
    );
    return { exitCode: result.exitCode, output: readFileSync(output, "utf8") };
  }
  afterEach(() => {
    for (const dir of repos.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });
  test("PR의 공통 조상으로 비교하고 파일 이름의 공백을 보존해요", () => {
    const dir = repo();
    commit(dir, { "README.md": "base\n" });
    git(dir, "switch", "-c", "feature");
    const head = commit(dir, { "apps/api/a line\nname.ts": "api\n" });
    git(dir, "switch", "main");
    const base = commit(dir, { "apps/android/Main.java": "android\n" });
    expect(scopes(dir, "pull_request", base, head)).toEqual({
      exitCode: 0,
      output: "api=true\nandroid=false\ninfra=false\n",
    });
  });
  test("푸시하는 여러 커밋의 전체 범위를 검사해요", () => {
    const dir = repo();
    const base = commit(dir, { "README.md": "base\n" });
    commit(dir, { "apps/api/app.ts": "api\n" });
    const head = commit(dir, { "infra/cloudflare/main.tf": "infra\n" });
    expect(scopes(dir, "push", base, head)).toEqual({
      exitCode: 0,
      output: "api=true\nandroid=false\ninfra=true\n",
    });
  });
  test("문서만 바뀌면 앱 검사를 선택하지 않아요", () => {
    const dir = repo();
    const base = commit(dir, { "README.md": "base\n" });
    const head = commit(dir, { "AGENTS.md": "rules\n" });
    expect(scopes(dir, "pull_request", base, head)).toEqual({
      exitCode: 0,
      output: "api=false\nandroid=false\ninfra=false\n",
    });
  });
  test("앱 사이로 파일을 옮기면 양쪽 범위를 검사해요", () => {
    const dir = repo();
    const base = commit(dir, { "apps/api/shared.txt": "same\n" });
    mkdirSync(join(dir, "apps/android"), { recursive: true });
    git(dir, "mv", "apps/api/shared.txt", "apps/android/shared.txt");
    git(dir, "-c", "core.hooksPath=/dev/null", "commit", "-m", "rename");
    const head = git(dir, "rev-parse", "HEAD");
    expect(scopes(dir, "pull_request", base, head)).toEqual({
      exitCode: 0,
      output: "api=true\nandroid=true\ninfra=false\n",
    });
    expect(
      changedFilesForPush(
        dir,
        `refs/heads/main ${head} refs/heads/main ${base}\n`,
        "origin",
      ),
    ).toEqual(["apps/android/shared.txt", "apps/api/shared.txt"]);
  });
  test("이전 커밋이 없는 첫 푸시는 추적 중인 파일을 검사해요", () => {
    const dir = repo();
    const head = commit(dir, { "apps/api/app.ts": "api\n" });
    expect(scopes(dir, "push", "0".repeat(40), head)).toEqual({
      exitCode: 0,
      output: "api=true\nandroid=false\ninfra=false\n",
    });
  });
  test("비교할 커밋이 잘못됐거나 없으면 검사 없음으로 처리하지 않고 실패해요", () => {
    const dir = repo();
    const head = commit(dir, { "README.md": "base\n" });
    for (const base of ["--invalid", "f".repeat(40)]) {
      const result = scopes(dir, "pull_request", base, head);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toBe("");
    }
  });
});
