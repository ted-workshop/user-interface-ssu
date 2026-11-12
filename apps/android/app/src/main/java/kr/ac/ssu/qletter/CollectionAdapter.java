package kr.ac.ssu.qletter;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import java.util.List;

public class CollectionAdapter extends RecyclerView.Adapter<CollectionAdapter.ViewHolder> {

  private final List<ReportCollection> items;

  public CollectionAdapter(List<ReportCollection> items) {
    this.items = items;
  }

  @NonNull
  @Override
  public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
    View view =
        LayoutInflater.from(parent.getContext()).inflate(R.layout.item_collection, parent, false);
    return new ViewHolder(view);
  }

  @Override
  public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
    ReportCollection item = items.get(position);
    holder.nameText.setText(item.getName());
    holder.countText.setText("리포트" + item.getReportCount() + "개");
  }

  @Override
  public int getItemCount() {
    return items.size();
  }

  static class ViewHolder extends RecyclerView.ViewHolder {
    final TextView nameText;
    final TextView countText;

    ViewHolder(@NonNull View itemView) {
      super(itemView);
      nameText = itemView.findViewById(R.id.collection_name);
      countText = itemView.findViewById(R.id.collection_count);
    }
  }
}
