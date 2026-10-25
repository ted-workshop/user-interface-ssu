import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { changedFilesForPush, checkStaged, installHooks } from "./git-hooks";

const repos: string[] = [];
function git(repo: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", repo, ...args]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "qletter-hooks-"));
  repos.push(dir);
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.invalid");
  return dir;
}
afterEach(() => {
  for (const path of repos.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("Git 훅 설치", () => {
  test("저장소 훅을 반복해서 설치해도 같은 상태를 유지해요", () => {
    const dir = repo();
    installHooks(dir);
    installHooks(dir);
    expect(git(dir, "config", "--local", "core.hooksPath")).toBe(".githooks");
  });
  test("기존 사용자 훅 경로를 보존해요", () => {
    const dir = repo();
    git(dir, "config", "core.hooksPath", "custom-hooks");
    expect(() => installHooks(dir)).toThrow();
    expect(git(dir, "config", "core.hooksPath")).toBe("custom-hooks");
  });
});

describe("스테이징한 변경 검사", () => {
  test("미스테이징 변경과 인덱스를 보존하며 스테이징한 내용을 검사해요", () => {
    const dir = repo();
    writeFileSync(join(dir, "sample.ts"), "export const value = 1;\n");
    git(dir, "add", "sample.ts");
    writeFileSync(
      join(dir, "sample.ts"),
      "this is deliberately not TypeScript",
    );
    const before = git(dir, "show", ":sample.ts");
    checkStaged(dir);
    expect(git(dir, "show", ":sample.ts")).toBe(before);
    expect(readFileSync(join(dir, "sample.ts"), "utf8")).toBe(
      "this is deliberately not TypeScript",
    );
  });
  test("작업 파일을 고쳐도 스테이징한 코드가 잘못됐으면 거부해요", () => {
    const dir = repo();
    writeFileSync(join(dir, "sample.ts"), "export const = ;\n");
    git(dir, "add", "sample.ts");
    writeFileSync(join(dir, "sample.ts"), "export const value = 1;\n");
    expect(() => checkStaged(dir)).toThrow();
  });
});

describe("푸시할 변경 검사", () => {
  test("pre-push에 상속된 저장소 상태를 격리해요", () => {
    const current = repo();
    const foreign = repo();
    git(current, "config", "qletter.marker", "current");
    git(foreign, "config", "qletter.marker", "foreign");
    const bin = join(current, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "mise"),
      '#!/bin/sh\nexec "$QLETTER_TEST_BUN" "$QLETTER_TEST_PROBE"\n',
      { mode: 0o755 },
    );
    const probe = join(current, "probe.ts");
    writeFileSync(
      probe,
      `const result = Bun.spawnSync(["git", "-C", process.env.QLETTER_TEST_REPO!, "config", "--local", "qletter.marker", "checked"]);
process.exit(result.exitCode);
`,
    );
    const result = Bun.spawnSync(
      [
        "sh",
        join(import.meta.dir, "../.githooks/pre-push"),
        "origin",
        "unused",
      ],
      {
        cwd: current,
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
          GIT_DIR: join(current, ".git"),
          GIT_WORK_TREE: current,
          GIT_INDEX_FILE: join(current, ".git", "index"),
          QLETTER_TEST_BUN: process.execPath,
          QLETTER_TEST_PROBE: probe,
          QLETTER_TEST_REPO: foreign,
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(git(current, "config", "qletter.marker")).toBe("current");
    expect(git(foreign, "config", "qletter.marker")).toBe("checked");
  });
  test("이미 커밋한 변경을 포함해 푸시할 커밋을 검사해요", () => {
    const dir = repo();
    writeFileSync(join(dir, "README.md"), "base\n");
    git(dir, "add", "README.md");
    git(dir, "-c", "core.hooksPath=/dev/null", "commit", "-m", "base");
    const base = git(dir, "rev-parse", "HEAD");
    writeFileSync(join(dir, "mise.toml"), "[tools]\n");
    git(dir, "add", "mise.toml");
    git(dir, "-c", "core.hooksPath=/dev/null", "commit", "-m", "tools");
    const head = git(dir, "rev-parse", "HEAD");
    expect(
      changedFilesForPush(
        dir,
        `refs/heads/main ${head} refs/heads/main ${base}\n`,
        "origin",
      ),
    ).toEqual(["mise.toml"]);
    expect(
      changedFilesForPush(
        dir,
        `refs/heads/main ${"0".repeat(40)} refs/heads/main ${head}\n`,
        "origin",
      ),
    ).toEqual([]);
    expect(
      changedFilesForPush(
        dir,
        `refs/heads/feature ${head} refs/heads/feature ${"0".repeat(40)}\n`,
        "origin",
      ),
    ).toEqual(["README.md", "mise.toml"]);
  });
});
