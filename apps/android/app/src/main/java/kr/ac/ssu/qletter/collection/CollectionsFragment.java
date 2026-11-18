package kr.ac.ssu.qletter.collection;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import java.util.ArrayList;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.databinding.FragmentCollectionsBinding;
import okhttp3.Call;

public class CollectionsFragment extends Fragment {
  private FragmentCollectionsBinding binding;
  private final List<ReportCollection> items = new ArrayList<>();
  private CollectionAdapter adapter;
  private Call loadCall;
  private CollectionApi collectionApi;

  /** 상세에서 이름을 바꾸거나 모음을 지우면 RESULT_OK가 와서 목록을 다시 불러와요(07강 결과 받기). */
  private final ActivityResultLauncher<Intent> detailLauncher =
      registerForActivityResult(
          new ActivityResultContracts.StartActivityForResult(),
          result -> {
            if (result.getResultCode() == Activity.RESULT_OK && binding != null) loadCollections();
          });

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
    adapter =
        new CollectionAdapter(
            items, this::openCollectionDetail, this::showNewCollectionSheet, this::confirmDelete);
    binding.collectionsList.setAdapter(adapter);
    QletterApplication app = (QletterApplication) requireActivity().getApplication();
    collectionApi = new CollectionApi(app.api());
    loadCollections();
    binding.newCollectionButton.setOnClickListener(v -> showNewCollectionSheet(-1));
  }

  @Override
  public void onDestroyView() {
    super.onDestroyView();
    if (loadCall != null) loadCall.cancel();
    loadCall = null;
    binding = null;
  }

  /** position이 -1이면 새 모음, 아니면 그 모음의 이름 바꾸기예요. */
  private void showNewCollectionSheet(int position) {
    ReportCollection original = position == -1 ? null : items.get(position);
    CollectionNameSheet.show(
        requireContext(),
        collectionApi,
        original,
        saved -> {
          if (binding == null) return;
          if (original == null) {
            items.add(0, saved);
            adapter.notifyItemInserted(0);
            binding.collectionsMessage.setVisibility(View.GONE);
            binding.collectionsList.scrollToPosition(0);
            return;
          }
          // 요청 중에 목록이 바뀌었을 수 있어서 위치를 다시 찾아요.
          int current = items.indexOf(original);
          if (current == -1) return;
          items.set(current, saved);
          adapter.notifyItemChanged(current);
        });
  }

  private void confirmDelete(int position) {
    ReportCollection target = items.get(position);
    CollectionDeleteDialog.show(requireContext(), target.getName(), () -> deleteCollection(target));
  }

  private void deleteCollection(ReportCollection target) {
    collectionApi.delete(
        target.getId(),
        new CollectionApi.Result<Void>() {
          @Override
          public void onSuccess(Void value) {
            runOnUi(
                () -> {
                  if (binding == null) return;
                  // 요청 중에 목록이 바뀌었을 수 있어서 위치를 다시 찾아요.
                  int position = items.indexOf(target);
                  if (position == -1) return;
                  items.remove(position);
                  adapter.notifyItemRemoved(position);
                  if (items.isEmpty()) {
                    binding.collectionsMessage.setText(R.string.collection_empty);
                    binding.collectionsMessage.setVisibility(View.VISIBLE);
                  }
                });
          }

          @Override
          public void onError(String message) {
            runOnUi(
                () -> {
                  if (binding == null) return;
                  Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show();
                });
          }
        });
  }

  private void openCollectionDetail(int position) {
    ReportCollection item = items.get(position);
    Intent intent = new Intent(requireContext(), CollectionDetailActivity.class);
    intent.putExtra(CollectionDetailActivity.EXTRA_ID, item.getId());
    intent.putExtra(CollectionDetailActivity.EXTRA_NAME, item.getName());
    intent.putExtra(CollectionDetailActivity.EXTRA_REPORT_COUNT, item.getReportCount());
    detailLauncher.launch(intent);
  }

  private void loadCollections() {
    binding.collectionsLoading.setVisibility(View.VISIBLE);
    binding.collectionsMessage.setVisibility(View.GONE);

    loadCall =
        collectionApi.list(
            new CollectionApi.Result<List<ReportCollection>>() {
              @Override
              public void onSuccess(List<ReportCollection> value) {
                runOnUi(
                    () -> {
                      if (binding == null) return;

                      binding.collectionsLoading.setVisibility(View.GONE);
                      items.clear();
                      items.addAll(value);
                      adapter.notifyDataSetChanged();

                      if (items.isEmpty()) {
                        binding.collectionsMessage.setVisibility(View.VISIBLE);
                        binding.collectionsMessage.setText(R.string.collection_empty);
                      }
                    });
              }

              @Override
              public void onError(String message) {
                runOnUi(
                    () -> {
                      if (binding == null) return;

                      binding.collectionsLoading.setVisibility(View.GONE);
                      binding.collectionsMessage.setText(message);
                      binding.collectionsMessage.setVisibility(View.VISIBLE);
                    });
              }
            });
  }

  /** 응답이 왔을 때 화면이 이미 Activity에서 떨어졌으면 아무것도 하지 않아요. */
  private void runOnUi(Runnable action) {
    Activity activity = getActivity();
    if (activity != null) activity.runOnUiThread(action);
  }
}
