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
import io.noties.markwon.AbstractMarkwonPlugin;
import io.noties.markwon.Markwon;
import io.noties.markwon.MarkwonConfiguration;
import java.util.Objects;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.common.SessionStore;
import kr.ac.ssu.qletter.databinding.FragmentReportDetailBinding;
import okhttp3.Call;

/** 상세도 탭 안의 Fragment로 열어 하단 탐색을 유지해요. */
public final class ReportDetailFragment extends Fragment {
  public static final String ARG_REPORT_ID = "reportId";
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
    ReportDetailFragment fragment = new ReportDetailFragment();
    Bundle arguments = new Bundle();
    arguments.putString(ARG_REPORT_ID, reportId);
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
    binding.reportBack.setOnClickListener(v -> getParentFragmentManager().popBackStack());
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
