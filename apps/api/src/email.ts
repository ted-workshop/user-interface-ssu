import tls from "node:tls";
import nodemailer, { type NodemailerError } from "nodemailer";
import type { SMTPTransportGetSocket } from "nodemailer/lib/smtp-transport";
import { z } from "zod";

const mailboxSchema = z.email();
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
    await transport.sendMail({
      from: { name: "Qletter", address: config.user },
      to: message.to,
      envelope: { from: config.user, to: [message.to] },
      subject: message.subject,
      text: message.text,
      html: message.html,
      messageId,
    });
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
  const [, domain] = user.toLowerCase().split("@");
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
  if (error instanceof EmailError) {
    return error;
  }
  if (!(error instanceof Error)) {
    return new EmailError("ambiguous");
  }
  const smtpError: NodemailerError = error;
  const smtpCode = smtpError.responseCode;
  if (smtpCode === 550 && /^550[ -]5\.4\.5\b/.test(smtpError.response ?? "")) {
    return new EmailError("quota", smtpCode);
  }
  // 454 같은 일시적 인증 거부는 설정 오류보다 먼저 분류해요.
  if (smtpError.permanent === false) {
    return new EmailError("temporary", smtpCode);
  }
  if (smtpError.code === "EAUTH") {
    return new EmailError("configuration", smtpCode);
  }
  if (smtpError.permanent === true) {
    return new EmailError("permanent", smtpCode);
  }
  // Nodemailer uses command=CONN for socket failures even after DATA. Never infer non-delivery from it.
  return new EmailError("ambiguous");
}
