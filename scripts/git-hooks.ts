import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
function git(repo: string, args: string[]) {
  const result = Bun.spawnSync(["git", "-C", repo, ...args]);
  if (result.exitCode !== 0)
    throw new Error(result.stderr.toString() || "Git 명령이 실패했어요.");
  return result.stdout.toString();
}

export function installHooks(repo: string): void {
  const existing = Bun.spawnSync([
    "git",
    "-C",
    repo,
    "config",
    "--get",
    "core.hooksPath",
  ]);
  if (existing.exitCode !== 0 && existing.exitCode !== 1)
    throw new Error(existing.stderr.toString());
  const value = existing.stdout.toString().trim();
  if (value && value !== ".githooks") {
    throw new Error(
      "기존 core.hooksPath가 있어요. CONTRIBUTING.md에 따라 기존 hooks와 통합해 주세요.",
    );
  }
  git(repo, ["config", "--local", "core.hooksPath", ".githooks"]);
}

export function checkStaged(repo: string): void {
  git(repo, ["diff", "--cached", "--check"]);
  const files = git(repo, [
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
    "-z",
  ])
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    if (!/\.(?:[cm]?tsx?|jsx?|jsonc?)$/.test(file)) continue;
    const content = git(repo, ["show", `:${file}`]);
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--bun",
        resolve(root, "node_modules/@biomejs/biome/bin/biome"),
        "format",
        "--config-path",
        root,
        "--stdin-file-path",
        file,
      ],
      { cwd: root, stdin: Buffer.from(content) },
    );
    if (result.exitCode !== 0)
      throw new Error(result.stdout.toString() + result.stderr.toString());
    if (result.stdout.toString() !== content) {
      throw new Error(
        file +
          ": staged 내용의 포맷 수정이 필요해요. 수정 후 의도한 부분만 다시 stage해 주세요.",
      );
    }
  }
}

export function checksForFiles(files: string[]): string[] {
  let api = false;
  let android = false;
  for (const file of files) {
    if (
      file.startsWith("docs/") ||
      ["README.md", "CONTRIBUTING.md"].includes(file)
    )
      continue;
    if (file.startsWith("apps/api/")) api = true;
    else if (file.startsWith("apps/android/")) android = true;
    else {
      api = true;
      android = true;
    }
  }
  return [...(api ? ["api:check"] : []), ...(android ? ["android:check"] : [])];
}

export function changedFilesForPush(
  repo: string,
  input: string,
  remote: string,
): string[] {
  const files = new Set<string>();
  for (const line of input.trim().split("\n").filter(Boolean)) {
    const parts = line.trim().split(/\s+/);
    const local = parts[1];
    const previous = parts[3];
    if (
      parts.length !== 4 ||
      !local ||
      !previous ||
      !/^[a-f0-9]{40,64}$/.test(local) ||
      !/^[a-f0-9]{40,64}$/.test(previous)
    ) {
      throw new Error("pre-push 입력을 해석하지 못했어요.");
    }
    if (/^0+$/.test(local)) continue;
    let base = previous;
    if (/^0+$/.test(previous)) {
      const candidate = Bun.spawnSync([
        "git",
        "-C",
        repo,
        "merge-base",
        local,
        `refs/remotes/${remote}/HEAD`,
      ]);
      base = candidate.exitCode === 0 ? candidate.stdout.toString().trim() : "";
    }
    const names = base
      ? git(repo, ["diff", "--name-only", "-z", base, local])
      : git(repo, ["ls-tree", "-r", "--name-only", "-z", local]);
    for (const name of names.split("\0").filter(Boolean)) files.add(name);
  }
  return [...files].sort();
}

if (import.meta.main) {
  try {
    const mode = process.argv[2];
    if (mode === "pre-commit") checkStaged(root);
    else if (mode === "pre-push") {
      const checks = checksForFiles(
        changedFilesForPush(
          root,
          await Bun.stdin.text(),
          process.argv[3] ?? "origin",
        ),
      );
      if (checks.length && git(root, ["status", "--porcelain"]).trim()) {
        throw new Error(
          "push할 커밋과 같은 상태를 검사하도록 작업 트리를 먼저 정리해 주세요.",
        );
      }
      for (const check of checks) {
        const result = Bun.spawnSync([process.execPath, "run", check], {
          cwd: root,
          stdio: ["inherit", "inherit", "inherit"],
        });
        if (result.exitCode !== 0) process.exit(result.exitCode || 1);
      }
    } else throw new Error("지원하지 않는 hook이에요.");
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Git hook이 실패했어요.",
    );
    process.exit(1);
  }
}
