package kr.ac.ssu.qletter;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import java.util.ArrayList;
import java.util.List;
import kr.ac.ssu.qletter.databinding.BottomSheetNewCollectionBinding;
import kr.ac.ssu.qletter.databinding.FragmentCollectionsBinding;

public class CollectionsFragment extends Fragment {
  private FragmentCollectionsBinding binding;
  private final List<ReportCollection> items = new ArrayList<>();
  private CollectionAdapter adapter;

  @Nullable
  @Override
  public View onCreateView(
      @NonNull LayoutInflater inflater,
      @Nullable ViewGroup container,
      @Nullable Bundle savedInstanceState) {
    binding = FragmentCollectionsBinding.inflate(inflater, container, false);
    return binding.getRoot();
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
    super.onViewCreated(view, savedInstanceState);
    binding.collectionsList.setLayoutManager(new LinearLayoutManager(requireContext()));
    adapter = new CollectionAdapter(items);
    binding.collectionsList.setAdapter(adapter);
    // 서버 연결 전까지 쓰는 더미 데이터예요.
    if (items.isEmpty()) {
      items.add(new ReportCollection("면접준비", 3));
      items.add(new ReportCollection("수학", 4));
      items.add(new ReportCollection("과학", 2));
    }
    binding.newCollectionButton.setOnClickListener(v -> showNewCollectionSheet());
  }

  @Override
  public void onDestroyView() {
    super.onDestroyView();
    binding = null;
  }

  private void showNewCollectionSheet() {
    BottomSheetDialog bottomSheetDialog = new BottomSheetDialog(requireContext());
    BottomSheetNewCollectionBinding sheet =
        BottomSheetNewCollectionBinding.inflate(getLayoutInflater());
    bottomSheetDialog.setContentView(sheet.getRoot());
    sheet.createCollectionButton.setOnClickListener(
        view -> {
          String name = sheet.collectionNameInput.getText().toString().trim();
          if (name.isEmpty()) {
            sheet.collectionNameInput.setError("모음 이름을 입력해 주세요");
            return;
          }

          items.add(new ReportCollection(name, 0));
          adapter.notifyItemInserted(items.size() - 1);
          bottomSheetDialog.dismiss();
        });
    bottomSheetDialog.show();
  }
}
