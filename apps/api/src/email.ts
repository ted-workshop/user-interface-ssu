import tls from "node:tls";
import nodemailer, { type NodemailerError } from "nodemailer";
import { EAUTH } from "nodemailer/lib/errors";
import type { SMTPTransportGetSocket } from "nodemailer/lib/smtp-transport";
import { z } from "zod";

const mailboxSchema = z.email();
const textSchema = z.string().refine((value) => value.trim().length > 0);
const deliveryIdSchema = z.guid();

const gmailConfigSchema = z.object({
  user: mailboxSchema,
  // 공백이 아닌 문자가 하나 이상 있어야 비어 있지 않은 앱 비밀번호로 받아요.
  appPassword: z.string().regex(/\S/),
});
const emailMessageSchema = z.object({
  /** 발송 전에 수신자·발송별 ID를 저장해요. 중복 방지 키는 아니에요. */
  deliveryId: deliveryIdSchema,
  to: mailboxSchema,
  // 메일 제목이 다른 헤더로 이어지지 않도록 CR·LF 개행을 거부해요.
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
      ? {
          user: config.user,
          // Google 앱 비밀번호의 표시용 공백을 모두 제거한 뒤 인증에 사용해요.
          pass: config.appPassword.replace(/\s/g, ""),
        }
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

// Nodemailer가 해석한 IP 대신 호스트명을 workerd의 TCP 프록시에 전달해요.
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
    // SMTP에 소켓을 넘기기 전이라 메일이 접수될 수 없어요.
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
  switch (true) {
    // 550 5.4.5로 시작하는 SMTP 응답을 발송 한도 초과로 분류해요.
    case smtpCode === 550 && /^550[ -]5\.4\.5\b/.test(smtpError.response ?? ""):
      return new EmailError("quota", smtpCode);
    // 454 같은 일시적 인증 거부는 설정 오류보다 먼저 분류해요.
    case smtpError.permanent === false:
      return new EmailError("temporary", smtpCode);
    case smtpError.code === EAUTH:
      return new EmailError("configuration", smtpCode);
    case smtpError.permanent === true:
      return new EmailError("permanent", smtpCode);
    default:
      // DATA 이후 소켓 오류도 CONN으로 표시하므로 미발송으로 추정하지 않아요.
      return new EmailError("ambiguous");
  }
}
