package kr.ac.ssu.qletter.collection;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.CheckBox;
import androidx.annotation.NonNull;
import androidx.core.view.AccessibilityDelegateCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat;
import androidx.recyclerview.widget.RecyclerView;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.databinding.ItemCollectionCheckBinding;

/** 모음에 담기 시트의 체크 목록이에요. 줄을 누르면 그 모음의 체크를 바꿔요. */
public class CollectionCheckAdapter
    extends RecyclerView.Adapter<CollectionCheckAdapter.ViewHolder> {
  // payload가 있으면 같은 줄 View를 다시 써서 TalkBack 초점이 남아요.
  private static final Object CHECK_CHANGED = new Object();

  private final List<CollectionCheck> items;
  private boolean enabled = true;

  public CollectionCheckAdapter(List<CollectionCheck> items) {
    this.items = items;
  }

  /** 저장하는 동안에는 체크를 바꾸지 못하게 해요. */
  void setEnabled(boolean enabled) {
    this.enabled = enabled;
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
          if (!enabled || position == RecyclerView.NO_POSITION) return;
          CollectionCheck item = items.get(position);
          item.setChecked(!item.isChecked());
          notifyItemChanged(position, CHECK_CHANGED);
        });
    // 체크 상자는 그림이라 줄 전체를 체크 상자로 읽어 줘요.
    ViewCompat.setAccessibilityDelegate(
        binding.checkRow,
        new AccessibilityDelegateCompat() {
          @Override
          public void onInitializeAccessibilityNodeInfo(
              @NonNull View host, @NonNull AccessibilityNodeInfoCompat info) {
            super.onInitializeAccessibilityNodeInfo(host, info);
            int position = holder.getBindingAdapterPosition();
            if (position == RecyclerView.NO_POSITION) return;
            info.setClassName(CheckBox.class.getName());
            info.setCheckable(true);
            info.setChecked(
                items.get(position).isChecked()
                    ? AccessibilityNodeInfoCompat.CHECKED_STATE_TRUE
                    : AccessibilityNodeInfoCompat.CHECKED_STATE_FALSE);
            info.setEnabled(enabled);
          }
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
      holder.binding.checkBox.setImageResource(R.drawable.ic_check);
    } else {
      holder.binding.checkBox.setBackgroundResource(R.drawable.q_check_off);
      holder.binding.checkBox.setImageDrawable(null);
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
