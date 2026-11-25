package kr.ac.ssu.qletter.summary;

import org.json.JSONException;
import org.json.JSONObject;

final class SummaryRequest {
  final String id;
  final String url;
  final String origin;
  final String status;
  final int attempt;
  final String reportId;
  final String failureCode;
  final boolean retryable;

  SummaryRequest(JSONObject json) throws JSONException {
    id = json.getString("id");
    url = SummaryInput.normalize(json.getString("url"));
    origin = json.getString("origin");
    status = json.getString("status");
    attempt = json.getInt("attempt");
    reportId = json.isNull("reportId") ? null : json.getString("reportId");
    failureCode = json.isNull("failureCode") ? "" : json.getString("failureCode");
    retryable = json.getBoolean("retryable");
    if (url == null
        || !(pending() || status.equals("completed") || status.equals("failed"))
        || (status.equals("completed") && (reportId == null || reportId.isEmpty())))
      throw new JSONException("요청 상태를 확인할 수 없어요.");
  }

  boolean pending() {
    return status.equals("queued") || status.equals("running");
  }

  boolean canRetry() {
    return status.equals("failed") && retryable && attempt >= 1 && attempt <= 3;
  }
}
