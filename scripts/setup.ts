import { resolve } from "node:path";
import { installHooks } from "./git-hooks";

const root = resolve(import.meta.dir, "..");
try {
  const result = Bun.spawnSync(
    [process.execPath, "install", "--frozen-lockfile"],
    {
      cwd: root,
      stdio: ["inherit", "inherit", "inherit"],
    },
  );
  if (result.exitCode !== 0) process.exit(result.exitCode || 1);
  installHooks(root);
  console.info(
    "의존성과 .githooks 설정을 완료했어요. Android SDK·Studio 연결은 docs/development.md를 따라 주세요.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "설정에 실패했어요.");
  process.exit(1);
}
