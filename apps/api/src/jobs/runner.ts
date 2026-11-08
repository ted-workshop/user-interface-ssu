import { runAuthMail } from "../auth-mail";
import { EmailError, sendEmail } from "../email";
import { generateReport, getVideoMetadata, SummaryError } from "../summary";
import {
  claimAnalysis,
  completeAnalysis,
  failAnalysis,
  getAnalysisJob,
  markAnalysisDispatched,
  parseGenerationProfile,
  recoverAnalysis,
} from "./analysis";
import {
  cancelUndispatchedDelivery,
  claimDelivery,
  completeDelivery,
  failDelivery,
  getDeliveryMessage,
  markDeliveryDispatched,
  recoverDeliveries,
} from "./delivery";
import { unixNow } from "./shared";

export type JobProviders = {
  metadata: typeof getVideoMetadata;
  generate: typeof generateReport;
  send: typeof sendEmail;
  now: () => number;
};
const providers: JobProviders = {
  metadata: getVideoMetadata,
  generate: generateReport,
  send: sendEmail,
  now: unixNow,
};

export async function runBackgroundJobs(
  env: Env,
  io: JobProviders = providers,
) {
  await recoverAnalysis(env.DB, io.now());
  await recoverDeliveries(env.DB, io.now());
  // 각 종류는 D1에서 한 개만 점유해 중첩 Cron도 동시에 같은 공급자를 호출하지 않아요.
  const outcomes = await Promise.allSettled([
    runAnalysis(env, io),
    runDelivery(env, io),
    runAuthMail(env, io.send, io.now()),
  ]);
  if (outcomes.some((outcome) => outcome.status === "rejected")) {
    console.error(JSON.stringify({ event: "job.storage_or_runtime_error" }));
    throw new Error(
      "영속 작업 실행을 마치지 못했어요. 다음 예약 실행에서 저장 상태를 확인해요.",
    );
  }
}

async function runAnalysis(env: Env, io: JobProviders) {
  const claim = await claimAnalysis(env.DB, io.now());
  if (!claim) return;
  const job = await getAnalysisJob(env.DB, claim.id);

  let metadata: Awaited<ReturnType<typeof getVideoMetadata>>;
  let model: string;
  try {
    const config = await parseGenerationProfile(
      job.generationConfigJson,
      job.generationKey,
    );
    model = config.model;
    if (!env.GEMINI_API_KEY?.trim()) throw new SummaryError("configuration");
    metadata = await io.metadata(
      `https://www.youtube.com/watch?v=${job.videoId}`,
    );
  } catch (error) {
    await failAnalysis(
      env.DB,
      claim,
      error instanceof SummaryError ? error.reason : "configuration",
      io.now(),
    );
    return;
  }
  if (!(await markAnalysisDispatched(env.DB, claim, io.now()))) return;
  let report: Awaited<ReturnType<typeof generateReport>>;
  try {
    report = await io.generate(
      { apiKey: env.GEMINI_API_KEY, model, timeoutMs: 600_000 },
      metadata,
    );
  } catch (error) {
    const { code, usage } = generationFailure(error);
    await failAnalysis(env.DB, claim, code, io.now(), usage);
    return;
  }
  // 공급자 성공 후 DB 오류는 공급자 실패로 덮어쓰거나 재호출하지 않아요.
  await completeAnalysis(
    env.DB,
    claim,
    {
      ...report,
      title: metadata.title,
      channel: metadata.channel,
      channelUrl: metadata.channelUrl,
      model: report.model ?? model,
    },
    io.now(),
  );
}

function generationFailure(error: unknown) {
  if (!(error instanceof SummaryError))
    return { code: "provider_outcome_unknown", usage: null };

  switch (error.reason) {
    case "temporary":
      // 한 번만 호출하므로 503은 처리되지 않은 요청이에요. 사용자가 다시 시도할 수 있어요.
      if (error.httpStatus === 503)
        return { code: "temporary", usage: error.usage };
      // 다른 5xx는 공급자가 처리하다 실패했을 수 있어 결과 불명으로 남겨요.
      return { code: "provider_outcome_unknown", usage: error.usage };
    case "timeout":
    case "unknown":
      return { code: "provider_outcome_unknown", usage: error.usage };
    default:
      return { code: error.reason, usage: error.usage };
  }
}

async function runDelivery(env: Env, io: JobProviders) {
  const claim = await claimDelivery(env.DB, io.now());
  if (!claim) return;
  const message = await getDeliveryMessage(env.DB, claim.id);
  if (!(await markDeliveryDispatched(env.DB, claim, io.now()))) {
    await cancelUndispatchedDelivery(env.DB, claim, io.now());
    return;
  }
  try {
    await io.send(
      { user: env.SMTP_USER, appPassword: env.SMTP_APP_PASSWORD },
      {
        deliveryId: claim.id,
        to: message.recipientEmail,
        subject: message.title.replace(/[\r\n]/g, " "),
        text: message.bodyMarkdown,
        html: `<pre>${escapeHtml(message.bodyMarkdown)}</pre>`,
      },
    );
  } catch (error) {
    await failDelivery(
      env.DB,
      claim,
      error instanceof EmailError ? error.reason : "ambiguous",
      io.now(),
    );
    return;
  }
  await completeDelivery(env.DB, claim, io.now());
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
