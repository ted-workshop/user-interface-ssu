import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type QualityRun = {
  head_sha: string;
  head_branch: string;
  event: string;
  status: string;
  conclusion: string | null;
};

type WorkerConfig = {
  name: string;
  main: string;
  vars?: Record<string, string>;
  d1_databases: {
    binding: string;
    database_name: string;
    database_id: string;
    migrations_dir: string;
  }[];
  [key: string]: unknown;
};

function assertSha(sha: string) {
  if (!/^[a-f0-9]{40}$/.test(sha))
    throw new Error("배포 대상은 전체 40자리 커밋 SHA여야 해요.");
}

export function assertSuccessfulRelease(sha: string, runs: QualityRun[]) {
  assertSha(sha);
  const latest = runs[0];
  if (
    !latest ||
    latest.head_sha !== sha ||
    latest.head_branch !== "main" ||
    latest.event !== "push" ||
    latest.status !== "completed" ||
    latest.conclusion !== "success"
  ) {
    throw new Error("대상 SHA의 최신 main Quality 실행이 성공해야 해요.");
  }
}

export function createDeploymentConfig(
  local: WorkerConfig,
  databaseId: string,
  sha: string,
  model: string,
) {
  assertSha(sha);
  if (!model.trim())
    throw new Error("GEMINI_MODEL을 production 환경 Variable에 설정해 주세요.");
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(databaseId) ||
    databaseId === "00000000-0000-0000-0000-000000000000"
  ) {
    throw new Error("실제 D1 ID를 CLOUDFLARE_D1_DATABASE_ID에 설정해 주세요.");
  }
  const db = local.d1_databases[0];
  if (local.d1_databases.length !== 1 || !db || db.binding !== "DB")
    throw new Error("배포 설정에는 DB binding 하나가 필요해요.");

  return {
    ...local,
    workers_dev: true,
    preview_urls: false,
    vars: { ...local.vars, BUILD_REVISION: sha, GEMINI_MODEL: model.trim() },
    d1_databases: [{ ...db, database_id: databaseId }],
  };
}

function deploymentUrl(baseUrl: string) {
  const base = new URL(baseUrl);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  ) {
    throw new Error("QLETTER_API_URL은 HTTPS origin이어야 해요.");
  }
  return base;
}

export async function verifyDeployment(
  baseUrl: string,
  sha: string,
  request: (url: URL, options: RequestInit) => Promise<Response> = fetch,
) {
  assertSha(sha);
  const base = deploymentUrl(baseUrl);
  const options: RequestInit = {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  };
  const health = await request(new URL("/health", base), options);
  const body = await health.json();
  if (
    health.status !== 200 ||
    body.status !== "ok" ||
    body.service !== "qletter-api" ||
    health.headers.get("x-qletter-revision") !== sha
  ) {
    throw new Error("배포 SHA와 health 응답이 일치하지 않아요.");
  }
  const missing = await request(
    new URL(`/__qletter_deploy_probe_${sha}`, base),
    { ...options, signal: AbortSignal.timeout(10_000) },
  );
  const error = await missing.json();
  if (missing.status !== 404 || error.error?.code !== "NOT_FOUND")
    throw new Error("배포 API의 JSON 404 계약이 맞지 않아요.");
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const mode = process.argv[2];
  const sha = process.env.RELEASE_SHA ?? "";
  if (mode === "check") {
    const payload = await Bun.file(process.argv[3] ?? "").json();
    assertSuccessfulRelease(sha, payload.workflow_runs);
    console.info(`Quality 성공 확인: ${sha}`);
  } else if (mode === "secrets") {
    const path = process.argv[3];
    if (!path) throw new Error("시크릿 파일의 저장 경로가 필요해요.");
    const secrets = {
      SMTP_USER: process.env.SMTP_USER,
      SMTP_APP_PASSWORD: process.env.SMTP_APP_PASSWORD,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    };
    for (const [name, value] of Object.entries(secrets)) {
      if (!value?.trim())
        throw new Error(`${name}을 production 환경 Secret에 설정해 주세요.`);
    }
    await writeFile(path, `${JSON.stringify(secrets)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  } else if (mode === "config") {
    deploymentUrl(process.env.QLETTER_API_URL ?? "");
    const local = await Bun.file(
      resolve(root, "apps/api/wrangler.jsonc"),
    ).json();
    const config = createDeploymentConfig(
      local,
      process.env.CLOUDFLARE_D1_DATABASE_ID ?? "",
      sha,
      process.env.GEMINI_MODEL ?? "",
    );
    await Bun.write(
      resolve(root, "apps/api/wrangler.deploy.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
  } else if (mode === "verify") {
    await verifyDeployment(process.env.QLETTER_API_URL ?? "", sha);
    console.info(`배포 SHA·health·404 확인: ${sha}`);
  } else {
    throw new Error(
      "release 작업은 check, secrets, config, verify 중 하나여야 해요.",
    );
  }
}
