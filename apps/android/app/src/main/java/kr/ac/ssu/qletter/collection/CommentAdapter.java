package kr.ac.ssu.qletter.collection;

import android.view.LayoutInflater;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import java.util.List;
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
          // TODO ④-1: 누른 순간의 위치를 다시 읽고(NO_POSITION이면 무시),
          //  그 위치의 댓글을 deleteListener.onDeleteClick(...)으로 Fragment에 넘겨요.
        });
    return holder;
  }

  @Override
  public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
    Comment item = items.get(position);
    // TODO ④-2: 작성자 닉네임(commentAuthor), 본문(commentBody)을 채워요.
    // TODO ④-3: 시간(commentTime)은 CommentTime.label(context, item.getCreatedAtMillis())로 채워요.
    // TODO ④-4: item.canDelete()가 true면 "내 댓글"(commentMine)과 "삭제"(commentDelete)를 VISIBLE,
    //  아니면 둘 다 GONE으로 해요. (else를 빼먹으면 줄이 재사용될 때 남의 댓글에 삭제가 보여요.)
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
