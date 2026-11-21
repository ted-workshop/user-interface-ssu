package kr.ac.ssu.qletter.report;

import android.content.res.Resources;
import kr.ac.ssu.qletter.R;
import org.json.JSONException;
import org.json.JSONObject;

final class ReportItem {
  final String id;
  final String title;
  final String channel;
  final String channelUrl;
  final String videoUrl;
  final String savedAt;
  final String origin;
  final String delivery;
  final String body;
  final boolean timestampsVerified;

  ReportItem(JSONObject json, Resources resources, boolean detail) throws JSONException {
    id = json.getString("id");
    title = text(json, "title", resources.getString(R.string.report_untitled));
    channel = text(json, "channelName", resources.getString(R.string.report_unknown_channel));
    channelUrl = text(json, "channelUrl", "");
    videoUrl = ReportLinks.video(json.getString("videoId"));
    JSONObject viewer = json.optJSONObject("viewerContext");
    savedAt = viewer == null ? json.getString("createdAt") : viewer.getString("savedAt");
    origin = viewer == null ? "" : viewer.getString("origin");
    delivery = viewer == null ? "" : viewer.getString("deliveryStatus");
    body = detail ? json.getString("bodyMarkdown") : "";
    timestampsVerified = "verified".equals(json.optString("timestampVerification"));
  }

  String metadata(Resources resources) {
    String date = savedAt.length() >= 10 ? savedAt.substring(0, 10) : savedAt;
    return resources.getString(
        R.string.report_metadata,
        channel,
        date,
        resources.getString(
            "channel".equals(origin)
                ? R.string.report_origin_channel
                : R.string.report_origin_direct),
        resources.getString(deliveryLabel()));
  }

  private int deliveryLabel() {
    switch (delivery) {
      case "failed":
        return R.string.report_delivery_failed;
      case "pending":
        return R.string.report_delivery_pending;
      case "sent":
        return R.string.report_delivery_sent;
      default:
        return R.string.report_delivery_none;
    }
  }

  private static String text(JSONObject json, String key, String fallback) {
    return json.isNull(key) ? fallback : json.optString(key, fallback);
  }
}
