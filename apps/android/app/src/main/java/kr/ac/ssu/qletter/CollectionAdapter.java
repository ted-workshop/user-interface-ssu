package kr.ac.ssu.qletter;

import android.view.LayoutInflater;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import java.util.List;
import kr.ac.ssu.qletter.databinding.ItemCollectionBinding;

public class CollectionAdapter extends RecyclerView.Adapter<CollectionAdapter.ViewHolder> {

  private final List<ReportCollection> items;

  public CollectionAdapter(List<ReportCollection> items) {
    this.items = items;
  }

  @NonNull
  @Override
  public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
    ItemCollectionBinding binding =
        ItemCollectionBinding.inflate(LayoutInflater.from(parent.getContext()), parent, false);
    return new ViewHolder(binding);
  }

  @Override
  public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
    ReportCollection item = items.get(position);
    holder.binding.collectionName.setText(item.getName());
    holder.binding.collectionCount.setText("리포트" + item.getReportCount() + "개");
  }

  @Override
  public int getItemCount() {
    return items.size();
  }

  static class ViewHolder extends RecyclerView.ViewHolder {
    private ItemCollectionBinding binding;

    ViewHolder(@NonNull ItemCollectionBinding binding) {
      super(binding.getRoot());
      this.binding = binding;
    }
  }
}
