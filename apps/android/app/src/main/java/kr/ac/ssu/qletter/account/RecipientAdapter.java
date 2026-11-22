package kr.ac.ssu.qletter.account;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.databinding.ItemRecipientBinding;

final class RecipientAdapter extends RecyclerView.Adapter<RecipientAdapter.Holder> {
  interface Listener {
    void onVerify(Recipient recipient);

    void onDelete(Recipient recipient);
  }

  private final List<Recipient> items;
  private final Listener listener;

  RecipientAdapter(List<Recipient> items, Listener listener) {
    this.items = items;
    this.listener = listener;
  }

  @NonNull
  @Override
  public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
    return new Holder(
        ItemRecipientBinding.inflate(LayoutInflater.from(parent.getContext()), parent, false));
  }

  @Override
  public void onBindViewHolder(@NonNull Holder holder, int position) {
    Recipient item = items.get(position);
    holder.binding.recipientEmail.setText(item.email());
    holder.binding.recipientStatus.setText(
        item.verified()
            ? R.string.account_recipient_verified
            : R.string.account_recipient_unverified);
    holder.binding.recipientStatus.setTextColor(
        ContextCompat.getColor(
            holder.itemView.getContext(),
            item.verified() ? R.color.q_state_ok : R.color.q_state_warn));
    holder.binding.recipientVerify.setVisibility(item.verified() ? View.GONE : View.VISIBLE);
    holder.binding.recipientVerify.setOnClickListener(ignored -> listener.onVerify(item));
    holder.binding.recipientDelete.setOnClickListener(ignored -> listener.onDelete(item));
  }

  @Override
  public int getItemCount() {
    return items.size();
  }

  static final class Holder extends RecyclerView.ViewHolder {
    final ItemRecipientBinding binding;

    Holder(ItemRecipientBinding binding) {
      super(binding.getRoot());
      this.binding = binding;
    }
  }
}
