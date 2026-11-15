package kr.ac.ssu.qletter;

import android.view.LayoutInflater;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import java.util.List;
import kr.ac.ssu.qletter.databinding.ItemCollectionReportBinding;

public class CollectionReportAdapter
    extends RecyclerView.Adapter<CollectionReportAdapter.ViewHolder> {
  private final List<CollectionReport> items;

  public CollectionReportAdapter(List<CollectionReport> items) {
    this.items = items;
  }

  @NonNull
  @Override
  public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
    ItemCollectionReportBinding binding =
        ItemCollectionReportBinding.inflate(
            LayoutInflater.from(parent.getContext()), parent, false);
    return new ViewHolder(binding);
  }

  @Override
  public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
    CollectionReport item = items.get(position);
    holder.binding.reportTitle.setText(item.getTitle());
    holder.binding.reportChannel.setText(item.getChannelName());
  }

  @Override
  public int getItemCount() {
    return items.size();
  }

  static class ViewHolder extends RecyclerView.ViewHolder {
    private final ItemCollectionReportBinding binding;

    ViewHolder(@NonNull ItemCollectionReportBinding binding) {
      super(binding.getRoot());
      this.binding = binding;
    }
  }
}
