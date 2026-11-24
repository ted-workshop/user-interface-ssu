package kr.ac.ssu.qletter.report;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Spanned;
import android.view.View;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.view.ViewCompat;
import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentManager;
import androidx.fragment.app.FragmentTransaction;
import io.noties.markwon.AbstractMarkwonPlugin;
import io.noties.markwon.Markwon;
import io.noties.markwon.MarkwonConfiguration;
import java.util.Objects;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.collection.AddToCollectionSheet;
import kr.ac.ssu.qletter.collection.ReportCommentsFragment;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.common.SessionStore;
import kr.ac.ssu.qletter.databinding.FragmentReportDetailBinding;
import okhttp3.Call;

/** 상세도 탭 안의 Fragment로 열어 하단 탐색을 유지해요. 모음 상세에서도 같은 Fragment를 열어요. */
public final class ReportDetailFragment extends Fragment {
  public static final String ARG_REPORT_ID = "reportId";

  /** 모음에 담기 시트에서 하나라도 반영되면 띄운 쪽 FragmentManager로 이 키를 보내요. 모음 상세는 목록과 개수를 다시 받아요. */
  public static final String COLLECTIONS_CHANGED = "report_detail_collections_changed";

  private static final String ARG_BACK_LABEL = "backLabel";
  private FragmentReportDetailBinding binding;
  private final Handler main = new Handler(Looper.getMainLooper());
  private Call call;
  private int generation;
  private SessionStore sessions;
  private Long revision;
  private ReportApi api;
  private Markwon markdown;

  public ReportDetailFragment() {
    super(R.layout.fragment_report_detail);
  }

  public static ReportDetailFragment create(String reportId) {
    return create(reportId, null);
  }

  /** backLabel을 주면 뒤로 버튼에 "← 내 리포트" 대신 그 이름을 보여 줘요. 모음 상세에서 모음 이름을 넘겨요. */
  public static ReportDetailFragment create(String reportId, @Nullable String backLabel) {
    ReportDetailFragment fragment = new ReportDetailFragment();
    Bundle arguments = new Bundle();
    arguments.putString(ARG_REPORT_ID, reportId);
    arguments.putString(ARG_BACK_LABEL, backLabel);
    fragment.setArguments(arguments);
    return fragment;
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle saved) {
    binding = FragmentReportDetailBinding.bind(view);
    ViewCompat.setAccessibilityHeading(binding.detailTitle, true);
    QletterApplication app = (QletterApplication) requireActivity().getApplication();
    sessions = app.sessions();
    revision = sessions.changes().getValue();
    api = new ReportApi(app.api(), getResources());
    markdown =
        Markwon.builder(requireContext())
            .usePlugin(
                new AbstractMarkwonPlugin() {
                  @Override
                  public void configureConfiguration(
                      @NonNull MarkwonConfiguration.Builder builder) {
                    builder.linkResolver((linkView, link) -> openWeb(link));
                  }
                })
            .build();
    String backLabel = requireArguments().getString(ARG_BACK_LABEL);
    if (backLabel != null)
      binding.reportBack.setText(getString(R.string.report_back_to, backLabel));
    binding.reportBack.setOnClickListener(v -> getParentFragmentManager().popBackStack());
    // 시트는 이 Fragment의 자식이라 결과도 여기로 와요. 띄운 쪽이 목록을 다시 받게 그대로 넘겨요.
    getChildFragmentManager()
        .setFragmentResultListener(
            AddToCollectionSheet.REQUEST_KEY,
            getViewLifecycleOwner(),
            (key, result) ->
                getParentFragmentManager().setFragmentResult(COLLECTIONS_CHANGED, result));
    binding.detailRetry.setOnClickListener(v -> load());
    sessions
        .changes()
        .observe(
            getViewLifecycleOwner(),
            ignored -> {
              if (!validSession()) clearPrivateContent();
            });
    load();
  }

  @Override
  public void onStart() {
    super.onStart();
    if (!validSession()) clearPrivateContent();
  }

  private boolean validSession() {
    return sessions.isSignedIn() && Objects.equals(revision, sessions.changes().getValue());
  }

  private void clearPrivateContent() {
    generation++;
    if (call != null) call.cancel();
    if (binding == null) return;
    binding.detailBody.setText("");
    binding.detailTitle.setText("");
    binding.detailMetadata.setText("");
    binding.detailContent.setVisibility(View.GONE);
    // 댓글과 모음에 담기 시트도 개인 데이터라 함께 닫아요.
    FragmentManager children = getChildFragmentManager();
    if (!children.getFragments().isEmpty()) {
      FragmentTransaction close = children.beginTransaction();
      for (Fragment child : children.getFragments()) close.remove(child);
      close.commitAllowingStateLoss();
    }
    showError(R.string.report_sign_in);
  }

  private void load() {
    if (!validSession()) {
      clearPrivateContent();
      return;
    }
    if (call != null) call.cancel();
    int request = ++generation;
    binding.detailLoading.setVisibility(View.VISIBLE);
    binding.detailMessage.setVisibility(View.GONE);
    binding.detailRetry.setVisibility(View.GONE);
    binding.detailContent.setVisibility(View.GONE);
    String id = requireArguments().getString(ARG_REPORT_ID);
    if (id == null || id.isEmpty()) {
      showError(R.string.report_not_found);
      return;
    }
    call =
        api.detail(
            id,
            new ReportApi.Result<ReportItem>() {
              @Override
              public void success(ReportItem report) {
                // 본문 해석도 네트워크 콜백 작업 스레드에서 수행해 UI를 막지 않아요.
                Spanned styled = markdown.toMarkdown(report.body);
                main.post(
                    () -> {
                      if (binding == null || request != generation || !validSession()) return;
                      binding.detailLoading.setVisibility(View.GONE);
                      binding.detailContent.setVisibility(View.VISIBLE);
                      binding.detailTitle.setText(report.title);
                      binding.detailMetadata.setText(report.metadata(getResources()));
                      binding.detailVerification.setText(
                          report.timestampsVerified
                              ? R.string.report_ai_notice
                              : R.string.report_time_notice);
                      markdown.setParsedMarkdown(binding.detailBody, styled);
                      binding.detailVideo.setEnabled(report.videoUrl != null);
                      binding.detailVideo.setOnClickListener(v -> openWeb(report.videoUrl));
                      binding.detailAddCollection.setOnClickListener(
                          v -> AddToCollectionSheet.open(getChildFragmentManager(), id));
                      showComments(id);
                    });
              }

              @Override
              public void failure(int message) {
                main.post(
                    () -> {
                      if (binding == null || request != generation || !validSession()) return;
                      showError(message);
                    });
              }
            });
  }

  /** 본문을 읽을 수 있을 때만 댓글 영역을 붙여요. 회전 뒤에는 FragmentManager가 다시 붙여 둔 것을 써요. */
  private void showComments(String id) {
    FragmentManager children = getChildFragmentManager();
    if (children.findFragmentById(R.id.detail_comments) != null) return;
    // 응답이 화면이 멈춘 뒤에 올 수 있어요. 그때 빠져도 다시 열면 불러오면서 다시 붙여요.
    children
        .beginTransaction()
        .setReorderingAllowed(true)
        .add(R.id.detail_comments, ReportCommentsFragment.newInstance(id))
        .commitAllowingStateLoss();
  }

  private void showError(int message) {
    binding.detailLoading.setVisibility(View.GONE);
    binding.detailMessage.setText(message);
    binding.detailMessage.setVisibility(View.VISIBLE);
    binding.detailRetry.setVisibility(
        message == R.string.report_sign_in || message == R.string.report_not_found
            ? View.GONE
            : View.VISIBLE);
  }

  private void openWeb(String link) {
    String safe = ReportLinks.web(link);
    if (safe == null) {
      Toast.makeText(requireContext(), R.string.report_link_unavailable, Toast.LENGTH_SHORT).show();
      return;
    }
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(safe)));
    } catch (ActivityNotFoundException error) {
      Toast.makeText(requireContext(), R.string.report_link_unavailable, Toast.LENGTH_SHORT).show();
    }
  }

  @Override
  public void onDestroyView() {
    generation++;
    if (call != null) call.cancel();
    binding = null;
    super.onDestroyView();
  }
}
