package kr.ac.ssu.qletter;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import java.util.ArrayList;
import java.util.List;

public class CollectionsFragment extends Fragment {
  private final List<ReportCollection> items = new ArrayList<>();
  private CollectionAdapter adapter;

  @Nullable
  @Override
  public View onCreateView(
      @NonNull LayoutInflater inflater,
      @Nullable ViewGroup container,
      @Nullable Bundle savedInstanceState) {
    return inflater.inflate(R.layout.fragment_collections, container, false);
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
    super.onViewCreated(view, savedInstanceState);
    RecyclerView recyclerView = view.findViewById(R.id.collections_list);
    recyclerView.setLayoutManager(new LinearLayoutManager(requireContext()));
    adapter = new CollectionAdapter(items);
    recyclerView.setAdapter(adapter);
    // 서버 연결 전까지 쓰는 더미 데이터예요.
    if (items.isEmpty()) {
      items.add(new ReportCollection("면접준비", 3));
      items.add(new ReportCollection("수학", 4));
      items.add(new ReportCollection("과학", 2));
    }
    Button button = view.findViewById(R.id.new_collection_button);
    button.setOnClickListener(view1 -> showNewCollectionSheet());
  }

  private void showNewCollectionSheet() {
    BottomSheetDialog bottomSheetDialog = new BottomSheetDialog(requireContext());
    bottomSheetDialog.setContentView(R.layout.bottom_sheet_new_collection);
    EditText editText = bottomSheetDialog.findViewById(R.id.collection_name_input);
    Button button = bottomSheetDialog.findViewById(R.id.create_collection_button);
    button.setOnClickListener(
        view -> {
          String name = editText.getText().toString().trim();
          if (name.isEmpty()) {
            editText.setError("모음 이름을 입력해 주세요");
            return;
          }

          items.add(new ReportCollection(name, 0));
          adapter.notifyItemInserted(items.size() - 1);
          bottomSheetDialog.dismiss();
        });
    bottomSheetDialog.show();
  }
}
