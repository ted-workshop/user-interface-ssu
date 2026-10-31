-- 공통 분석의 새 실행을 접수한 사용자만 차감하고 합류·응답 재전달은 차감하지 않아요.
CREATE TABLE summary_admissions (
  analysis_job_id TEXT NOT NULL REFERENCES analysis_jobs(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  accepted_at INTEGER NOT NULL,
  PRIMARY KEY (analysis_job_id, attempt_number)
) STRICT;
CREATE INDEX summary_admissions_user_time ON summary_admissions(user_id, accepted_at);
