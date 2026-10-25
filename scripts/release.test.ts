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
