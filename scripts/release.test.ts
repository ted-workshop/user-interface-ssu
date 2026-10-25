import { describe, expect, test } from "bun:test";
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
