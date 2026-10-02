package kr.ac.ssu.qletter;

import com.squareup.moshi.JsonAdapter;
import com.squareup.moshi.JsonDataException;
import com.squareup.moshi.Moshi;
import com.squareup.moshi.Types;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

public final class HealthClient {
  private final HttpUrl url;
  private final OkHttpClient client;
  private final JsonAdapter<Map<String, Object>> adapter =
      new Moshi.Builder()
          .build()
          .adapter(Types.newParameterizedType(Map.class, String.class, Object.class));

  public HealthClient(String baseUrl) {
    this(
        baseUrl,
        new OkHttpClient.Builder()
            .connectTimeout(3, TimeUnit.SECONDS)
            .callTimeout(10, TimeUnit.SECONDS)
            .build());
  }

  HealthClient(String baseUrl, OkHttpClient client) {
    this.url = HttpUrl.get(baseUrl).newBuilder().addPathSegment("health").build();
    this.client = client;
  }

  public void check() throws IOException {
    try (Response response = client.newCall(new Request.Builder().url(url).build()).execute()) {
      if (!response.isSuccessful()) throw new IOException("Health request failed");
      ResponseBody body = response.body();
      if (body == null) throw new IOException("Empty health response");
      Map<String, Object> data;
      try {
        data = adapter.fromJson(body.string());
      } catch (JsonDataException error) {
        throw new IOException("Invalid health response", error);
      }
      if (data == null
          || !"ok".equals(data.get("status"))
          || !"qletter-api".equals(data.get("service"))) {
        throw new IOException("Unexpected health response");
      }
    }
  }
}
