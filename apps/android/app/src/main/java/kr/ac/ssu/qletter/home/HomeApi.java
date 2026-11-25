package kr.ac.ssu.qletter.home;

import java.util.ArrayList;
import java.util.List;
import kr.ac.ssu.qletter.common.JsonCall;
import kr.ac.ssu.qletter.common.QletterApi;
import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class HomeApi {
  static final class Report {
    final String id;
    final String title;
    final String channel;
    final String origin;
    final String delivery;

    Report(JSONObject json) throws JSONException {
      id = json.getString("id");
      title = json.isNull("title") ? "" : json.getString("title");
      channel = json.isNull("channelName") ? "" : json.getString("channelName");
      JSONObject viewer = json.getJSONObject("viewerContext");
      origin = viewer.getString("origin");
      delivery = viewer.getString("deliveryStatus");
    }
  }

  static final class Dashboard {
    final List<Report> reports = new ArrayList<>();
    final int activeChannels;
    final int queued;
    final int running;
    final int failedSummaries;
    final int pendingDeliveries;
    final int failedDeliveries;
    final String lastCheckedAt;
    final String nextCheckAt;

    Dashboard(String text) throws JSONException {
      JSONObject json = new JSONObject(text);
      JSONArray rows = json.getJSONArray("recentReports");
      for (int i = 0; i < rows.length(); i++) reports.add(new Report(rows.getJSONObject(i)));
      activeChannels = json.getInt("activeChannelCount");
      JSONObject summary = json.getJSONObject("summaryCounts");
      queued = summary.getInt("queued");
      running = summary.getInt("running");
      failedSummaries = summary.getInt("failed");
      JSONObject delivery = json.getJSONObject("deliveryCounts");
      pendingDeliveries = delivery.getInt("pending");
      failedDeliveries = delivery.getInt("failed");
      lastCheckedAt = json.isNull("lastCheckedAt") ? null : json.getString("lastCheckedAt");
      nextCheckAt = json.isNull("nextCheckAt") ? null : json.getString("nextCheckAt");
    }
  }

  static final class ChannelResult {
    final String id;
    final String title;
    final boolean failed;

    ChannelResult(JSONObject json) throws JSONException {
      id = json.getString("subscriptionId");
      title = json.isNull("title") ? "" : json.getString("title");
      failed = "failed".equals(json.getString("status"));
    }
  }

  static final class Check {
    final String id;
    final String status;
    final String nextId;
    final List<ChannelResult> channels = new ArrayList<>();

    Check(String text) throws JSONException {
      JSONObject json = new JSONObject(text);
      id = json.getString("id");
      status = json.getString("status");
      nextId = json.isNull("nextCheckId") ? null : json.getString("nextCheckId");
      JSONArray rows = json.getJSONArray("channels");
      for (int i = 0; i < rows.length(); i++)
        channels.add(new ChannelResult(rows.getJSONObject(i)));
      if (!(pending() || status.equals("completed") || status.equals("failed")))
        throw new JSONException("채널 확인 상태를 읽지 못했어요.");
    }

    boolean pending() {
      return status.equals("queued") || status.equals("running");
    }
  }

  private final QletterApi api;

  HomeApi(QletterApi api) {
    this.api = api;
  }

  Call dashboard(JsonCall.Result<Dashboard> result) {
    Call call = api.newCall(new Request.Builder().url(api.endpoint("dashboard").build()).build());
    JsonCall.enqueue(call, Dashboard::new, result);
    return call;
  }

  Call check(String id, JsonCall.Result<Check> result) {
    Request.Builder request = new Request.Builder();
    if (id == null)
      request
          .url(api.endpoint("channel-checks").build())
          .post(RequestBody.create("{}", MediaType.get("application/json; charset=utf-8")));
    else request.url(api.endpoint("channel-checks", id).build());
    Call call = api.newCall(request.build());
    JsonCall.enqueue(call, Check::new, result);
    return call;
  }
}
