package kr.ac.ssu.qletter.collection;

import androidx.annotation.Nullable;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;
import okhttp3.Call;

/**
 * 새 모음·이름 바꾸기 저장 요청을 시트보다 오래 들고 있어요.
 *
 * <p>화면을 돌려 시트가 다시 만들어져도 같은 ViewModel이 요청을 이어 받고, 결과는 LiveData로 전달해요. LiveData는 시트가 화면에
 * 보이는(STARTED) 동안에만 결과를 넘겨서, 앱이 백그라운드에 있을 때 상태 저장 뒤 시트를 닫는 일이 없어요.
 */
public final class CollectionSaveViewModel extends ViewModel {
  /** 저장 진행 상태예요. 성공이면 collection, 실패면 error가 들어 있어요. */
  static final class State {
    final boolean saving;
    @Nullable final ReportCollection collection;
    @Nullable final String error;
    final boolean created;

    private State(
        boolean saving,
        @Nullable ReportCollection collection,
        @Nullable String error,
        boolean created) {
      this.saving = saving;
      this.collection = collection;
      this.error = error;
      this.created = created;
    }
  }

  private final MutableLiveData<State> state = new MutableLiveData<>();
  private Call call;

  LiveData<State> state() {
    return state;
  }

  /** 이미 저장 중이면 다시 보내지 않아요. 결과는 작업 스레드에서 postValue로 넘겨요. */
  void save(CollectionApi api, @Nullable String originalId, String name) {
    State current = state.getValue();
    if (current != null && current.saving) return;
    boolean created = originalId == null;
    state.setValue(new State(true, null, null, created));
    CollectionApi.Result<ReportCollection> result =
        new CollectionApi.Result<ReportCollection>() {
          @Override
          public void onSuccess(ReportCollection value) {
            state.postValue(new State(false, value, null, created));
          }

          @Override
          public void onError(String message) {
            state.postValue(new State(false, null, message, created));
          }
        };
    call = created ? api.create(name, result) : api.rename(originalId, name, result);
  }

  /** 결과를 한 번 반영한 뒤 다시 전달되지 않게 비워요. */
  void consume() {
    state.setValue(null);
  }

  @Override
  protected void onCleared() {
    // 시트가 완전히 사라질 때만 불려요. 회전 때는 불리지 않아 요청이 이어져요.
    if (call != null) call.cancel();
  }
}
