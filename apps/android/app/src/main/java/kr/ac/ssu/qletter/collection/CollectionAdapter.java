package kr.ac.ssu.qletter.collection;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.databinding.ItemCollectionBinding;

public class CollectionAdapter extends RecyclerView.Adapter<CollectionAdapter.ViewHolder> {

  public interface OnItemClickListener {
    void onItemClick(int position);
  }

  private final List<ReportCollection> items;
  private final OnItemClickListener openListener;
  private final OnItemClickListener renameListener;
  private final OnItemClickListener deleteListener;

  public CollectionAdapter(
      List<ReportCollection> items,
      OnItemClickListener openListener,
      OnItemClickListener renameListener,
      OnItemClickListener deleteListener) {
    this.items = items;
    this.openListener = openListener;
    this.renameListener = renameListener;
    this.deleteListener = deleteListener;
  }

  @NonNull
  @Override
  public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
    ItemCollectionBinding binding =
        ItemCollectionBinding.inflate(LayoutInflater.from(parent.getContext()), parent, false);
    ViewHolder holder = new ViewHolder(binding);
    binding.collectionOpen.setOnClickListener(view -> notify(holder, openListener));
    binding.collectionRenameButton.setOnClickListener(view -> notify(holder, renameListener));
    binding.collectionDeleteButton.setOnClickListener(view -> notify(holder, deleteListener));
    return holder;
  }

  /** 삭제 뒤 위치가 당겨질 수 있어서 누른 순간의 위치를 다시 읽어요. */
  private static void notify(ViewHolder holder, OnItemClickListener listener) {
    int position = holder.getBindingAdapterPosition();
    // 삭제 애니메이션 중처럼 위치를 모르면 NO_POSITION이 와요.
    if (position == RecyclerView.NO_POSITION) return;
    listener.onItemClick(position);
  }

  @Override
  public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
    ReportCollection item = items.get(position);
    View root = holder.itemView;
    holder.binding.collectionName.setText(item.getName());
    holder.binding.collectionCount.setText(
        root.getContext().getString(R.string.collection_report_count, item.getReportCount()));
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
