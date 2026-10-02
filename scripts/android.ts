import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const mode = process.argv[2] ?? "check";
const tasks: Record<string, string[]> = {
  check: ["spotlessCheck", "lintDebug", "testDebugUnitTest", "assembleDebug"],
  format: ["spotlessApply"],
};
const selected = tasks[mode];
if (!selected)
  throw new Error("Android 작업은 check 또는 format을 지정해 주세요.");
const cwd = resolve(root, "apps/android");
const result = Bun.spawnSync(
  process.platform === "win32"
    ? ["cmd.exe", "/d", "/c", "gradlew.bat", ...selected, "--console=plain"]
    : ["./gradlew", ...selected, "--console=plain"],
  { cwd, stdio: ["inherit", "inherit", "inherit"] },
);
process.exit(result.exitCode || (result.success ? 0 : 1));
