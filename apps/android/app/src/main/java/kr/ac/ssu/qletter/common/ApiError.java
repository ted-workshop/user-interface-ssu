package kr.ac.ssu.qletter.common;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

/** 서버 오류 코드와 필드 안내를 화면이 분기할 수 있는 형태로 보관해요. */
public final class ApiError {
  /** 응답 본문을 읽지 못했을 때예요. 네트워크 실패와 구분해요. */
  public static final String INVALID_RESPONSE = "INVALID_RESPONSE";

  private final int status;
  private final String code;
  private final Map<String, String> fields;
  private final long retryAfterSeconds;

  private ApiError(int status, String code, Map<String, String> fields, long retryAfterSeconds) {
    this.status = status;
    this.code = code;
    this.fields = Collections.unmodifiableMap(fields);
    this.retryAfterSeconds = retryAfterSeconds;
  }

  public static ApiError from(int status, String body, long retryAfterSeconds) {
    String code = "";
    Map<String, String> fields = new HashMap<>();
    try {
      JSONObject error = new JSONObject(body).getJSONObject("error");
      code = error.optString("code", "");
      JSONObject given = error.optJSONObject("fields");
      if (given != null) {
        java.util.Iterator<String> names = given.keys();
        while (names.hasNext()) {
          String name = names.next();
          fields.put(name, given.optString(name, ""));
        }
      }
    } catch (JSONException ignored) {
      // JSON이 아닌 오류 본문은 상태 코드만으로 안내해요.
    }
    return new ApiError(status, code, fields, retryAfterSeconds);
  }

  /** 서버에 닿지 못했거나 응답을 받는 중 연결이 끊겼어요. */
  public static ApiError network() {
    return new ApiError(0, "", new HashMap<>(), 0);
  }

  public static ApiError invalidResponse(int status) {
    return new ApiError(status, INVALID_RESPONSE, new HashMap<>(), 0);
  }

  public int status() {
    return status;
  }

  public String code() {
    return code;
  }

  public boolean is(String expected) {
    return expected.equals(code);
  }

  public boolean isNetwork() {
    return status == 0;
  }

  public boolean isUnauthorized() {
    return status == 401;
  }

  public String field(String name) {
    return fields.get(name);
  }

  public long retryAfterSeconds() {
    return retryAfterSeconds;
  }
}
