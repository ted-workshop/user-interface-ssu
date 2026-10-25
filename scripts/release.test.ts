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

describe("release eligibility", () => {
  test("accepts the latest successful main push for the exact SHA", () => {
    expect(() => assertSuccessfulRelease(sha, [successfulRun])).not.toThrow();
  });

  test("rejects missing, pending, failed, PR, and different commit results", () => {
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

describe("deployment configuration", () => {
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

  test("uses the selected revision and remote DB without changing local config", () => {
    const deployed = createDeploymentConfig(local, databaseId, sha);
    expect(deployed.vars.BUILD_REVISION).toBe(sha);
    expect(deployed.d1_databases[0]?.database_id).toBe(databaseId);
    expect(deployed.d1_databases[0]?.migrations_dir).toBe("migrations");
    expect(local.vars.BUILD_REVISION).toBe("local");
    expect(local.d1_databases[0]?.database_id).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
  });

  test("rejects placeholder DBs and malformed revisions before remote writes", () => {
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

describe("deployed API proof", () => {
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

  test("accepts the selected revision and checks the JSON 404 contract", async () => {
    await verifyDeployment("https://qletter.example", sha, responses());
  });

  test("rejects a healthy response from the previous deployment", async () => {
    await expect(
      verifyDeployment("https://qletter.example", sha, responses("old")),
    ).rejects.toThrow();
  });

  test("rejects a broken 404 contract or an insecure deployment URL", async () => {
    await expect(
      verifyDeployment("https://qletter.example", sha, responses(sha, 200)),
    ).rejects.toThrow();
    await expect(
      verifyDeployment("http://qletter.example", sha, responses()),
    ).rejects.toThrow();
  });
});
