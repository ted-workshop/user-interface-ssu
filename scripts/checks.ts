import { appendFileSync } from "node:fs";

export function checksForFiles(files: string[]): string[] {
  let api = false;
  let android = false;
  let infra = false;
  for (const file of files) {
    if (file.startsWith("docs/") || /\.md$/i.test(file)) continue;
    if (file.startsWith("apps/api/")) {
      api = true;
      if (file === "apps/api/wrangler.jsonc") infra = true;
    } else if (file.startsWith("apps/android/")) android = true;
    else if (
      file.startsWith("infra/") ||
      file === ".github/workflows/infra.yml"
    )
      infra = true;
    else if (file === "scripts/android.ts") {
      api = true;
      android = true;
    } else if (
      [
        "bun.lock",
        "biome.json",
        "tsconfig.json",
        ".github/workflows/deploy-api.yml",
      ].includes(file) ||
      /^scripts\/release(?:\.test)?\.ts$/.test(file)
    )
      api = true;
    else {
      api = true;
      android = true;
      infra = true;
    }
  }
  return [
    ...(api ? ["api:check"] : []),
    ...(android ? ["android:check"] : []),
    ...(infra ? ["infra:check"] : []),
  ];
}

if (import.meta.main) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT 경로가 없어요.");
  const files = (await Bun.stdin.text()).split("\0").filter(Boolean);
  const checks = checksForFiles(files);
  appendFileSync(
    output,
    ["api", "android", "infra"]
      .map((scope) => `${scope}=${checks.includes(`${scope}:check`)}\n`)
      .join(""),
  );
  console.log(`Checks: ${checks.join(", ") || "none"}`);
}
