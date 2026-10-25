import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as email from "../src/email";
import { runEmailCommand } from "./email";

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
  if (!("deliveryId" in prepared))
    throw new Error("준비된 테스트 메시지가 필요해요");
  return { ...prepared, directory };
}

describe("검증 메일의 중복 시도 방지", () => {
  test("같은 발송 명령을 동시에 실행해도 한 번만 보내요", async () => {
    const { directory, deliveryId } = await preparedProbe();
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        runEmailCommand(["send", deliveryId], directory),
      ),
    );
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((result) => result.status === "rejected"),
    ).toHaveLength(7);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected")
        expect(outcome.reason).toMatchObject({ code: "EEXIST" });
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await Bun.file(join(directory, `${deliveryId}.attempt.json`)).json(),
    ).toMatchObject({
      state: "accepted",
    });
  });

  test("프로세스 중단 때 남은 시도 기록이 있으면 다시 보내지 않아요", async () => {
    const { directory, deliveryId } = await preparedProbe();
    const path = join(directory, `${deliveryId}.attempt.json`);
    const checkpoint = JSON.stringify({
      state: "started",
      at: "2026-10-25T00:00:00.000Z",
    });
    await writeFile(path, checkpoint, { flag: "wx", mode: 0o600 });
    await expect(
      runEmailCommand(["send", deliveryId], directory),
    ).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await readFile(path, "utf8")).toBe(checkpoint);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("메일 검증 명령", () => {
  test("잘못된 수신 주소는 준비 파일을 만들기 전에 거부해요", async () => {
    const directory = await temporaryDirectory();
    for (const testRecipient of [
      "person@localhost",
      "a@example.net,b@example.net",
      42,
    ]) {
      await Bun.write(
        join(directory, "credentials.json"),
        JSON.stringify({ ...settings, testRecipient }),
      );
      await expect(
        runEmailCommand(["prepare"], directory),
      ).rejects.toMatchObject({
        reason: "invalid_input",
      });
      expect(await readdir(directory)).toEqual(["credentials.json"]);
    }
    expect(send).not.toHaveBeenCalled();
  });

  test("접수 뒤 결과 저장이 실패해도 기존 시도 기록으로 재발송을 막아요", async () => {
    const { directory, deliveryId } = await preparedProbe();
    const attemptPath = join(directory, `${deliveryId}.attempt.json`);
    await writeFile(`${attemptPath}.tmp`, "existing temporary result", {
      flag: "wx",
      mode: 0o600,
    });
    await expect(
      runEmailCommand(["send", deliveryId], directory),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await Bun.file(attemptPath).json()).toMatchObject({
      state: "started",
    });
    await expect(
      runEmailCommand(["send", deliveryId], directory),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("연결 확인은 자격증명 없이 실행하고 인증을 확인하며 잘못된 명령은 먼저 거부해요", async () => {
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

  test("메시지를 비공개 파일로 준비하고 결과 조회는 원래 수신 주소를 유지해요", async () => {
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
    await writeFile(
      join(prepared.directory, `${prepared.deliveryId}.attempt.json`),
      JSON.stringify({ state: "started" }),
      { flag: "wx", mode: 0o600 },
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

  test("접수 결과를 비공개 파일에 기록하고 두 번째 SMTP 시도를 거부해요", async () => {
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
  ])("결과 불명을 기록하고 자동 재발송하지 않아요: %s", async (error) => {
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
  });

  test("ID 누락·경로 이탈·메시지 불일치는 SMTP 호출 전에 거부해요", async () => {
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
