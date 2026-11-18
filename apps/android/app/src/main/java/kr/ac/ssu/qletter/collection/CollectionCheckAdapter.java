package kr.ac.ssu.qletter.collection;

import android.view.LayoutInflater;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.databinding.ItemCollectionCheckBinding;

/** 모음에 담기 시트의 체크 목록이에요. 줄을 누르면 그 모음의 체크를 바꿔요. */
public class CollectionCheckAdapter
    extends RecyclerView.Adapter<CollectionCheckAdapter.ViewHolder> {
  private final List<CollectionCheck> items;

  public CollectionCheckAdapter(List<CollectionCheck> items) {
    this.items = items;
  }

  @NonNull
  @Override
  public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
    ItemCollectionCheckBinding binding =
        ItemCollectionCheckBinding.inflate(LayoutInflater.from(parent.getContext()), parent, false);
    ViewHolder holder = new ViewHolder(binding);
    binding.checkRow.setOnClickListener(
        view -> {
          int position = holder.getBindingAdapterPosition();
          if (position == RecyclerView.NO_POSITION) return;
          CollectionCheck item = items.get(position);
          item.setChecked(!item.isChecked());
          notifyItemChanged(position);
        });
    return holder;
  }

  @Override
  public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
    CollectionCheck item = items.get(position);
    holder.binding.checkName.setText(item.getCollection().getName());
    holder.binding.checkCount.setText(
        holder
            .itemView
            .getContext()
            .getString(R.string.add_to_collection_count, item.getCollection().getReportCount()));
    if (item.isChecked()) {
      holder.binding.checkBox.setBackgroundResource(R.drawable.q_check_on);
      holder.binding.checkBox.setText(R.string.add_to_collection_check_mark);
    } else {
      holder.binding.checkBox.setBackgroundResource(R.drawable.q_check_off);
      holder.binding.checkBox.setText("");
    }
  }

  @Override
  public int getItemCount() {
    return items.size();
  }

  static class ViewHolder extends RecyclerView.ViewHolder {
    private final ItemCollectionCheckBinding binding;

    ViewHolder(@NonNull ItemCollectionCheckBinding binding) {
      super(binding.getRoot());
      this.binding = binding;
    }
  }
}
