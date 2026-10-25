import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  EmailError,
  type EmailMessage,
  emailMessageId,
  type GmailConfig,
  sendEmail,
  verifyGmailConnection,
} from "../src/email";

type Settings = GmailConfig & { testRecipient: string };
type Probe = EmailMessage & { sender: string };
type ProbeResult =
  | { state: "accepted"; messageId: string }
  | { state: EmailError["reason"] };

const mailboxSchema = z.email();

export async function runEmailCommand(
  [command, deliveryId]: string[],
  directory: string,
) {
  const settingsFile = Bun.file(resolve(directory, "credentials.json"));
  switch (command) {
    case "handshake":
      return verifyGmailConnection();
    case "verify": {
      const settings: Settings = await settingsFile.json();
      return {
        ...(await verifyGmailConnection(settings)),
        sender: maskedMailbox(settings.user),
      };
    }
    case "prepare":
      return prepareProbe(directory, await settingsFile.json());
    case "send":
    case "result": {
      const settings: Settings = await settingsFile.json();
      if (!deliveryId) throw new EmailError("invalid_input");
      const messageId = emailMessageId(settings.user, deliveryId);
      const attemptPath = resolve(directory, `${deliveryId}.attempt.json`);
      const probe: Probe = await Bun.file(
        resolve(directory, `${deliveryId}.json`),
      ).json();
      if (probe.deliveryId !== deliveryId || probe.sender !== settings.user)
        throw new EmailError("invalid_input");
      const addresses = maskedAddresses(probe);
      if (command === "result") {
        return {
          ...addresses,
          localAttempt: await Bun.file(attemptPath).json(),
          sentSearch: `in:sent rfc822msgid:${messageId.slice(1, -1)}`,
          note: "로컬 시도 기록이에요. 실제 수신과 보낸편지함은 따로 확인해 주세요.",
        };
      }
      console.info(JSON.stringify({ deliveryId, ...addresses }));
      const result = await sendProbe(settings, probe, attemptPath);
      return { deliveryId, messageId, ...addresses, result };
    }
    default:
      throw new EmailError("invalid_input");
  }
}

async function prepareProbe(directory: string, settings: Settings) {
  if (!mailboxSchema.validate(settings.testRecipient))
    throw new EmailError("invalid_input");
  const deliveryId = crypto.randomUUID();
  const text = `Qletter 메일 발송 기반 확인용 메시지예요. 확인 번호: ${deliveryId}`;
  const probe: Probe = {
    deliveryId,
    sender: settings.user,
    to: settings.testRecipient,
    subject: `[Qletter] 메일 연결 확인 ${deliveryId}`,
    text,
    html: `<p>${text}</p>`,
  };
  const messageId = emailMessageId(settings.user, deliveryId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writePrivateJson(resolve(directory, `${deliveryId}.json`), probe);
  return { deliveryId, messageId, ...maskedAddresses(probe) };
}

async function sendProbe(
  settings: Settings,
  probe: Probe,
  attemptPath: string,
) {
  // 기존 기록은 이미 발송됐을 가능성을 뜻하므로 SMTP 호출 전에 독점 생성해요.
  await writePrivateJson(attemptPath, {
    state: "started",
    at: new Date().toISOString(),
  });
  let result: ProbeResult;
  try {
    const accepted = await sendEmail(settings, probe);
    result = { state: accepted.status, messageId: accepted.messageId };
  } catch (error) {
    result = {
      state: error instanceof EmailError ? error.reason : "ambiguous",
    };
  }
  const temporary = `${attemptPath}.tmp`;
  await writePrivateJson(temporary, result);
  await rename(temporary, attemptPath);
  return result;
}

function writePrivateJson(path: string, value: object) {
  return writeFile(path, JSON.stringify(value, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
}

function maskedAddresses(probe: Probe) {
  return {
    sender: maskedMailbox(probe.sender),
    recipient: maskedMailbox(probe.to),
  };
}

function maskedMailbox(address: string) {
  const [local, domain] = address.split("@");
  if (!local || !mailboxSchema.validate(address)) return "***";
  const suffix = local.length > 4 ? local.slice(-2) : "";
  return `${local.slice(0, 2)}***${suffix}@${domain}`;
}

if (import.meta.main) {
  try {
    const result = await runEmailCommand(
      process.argv.slice(2),
      resolve(import.meta.dir, "../.artifacts/email"),
    );
    console.info(JSON.stringify(result));
    if ("result" in result && result.result.state !== "accepted")
      process.exitCode = 1;
  } catch (error) {
    console.error(
      error instanceof EmailError
        ? error.message
        : "메일 검증을 중단했어요. 설정·입력 파일과 기존 시도 기록을 확인해 주세요.",
    );
    process.exitCode = 1;
  }
}
