package kr.ac.ssu.qletter;

import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** 개인 API 요청을 생성할 때의 세션과 서버에 고정해요. */
public final class QletterApi {
  interface Sessions {
    Session current();

    void invalidate(Session sent);
  }

  private final HttpUrl base;
  private final Sessions sessions;
  private final OkHttpClient client;

  QletterApi(String baseUrl, Sessions sessions) {
    base = HttpUrl.get(baseUrl).newBuilder().addPathSegment("v1").addPathSegment("").build();
    this.sessions = sessions;
    client =
        new OkHttpClient.Builder()
            .callTimeout(15, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .followRedirects(false)
            .followSslRedirects(false)
            .addInterceptor(
                chain -> {
                  Request request = chain.request();
                  Session sent = request.tag(Session.class);
                  if (sent == null || sent != sessions.current())
                    throw new IOException("로그인이 필요해요.");
                  Response response =
                      chain.proceed(
                          request
                              .newBuilder()
                              .header("Accept", "application/json")
                              .header("Authorization", "Bearer " + sent.token)
                              .build());
                  if (sent != sessions.current()) {
                    response.close();
                    throw new IOException("세션이 변경됐어요.");
                  }
                  if (response.code() == 401) sessions.invalidate(sent);
                  return response;
                })
            .build();
  }

  public HttpUrl.Builder endpoint(String... segments) {
    HttpUrl.Builder builder = base.newBuilder();
    for (String segment : segments) builder.addPathSegment(segment);
    return builder;
  }

  public Call newCall(Request request) {
    HttpUrl url = request.url();
    if (!base.scheme().equals(url.scheme())
        || !base.host().equals(url.host())
        || base.port() != url.port()
        || !url.encodedPath().startsWith(base.encodedPath())
        || !url.username().isEmpty()
        || !url.password().isEmpty()
        || url.fragment() != null)
      throw new IllegalArgumentException("지정한 Qletter API 주소를 사용해 주세요.");
    return client.newCall(request.newBuilder().tag(Session.class, sessions.current()).build());
  }
}
