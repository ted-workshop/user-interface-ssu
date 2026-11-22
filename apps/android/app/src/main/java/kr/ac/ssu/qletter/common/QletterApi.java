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
  private final OkHttpClient publicClient;

  QletterApi(String baseUrl, Sessions sessions) {
    base = HttpUrl.get(baseUrl).newBuilder().addPathSegment("v1").addPathSegment("").build();
    this.sessions = sessions;
    OkHttpClient.Builder builder =
        new OkHttpClient.Builder()
            .callTimeout(15, TimeUnit.SECONDS)
            // 저장 요청이 자동으로 두 번 가지 않게 OkHttp 전체 재시도는 꺼요(ADR-0038).
            .retryOnConnectionFailure(false)
            .followRedirects(false)
            .followSslRedirects(false);
    // 로그인·가입·비밀번호 재설정 요청은 세션이 없어도 보낼 수 있어요.
    publicClient = builder.build();
    client =
        builder
            .addInterceptor(
                chain -> {
                  Request request = chain.request();
                  Session sent = request.tag(Session.class);
                  if (sent == null || sent != sessions.current())
                    throw new IOException("로그인이 필요해요.");
                  Request authorized =
                      request
                          .newBuilder()
                          .header("Accept", "application/json")
                          .header("Authorization", "Bearer " + sent.token)
                          .build();
                  Response response;
                  try {
                    response = chain.proceed(authorized);
                  } catch (IOException error) {
                    // 서버가 닫은 keep-alive 연결을 다시 쓰다 실패하면 조회만 새 연결로 한 번 더 보내요.
                    if (!safeToRetry(authorized) || chain.call().isCanceled()) throw error;
                    // 첫 요청 중 로그아웃·계정 전환·만료가 일어났으면 이전 토큰으로 다시 보내지 않아요(ADR-0038).
                    if (sent != sessions.current()) throw new IOException("세션이 변경됐어요.");
                    response = chain.proceed(authorized);
                  }
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

  /** 다시 보내도 서버 상태가 바뀌지 않는 요청만 재전송해요. */
  private static boolean safeToRetry(Request request) {
    return "GET".equals(request.method()) || "HEAD".equals(request.method());
  }

  public HttpUrl.Builder endpoint(String... segments) {
    HttpUrl.Builder builder = base.newBuilder();
    for (String segment : segments) builder.addPathSegment(segment);
    return builder;
  }

  public Call newCall(Request request) {
    checkBase(request.url());
    return client.newCall(request.newBuilder().tag(Session.class, sessions.current()).build());
  }

  /** 로그인 전에 쓰는 공개 API 요청이에요. 세션 토큰을 붙이지 않아요. */
  public Call newPublicCall(Request request) {
    checkBase(request.url());
    return publicClient.newCall(request.newBuilder().header("Accept", "application/json").build());
  }

  private void checkBase(HttpUrl url) {
    if (!base.scheme().equals(url.scheme())
        || !base.host().equals(url.host())
        || base.port() != url.port()
        || !url.encodedPath().startsWith(base.encodedPath())
        || !url.username().isEmpty()
        || !url.password().isEmpty()
        || url.fragment() != null)
      throw new IllegalArgumentException("지정한 Qletter API 주소를 사용해 주세요.");
  }
}
