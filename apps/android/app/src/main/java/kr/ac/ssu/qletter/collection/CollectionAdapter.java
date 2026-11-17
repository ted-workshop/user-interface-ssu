package kr.ac.ssu.qletter.collection;

import android.view.LayoutInflater;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.databinding.ItemCollectionBinding;

public class CollectionAdapter extends RecyclerView.Adapter<CollectionAdapter.ViewHolder> {

  public interface OnItemLongClickListener {
    void onItemLongClick(int position);
  }

  public interface OnItemClickListener {
    void onItemClick(int position);
  }

  private final OnItemClickListener clickListener;

  private final List<ReportCollection> items;

  private final OnItemLongClickListener listener;

  public CollectionAdapter(
      List<ReportCollection> items,
      OnItemLongClickListener listener,
      OnItemClickListener clickListener) {
    this.items = items;
    this.listener = listener;
    this.clickListener = clickListener;
  }

  @NonNull
  @Override
  public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
    ItemCollectionBinding binding =
        ItemCollectionBinding.inflate(LayoutInflater.from(parent.getContext()), parent, false);
    ViewHolder holder = new ViewHolder(binding);
    binding
        .getRoot()
        .setOnClickListener(
            view -> {
              int position = holder.getBindingAdapterPosition();
              if (position == RecyclerView.NO_POSITION) return;
              clickListener.onItemClick(position);
            });
    binding
        .getRoot()
        .setOnLongClickListener(
            view -> {
              // 삭제 뒤 위치가 당겨질 수 있어서 누른 순간의 위치를 다시 읽어요.
              int position = holder.getBindingAdapterPosition();
              // 삭제 애니메이션 중처럼 위치를 모르면 NO_POSITION이 와요.
              if (position == RecyclerView.NO_POSITION) return false;
              listener.onItemLongClick(position);
              return true;
            });
    return holder;
  }

  @Override
  public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
    ReportCollection item = items.get(position);
    holder.binding.collectionName.setText(item.getName());
    holder.binding.collectionCount.setText(
        holder
            .itemView
            .getContext()
            .getString(R.string.collection_report_count, item.getReportCount()));
  }

  @Override
  public int getItemCount() {
    return items.size();
  }

  static class ViewHolder extends RecyclerView.ViewHolder {
    private final ItemCollectionBinding binding;

    ViewHolder(@NonNull ItemCollectionBinding binding) {
      super(binding.getRoot());
      this.binding = binding;
    }
  }
}
