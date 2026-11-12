package kr.ac.ssu.qletter;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import java.util.ArrayList;
import java.util.List;

public class CollectionsFragment extends Fragment {
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
    List<ReportCollection> items = new ArrayList<>();
    // 서버 연결 전까지 쓰는 더미 데이터예요.
    items.add(new ReportCollection("면접준비", 3));
    items.add(new ReportCollection("수학", 4));
    items.add(new ReportCollection("과학", 2));
    recyclerView.setAdapter(new CollectionAdapter(items));
  }
}
