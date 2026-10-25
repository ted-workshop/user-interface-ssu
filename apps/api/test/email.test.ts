import { env } from "cloudflare:workers";
import { EventEmitter } from "node:events";
import tls from "node:tls";
import nodemailer from "nodemailer";
import type { SMTPTransportOptions } from "nodemailer/lib/smtp-transport";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  EmailError,
  emailMessageId,
  sendEmail,
  verifyGmailConnection,
} from "../src/email";

const smtp = vi.hoisted(() => ({
  sendMail: vi.fn(),
  verify: vi.fn(),
  close: vi.fn(),
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => smtp) },
}));
vi.mock("node:tls", () => ({ default: { connect: vi.fn() } }));
const config = {
  user: "sender@gmail.com",
  appPassword: "fixture-app-password",
};
const message = {
  deliveryId: "fdcce475-8231-4ebc-9e33-d02c57389264",
  to: "recipient@example.net",
  subject: "Qletter 메일 연결 확인",
  text: "메일 연결을 확인해요.",
  html: "<p>메일 연결을 확인해요.</p>",
};
const messageId = `<qletter.${message.deliveryId}@gmail.com>`;

describe("Gmail SMTP delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    smtp.sendMail.mockReset();
    smtp.verify.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("Worker 시크릿 binding을 공통 함수에 전달하고 실제 발송은 하지 않아요", async () => {
    smtp.verify.mockResolvedValue(true);
    const result = await verifyGmailConnection({
      user: env.SMTP_USER,
      appPassword: env.SMTP_APP_PASSWORD,
    });
    expect(result).toEqual({ status: "ready", authenticated: true });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: {
          user: "fixture-sender@gmail.com",
          pass: "fixture-app-password",
        },
      }),
    );
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  test("uses authenticated TLS and sends one recipient with both bodies", async () => {
    smtp.sendMail.mockResolvedValue({
      messageId,
      accepted: [message.to],
      rejected: [],
      response: "250 2.0.0 OK fixture",
    });
    expect(await sendEmail(config, message)).toEqual({
      status: "accepted",
      messageId,
    });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "gmail",
        auth: { user: config.user, pass: config.appPassword },
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
        getSocket: expect.any(Function),
      }),
    );
    expect(smtp.sendMail).toHaveBeenCalledExactlyOnceWith({
      from: { name: "Qletter", address: config.user },
      to: message.to,
      envelope: { from: config.user, to: [message.to] },
      subject: message.subject,
      text: message.text,
      html: message.html,
      messageId,
    });
    expect(smtp.close).toHaveBeenCalledTimes(1);
  });

  test.each([
    [{ responseCode: 535, permanent: true, code: "EAUTH" }, "configuration"],
    [{ responseCode: 454, permanent: false, code: "EAUTH" }, "temporary"],
    [{ responseCode: 450, permanent: false, code: "EENVELOPE" }, "temporary"],
    [{ responseCode: 503, permanent: false, code: "EENVELOPE" }, "temporary"],
    [{ responseCode: 550, permanent: true, code: "EENVELOPE" }, "permanent"],
    [{ responseCode: 552, permanent: true, code: "EMESSAGE" }, "permanent"],
    [
      {
        responseCode: 550,
        permanent: true,
        response: "550 5.4.5 Daily user sending limit exceeded",
      },
      "quota",
    ],
    [{ code: "ETIMEDOUT", command: "DATA" }, "ambiguous"],
    // Nodemailer labels socket failures CONN even after DATA; this is not proof of rejection.
    [{ code: "ECONNECTION", command: "CONN" }, "ambiguous"],
    [{ code: "ETIMEDOUT", command: "CONN" }, "ambiguous"],
  ])("classifies SMTP %j as %s without replaying", async (metadata, reason) => {
    smtp.sendMail.mockRejectedValue(
      Object.assign(
        new Error("private provider response with credentials"),
        metadata,
      ),
    );
    const result = await sendEmail(config, message).catch(
      (error: unknown) => error,
    );
    expect(result).toBeInstanceOf(EmailError);
    expect(result).toMatchObject({ reason });
    expect(String(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("credentials");
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    expect(smtp.close).toHaveBeenCalledTimes(1);
  });

  test("오류 객체가 아닌 거부 결과도 원문을 숨기고 재발송하지 않아요", async () => {
    for (const error of [null, undefined, "private provider response"]) {
      smtp.sendMail.mockRejectedValueOnce(error);
      const result = await sendEmail(config, message).catch(
        (caught: unknown) => caught,
      );
      expect(result).toBeInstanceOf(EmailError);
      expect(result).toMatchObject({ reason: "ambiguous" });
      expect(String(result)).not.toContain("private");
    }
    expect(smtp.sendMail).toHaveBeenCalledTimes(3);
    expect(smtp.close).toHaveBeenCalledTimes(3);
  });

  test.each([
    ["sender@GMAIL.COM", "gmail.com"],
    ["first.last+probe@Sub.Example.COM", "sub.example.com"],
  ])("발신 주소 %s의 도메인으로 같은 발송 ID를 만들어요", (user, domain) => {
    expect(emailMessageId(user, message.deliveryId)).toBe(
      `<qletter.${message.deliveryId}@${domain}>`,
    );
  });

  test("invalid settings and multi-recipient input never connect", async () => {
    for (const settings of [
      { ...config, user: "" },
      { ...config, appPassword: " " },
    ]) {
      await expect(sendEmail(settings, message)).rejects.toMatchObject({
        reason: "configuration",
      });
      await expect(verifyGmailConnection(settings)).rejects.toMatchObject({
        reason: "configuration",
      });
    }
    for (const change of [
      { deliveryId: "not-a-uuid" },
      { to: "a@example.com,b@example.com" },
      { to: "a@example.com\r\nBcc: other@example.com" },
      { subject: "injected\r\nheader" },
      { subject: " " },
      { text: "" },
      { text: " " },
      { html: "" },
      { html: " " },
    ]) {
      await expect(
        sendEmail(config, { ...message, ...change }),
      ).rejects.toMatchObject({ reason: "invalid_input" });
    }
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  test("auth verification sends no email and closes the connection", async () => {
    smtp.verify.mockResolvedValue(true);
    expect(await verifyGmailConnection(config)).toEqual({
      status: "ready",
      authenticated: true,
    });
    expect(smtp.verify).toHaveBeenCalledTimes(1);
    expect(smtp.sendMail).not.toHaveBeenCalled();
    expect(smtp.close).toHaveBeenCalledTimes(1);
  });

  test("a handshake without credentials is reported as unauthenticated", async () => {
    smtp.verify.mockResolvedValue(true);
    expect(await verifyGmailConnection()).toEqual({
      status: "ready",
      authenticated: false,
    });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  test("TLS handoff keeps the hostname and removes the connection deadline", async () => {
    vi.useFakeTimers();
    const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    vi.mocked(tls.connect).mockReturnValue(socket as unknown as tls.TLSSocket);
    smtp.verify.mockResolvedValue(true);
    await verifyGmailConnection();
    const options = vi.mocked(nodemailer.createTransport).mock
      .calls[0]?.[0] as SMTPTransportOptions;
    const callback = vi.fn();
    options.getSocket?.({}, callback);
    expect(tls.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.gmail.com",
        servername: "smtp.gmail.com",
        port: 465,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
      }),
    );
    socket.emit("secureConnect");
    socket.emit("secureConnect");
    expect(callback).toHaveBeenCalledExactlyOnceWith(null, {
      connection: socket,
      secured: true,
    });
    vi.advanceTimersByTime(20_000);
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  test("a TLS failure before SMTP is safe to retry and cannot hand off twice", async () => {
    vi.useFakeTimers();
    const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    vi.mocked(tls.connect).mockReturnValue(socket as unknown as tls.TLSSocket);
    smtp.verify.mockResolvedValue(true);
    await verifyGmailConnection();
    const options = vi.mocked(nodemailer.createTransport).mock
      .calls[0]?.[0] as SMTPTransportOptions;
    const callback = vi.fn();
    options.getSocket?.({}, callback);
    socket.emit("error", new Error("private TLS diagnostic"));
    socket.emit("secureConnect");
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0]).toMatchObject({ reason: "temporary" });
    expect(String(callback.mock.calls[0]?.[0])).not.toContain("private");
    expect(socket.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("an unresponsive TLS peer is closed at the connection deadline", async () => {
    vi.useFakeTimers();
    const socket = new EventEmitter();
    const destroy = vi.fn((error?: Error) => {
      if (error) socket.emit("error", error);
    });
    Object.assign(socket, { destroy });
    vi.mocked(tls.connect).mockReturnValue(socket as unknown as tls.TLSSocket);
    smtp.verify.mockResolvedValue(true);
    await verifyGmailConnection();
    const options = vi.mocked(nodemailer.createTransport).mock
      .calls[0]?.[0] as SMTPTransportOptions;
    const callback = vi.fn();
    options.getSocket?.({}, callback);
    vi.advanceTimersByTime(10_000);
    expect(destroy).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0]).toMatchObject({ reason: "temporary" });
    expect(vi.getTimerCount()).toBe(0);
  });

  test("일반 주소와 별칭·하위 도메인 주소를 그대로 전달해요", async () => {
    for (const to of [
      "person@gmail.com",
      "person@icloud.com",
      "first.last+qletter@sub.example.com",
      "UPPER@EXAMPLE.COM",
    ]) {
      smtp.sendMail.mockResolvedValueOnce({
        messageId,
        accepted: [to],
        rejected: [],
        response: "250 2.0.0 OK fixture",
      });
      await expect(sendEmail(config, { ...message, to })).resolves.toEqual({
        status: "accepted",
        messageId,
      });
      expect(smtp.sendMail).toHaveBeenLastCalledWith(
        expect.objectContaining({
          to,
          envelope: { from: config.user, to: [to] },
        }),
      );
    }
  });

  test("잘못된 주소 형식은 발신·수신 모두 SMTP 연결 전에 거부해요", async () => {
    for (const address of [
      "missing-at.example.com",
      "person@",
      "person@localhost",
      ".person@example.com",
      "first..last@example.com",
      '"quoted local"@example.com',
      "Qletter <person@example.com>",
    ]) {
      const settings = { ...config, user: address };
      await expect(sendEmail(settings, message)).rejects.toMatchObject({
        reason: "configuration",
      });
      await expect(verifyGmailConnection(settings)).rejects.toMatchObject({
        reason: "configuration",
      });
      await expect(
        sendEmail(config, { ...message, to: address }),
      ).rejects.toMatchObject({ reason: "invalid_input" });
    }
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  test.each([
    "00000000-0000-0000-0000-000000000000",
    "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
  ])("기존 발송 ID 형식 %s를 그대로 허용해요", async (deliveryId) => {
    const expectedId = `<qletter.${deliveryId}@gmail.com>`;
    smtp.sendMail.mockResolvedValue({
      messageId: expectedId,
      accepted: [message.to],
      rejected: [],
      response: "250 2.0.0 OK fixture",
    });
    expect(await sendEmail(config, { ...message, deliveryId })).toEqual({
      status: "accepted",
      messageId: expectedId,
    });
  });

  test("제목·본문 원문을 보존하고 앱 비밀번호의 공백만 제거해요", async () => {
    const content = {
      ...message,
      subject: "  Qletter 메일 연결 확인  ",
      text: "  본문 앞뒤 공백을 보존해요.\n ",
      html: " <p>본문 앞뒤 공백을 보존해요.</p> ",
    };
    smtp.sendMail.mockResolvedValue({
      messageId,
      accepted: [message.to],
      rejected: [],
      response: "250 2.0.0 OK fixture",
    });
    await sendEmail({ ...config, appPassword: " abc def\t " }, content);
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: config.user, pass: "abcdef" } }),
    );
    expect(smtp.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: content.subject,
        text: content.text,
        html: content.html,
      }),
    );
  });

  test("JSON 입력의 잘못된 필드 타입을 연결 전에 거부하고 민감값을 숨겨요", async () => {
    for (const input of [
      '{"user":42,"appPassword":"secret-fixture"}',
      '{"user":"sender@gmail.com","appPassword":7}',
    ]) {
      const invalid = JSON.parse(input);
      const result = await sendEmail(invalid, message).catch(
        (error: unknown) => error,
      );
      expect(result).toBeInstanceOf(EmailError);
      expect(result).toMatchObject({ reason: "configuration" });
      expect(String(result)).not.toContain("secret-fixture");
      await expect(verifyGmailConnection(invalid)).rejects.toMatchObject({
        reason: "configuration",
      });
    }
    for (const input of ['{"to":42}', '{"subject":null}', '{"html":[]}']) {
      await expect(
        sendEmail(config, { ...message, ...JSON.parse(input) }),
      ).rejects.toMatchObject({ reason: "invalid_input" });
    }
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  test("설정값이 있지만 객체가 아니면 미인증 연결 확인으로 넘기지 않아요", async () => {
    for (const input of ["null", "0", "false", '""']) {
      await expect(
        verifyGmailConnection(JSON.parse(input)),
      ).rejects.toMatchObject({ reason: "configuration" });
    }
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });
});
