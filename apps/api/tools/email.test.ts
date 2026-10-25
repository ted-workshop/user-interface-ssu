import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as email from "../src/email";
import { claimEmailAttempt, runEmailCommand } from "./email";

const directories: string[] = [];
const settings = {
  user: "sender@gmail.com",
  appPassword: "fixture-app-password",
  testRecipient: "recipient@example.net",
};
const send = mock(
  async (config: email.GmailConfig, message: email.EmailMessage) => ({
    status: "accepted" as const,
    messageId: email.emailMessageId(config.user, message.deliveryId),
  }),
);
const verify = mock(async (config?: email.GmailConfig) => ({
  status: "ready" as const,
  authenticated: config !== undefined,
}));
const consoleOutput = mock(() => {});

beforeEach(() => {
  mock.clearAllMocks();
  spyOn(email, "sendEmail").mockImplementation(send);
  spyOn(email, "verifyGmailConnection").mockImplementation(verify);
  spyOn(console, "info").mockImplementation(consoleOutput);
});

afterEach(async () => {
  mock.restore();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "qletter-mail-"));
  directories.push(directory);
  return directory;
}

async function preparedProbe() {
  const directory = await temporaryDirectory();
  await Bun.write(
    join(directory, "credentials.json"),
    JSON.stringify(settings),
  );
  const prepared = await runEmailCommand(["prepare"], directory);
  if (!("deliveryId" in prepared)) throw new Error("Expected a prepared probe");
  return { ...prepared, directory };
}

describe("live email probe guard", () => {
  test("concurrent invocations can claim a delivery only once", async () => {
    const directory = await temporaryDirectory();
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
    const directory = await temporaryDirectory();
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

describe("email verification commands", () => {
  test("handshake needs no credentials, verify authenticates, and unknown commands fail early", async () => {
    const directory = await temporaryDirectory();
    expect(await runEmailCommand(["handshake"], directory)).toEqual({
      status: "ready",
      authenticated: false,
    });
    expect(verify.mock.calls[0]).toEqual([]);
    await expect(runEmailCommand(["unknown"], directory)).rejects.toMatchObject(
      {
        reason: "invalid_input",
      },
    );
    await Bun.write(
      join(directory, "credentials.json"),
      JSON.stringify(settings),
    );
    expect(await runEmailCommand(["verify"], directory)).toEqual({
      status: "ready",
      authenticated: true,
      sender: "se***er@gmail.com",
    });
    const invalid = Bun.spawnSync([
      process.execPath,
      resolve(import.meta.dir, "email.ts"),
      "unknown",
    ]);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stdout.toString()).toBe("");
    expect(invalid.stderr.toString()).toContain("invalid_input");
    expect(send).not.toHaveBeenCalled();
  });

  test("prepare stores a private message and result keeps its original recipient", async () => {
    const prepared = await preparedProbe();
    expect(prepared).toMatchObject({
      sender: "se***er@gmail.com",
      recipient: "re***nt@example.net",
    });
    const output = JSON.stringify(prepared);
    for (const value of Object.values(settings))
      expect(output).not.toContain(value);
    const messagePath = join(prepared.directory, `${prepared.deliveryId}.json`);
    expect(await Bun.file(messagePath).json()).toMatchObject({
      sender: settings.user,
      to: settings.testRecipient,
      deliveryId: prepared.deliveryId,
    });
    expect((await stat(messagePath)).mode & 0o777).toBe(0o600);
    await claimEmailAttempt(
      join(prepared.directory, `${prepared.deliveryId}.attempt.json`),
    );
    await Bun.write(
      join(prepared.directory, "credentials.json"),
      JSON.stringify({
        ...settings,
        testRecipient: "different@example.net",
      }),
    );
    expect(
      await runEmailCommand(
        ["result", prepared.deliveryId],
        prepared.directory,
      ),
    ).toMatchObject({
      sender: "se***er@gmail.com",
      recipient: "re***nt@example.net",
      localAttempt: { state: "started" },
      sentSearch: `in:sent rfc822msgid:qletter.${prepared.deliveryId}@gmail.com`,
    });
    expect(send).not.toHaveBeenCalled();
  });

  test("send records acceptance privately and refuses a second SMTP attempt", async () => {
    const { directory, deliveryId } = await preparedProbe();
    const messageId = email.emailMessageId(settings.user, deliveryId);
    const attemptPath = join(directory, `${deliveryId}.attempt.json`);
    send.mockImplementationOnce(async () => {
      expect(await Bun.file(attemptPath).json()).toMatchObject({
        state: "started",
      });
      return { status: "accepted", messageId };
    });
    const output = await runEmailCommand(["send", deliveryId], directory);
    expect(output).toMatchObject({ result: { state: "accepted", messageId } });
    expect(await Bun.file(attemptPath).json()).toEqual({
      state: "accepted",
      messageId,
    });
    expect((await stat(attemptPath)).mode & 0o777).toBe(0o600);
    expect(await Bun.file(`${attemptPath}.tmp`).exists()).toBe(false);
    await expect(
      runEmailCommand(["send", deliveryId], directory),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(send).toHaveBeenCalledTimes(1);
    for (const value of Object.values(settings)) {
      expect(JSON.stringify(output)).not.toContain(value);
      expect(JSON.stringify(consoleOutput.mock.calls)).not.toContain(value);
    }
  });

  test.each([
    new email.EmailError("ambiguous"),
    new Error("private provider error"),
  ])(
    "uncertain delivery is recorded and never resent automatically: %s",
    async (error) => {
      const { directory, deliveryId } = await preparedProbe();
      const exitCode = process.exitCode;
      send.mockRejectedValueOnce(error);
      expect(
        await runEmailCommand(["send", deliveryId], directory),
      ).toMatchObject({
        result: { state: "ambiguous" },
      });
      const attemptPath = join(directory, `${deliveryId}.attempt.json`);
      expect(await Bun.file(attemptPath).json()).toEqual({
        state: "ambiguous",
      });
      expect(process.exitCode).toBe(exitCode);
      await expect(
        runEmailCommand(["send", deliveryId], directory),
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  test("missing IDs, path traversal, and mismatched probes cannot reach SMTP", async () => {
    const { directory, deliveryId } = await preparedProbe();
    for (const args of [["send"], ["send", "../../credentials"]]) {
      await expect(runEmailCommand(args, directory)).rejects.toMatchObject({
        reason: "invalid_input",
      });
    }
    const path = join(directory, `${deliveryId}.json`);
    const original = await Bun.file(path).json();
    for (const change of [
      { sender: "other@gmail.com" },
      { deliveryId: crypto.randomUUID() },
    ]) {
      await Bun.write(path, JSON.stringify({ ...original, ...change }));
      await expect(
        runEmailCommand(["send", deliveryId], directory),
      ).rejects.toMatchObject({ reason: "invalid_input" });
    }
    expect(send).not.toHaveBeenCalled();
    expect(
      await Bun.file(join(directory, `${deliveryId}.attempt.json`)).exists(),
    ).toBe(false);
  });
});
