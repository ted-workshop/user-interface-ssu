import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimEmailAttempt } from "./email";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("live email probe guard", () => {
  test("concurrent invocations can claim a delivery only once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "qletter-mail-"));
    directories.push(directory);
    const path = join(directory, "attempt.json");
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () => claimEmailAttempt(path)),
    );
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((result) => result.status === "rejected"),
    ).toHaveLength(7);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      state: "started",
    });
  });

  test("a crash after claiming cannot cause an automatic resend", async () => {
    const directory = await mkdtemp(join(tmpdir(), "qletter-mail-"));
    directories.push(directory);
    const path = join(directory, "attempt.json");
    await claimEmailAttempt(path);
    await expect(claimEmailAttempt(path)).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      state: "started",
    });
  });
});
