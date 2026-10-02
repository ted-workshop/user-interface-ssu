import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  changedFilesForPush,
  checkStaged,
  checksForFiles,
  installHooks,
} from "./git-hooks";

const repos: string[] = [];
function git(repo: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", repo, ...args]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "qletter-hooks-"));
  repos.push(dir);
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.invalid");
  return dir;
}
afterEach(() => {
  for (const path of repos.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("hook installation", () => {
  test("installs repository-local hooks idempotently", () => {
    const dir = repo();
    installHooks(dir);
    installHooks(dir);
    expect(git(dir, "config", "--local", "core.hooksPath")).toBe(".githooks");
  });
  test("preserves an existing custom hook path", () => {
    const dir = repo();
    git(dir, "config", "core.hooksPath", "custom-hooks");
    expect(() => installHooks(dir)).toThrow();
    expect(git(dir, "config", "core.hooksPath")).toBe("custom-hooks");
  });
});

describe("staged checks", () => {
  test("checks staged bytes while preserving unstaged changes and index", () => {
    const dir = repo();
    writeFileSync(join(dir, "sample.ts"), "export const value = 1;\n");
    git(dir, "add", "sample.ts");
    writeFileSync(
      join(dir, "sample.ts"),
      "this is deliberately not TypeScript",
    );
    const before = git(dir, "show", ":sample.ts");
    checkStaged(dir);
    expect(git(dir, "show", ":sample.ts")).toBe(before);
    expect(readFileSync(join(dir, "sample.ts"), "utf8")).toBe(
      "this is deliberately not TypeScript",
    );
  });
  test("rejects invalid staged code even if the working file is fixed", () => {
    const dir = repo();
    writeFileSync(join(dir, "sample.ts"), "export const = ;\n");
    git(dir, "add", "sample.ts");
    writeFileSync(join(dir, "sample.ts"), "export const value = 1;\n");
    expect(() => checkStaged(dir)).toThrow();
  });
});

describe("push checks", () => {
  test("selects apps and includes both for shared changes", () => {
    expect(checksForFiles(["apps/api/src/app.ts"])).toEqual(["api:check"]);
    expect(checksForFiles(["apps/android/app/build.gradle.kts"])).toEqual([
      "android:check",
    ]);
    expect(checksForFiles(["mise.toml"])).toEqual([
      "api:check",
      "android:check",
    ]);
    expect(checksForFiles(["docs/development.md"])).toEqual([]);
  });
  test("checks commits being pushed, including changes already committed", () => {
    const dir = repo();
    writeFileSync(join(dir, "README.md"), "base\n");
    git(dir, "add", "README.md");
    git(dir, "-c", "core.hooksPath=/dev/null", "commit", "-m", "base");
    const base = git(dir, "rev-parse", "HEAD");
    writeFileSync(join(dir, "mise.toml"), "[tools]\n");
    git(dir, "add", "mise.toml");
    git(dir, "-c", "core.hooksPath=/dev/null", "commit", "-m", "tools");
    const head = git(dir, "rev-parse", "HEAD");
    expect(
      changedFilesForPush(
        dir,
        `refs/heads/main ${head} refs/heads/main ${base}\n`,
        "origin",
      ),
    ).toEqual(["mise.toml"]);
    expect(
      changedFilesForPush(
        dir,
        `refs/heads/main ${"0".repeat(40)} refs/heads/main ${head}\n`,
        "origin",
      ),
    ).toEqual([]);
    expect(
      changedFilesForPush(
        dir,
        `refs/heads/feature ${head} refs/heads/feature ${"0".repeat(40)}\n`,
        "origin",
      ),
    ).toEqual(["README.md", "mise.toml"]);
  });
});
