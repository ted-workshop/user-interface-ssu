package kr.ac.ssu.qletter.channel;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.databinding.ItemChannelBinding;

final class ChannelAdapter extends RecyclerView.Adapter<ChannelAdapter.Holder> {
  interface Listener {
    void onToggle(Channel channel);

    void onDelete(Channel channel);
  }

  private final List<Channel> items;
  private final Listener listener;
  private String busyId;

  ChannelAdapter(List<Channel> items, Listener listener) {
    this.items = items;
    this.listener = listener;
  }

  void setBusyId(String id) {
    busyId = id;
    notifyDataSetChanged();
  }

  @NonNull
  @Override
  public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
    return new Holder(
        ItemChannelBinding.inflate(LayoutInflater.from(parent.getContext()), parent, false));
  }

  @Override
  public void onBindViewHolder(@NonNull Holder holder, int position) {
    Channel item = items.get(position);
    boolean busy = busyId != null;
    holder.binding.itemChannelAvatar.setText(initial(holder.itemView.getContext(), item.title()));
    holder.binding.itemChannelName.setText(
        item.title().isEmpty()
            ? holder.itemView.getContext().getString(R.string.channel_unknown_title)
            : item.title());
    holder.binding.itemChannelUrl.setText(item.shortUrl());
    holder.binding.itemChannelUrl.setVisibility(
        item.shortUrl().isEmpty() ? View.GONE : View.VISIBLE);
    holder.binding.itemChannelDot.setBackgroundResource(
        item.active() ? R.drawable.q_status_dot_ok : R.drawable.q_status_dot_muted);
    holder.binding.itemChannelStatus.setText(
        item.active() ? R.string.channel_status_active : R.string.channel_status_paused);
    holder.binding.itemChannelChecked.setText(
        item.lastCheckedAt() == null
            ? holder.itemView.getContext().getString(R.string.channel_never_checked)
            : holder
                .itemView
                .getContext()
                .getString(
                    R.string.channel_last_checked,
                    relative(holder.itemView.getContext(), item.lastCheckedAt())));
    holder.binding.itemChannelToggle.setEnabled(!busy);
    holder.binding.itemChannelDelete.setEnabled(!busy);
    if (item.id().equals(busyId)) {
      holder.binding.itemChannelToggle.setText(R.string.common_working);
    } else {
      holder.binding.itemChannelToggle.setText(
          item.active() ? R.string.channel_pause : R.string.channel_resume);
    }
    holder.binding.itemChannelToggle.setOnClickListener(ignored -> listener.onToggle(item));
    holder.binding.itemChannelDelete.setOnClickListener(ignored -> listener.onDelete(item));
  }

  private static String initial(Context context, String title) {
    if (title == null || title.isEmpty()) return context.getString(R.string.channel_avatar_unknown);
    return new String(Character.toChars(title.codePointAt(0)));
  }

  /** 기기 언어와 상관없이 앱 문구와 같은 한국어로 지난 시간을 보여 줘요. */
  private static String relative(Context context, long at) {
    long elapsed = Math.max(0, System.currentTimeMillis() - at);
    long minutes = elapsed / 60_000;
    if (minutes < 1) return context.getString(R.string.channel_just_now);
    if (minutes < 60) return context.getString(R.string.channel_minutes_ago, minutes);
    long hours = minutes / 60;
    if (hours < 24) return context.getString(R.string.channel_hours_ago, hours);
    return context.getString(R.string.channel_days_ago, hours / 24);
  }

  @Override
  public int getItemCount() {
    return items.size();
  }

  static final class Holder extends RecyclerView.ViewHolder {
    final ItemChannelBinding binding;

    Holder(ItemChannelBinding binding) {
      super(binding.getRoot());
      this.binding = binding;
    }
  }
}
