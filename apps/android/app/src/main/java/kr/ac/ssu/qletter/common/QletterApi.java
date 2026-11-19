package kr.ac.ssu.qletter.common;

import java.io.IOException;
import java.io.InterruptedIOException;
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

  /**
   * 화면이 직접 cancel()한 요청이면 true예요. 이때는 실패 문구를 보여 주지 않아요.
   *
   * <p>OkHttp는 callTimeout이 지나도 cancel()로 요청을 끊어서 isCanceled()만으로는 시간 초과와 구분할 수 없어요. 시간 초과는
   * InterruptedIOException으로 오니 실패로 보여 줘야 해요.
   */
  public static boolean canceledByCaller(Call call, IOException error) {
    return call.isCanceled() && !(error instanceof InterruptedIOException);
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
