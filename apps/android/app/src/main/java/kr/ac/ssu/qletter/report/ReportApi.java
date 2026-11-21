package kr.ac.ssu.qletter.report;

import android.content.res.Resources;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.QletterApi;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class ReportApi {
  interface Result<T> {
    void success(T value);

    void failure(int message);
  }

  interface Parser<T> {
    T parse(JSONObject json) throws JSONException;
  }

  static final class Page {
    final List<ReportItem> items;
    final String cursor;

    Page(List<ReportItem> items, String cursor) {
      this.items = Collections.unmodifiableList(items);
      this.cursor = cursor;
    }
  }

  private final QletterApi api;
  private final Resources resources;

  ReportApi(QletterApi api, Resources resources) {
    this.api = api;
    this.resources = resources;
  }

  Call list(ReportQuery query, String cursor, Result<Page> result) {
    return send(
        new Request.Builder().url(query.url(api.endpoint("reports"), cursor)).build(),
        json -> {
          JSONArray data = json.getJSONArray("items");
          List<ReportItem> items = new ArrayList<>();
          for (int i = 0; i < data.length(); i++)
            items.add(new ReportItem(data.getJSONObject(i), resources, false));
          return new Page(items, json.isNull("nextCursor") ? null : json.getString("nextCursor"));
        },
        result);
  }

  Call detail(String id, Result<ReportItem> result) {
    return send(
        new Request.Builder().url(api.endpoint("reports", id).build()).build(),
        json -> new ReportItem(json, resources, true),
        result);
  }

  private <T> Call send(Request request, Parser<T> parser, Result<T> result) {
    Call call = api.newCall(request);
    call.enqueue(
        new Callback() {
          @Override
          public void onFailure(Call call, IOException error) {
            if (!QletterApi.canceledByCaller(call, error))
              result.failure(R.string.report_error_network);
          }

          @Override
          public void onResponse(Call call, Response response) {
            try (Response closed = response) {
              if (!response.isSuccessful()) {
                int status = response.code();
                result.failure(
                    status == 401
                        ? R.string.report_sign_in
                        : status == 404 ? R.string.report_not_found : R.string.report_error_server);
              } else if (response.body() == null) {
                result.failure(R.string.report_error_response);
              } else {
                result.success(parser.parse(new JSONObject(response.body().string())));
              }
            } catch (IOException | JSONException | IllegalArgumentException error) {
              result.failure(R.string.report_error_response);
            }
          }
        });
    return call;
  }
}
