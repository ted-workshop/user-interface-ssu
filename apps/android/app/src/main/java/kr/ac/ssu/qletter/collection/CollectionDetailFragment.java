package kr.ac.ssu.qletter.collection;

import android.annotation.SuppressLint;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentManager;
import androidx.lifecycle.ViewModelProvider;
import androidx.recyclerview.widget.LinearLayoutManager;
import java.util.Objects;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.ConfirmDialog;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.common.SessionStore;
import kr.ac.ssu.qletter.databinding.FragmentCollectionDetailBinding;
import kr.ac.ssu.qletter.report.ReportDetailFragment;

/**
 * 피그마 60:88 모음 상세예요. 리포트 탭 안에서 모음 목록 대신 열어 하단 탭을 유지해요(ADR-0050).
 *
 * <p>뒤로 가면 모음 목록이 다시 만들어지면서 이름·개수를 새로 받아요. 그래서 바뀐 내용을 따로 돌려주지 않아요.
 */
public class CollectionDetailFragment extends Fragment {
  private static final String ARG_ID = "id";
  private static final String ARG_NAME = "name";
  private static final String ARG_REPORT_COUNT = "reportCount";
  private static final String STATE_NAME = "state_name";
  private static final String STATE_REPORT_COUNT = "state_report_count";

  private static final String REMOVE_REQUEST_KEY = "collection_remove_report";
  private static final String REMOVE_DIALOG_TAG = "collection_remove_dialog";

  private final Handler main = new Handler(Looper.getMainLooper());
  private FragmentCollectionDetailBinding binding;
  private CollectionReportAdapter adapter;
  private CollectionDetailViewModel model;
  // 이 화면의 어댑터가 반영한 마지막 변경 번호예요.
  private int appliedSeq;
  private CollectionApi collectionApi;
  private ReportCollection collection;
  private SessionStore sessions;
  private Long openedRevision;

  /** 모음 목록에서 받은 이름·개수로 먼저 그리고, 리포트는 서버에서 받아요. */
  public static CollectionDetailFragment create(ReportCollection collection) {
    CollectionDetailFragment fragment = new CollectionDetailFragment();
    Bundle args = new Bundle();
    args.putString(ARG_ID, collection.getId());
    args.putString(ARG_NAME, collection.getName());
    args.putInt(ARG_REPORT_COUNT, collection.getReportCount());
    fragment.setArguments(args);
    return fragment;
  }

  @Override
  public void onCreate(@Nullable Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // 다시 만들어지면 처음 인자 대신 저장해 둔 이름·개수를 써요. 리포트 상세에 다녀올 때는 이 객체가 그대로 남아요.
    Bundle args = requireArguments();
    String name = args.getString(ARG_NAME);
    int reportCount = args.getInt(ARG_REPORT_COUNT);
    if (savedInstanceState != null) {
      name = savedInstanceState.getString(STATE_NAME, name);
      reportCount = savedInstanceState.getInt(STATE_REPORT_COUNT, reportCount);
    }
    collection = new ReportCollection(name, reportCount, args.getString(ARG_ID));
    QletterApplication app = (QletterApplication) requireActivity().getApplication();
    collectionApi = new CollectionApi(app.api(), getResources());
    sessions = app.sessions();
    openedRevision = sessions.changes().getValue();
    // Fragment 범위 ViewModel이라 회전하거나 리포트 상세에 다녀와도 같은 목록과 요청을 이어 받아요.
    model = new ViewModelProvider(this).get(CollectionDetailViewModel.class);
    model.start(collectionApi, collection.getId(), reportCount);

    FragmentManager children = getChildFragmentManager();
    children.setFragmentResultListener(
        CollectionNameSheet.REQUEST_KEY,
        this,
        (key, result) -> {
          if (sessionChanged()) return;
          collection = CollectionNameSheet.collectionFrom(result);
          model.setReportCount(collection.getReportCount());
          showHeader();
        });
    children.setFragmentResultListener(
        CollectionDeleteDialog.REQUEST_KEY, this, (key, result) -> deleteCollection());
    children.setFragmentResultListener(
        REMOVE_REQUEST_KEY,
        this,
        (key, result) -> {
          if (sessionChanged()) return;
          model.remove(result.getString(ConfirmDialog.RESULT_ID));
        });
    // 리포트 상세는 같은 FragmentManager에서 이 화면 대신 열려요. 그 상세의 모음에 담기 시트에서
    // 이 모음이 바뀌었을 수 있어서, 돌아오면 목록·개수를 다시 받아요.
    getParentFragmentManager()
        .setFragmentResultListener(
            ReportDetailFragment.COLLECTIONS_CHANGED,
            this,
            (key, result) -> {
              if (!sessionChanged()) model.refresh();
            });
  }

  @Nullable
  @Override
  public View onCreateView(
      @NonNull LayoutInflater inflater,
      @Nullable ViewGroup container,
      @Nullable Bundle savedInstanceState) {
    binding = FragmentCollectionDetailBinding.inflate(inflater, container, false);
    return binding.getRoot();
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
    super.onViewCreated(view, savedInstanceState);
    binding.detailRetry.setOnClickListener(v -> model.load());
    binding.detailMore.setOnClickListener(v -> model.loadMore());
    binding.detailBack.setOnClickListener(v -> getParentFragmentManager().popBackStack());
    binding.detailRenameButton.setOnClickListener(
        v -> {
          // 빼는 중에는 열지 않아요. 두 응답이 겹치면 헤더 개수가 두 번 줄어요.
          if (Boolean.TRUE.equals(model.removingAny().getValue())) return;
          CollectionNameSheet.show(getChildFragmentManager(), collection);
        });
    binding.detailDeleteButton.setOnClickListener(
        v -> CollectionDeleteDialog.show(getChildFragmentManager(), collection));
    showHeader();

    adapter =
        new CollectionReportAdapter(
            model.reports(),
            new CollectionReportAdapter.Listener() {
              @Override
              public void onOpen(CollectionReport report) {
                openReport(report);
              }

              @Override
              public void onRemove(CollectionReport report) {
                confirmRemove(report);
              }

              @Override
              public boolean isRemoving(CollectionReport report) {
                return model.isRemoving(report.getId());
              }
            });
    binding.detailReportsList.setLayoutManager(new LinearLayoutManager(requireContext()));
    binding.detailReportsList.setAdapter(adapter);
    // 새 어댑터는 지금 목록을 통째로 그리니 지금까지의 변경은 이미 반영한 셈이에요.
    appliedSeq = model.seq();

    sessions
        .changes()
        .observe(
            getViewLifecycleOwner(),
            revision -> {
              if (sessionChanged()) closeForSessionChange();
            });
    model.changes().observe(getViewLifecycleOwner(), this::applyChange);
    model.status().observe(getViewLifecycleOwner(), this::renderStatus);
    model.error().observe(getViewLifecycleOwner(), this::renderError);
    model
        .removingAny()
        .observe(getViewLifecycleOwner(), busy -> binding.detailRenameButton.setEnabled(!busy));
    model
        .reportCount()
        .observe(
            getViewLifecycleOwner(),
            count -> {
              collection = new ReportCollection(collection.getName(), count, collection.getId());
              showHeader();
            });
  }

  @Override
  public void onStart() {
    super.onStart();
    // 백그라운드에 있는 동안 만료됐으면 돌아오자마자 개인 데이터를 지우고 닫아요.
    if (sessionChanged()) closeForSessionChange();
  }

  @Override
  public void onSaveInstanceState(@NonNull Bundle outState) {
    super.onSaveInstanceState(outState);
    outState.putString(STATE_NAME, collection.getName());
    outState.putInt(STATE_REPORT_COUNT, collection.getReportCount());
  }

  @Override
  public void onDestroyView() {
    binding = null;
    super.onDestroyView();
  }

  @Override
  public void onDestroy() {
    main.removeCallbacksAndMessages(null);
    super.onDestroy();
  }

  /** 상세를 연 뒤 로그인이 풀리거나 만료되거나 다른 계정으로 바뀌었는지 봐요. */
  private boolean sessionChanged() {
    return !sessions.isSignedIn() || !Objects.equals(sessions.changes().getValue(), openedRevision);
  }

  private void closeForSessionChange() {
    // 개인 데이터를 먼저 숨기고 모음 목록으로 돌아가요. 진행 중인 요청은 ViewModel이 정리될 때 취소돼요.
    if (binding != null) {
      binding.detailName.setText("");
      binding.detailCount.setText("");
      binding.detailReportsList.setVisibility(View.GONE);
    }
    if (!getParentFragmentManager().isStateSaved()) getParentFragmentManager().popBackStack();
  }

  /** 리포트 상세를 이 화면 자리에 열어요. 뒤로 가면 스크롤 위치 그대로 돌아와요. */
  private void openReport(CollectionReport report) {
    if (sessionChanged() || getParentFragmentManager().isStateSaved()) return;
    getParentFragmentManager()
        .beginTransaction()
        .setReorderingAllowed(true)
        .replace(getId(), ReportDetailFragment.create(report.getId(), collection.getName()))
        .addToBackStack("report-detail")
        .commit();
  }

  private void showHeader() {
    if (binding == null) return;
    binding.detailName.setText(collection.getName());
    binding.detailCount.setText(
        getString(R.string.collection_detail_summary, collection.getReportCount()));
  }

  private void deleteCollection() {
    collectionApi.delete(
        collection.getId(),
        new CollectionApi.Result<Void>() {
          @Override
          public void onSuccess(Void value) {
            main.post(
                () -> {
                  if (binding == null || sessionChanged()) return;
                  // 모음 목록으로 돌아가면 목록이 다시 만들어지면서 지운 모음이 빠져요.
                  if (!getParentFragmentManager().isStateSaved())
                    getParentFragmentManager().popBackStack();
                });
          }

          @Override
          public void onError(String message) {
            main.post(
                () -> {
                  if (binding == null) return;
                  Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show();
                });
          }
        });
  }

  private void confirmRemove(CollectionReport report) {
    ConfirmDialog.show(
        getChildFragmentManager(),
        REMOVE_DIALOG_TAG,
        REMOVE_REQUEST_KEY,
        getString(R.string.collection_remove_title),
        getString(R.string.collection_remove_message, report.getTitle()),
        getString(R.string.collection_remove),
        report.getId());
  }

  /** ViewModel이 바꾼 만큼만 목록을 다시 그려요. 놓친 변경이 있으면 전체를 다시 그려요. */
  @SuppressLint("NotifyDataSetChanged")
  private void applyChange(CollectionDetailViewModel.Change change) {
    if (change == null || change.seq <= appliedSeq) return;
    if (change.seq != appliedSeq + 1 || change.kind == CollectionDetailViewModel.RELOADED) {
      adapter.notifyDataSetChanged();
    } else if (change.kind == CollectionDetailViewModel.APPENDED) {
      adapter.notifyItemRangeInserted(change.position, change.count);
    } else if (change.kind == CollectionDetailViewModel.REMOVED) {
      adapter.notifyItemRemoved(change.position);
    } else {
      adapter.notifyItemChanged(change.position);
    }
    appliedSeq = change.seq;
    renderStatus(model.status().getValue());
  }

  private void renderStatus(CollectionDetailViewModel.Status status) {
    if (status == null || binding == null) return;
    binding.detailLoading.setVisibility(status.loading ? View.VISIBLE : View.GONE);
    if (status.loadError != null) {
      showState(status.loadError, true);
    } else if (!status.loading && model.reports().isEmpty() && !model.hasMore()) {
      showState(getString(R.string.collection_detail_empty), false);
    } else {
      binding.detailState.setVisibility(View.GONE);
    }
    boolean more = !status.loading && status.loadError == null && model.hasMore();
    binding.detailMore.setVisibility(more ? View.VISIBLE : View.GONE);
    binding.detailMore.setEnabled(!status.moreLoading);
    binding.detailMore.setText(
        status.moreLoading ? R.string.collection_more_loading : R.string.collection_more);
    binding.detailMoreError.setText(status.moreError);
    binding.detailMoreError.setVisibility(
        more && status.moreError != null ? View.VISIBLE : View.GONE);
  }

  /** 빼기 실패는 한 번만 알려요. 회전 뒤에 다시 뜨지 않게 보여 준 뒤 비워요. */
  private void renderError(String message) {
    if (message == null) return;
    Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show();
    model.consumeError();
  }

  private void showState(String message, boolean retry) {
    binding.detailMessage.setText(message);
    binding.detailRetry.setVisibility(retry ? View.VISIBLE : View.GONE);
    binding.detailState.setVisibility(View.VISIBLE);
  }
}
