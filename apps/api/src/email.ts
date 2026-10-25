import tls from "node:tls";
import nodemailer from "nodemailer";
import addressparser from "nodemailer/lib/addressparser";
import type { SMTPTransportGetSocket } from "nodemailer/lib/smtp-transport";
import { z } from "zod";

const mailboxSchema = z.string().refine((value) => {
  const addresses = addressparser(value);
  return (
    addresses.length === 1 &&
    addresses[0]?.address === value &&
    value.includes("@") &&
    !/[\r\n]/.test(value)
  );
});
const textSchema = z.string().refine((value) => value.trim().length > 0);
const deliveryIdSchema = z.guid();

const gmailConfigSchema = z.object({
  user: mailboxSchema,
  appPassword: z.string().regex(/\S/),
});
const emailMessageSchema = z.object({
  /** 발송 전에 수신자·발송별 ID를 저장해요. 중복 방지 키는 아니에요. */
  deliveryId: deliveryIdSchema,
  to: mailboxSchema,
  subject: textSchema.refine((value) => !/[\r\n]/.test(value)),
  text: textSchema,
  /** 호출부에서 일반 텍스트와 별도로 안전하게 렌더링한 HTML을 전달해요. */
  html: textSchema,
});

export type GmailConfig = z.infer<typeof gmailConfigSchema>;
export type EmailMessage = z.infer<typeof emailMessageSchema>;

export class EmailError extends Error {
  constructor(
    readonly reason:
      | "configuration"
      | "invalid_input"
      | "temporary"
      | "permanent"
      | "quota"
      | "ambiguous",
    readonly smtpCode?: number,
  ) {
    super(`Email request failed: ${reason}`);
    this.name = "EmailError";
  }
}

export async function sendEmail(config: GmailConfig, message: EmailMessage) {
  if (!gmailConfigSchema.validate(config))
    throw new EmailError("configuration");
  if (!emailMessageSchema.validate(message))
    throw new EmailError("invalid_input");
  const messageId = emailMessageId(config.user, message.deliveryId);
  const transport = createGmailTransport(config);
  try {
    const info = await transport.sendMail({
      from: { name: "Qletter", address: config.user },
      to: message.to,
      envelope: { from: config.user, to: [message.to] },
      subject: message.subject,
      text: message.text,
      html: message.html,
      messageId,
    });
    if (
      info.messageId !== messageId ||
      info.accepted.length !== 1 ||
      info.rejected.length !== 0 ||
      !/^250[ -]/.test(info.response)
    ) {
      throw new EmailError("ambiguous");
    }
    return { status: "accepted" as const, messageId };
  } catch (error) {
    throw toEmailError(error);
  } finally {
    transport.close();
  }
}

export async function verifyGmailConnection(config?: GmailConfig) {
  if (config !== undefined && !gmailConfigSchema.validate(config))
    throw new EmailError("configuration");
  const transport = createGmailTransport(config);
  try {
    await transport.verify();
    return { status: "ready" as const, authenticated: config !== undefined };
  } catch (error) {
    throw toEmailError(error);
  } finally {
    transport.close();
  }
}

export function emailMessageId(user: string, deliveryId: string) {
  if (!mailboxSchema.validate(user) || !deliveryIdSchema.validate(deliveryId))
    throw new EmailError("invalid_input");
  const domain = user.slice(user.lastIndexOf("@") + 1).toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(domain)) throw new EmailError("invalid_input");
  return `<qletter.${deliveryId}@${domain}>`;
}

function createGmailTransport(config?: GmailConfig) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: config
      ? { user: config.user, pass: config.appPassword.replace(/\s/g, "") }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
    getSocket: gmailSocket,
  });
}

// Keep the hostname for workerd's TCP proxy instead of Nodemailer's resolved-IP path.
const gmailSocket: SMTPTransportGetSocket = (_options, callback) => {
  const socket = tls.connect({
    host: "smtp.gmail.com",
    port: 465,
    servername: "smtp.gmail.com",
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  });
  const timer = setTimeout(
    () => socket.destroy(new Error("SMTP connect timeout")),
    10_000,
  );
  const onError = () => {
    clearTimeout(timer);
    socket.removeListener("secureConnect", onSecure);
    socket.destroy();
    // This socket has not been handed to SMTP yet, so no message can have been accepted.
    callback(new EmailError("temporary"));
  };
  const onSecure = () => {
    clearTimeout(timer);
    socket.removeListener("error", onError);
    callback(null, { connection: socket, secured: true });
  };
  socket.once("error", onError);
  socket.once("secureConnect", onSecure);
};

function toEmailError(error: unknown) {
  if (error instanceof EmailError) return error;
  const detail = error as {
    responseCode?: number;
    code?: string;
    response?: string;
  } | null;
  const code = detail?.responseCode;
  if (code === 550 && /^550[ -]5\.4\.5\b/.test(detail?.response ?? ""))
    return new EmailError("quota", code);
  if (typeof code === "number" && code >= 400 && code < 500)
    return new EmailError("temporary", code);
  if (detail?.code === "EAUTH") return new EmailError("configuration", code);
  if (typeof code === "number" && code >= 500 && code < 600)
    return new EmailError("permanent", code);
  // Nodemailer uses command=CONN for socket failures even after DATA. Never infer non-delivery from it.
  return new EmailError("ambiguous");
}
