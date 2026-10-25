import { EventEmitter } from "node:events";
import tls from "node:tls";
import nodemailer from "nodemailer";
import type { SMTPTransportOptions } from "nodemailer/lib/smtp-transport";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EmailError, sendEmail, verifyGmailConnection } from "../src/email";

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

describe("Gmail SMTP 메일 발송", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    smtp.sendMail.mockReset();
    smtp.verify.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("TLS로 인증하고 한 수신자에게 텍스트와 HTML 본문을 함께 보내요", async () => {
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
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
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
    [
      { responseCode: 535, code: "EAUTH", command: "AUTH PLAIN" },
      "configuration",
    ],
    [{ responseCode: 454, code: "EAUTH", command: "AUTH PLAIN" }, "temporary"],
    [{ responseCode: 450, code: "EENVELOPE", command: "RCPT TO" }, "temporary"],
    [{ responseCode: 550, code: "EENVELOPE", command: "RCPT TO" }, "permanent"],
    [{ responseCode: 552, code: "EMESSAGE", command: "DATA" }, "permanent"],
    [
      {
        responseCode: 550,
        response: "550 5.4.5 Daily user sending limit exceeded",
      },
      "quota",
    ],
    [{ code: "ETIMEDOUT", command: "DATA" }, "ambiguous"],
    // DATA 이후 소켓 오류도 CONN으로 표시되므로 메일이 거부됐다는 증거가 아니에요.
    [{ code: "ECONNECTION", command: "CONN" }, "ambiguous"],
    [{ code: "ETIMEDOUT", command: "CONN" }, "ambiguous"],
  ])(
    "SMTP 오류 %j를 %s로 분류하고 재발송하지 않아요",
    async (metadata, reason) => {
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
    },
  );

  test("접수 응답이 없거나 수신 결과가 일치하지 않으면 결과 불명으로 남겨요", async () => {
    for (const info of [
      { accepted: [], rejected: [], response: "250 OK" },
      { accepted: [message.to], rejected: [message.to], response: "250 OK" },
      { accepted: [message.to], rejected: [], response: "354 continue" },
    ]) {
      smtp.sendMail.mockResolvedValueOnce({ ...info, messageId });
      await expect(sendEmail(config, message)).rejects.toMatchObject({
        reason: "ambiguous",
      });
    }
  });

  test("잘못된 설정과 여러 수신자 입력은 SMTP 연결 전에 거부해요", async () => {
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

  test("인증 확인에서는 메일을 보내지 않고 연결을 닫아요", async () => {
    smtp.verify.mockResolvedValue(true);
    expect(await verifyGmailConnection(config)).toEqual({
      status: "ready",
      authenticated: true,
    });
    expect(smtp.verify).toHaveBeenCalledTimes(1);
    expect(smtp.sendMail).not.toHaveBeenCalled();
    expect(smtp.close).toHaveBeenCalledTimes(1);
  });

  test("자격증명 없는 연결 확인은 미인증 상태로 표시해요", async () => {
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

  test("TLS 연결을 넘길 때 호스트명을 유지하고 연결 제한 시간을 해제해요", async () => {
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

  test("SMTP 전 TLS 실패는 재시도할 수 있고 소켓을 두 번 전달하지 않아요", async () => {
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

  test("TLS 상대가 응답하지 않으면 연결 제한 시간에 소켓을 닫아요", async () => {
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
});
