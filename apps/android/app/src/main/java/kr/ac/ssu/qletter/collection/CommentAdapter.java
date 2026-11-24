package kr.ac.ssu.qletter.collection;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.databinding.ItemCommentBinding;

/** 리포트 댓글 목록이에요. 내 댓글에만 "내 댓글"과 "삭제"를 보여요. */
public class CommentAdapter extends RecyclerView.Adapter<CommentAdapter.ViewHolder> {

  /** 삭제를 누른 댓글을 Fragment에 알려요. */
  public interface OnDeleteClickListener {
    void onDeleteClick(Comment comment);
  }

  private final List<Comment> items;
  private final OnDeleteClickListener deleteListener;

  public CommentAdapter(List<Comment> items, OnDeleteClickListener deleteListener) {
    this.items = items;
    this.deleteListener = deleteListener;
  }

  @NonNull
  @Override
  public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
    ItemCommentBinding binding =
        ItemCommentBinding.inflate(LayoutInflater.from(parent.getContext()), parent, false);
    ViewHolder holder = new ViewHolder(binding);
    binding.commentDelete.setOnClickListener(
        view -> {
          int position = holder.getBindingAdapterPosition();
          if (position == RecyclerView.NO_POSITION) return;
          else deleteListener.onDeleteClick(items.get(position));
        });
    return holder;
  }

  @Override
  public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
    Comment item = items.get(position);
    holder.binding.commentAuthor.setText(item.getAuthorNickname());
    holder.binding.commentBody.setText(item.getBody());
    Context context = holder.itemView.getContext();
    holder.binding.commentTime.setText(CommentTime.label(context, item.getCreatedAtMillis()));
    if (item.canDelete()) {
      // TalkBack이 "삭제"만 읽으면 어느 댓글인지 몰라서 본문 앞부분을 같이 읽어요.
      holder.binding.commentDelete.setContentDescription(
          context.getString(R.string.comment_delete_description, item.getBody()));
      holder.binding.commentDelete.setVisibility(View.VISIBLE);
      holder.binding.commentMine.setVisibility(View.VISIBLE);
    } else {
      holder.binding.commentDelete.setVisibility(View.GONE);
      holder.binding.commentMine.setVisibility(View.GONE);
    }
  }

  @Override
  public int getItemCount() {
    return items.size();
  }

  static class ViewHolder extends RecyclerView.ViewHolder {
    private final ItemCommentBinding binding;

    ViewHolder(@NonNull ItemCommentBinding binding) {
      super(binding.getRoot());
      this.binding = binding;
    }
  }
}
