import { afterEach, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

type Step = {
  name?: string;
  run?: string;
  env?: Record<string, string>;
  if?: string;
};
const workflow = Bun.YAML.parse(
  readFileSync(
    join(import.meta.dir, "../.github/workflows/deploy-api.yml"),
    "utf8",
  ),
) as {
  jobs: { deploy: { env: Record<string, string>; steps: Step[] } };
};
const job = workflow.jobs.deploy;
const stepNames = [
  "Prepare Worker secrets",
  "Prepare and validate deployment configuration",
  "Apply D1 migrations and deploy Worker",
  "Remove temporary Worker secrets",
];
const steps = job.steps.filter((step) => stepNames.includes(step.name ?? ""));
if (steps.length !== stepNames.length)
  throw new Error("필수 배포 step이 없어요.");
const credentials = {
  SMTP_USER: "fixture@gmail.com",
  SMTP_APP_PASSWORD: "fixture-smtp-password",
  GEMINI_API_KEY: "fixture-gemini-key",
};
const model = "gemini-3.5-flash-lite";
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function runWorkflow(
  overrides: Record<string, string> = {},
  failDeploy = false,
) {
  const directory = mkdtempSync(join(tmpdir(), "qletter-deploy-workflow-"));
  directories.push(directory);
  for (const name of ["scripts", "apps/api", "bin"])
    mkdirSync(join(directory, name), { recursive: true });
  for (const file of ["scripts/release.ts", "apps/api/wrangler.jsonc"])
    copyFileSync(join(import.meta.dir, "..", file), join(directory, file));
  const trace = join(directory, "calls.jsonl");
  writeFileSync(trace, "");
  writeFileSync(
    join(directory, "bin/mise"),
    `#!${process.execPath}
import { appendFileSync, readFileSync, statSync } from "node:fs";
const args = process.argv.slice(2);
const marker = args.indexOf("wrangler");
if (marker < 0) {
  const result = Bun.spawnSync([process.execPath, ...args.slice(3)], { env: process.env, stdout: "inherit", stderr: "inherit" });
  process.exit(result.exitCode);
}
const operation = args[marker + 1];
const call = { operation, dryRun: args.includes("--dry-run") };
if (operation === "deploy" && !call.dryRun) {
  const path = args[args.indexOf("--secrets-file") + 1];
  call.secrets = JSON.parse(readFileSync(path, "utf8"));
  call.mode = statSync(path).mode & 0o777;
}
appendFileSync(process.env.QLETTER_TEST_TRACE, JSON.stringify(call) + "\\n");
if (operation === "deploy" && !call.dryRun && process.env.QLETTER_TEST_DEPLOY_FAIL === "1") process.exit(1);
`,
    { mode: 0o755 },
  );
  const context: Record<string, string> = {
    "secrets.SMTP_USER": credentials.SMTP_USER,
    "secrets.SMTP_APP_PASSWORD": credentials.SMTP_APP_PASSWORD,
    "secrets.GEMINI_API_KEY": credentials.GEMINI_API_KEY,
    "secrets.CLOUDFLARE_API_TOKEN": "fixture-cloudflare-token",
    "vars.GEMINI_MODEL": model,
    "vars.CLOUDFLARE_ACCOUNT_ID": "a".repeat(32),
    "vars.CLOUDFLARE_D1_DATABASE_ID": "12345678-1234-4234-8234-123456789abc",
    "vars.QLETTER_API_URL": "https://qletter.example",
    "steps.release.outputs.sha": "a".repeat(40),
  };
  for (const [name, value] of Object.entries(overrides)) {
    context[`secrets.${name}`] = value;
    context[`vars.${name}`] = value;
  }
  const execute = (step: Step) => {
    if (!step.run) throw new Error(`실행 명령이 없어요: ${step.name}`);
    const env = Object.fromEntries(
      Object.entries({ ...job.env, ...step.env }).map(([name, value]) => [
        name,
        value.replace(
          // ${{ ... }} 안의 점 표기 경로를 꺼내 fixture context 값으로 바꿔요.
          /\$\{\{\s*([\w.]+)\s*\}\}/g,
          (_, key) => context[key] ?? "",
        ),
      ]),
    );
    return Bun.spawnSync(["bash", "-e", "-o", "pipefail", "-c", step.run], {
      cwd: directory,
      env: {
        ...process.env,
        ...env,
        RUNNER_TEMP: directory,
        PATH: `${join(directory, "bin")}${delimiter}${process.env.PATH ?? ""}`,
        QLETTER_TEST_TRACE: trace,
        QLETTER_TEST_DEPLOY_FAIL: failDeploy ? "1" : "0",
      },
    });
  };
  let status = 0;
  let output = "";
  for (const step of steps) {
    if (status !== 0 && step.if !== "always()") continue;
    const result = execute(step);
    output += result.stdout.toString() + result.stderr.toString();
    status ||= result.exitCode;
  }
  const calls = readFileSync(trace, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { directory, status, output, calls };
}

test("워크플로 Bash가 테스트 설정을 전달하고 임시 Secret 파일을 정리해요", async () => {
  const result = runWorkflow();
  expect(result.status).toBe(0);
  expect(result.calls).toEqual([
    { operation: "deploy", dryRun: true },
    { operation: "d1", dryRun: false },
    { operation: "deploy", dryRun: false, secrets: credentials, mode: 0o600 },
  ]);
  const config = await Bun.file(
    join(result.directory, "apps/api/wrangler.deploy.json"),
  ).json();
  expect(config.vars.GEMINI_MODEL).toBe(model);
  expect(
    await Bun.file(
      join(result.directory, "qletter-worker-secrets.json"),
    ).exists(),
  ).toBe(false);
  for (const value of Object.values(credentials))
    expect(result.output).not.toContain(value);
});

test.each(["SMTP_USER", "SMTP_APP_PASSWORD", "GEMINI_API_KEY", "GEMINI_MODEL"])(
  "필수 설정 %s가 없으면 D1 변경 전에 실패하고 임시 파일을 정리해요",
  async (name) => {
    const result = runWorkflow({ [name]: "" });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(name);
    expect(result.calls).toEqual([]);
    expect(
      await Bun.file(
        join(result.directory, "qletter-worker-secrets.json"),
      ).exists(),
    ).toBe(false);
  },
);

test("배포 명령이 실패해도 Secret 파일을 남기거나 로그에 값을 출력하지 않아요", async () => {
  const result = runWorkflow({}, true);
  expect(result.status).not.toBe(0);
  expect(
    await Bun.file(
      join(result.directory, "qletter-worker-secrets.json"),
    ).exists(),
  ).toBe(false);
  for (const value of Object.values(credentials))
    expect(result.output).not.toContain(value);
});
