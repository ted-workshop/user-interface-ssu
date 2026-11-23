package kr.ac.ssu.qletter.report;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import java.util.ArrayList;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.databinding.FragmentReportListBinding;
import kr.ac.ssu.qletter.databinding.ItemReportBinding;

public final class ReportListFragment extends Fragment {
  private static final String[] ORIGINS = {"", "direct", "channel"};
  private static final String[] DELIVERIES = {"", "not_applicable", "pending", "sent", "failed"};
  private FragmentReportListBinding binding;
  private ReportListViewModel model;
  private ReportAdapter adapter;
  private boolean restoring;

  public ReportListFragment() {
    super(R.layout.fragment_report_list);
  }

  @Override
  public void onCreate(@Nullable Bundle saved) {
    super.onCreate(saved);
    model = new ViewModelProvider(this).get(ReportListViewModel.class);
    if (!model.initialized && saved != null) {
      model.query =
          new ReportQuery(
              saved.getString("query", ""),
              saved.getString("origin", ""),
              saved.getString("delivery", ""),
              saved.getString("channel", ""));
    }
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle saved) {
    binding = FragmentReportListBinding.bind(view);
    restoring = true;
    binding.reportSearch.setText(model.query.title);
    binding.reportOrigin.setAdapter(
        ArrayAdapter.createFromResource(
            requireContext(),
            R.array.report_origins,
            android.R.layout.simple_spinner_dropdown_item));
    binding.reportDelivery.setAdapter(
        ArrayAdapter.createFromResource(
            requireContext(),
            R.array.report_deliveries,
            android.R.layout.simple_spinner_dropdown_item));
    binding.reportOrigin.setSelection(index(ORIGINS, model.query.origin));
    binding.reportDelivery.setSelection(index(DELIVERIES, model.query.delivery));
    AdapterView.OnItemSelectedListener filters =
        new AdapterView.OnItemSelectedListener() {
          @Override
          public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
            if (restoring) return;
            String origin = ORIGINS[binding.reportOrigin.getSelectedItemPosition()];
            String delivery = DELIVERIES[binding.reportDelivery.getSelectedItemPosition()];
            if (!origin.equals(model.query.origin) || !delivery.equals(model.query.delivery))
              search();
          }

          @Override
          public void onNothingSelected(AdapterView<?> parent) {}
        };
    binding.reportOrigin.setOnItemSelectedListener(filters);
    binding.reportDelivery.setOnItemSelectedListener(filters);
    binding.reportSearchButton.setOnClickListener(v -> search());
    binding.reportSearch.setOnEditorActionListener(
        (v, action, event) -> {
          if (action != EditorInfo.IME_ACTION_SEARCH) return false;
          search();
          return true;
        });
    binding.reportReset.setOnClickListener(
        v -> {
          restoring = true;
          binding.reportSearch.setText("");
          binding.reportOrigin.setSelection(0);
          binding.reportDelivery.setSelection(0);
          model.refresh(new ReportQuery("", "", "", ""));
          restoring = false;
        });
    binding.reportRetry.setOnClickListener(v -> model.load(model.nextFailed));
    binding.reportMore.setOnClickListener(v -> model.load(true));
    adapter = new ReportAdapter();
    binding.reportList.setLayoutManager(new LinearLayoutManager(requireContext()));
    binding.reportList.setAdapter(adapter);
    model.changes.observe(getViewLifecycleOwner(), ignored -> render());
    restoring = false;
    if (!model.initialized) model.load(false);
  }

  @Override
  public void onStart() {
    super.onStart();
    model.checkSession();
  }

  private void search() {
    String query = binding.reportSearch.getText().toString().trim();
    if (query.length() > 100) {
      binding.reportSearch.setError(getString(R.string.report_search_limit));
      return;
    }
    binding.reportSearch.setError(null);
    model.refresh(
        new ReportQuery(
            query,
            ORIGINS[binding.reportOrigin.getSelectedItemPosition()],
            DELIVERIES[binding.reportDelivery.getSelectedItemPosition()],
            model.query.channel));
  }

  private void render() {
    adapter.update(model.items);
    binding.reportLoading.setVisibility(model.loading ? View.VISIBLE : View.GONE);
    binding.reportMore.setVisibility(
        model.cursor != null && model.error == 0 ? View.VISIBLE : View.GONE);
    binding.reportMore.setEnabled(!model.loading);
    int message = model.error;
    if (message == 0 && !model.loading && model.items.isEmpty())
      message = model.query.filtered() ? R.string.report_no_matches : R.string.report_empty;
    binding.reportMessage.setVisibility(message == 0 ? View.GONE : View.VISIBLE);
    if (message != 0) binding.reportMessage.setText(message);
    binding.reportRetry.setVisibility(
        model.error != 0 && model.error != R.string.report_sign_in ? View.VISIBLE : View.GONE);
    binding.reportReset.setVisibility(model.query.filtered() ? View.VISIBLE : View.GONE);
    binding.reportChannel.setVisibility(model.query.channel.isEmpty() ? View.GONE : View.VISIBLE);
    binding.reportChannel.setText(R.string.report_channel_active);
  }

  private void open(ReportItem item) {
    getParentFragmentManager()
        .beginTransaction()
        .setReorderingAllowed(true)
        .replace(R.id.reports_content, ReportDetailFragment.create(item.id))
        .addToBackStack("report-detail")
        .commit();
  }

  @Override
  public void onSaveInstanceState(@NonNull Bundle out) {
    super.onSaveInstanceState(out);
    out.putString("query", model.query.title);
    out.putString("origin", model.query.origin);
    out.putString("delivery", model.query.delivery);
    out.putString("channel", model.query.channel);
  }

  @Override
  public void onDestroyView() {
    binding.reportList.setAdapter(null);
    binding = null;
    super.onDestroyView();
  }

  private static int index(String[] values, String value) {
    for (int i = 0; i < values.length; i++) if (values[i].equals(value)) return i;
    return 0;
  }

  private final class ReportAdapter extends RecyclerView.Adapter<ReportHolder> {
    private final List<ReportItem> rows = new ArrayList<>();

    ReportAdapter() {
      setStateRestorationPolicy(StateRestorationPolicy.PREVENT_WHEN_EMPTY);
    }

    void update(List<ReportItem> next) {
      if (rows.equals(next)) return;
      int oldSize = rows.size();
      boolean append = next.size() >= oldSize && next.subList(0, oldSize).equals(rows);
      rows.clear();
      rows.addAll(next);
      if (append) notifyItemRangeInserted(oldSize, rows.size() - oldSize);
      else {
        notifyItemRangeRemoved(0, oldSize);
        notifyItemRangeInserted(0, rows.size());
      }
    }

    @NonNull
    @Override
    public ReportHolder onCreateViewHolder(@NonNull ViewGroup parent, int type) {
      return new ReportHolder(
          ItemReportBinding.inflate(LayoutInflater.from(parent.getContext()), parent, false));
    }

    @Override
    public void onBindViewHolder(@NonNull ReportHolder holder, int position) {
      ReportItem item = rows.get(position);
      holder.row.reportTitle.setText(item.title);
      holder.row.reportMetadata.setText(item.metadata(getResources()));
      holder.row.reportOpen.setOnClickListener(v -> open(item));
      holder.row.reportChannelFilter.setVisibility(
          item.channelUrl.isEmpty() ? View.GONE : View.VISIBLE);
      holder.row.reportChannelFilter.setText(getString(R.string.report_same_channel, item.channel));
      holder.row.reportChannelFilter.setOnClickListener(
          v ->
              model.refresh(
                  new ReportQuery(
                      model.query.title,
                      model.query.origin,
                      model.query.delivery,
                      item.channelUrl)));
    }

    @Override
    public int getItemCount() {
      return rows.size();
    }
  }

  private static final class ReportHolder extends RecyclerView.ViewHolder {
    final ItemReportBinding row;

    ReportHolder(ItemReportBinding row) {
      super(row.getRoot());
      this.row = row;
    }
  }
}
