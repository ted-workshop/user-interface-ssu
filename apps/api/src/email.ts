import tls from "node:tls";
import nodemailer from "nodemailer";
import addressparser from "nodemailer/lib/addressparser";
import type { SMTPTransportGetSocket } from "nodemailer/lib/smtp-transport";

export interface GmailConfig {
  user: string;
  appPassword: string;
}

export interface EmailMessage {
  /** Persist one ID per recipient and delivery before sending. It is not a deduplication key. */
  deliveryId: string;
  to: string;
  subject: string;
  text: string;
  /** The caller must provide safely rendered HTML, separate from the plain text. */
  html: string;
}

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

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function mailbox(value: string) {
  if (typeof value !== "string") return false;
  const addresses = addressparser(value);
  return (
    addresses.length === 1 &&
    addresses[0]?.address === value &&
    value.includes("@") &&
    !/[\r\n]/.test(value)
  );
}

export function emailMessageId(user: string, deliveryId: string) {
  if (!mailbox(user) || !uuid.test(deliveryId))
    throw new EmailError("invalid_input");
  const domain = user.slice(user.lastIndexOf("@") + 1).toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(domain)) throw new EmailError("invalid_input");
  return `<qletter.${deliveryId}@${domain}>`;
}

export async function sendEmail(config: GmailConfig, message: EmailMessage) {
  validateConfig(config);
  if (
    !mailbox(message.to) ||
    typeof message.subject !== "string" ||
    !message.subject.trim() ||
    /[\r\n]/.test(message.subject) ||
    typeof message.text !== "string" ||
    !message.text.trim() ||
    typeof message.html !== "string" ||
    !message.html.trim()
  ) {
    throw new EmailError("invalid_input");
  }
  const messageId = emailMessageId(config.user, message.deliveryId);
  const transport = gmailTransport(config);
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
    throw classify(error);
  } finally {
    transport.close();
  }
}

export async function verifyGmailConnection(config?: GmailConfig) {
  const transport = gmailTransport(config);
  try {
    await transport.verify();
    return { status: "ready" as const, authenticated: config !== undefined };
  } catch (error) {
    throw classify(error);
  } finally {
    transport.close();
  }
}

function validateConfig(config: GmailConfig) {
  if (
    !mailbox(config.user) ||
    typeof config.appPassword !== "string" ||
    !config.appPassword.replace(/\s/g, "")
  ) {
    throw new EmailError("configuration");
  }
}

function gmailTransport(config?: GmailConfig) {
  if (config) validateConfig(config);
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
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
  let settled = false;
  const onError = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.removeListener("secureConnect", onSecure);
    socket.destroy();
    // This socket has not been handed to SMTP yet, so no message can have been accepted.
    callback(new EmailError("temporary"));
  };
  const onSecure = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.removeListener("error", onError);
    callback(null, { connection: socket, secured: true });
  };
  socket.once("error", onError);
  socket.once("secureConnect", onSecure);
};

function classify(error: unknown) {
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
