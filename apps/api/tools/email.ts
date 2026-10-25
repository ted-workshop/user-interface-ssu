import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  EmailError,
  type EmailMessage,
  emailMessageId,
  type GmailConfig,
  sendEmail,
  verifyGmailConnection,
} from "../src/email";

const directory = resolve(import.meta.dir, "../.artifacts/email");
type Settings = GmailConfig & { testRecipient: string };
type Probe = EmailMessage & { sender: string };

function maskedMailbox(address: string) {
  const at = address.lastIndexOf("@");
  if (at <= 0 || !/^[a-z0-9.-]+$/i.test(address.slice(at + 1))) return "***";
  const local = address.slice(0, at);
  return `${local.slice(0, 2)}***${local.length > 4 ? local.slice(-2) : ""}@${address.slice(at + 1)}`;
}

/** An existing claim means the attempt may have reached Gmail, including after a crash. */
export async function claimEmailAttempt(path: string) {
  await writeFile(
    path,
    JSON.stringify({ state: "started", at: new Date().toISOString() }),
    {
      flag: "wx",
      mode: 0o600,
    },
  );
}

async function main() {
  const [mode, deliveryId] = process.argv.slice(2);
  if (mode === "handshake") {
    console.info(JSON.stringify(await verifyGmailConnection()));
    return;
  }
  if (!["verify", "prepare", "send", "result"].includes(mode ?? "")) {
    throw new EmailError("invalid_input");
  }
  const settings: Settings = await Bun.file(
    resolve(directory, "credentials.json"),
  ).json();
  if (mode === "verify") {
    console.info(
      JSON.stringify({
        ...(await verifyGmailConnection(settings)),
        sender: maskedMailbox(settings.user),
      }),
    );
    return;
  }
  if (mode === "prepare") {
    const id = crypto.randomUUID();
    const text = `Qletter 메일 발송 기반 확인용 메시지예요. 확인 번호: ${id}`;
    const probe: Probe = {
      deliveryId: id,
      sender: settings.user,
      to: settings.testRecipient,
      subject: `[Qletter] 메일 연결 확인 ${id}`,
      text,
      html: `<p>${text}</p>`,
    };
    const messageId = emailMessageId(settings.user, id);
    if (!probe.to) throw new EmailError("invalid_input");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      resolve(directory, `${id}.json`),
      JSON.stringify(probe, null, 2),
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    console.info(
      JSON.stringify({
        deliveryId: id,
        messageId,
        sender: maskedMailbox(probe.sender),
        recipient: maskedMailbox(probe.to),
      }),
    );
    return;
  }
  if (!deliveryId) throw new EmailError("invalid_input");
  const messageId = emailMessageId(settings.user, deliveryId);
  const path = resolve(directory, `${deliveryId}.attempt.json`);
  const probe: Probe = await Bun.file(
    resolve(directory, `${deliveryId}.json`),
  ).json();
  if (probe.deliveryId !== deliveryId || probe.sender !== settings.user)
    throw new EmailError("invalid_input");
  const addresses = {
    sender: maskedMailbox(probe.sender),
    recipient: maskedMailbox(probe.to),
  };
  if (mode === "result") {
    console.info(
      JSON.stringify({
        ...addresses,
        localAttempt: await Bun.file(path).json(),
        sentSearch: `in:sent rfc822msgid:${messageId.slice(1, -1)}`,
        note: "로컬 시도 기록이에요. 실제 수신과 보낸편지함은 따로 확인해 주세요.",
      }),
    );
    return;
  }
  console.info(JSON.stringify({ deliveryId, ...addresses }));
  await claimEmailAttempt(path);
  let result: object;
  try {
    const accepted = await sendEmail(settings, probe);
    result = { state: accepted.status, messageId: accepted.messageId };
  } catch (error) {
    result = {
      state: error instanceof EmailError ? error.reason : "ambiguous",
    };
    process.exitCode = 1;
  }
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(result), {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, path);
  console.info(JSON.stringify({ deliveryId, messageId, ...addresses, result }));
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(
      error instanceof EmailError
        ? error.message
        : "메일 검증을 중단했어요. 설정·입력 파일과 기존 시도 기록을 확인해 주세요.",
    );
    process.exitCode = 1;
  });
}
