package kr.ac.ssu.qletter.report;

import okhttp3.HttpUrl;

/** 목록의 모든 페이지가 같은 검색 조건을 사용해요. */
final class ReportQuery {
  final String title;
  final String origin;
  final String delivery;
  final String channel;

  ReportQuery(String title, String origin, String delivery, String channel) {
    this.title = title.trim();
    this.origin = origin;
    this.delivery = delivery;
    this.channel = channel;
  }

  boolean filtered() {
    return !title.isEmpty() || !origin.isEmpty() || !delivery.isEmpty() || !channel.isEmpty();
  }

  HttpUrl url(HttpUrl.Builder endpoint, String cursor) {
    endpoint.addQueryParameter("limit", "20");
    if (!title.isEmpty()) endpoint.addQueryParameter("q", title);
    if (!origin.isEmpty()) endpoint.addQueryParameter("origin", origin);
    if (!delivery.isEmpty()) endpoint.addQueryParameter("deliveryStatus", delivery);
    if (!channel.isEmpty()) endpoint.addQueryParameter("channelUrl", channel);
    if (cursor != null) endpoint.addQueryParameter("cursor", cursor);
    return endpoint.build();
  }
}
