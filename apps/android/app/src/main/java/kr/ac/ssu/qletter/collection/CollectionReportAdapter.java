package kr.ac.ssu.qletter.collection;

import android.content.Context;
import android.text.format.DateFormat;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import java.util.Calendar;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.databinding.ItemCollectionReportBinding;

public class CollectionReportAdapter
    extends RecyclerView.Adapter<CollectionReportAdapter.ViewHolder> {
  /** 줄의 빼기 버튼을 눌렀을 때 화면에 알려요. */
  interface Listener {
    void onRemove(CollectionReport report);

    /** 빼는 중이면 버튼을 잠가 두 번 보내지 않아요. */
    boolean isRemoving(CollectionReport report);
  }

  private final List<CollectionReport> items;
  private final Listener listener;

  public CollectionReportAdapter(List<CollectionReport> items, Listener listener) {
    this.items = items;
    this.listener = listener;
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
    Context context = holder.itemView.getContext();
    holder.binding.reportTitle.setText(item.getTitle());
    holder.binding.reportChannel.setText(
        context.getString(
            R.string.report_meta,
            item.getChannelName(),
            dayLabel(context, item.getCreatedAtMillis())));
    holder.binding.reportOrigin.setText(
        item.isChannelOrigin() ? R.string.report_origin_channel : R.string.report_origin_direct);
    holder.binding.reportDeliveryFailed.setVisibility(
        item.isDeliveryFailed() ? View.VISIBLE : View.GONE);
    boolean removing = listener.isRemoving(item);
    holder.binding.reportRemove.setEnabled(!removing);
    // TalkBack이 "빼기"만 읽지 않고 어느 리포트를 빼는지 함께 읽어요.
    holder.binding.reportRemove.setContentDescription(
        context.getString(R.string.collection_remove_description, item.getTitle()));
    holder.binding.reportRemove.setOnClickListener(
        v -> {
          int current = holder.getBindingAdapterPosition();
          if (current != RecyclerView.NO_POSITION) listener.onRemove(items.get(current));
        });
  }

  /** 피그마처럼 오늘·어제는 말로, 그 밖에는 "11월 16일"처럼 보여 줘요. */
  private static String dayLabel(Context context, long millis) {
    Calendar created = Calendar.getInstance();
    created.setTimeInMillis(millis);
    Calendar today = Calendar.getInstance();
    if (sameDay(created, today)) return context.getString(R.string.report_day_today);
    today.add(Calendar.DAY_OF_YEAR, -1);
    if (sameDay(created, today)) return context.getString(R.string.report_day_yesterday);
    return DateFormat.format(context.getString(R.string.report_day_format), created).toString();
  }

  private static boolean sameDay(Calendar a, Calendar b) {
    return a.get(Calendar.YEAR) == b.get(Calendar.YEAR)
        && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR);
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
