export const MAX_ATTEMPTS = 3;
export const ANALYSIS_LEASE_SECONDS = 660;
export const DELIVERY_LEASE_SECONDS = 120;
export const unixNow = () => Math.floor(Date.now() / 1_000);

export type JobClaim = {
  id: string;
  token: string;
  attemptId: string;
  attempt: number;
};

export class JobError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "RETRY_NOT_ALLOWED"
      | "INELIGIBLE"
      | "SUMMARY_UNAVAILABLE"
      | "USAGE_LIMIT_REACHED",
  ) {
    super(code);
    this.name = "JobError";
  }
}

export function statement(
  db: D1Database,
  query: string,
  ...values: (string | number | null)[]
) {
  return db.prepare(query).bind(...values);
}

export function jobLog(
  kind: "analysis" | "delivery",
  id: string,
  event: string,
  attempt: number,
  failureCode: string | null = null,
) {
  // 본문·주소·공급자 원문·비밀값은 로그에 포함하지 않아요.
  console.info(
    JSON.stringify({
      event: `job.${event}`,
      kind,
      jobId: id,
      attempt,
      failureCode,
    }),
  );
}

// 채널 확인은 시도 번호가 없어 작업 ID와 실패 코드만 남겨요.
export function checkLog(
  id: string,
  event: string,
  failureCode: string | null = null,
) {
  console.info(
    JSON.stringify({
      event: `check.${event}`,
      kind: "channel_check",
      jobId: id,
      failureCode,
    }),
  );
}
