package kr.ac.ssu.qletter.summary;

import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.view.ViewCompat;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.MainActivity;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.databinding.FragmentSummaryBinding;
import kr.ac.ssu.qletter.databinding.ItemStatusRowBinding;

public final class SummaryFragment extends Fragment {
  private FragmentSummaryBinding binding;
  private SummaryViewModel model;
  private String restoredId;
  private String renderedHistory;

  public SummaryFragment() {
    super(R.layout.fragment_summary);
  }

  @Override
  public void onCreate(@Nullable Bundle saved) {
    super.onCreate(saved);
    model = new ViewModelProvider(requireActivity()).get(SummaryViewModel.class);
    restoredId = saved == null ? null : saved.getString("requestId");
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle saved) {
    binding = FragmentSummaryBinding.bind(view);
    ViewCompat.setAccessibilityHeading(binding.summaryTitle, true);
    ViewCompat.setAccessibilityHeading(binding.summaryHistoryTitle, true);
    binding.summaryUrl.setText(model.input);
    binding.summaryUrl.addTextChangedListener(
        new TextWatcher() {
          @Override
          public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

          @Override
          public void onTextChanged(CharSequence s, int start, int before, int count) {
            model.input = s.toString();
            binding.summarySubmit.setEnabled(model.canSubmit());
          }

          @Override
          public void afterTextChanged(Editable value) {}
        });
    binding.summaryUrl.setOnFocusChangeListener(
        (v, focused) -> {
          if (!focused
              && !model.input.trim().isEmpty()
              && SummaryInput.normalize(model.input) == null)
            binding.summaryUrl.setError(getString(R.string.summary_invalid_url));
        });
    binding.summaryUrl.setOnEditorActionListener(
        (v, action, event) -> {
          if (action != EditorInfo.IME_ACTION_GO) return false;
          model.submit();
          return true;
        });
    binding.summarySubmit.setOnClickListener(v -> model.submit());
    binding.summaryRefresh.setOnClickListener(v -> model.refreshCurrent());
    binding.summaryRetry.setOnClickListener(v -> model.retryAnalysis());
    binding.summaryRead.setOnClickListener(
        v -> {
          if (model.current != null && model.current.reportId != null)
            ((MainActivity) requireActivity()).openReport(model.current.reportId);
        });
    binding.summaryAnother.setOnClickListener(
        v -> {
          binding.summaryUrl.setText("");
          binding.summaryUrl.requestFocus();
          binding.getRoot().smoothScrollTo(0, 0);
        });
    binding.summaryHistoryRefresh.setOnClickListener(v -> model.loadHistory(false));
    binding.summaryMore.setOnClickListener(v -> model.loadHistory(true));
    model.changes.observe(getViewLifecycleOwner(), ignored -> render());
    ((QletterApplication) requireActivity().getApplication())
        .sessions()
        .changes()
        .observe(getViewLifecycleOwner(), ignored -> model.checkSession());
  }

  @Override
  public void onStart() {
    super.onStart();
    model.start(restoredId);
    restoredId = null;
  }

  @Override
  public void onStop() {
    model.stop();
    super.onStop();
  }

  private void render() {
    binding.summarySubmit.setEnabled(model.canSubmit());
    binding.summaryLoading.setVisibility(
        model.loading || model.submitting || model.loadingHistory ? View.VISIBLE : View.GONE);
    binding.summaryError.setVisibility(model.error == 0 ? View.GONE : View.VISIBLE);
    if (model.error != 0) binding.summaryError.setText(model.error);
    binding.summaryRefresh.setEnabled(!model.loading && !model.submitting);
    binding.summaryRefresh.setVisibility(
        model.current != null || model.error != 0 ? View.VISIBLE : View.GONE);
    binding.summaryCurrent.setVisibility(model.current == null ? View.GONE : View.VISIBLE);
    if (model.current != null) {
      binding.summaryStatus.setText(SummaryText.status(model.current));
      binding.summaryVideo.setText(model.current.url);
      binding.summaryExplanation.setText(SummaryText.explanation(model.current));
      binding.summaryRetry.setVisibility(model.current.canRetry() ? View.VISIBLE : View.GONE);
      binding.summaryRetry.setEnabled(model.canRetry());
      binding.summaryRead.setVisibility(model.current.reportId == null ? View.GONE : View.VISIBLE);
      binding.summaryAnother.setVisibility(model.current.pending() ? View.GONE : View.VISIBLE);
    }
    binding.summaryHistoryError.setVisibility(model.historyError == 0 ? View.GONE : View.VISIBLE);
    if (model.historyError != 0) binding.summaryHistoryError.setText(model.historyError);
    binding.summaryEmpty.setVisibility(
        !model.loadingHistory && model.history.isEmpty() && model.historyError == 0
            ? View.VISIBLE
            : View.GONE);
    binding.summaryHistoryRefresh.setEnabled(!model.loadingHistory);
    binding.summaryMore.setVisibility(model.cursor == null ? View.GONE : View.VISIBLE);
    binding.summaryMore.setEnabled(!model.loadingHistory);
    StringBuilder fingerprint = new StringBuilder();
    for (SummaryRequest row : model.history)
      fingerprint.append(row.id).append(row.status).append(row.reportId);
    if (fingerprint.toString().equals(renderedHistory)) {
      for (int i = 0; i < binding.summaryHistory.getChildCount(); i++)
        binding.summaryHistory.getChildAt(i).setEnabled(!model.loading && !model.submitting);
      return;
    }
    renderedHistory = fingerprint.toString();
    binding.summaryHistory.removeAllViews();
    for (SummaryRequest row : model.history) {
      ItemStatusRowBinding item =
          ItemStatusRowBinding.inflate(getLayoutInflater(), binding.summaryHistory, false);
      item.rowTitle.setText(
          getString(
              R.string.summary_history_row,
              getString(SummaryText.status(row)),
              getString(
                  "channel".equals(row.origin)
                      ? R.string.report_origin_channel
                      : R.string.report_origin_direct)));
      item.rowMetadata.setText(row.url);
      item.getRoot().setEnabled(!model.loading && !model.submitting);
      item.getRoot().setOnClickListener(v -> model.select(row));
      binding.summaryHistory.addView(item.getRoot());
    }
  }

  @Override
  public void onSaveInstanceState(@NonNull Bundle out) {
    super.onSaveInstanceState(out);
    if (model.current != null) out.putString("requestId", model.current.id);
  }

  @Override
  public void onDestroyView() {
    binding = null;
    renderedHistory = null;
    super.onDestroyView();
  }
}
