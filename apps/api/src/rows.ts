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
