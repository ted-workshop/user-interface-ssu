package kr.ac.ssu.qletter.common;

import java.io.IOException;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONException;

/** JSON 응답을 읽어 성공 값이나 {@link ApiError}로 전달해요. 콜백은 OkHttp 작업 스레드에서 실행돼요. */
public final class JsonCall {
  public interface Parser<T> {
    T parse(String body) throws JSONException;
  }

  public interface Result<T> {
    void onSuccess(T value);

    void onError(ApiError error);
  }

  private JsonCall() {}

  public static <T> void enqueue(Call call, Parser<T> parser, Result<T> result) {
    call.enqueue(
        new Callback() {
          @Override
          public void onFailure(Call failed, IOException error) {
            if (QletterApi.canceledByCaller(failed, error)) return;
            result.onError(ApiError.network());
          }

          @Override
          public void onResponse(Call answered, Response response) {
            try (ResponseBody body = response.body()) {
              String text = body == null ? "" : body.string();
              if (!response.isSuccessful()) {
                result.onError(
                    ApiError.from(
                        response.code(), text, retryAfterSeconds(response.header("Retry-After"))));
                return;
              }
              result.onSuccess(parser.parse(text));
            } catch (IOException error) {
              result.onError(ApiError.network());
            } catch (JSONException | IllegalArgumentException error) {
              result.onError(ApiError.invalidResponse(response.code()));
            }
          }
        });
  }

  private static long retryAfterSeconds(String value) {
    if (value == null) return 0;
    try {
      return Math.max(0, Long.parseLong(value.trim()));
    } catch (NumberFormatException ignored) {
      return 0;
    }
  }
}
