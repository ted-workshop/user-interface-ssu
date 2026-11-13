// D1 행 타입을 한 곳에 모아요. 스키마가 바뀌면 고칠 곳이 여기 하나로 줄어요.
// SQL은 snake_case 컬럼을 camelCase alias로 돌려주고, 그 이름을 이 타입과 맞춰요.

// 분석 작업을 실행할 때 필요한 생성 설정이에요.
export type AnalysisJobRow = {
  videoId: string;
  generationKey: string;
  generationConfigJson: string;
};

// 세션 토큰 하나로 확인한 사용자예요.
export type SessionRow = { userId: string };

// 존재 여부만 확인하는 조회의 결과예요.
export type IdRow = { id: string };

// 만료된 실행권을 회수할 대상과 그때까지 쌓인 시도 횟수예요.
export type ExpiredRunRow = { id: string; attempt: number };

// 메일 발송에 필요한 보고서 본문이에요.
export type DeliveryMessageRow = {
  recipientEmail: string;
  title: string;
  bodyMarkdown: string;
};

// 개인 요약 요청과 연결된 작업·보고서 상태예요.
export type RequestRow = {
  id: string;
  videoId: string;
  origin: "direct" | "channel";
  createdAt: number;
  updatedAt: number;
  eligible: number;
  analysisJobId: string;
  status: "queued" | "running" | "completed" | "failed";
  jobStatus: string;
  attempt: number;
  failureCode: string | null;
  jobFailure: string | null;
  reportId: string | null;
};

// 개인 메일 발송 상태예요.
export type DeliveryRow = {
  id: string;
  status: string;
  attempt: number;
  failureCode: string | null;
  eligible: number;
  availableAt: number;
};

// 공통 보고서와 현재 사용자의 보관 정보예요. 보관 관계가 없는 공개 열람은 요청·보관 값이 NULL이에요.
export type ReportRow = {
  id: string;
  videoId: string;
  title: string;
  channelName: string;
  channelUrl: string | null;
  model: string;
  timestampVerification: string;
  createdAt: number;
  requestId: string | null;
  origin: "direct" | "channel" | null;
  deliveryStatus: "not_applicable" | "pending" | "sent" | "failed";
  savedAt: number | null;
};

// 상세 조회에서만 읽는 보고서 본문이에요.
export type ReportDetailRow = ReportRow & { bodyMarkdown: string };

// 화면에 보이는 댓글이에요. 작성자는 닉네임만 담아요.
export type CommentRow = {
  id: string;
  body: string;
  nickname: string;
  createdAt: number;
  canDelete: number;
};

// 메일 확인·비밀번호 재설정에 쓸 수 있는 토큰이에요.
export type AccountTokenRow = { id: string; userId: string };

// 로그인 검증에 필요한 계정이에요.
export type LoginUserRow = {
  id: string;
  email: string;
  nickname: string;
  passwordHash: string;
  emailVerifiedAt: number | null;
};

// 내 정보 응답에 쓰는 계정이에요.
export type AccountRow = { id: string; email: string; nickname: string };

// 발송 실행권을 얻은 인증 메일이에요.
export type AuthMailRow = {
  id: string;
  tokenCiphertext: string;
  attempts: number;
  purpose: "verify_email" | "reset_password" | "verify_recipient";
  email: string;
};

// 요청 제한을 센 결과예요.
export type RateLimitRow = { count: number; windowEnd: number };

// 내 모음과 담긴 리포트 수예요. reportId를 함께 물으면 그 리포트가 담겼는지도 돌려줘요.
export type CollectionRow = {
  id: string;
  name: string;
  reportCount: number;
  containsReport: number | null;
  createdAt: number;
};

// 모음 안의 리포트예요. 담은 시각으로 정렬해요.
export type CollectionReportRow = ReportRow & { addedAt: number };

// 본인의 채널 구독과 공식 출처에서 확인한 공통 채널 정보예요.
export type SubscriptionRow = {
  id: string;
  youtubeChannelId: string;
  title: string;
  url: string;
  status: "active" | "paused";
  baselineInitializedAt: number | null;
  lastCheckedAt: number | null;
  nextCheckAt: number | null;
  createdAt: number;
};
export type RecipientRow = {
  id: string;
  email: string;
  verifiedAt: number | null;
  createdAt: number;
};
export type RecipientTokenRow = { id: string; recipientId: string };

// 지금 확인·예약 확인 작업이에요. 실행권 token으로 중첩 실행의 결과 저장을 막아요.
export type ChannelCheckRow = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  manual: number;
  failureCode: string | null;
  createdAt: number;
  finishedAt: number | null;
};
export type ChannelCheckClaim = {
  id: string;
  userId: string;
  token: string;
  manual: number;
};

// 확인할 활성 구독과 공식 채널 정보예요.
export type ChannelCheckTargetRow = {
  id: string;
  channelId: string;
  youtubeChannelId: string;
  baselineInitializedAt: number | null;
  lastCheckedAt: number | null;
  nextCheckAt: number | null;
};

// 확인을 시도한 채널별 결과예요. 확인 완료와 영상 분석 완료는 달라요.
export type ChannelCheckResultRow = {
  subscriptionId: string;
  title: string;
  status: "completed" | "failed";
  failureCode:
    | "provider_unavailable"
    | "invalid_response"
    | "processing_failed"
    | null;
  lastCheckedAt: number | null;
};
