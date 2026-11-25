package kr.ac.ssu.qletter.home;

import android.os.Bundle;
import android.view.View;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.view.ViewCompat;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.MainActivity;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.databinding.FragmentHomeBinding;
import kr.ac.ssu.qletter.databinding.ItemStatusRowBinding;

public final class HomeFragment extends Fragment {
  private FragmentHomeBinding binding;
  private HomeViewModel model;
  private String restoredId;
  private HomeApi.Dashboard renderedDashboard;

  public HomeFragment() {
    super(R.layout.fragment_home);
  }

  @Override
  public void onCreate(@Nullable Bundle saved) {
    super.onCreate(saved);
    model = new ViewModelProvider(requireActivity()).get(HomeViewModel.class);
    restoredId = saved == null ? null : saved.getString("checkId");
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle saved) {
    binding = FragmentHomeBinding.bind(view);
    ViewCompat.setAccessibilityHeading(binding.homeTitle, true);
    ViewCompat.setAccessibilityHeading(binding.homeRecentTitle, true);
    binding.homeRefresh.setOnClickListener(v -> model.refresh());
    binding.homeCheck.setOnClickListener(v -> model.requestCheck());
    binding.homeCheckRefresh.setOnClickListener(v -> model.refreshCheck());
    binding.homeSummarize.setOnClickListener(
        v -> ((MainActivity) requireActivity()).openTab(R.id.tab_summary));
    binding.homeAllReports.setOnClickListener(
        v -> ((MainActivity) requireActivity()).openTab(R.id.tab_reports));
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
    binding.homeLoading.setVisibility(model.loading ? View.VISIBLE : View.GONE);
    binding.homeRefresh.setEnabled(!model.loading);
    binding.homeError.setVisibility(model.error == 0 ? View.GONE : View.VISIBLE);
    if (model.error != 0) binding.homeError.setText(model.error);
    binding.homeContent.setVisibility(model.dashboard == null ? View.GONE : View.VISIBLE);
    binding.homeCheck.setEnabled(model.canCheck());
    binding.homeCheckRefresh.setVisibility(model.checkId == null ? View.GONE : View.VISIBLE);
    binding.homeCheckRefresh.setEnabled(!model.checking);
    binding.homeCheckProgress.setVisibility(
        model.checking || model.activeCheck() ? View.VISIBLE : View.GONE);
    binding.homeCheckError.setVisibility(model.checkError == 0 ? View.GONE : View.VISIBLE);
    if (model.checkError != 0) binding.homeCheckError.setText(model.checkError);
    binding.homeCheckStatus.setVisibility(model.check == null ? View.GONE : View.VISIBLE);
    if (model.check != null) {
      StringBuilder status =
          new StringBuilder(
              getString(
                  model.activeCheck()
                      ? R.string.home_check_pending
                      : model.check.status.equals("failed")
                          ? R.string.home_check_failed
                          : R.string.home_check_complete));
      for (HomeApi.ChannelResult row : model.channels.values())
        status
            .append('\n')
            .append(
                getString(
                    R.string.home_channel_result,
                    row.title.isEmpty() ? getString(R.string.report_unknown_channel) : row.title,
                    getString(
                        row.failed
                            ? R.string.home_channel_failed
                            : R.string.home_channel_checked)));
      binding.homeCheckStatus.setText(status);
    }
    if (model.dashboard == null) return;
    HomeApi.Dashboard data = model.dashboard;
    binding.homeCounts.setText(
        getString(R.string.home_counts, data.activeChannels, data.queued, data.running));
    binding.homeAttention.setText(
        getString(
            R.string.home_attention,
            data.failedSummaries,
            data.pendingDeliveries,
            data.failedDeliveries));
    binding.homeCheckTimes.setText(
        getString(R.string.home_check_times, time(data.lastCheckedAt), time(data.nextCheckAt)));
    binding.homeEmpty.setVisibility(data.reports.isEmpty() ? View.VISIBLE : View.GONE);
    if (renderedDashboard == data) return;
    renderedDashboard = data;
    binding.homeRecent.removeAllViews();
    for (HomeApi.Report row : data.reports) {
      ItemStatusRowBinding item =
          ItemStatusRowBinding.inflate(getLayoutInflater(), binding.homeRecent, false);
      int delivery =
          row.delivery.equals("failed")
              ? R.string.report_delivery_failed
              : row.delivery.equals("pending")
                  ? R.string.report_delivery_pending
                  : row.delivery.equals("sent")
                      ? R.string.report_delivery_sent
                      : R.string.report_delivery_none;
      item.rowTitle.setText(row.title.isEmpty() ? getString(R.string.report_untitled) : row.title);
      item.rowMetadata.setText(
          getString(
              R.string.home_report_row,
              row.channel.isEmpty() ? getString(R.string.report_unknown_channel) : row.channel,
              getString(
                  row.origin.equals("channel")
                      ? R.string.report_origin_channel
                      : R.string.report_origin_direct),
              getString(delivery)));
      item.getRoot().setOnClickListener(v -> ((MainActivity) requireActivity()).openReport(row.id));
      binding.homeRecent.addView(item.getRoot());
    }
  }

  private String time(String value) {
    return value == null
        ? getString(R.string.home_time_none)
        : value.replace('T', ' ').replace(".000Z", " UTC").replace("Z", " UTC");
  }

  @Override
  public void onSaveInstanceState(@NonNull Bundle out) {
    super.onSaveInstanceState(out);
    if (model.checkId != null) out.putString("checkId", model.checkId);
  }

  @Override
  public void onDestroyView() {
    binding = null;
    renderedDashboard = null;
    super.onDestroyView();
  }
}
