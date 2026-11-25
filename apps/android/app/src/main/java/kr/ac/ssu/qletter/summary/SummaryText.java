package kr.ac.ssu.qletter.summary;

import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.ApiError;

final class SummaryText {
  private SummaryText() {}

  static int status(SummaryRequest request) {
    switch (request.status) {
      case "queued":
        return R.string.summary_queued;
      case "running":
        return R.string.summary_running;
      case "completed":
        return R.string.summary_completed;
      default:
        return R.string.summary_failed;
    }
  }

  static int explanation(SummaryRequest request) {
    if (request.pending()) return R.string.summary_progress_notice;
    if (request.reportId != null) return R.string.summary_complete_notice;
    switch (request.failureCode) {
      case "metadata_unavailable":
      case "invalid_url":
        return R.string.summary_video_unavailable;
      case "provider_outcome_unknown":
        return R.string.summary_outcome_unknown;
      case "configuration":
      case "quota":
        return R.string.summary_unavailable;
      case "channel_inactive":
        return R.string.summary_channel_inactive;
      default:
        return request.canRetry() ? R.string.summary_retry_notice : R.string.summary_no_retry;
    }
  }

  static int apiError(ApiError error) {
    if (error.isUnauthorized()) return R.string.report_sign_in;
    if (error.isNetwork()) return R.string.report_error_network;
    if (error.is("INVALID_INPUT")) return R.string.summary_invalid_url;
    if (error.is("USAGE_LIMIT_REACHED")) return R.string.summary_daily_limit;
    if (error.status() == 429) return R.string.summary_rate_limit;
    if (error.is("RETRY_NOT_ALLOWED")) return R.string.summary_retry_changed;
    if (error.status() == 404) return R.string.summary_not_found;
    if (error.is("SUMMARY_UNAVAILABLE")) return R.string.summary_unavailable;
    return R.string.summary_read_error;
  }
}
