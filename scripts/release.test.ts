import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertSuccessfulRelease,
  createDeploymentConfig,
  verifyDeployment,
} from "./release";

const sha = "a".repeat(40);
const databaseId = "12345678-1234-4234-8234-123456789abc";
const successfulRun = {
  head_sha: sha,
  head_branch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
};

describe("운영 메일 시크릿 파일", () => {
  const directories: string[] = [];
  const credentials = {
    SMTP_USER: "fixture-sender@gmail.com",
    SMTP_APP_PASSWORD: 'fixture "password"\\value\n두 번째 줄',
  };

  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  function temporaryFile() {
    const directory = mkdtempSync(join(tmpdir(), "qletter-release-secrets-"));
    directories.push(directory);
    return join(directory, "smtp.json");
  }

  function prepare(path: string, values = credentials) {
    return Bun.spawnSync({
      cmd: [
        process.execPath,
        resolve(import.meta.dir, "release.ts"),
        "secrets",
        path,
      ],
      env: { ...process.env, ...values },
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  test("환경의 두 값만 0600 JSON으로 저장하고 출력하지 않아요", async () => {
    const path = temporaryFile();
    const result = prepare(path);
    expect(result.exitCode).toBe(0);
    expect(await Bun.file(path).json()).toEqual(credentials);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe("");
  });

  test("필수 값이 비어 있으면 파일을 만들지 않고 값 대신 이름만 알려줘요", async () => {
    for (const key of ["SMTP_USER", "SMTP_APP_PASSWORD"] as const) {
      for (const value of ["", " \n\t "]) {
        const path = temporaryFile();
        const result = prepare(path, { ...credentials, [key]: value });
        expect(result.exitCode).not.toBe(0);
        expect(await Bun.file(path).exists()).toBe(false);
        const output = result.stdout.toString() + result.stderr.toString();
        expect(output).toContain(key);
        for (const secret of Object.values(credentials))
          expect(output).not.toContain(secret);
      }
    }
  });

  test("기존 파일을 덮어쓰거나 공개 권한의 파일에 비밀번호를 기록하지 않아요", async () => {
    const path = temporaryFile();
    writeFileSync(path, "existing fixture", { mode: 0o644 });
    const result = prepare(path);
    expect(result.exitCode).not.toBe(0);
    expect(await Bun.file(path).text()).toBe("existing fixture");
    expect(statSync(path).mode & 0o777).toBe(0o644);
    for (const secret of Object.values(credentials))
      expect(result.stdout.toString() + result.stderr.toString()).not.toContain(
        secret,
      );
  });
});

describe("배포 가능 여부", () => {
  test("선택한 SHA와 일치하는 최신 main 푸시 검사가 성공하면 허용해요", () => {
    expect(() => assertSuccessfulRelease(sha, [successfulRun])).not.toThrow();
  });

  test("결과가 없거나 대기·실패·PR·다른 커밋의 결과이면 거부해요", () => {
    for (const runs of [
      [],
      [{ ...successfulRun, status: "in_progress", conclusion: null }],
      [{ ...successfulRun, conclusion: "failure" }, successfulRun],
      [{ ...successfulRun, event: "pull_request" }],
      [{ ...successfulRun, head_branch: "feature/example" }],
      [{ ...successfulRun, head_sha: "b".repeat(40) }],
    ]) {
      expect(() => assertSuccessfulRelease(sha, runs)).toThrow();
    }
    expect(() => assertSuccessfulRelease("main", [successfulRun])).toThrow();
  });
});

describe("배포 설정", () => {
  const local = {
    name: "qletter-api",
    main: "src/server.ts",
    vars: { BUILD_REVISION: "local" },
    d1_databases: [
      {
        binding: "DB",
        database_name: "qletter",
        database_id: "00000000-0000-0000-0000-000000000000",
        migrations_dir: "migrations",
      },
    ],
  };

  test("로컬 설정을 바꾸지 않고 선택한 커밋과 원격 DB를 사용해요", () => {
    const deployed = createDeploymentConfig(local, databaseId, sha);
    expect(deployed.vars.BUILD_REVISION).toBe(sha);
    expect(deployed.d1_databases[0]?.database_id).toBe(databaseId);
    expect(deployed.d1_databases[0]?.migrations_dir).toBe("migrations");
    expect(local.vars.BUILD_REVISION).toBe("local");
    expect(local.d1_databases[0]?.database_id).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
  });

  test("미설정 DB와 잘못된 커밋 값은 원격 쓰기 전에 거부해요", () => {
    for (const id of [
      "",
      "not-a-uuid",
      local.d1_databases[0]?.database_id ?? "",
    ]) {
      expect(() => createDeploymentConfig(local, id, sha)).toThrow();
    }
    expect(() => createDeploymentConfig(local, databaseId, "main")).toThrow();
    expect(() =>
      createDeploymentConfig({ ...local, d1_databases: [] }, databaseId, sha),
    ).toThrow();
  });
});

describe("배포된 API 확인", () => {
  function responses(revision = sha, missingStatus = 404) {
    return async (url: URL) =>
      url.pathname === "/health"
        ? Response.json(
            { status: "ok", service: "qletter-api" },
            { headers: { "x-qletter-revision": revision } },
          )
        : Response.json(
            { error: { code: "NOT_FOUND" } },
            { status: missingStatus },
          );
  }

  test("선택한 커밋을 확인하고 JSON 404 응답 규약을 검사해요", async () => {
    await verifyDeployment("https://qletter.example", sha, responses());
  });

  test("이전 배포의 정상 응답은 거부해요", async () => {
    await expect(
      verifyDeployment("https://qletter.example", sha, responses("old")),
    ).rejects.toThrow();
  });

  test("404 응답 규약이 잘못됐거나 안전하지 않은 배포 URL이면 거부해요", async () => {
    await expect(
      verifyDeployment("https://qletter.example", sha, responses(sha, 200)),
    ).rejects.toThrow();
    await expect(
      verifyDeployment("http://qletter.example", sha, responses()),
    ).rejects.toThrow();
  });
});
