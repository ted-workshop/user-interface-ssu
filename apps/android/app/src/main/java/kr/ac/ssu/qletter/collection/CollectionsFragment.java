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

  @Override
  public void onCreate(@Nullable Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getChildFragmentManager()
        .setFragmentResultListener(
            CollectionNameSheet.REQUEST_KEY,
            this,
            (key, result) -> {
              // 저장 중에 화면이 돌아가 결과를 놓쳤으면 서버 목록을 다시 불러와요.
              if (result.getBoolean(CollectionNameSheet.RESULT_RELOAD)) {
                if (binding != null) loadCollections();
                return;
              }
              applySaved(
                  CollectionNameSheet.collectionFrom(result),
                  result.getBoolean(CollectionNameSheet.RESULT_CREATED));
            });
    getChildFragmentManager()
        .setFragmentResultListener(
            CollectionDeleteDialog.REQUEST_KEY,
            this,
            (key, result) -> {
              String id = result.getString(CollectionDeleteDialog.RESULT_ID);
              for (ReportCollection item : items) {
                if (item.getId().equals(id)) {
                  deleteCollection(item);
                  return;
                }
              }
            });
  }

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
    collectionApi = new CollectionApi(app.api(), getResources());
    binding.collectionsRetry.setOnClickListener(v -> loadCollections());
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
    CollectionNameSheet.show(
        getChildFragmentManager(), position == -1 ? null : items.get(position));
  }

  /** 시트가 저장에 성공하면 Fragment Result로 결과가 와요. 화면을 돌린 뒤에도 같은 방법으로 받아요. */
  private void applySaved(ReportCollection saved, boolean created) {
    if (binding == null) return;
    if (created) {
      items.add(0, saved);
      adapter.notifyItemInserted(0);
      hideState();
      binding.collectionsList.scrollToPosition(0);
      return;
    }
    // 요청 중에 목록이 바뀌었을 수 있어서 id로 위치를 다시 찾아요.
    for (int i = 0; i < items.size(); i++) {
      if (items.get(i).getId().equals(saved.getId())) {
        items.set(i, saved);
        adapter.notifyItemChanged(i);
        return;
      }
    }
  }

  private void confirmDelete(int position) {
    CollectionDeleteDialog.show(getChildFragmentManager(), items.get(position));
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
                  if (items.isEmpty()) showState(getString(R.string.collection_empty), false);
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
    binding.collectionsMore.setVisibility(View.GONE);
    hideState();
    if (loadCall != null) loadCall.cancel();

    loadCall =
        collectionApi.list(
            new CollectionApi.Result<CollectionApi.Page<ReportCollection>>() {
              @Override
              public void onSuccess(CollectionApi.Page<ReportCollection> page) {
                runOnUi(
                    () -> {
                      if (binding == null) return;
                      binding.collectionsLoading.setVisibility(View.GONE);
                      items.clear();
                      items.addAll(page.items);
                      adapter.notifyDataSetChanged();
                      if (items.isEmpty()) showState(getString(R.string.collection_empty), false);
                      // 서버에 더 남아 있으면 조용히 빼지 않고 몇 개까지 보이는지 알려요.
                      if (page.hasMore) {
                        binding.collectionsMore.setText(
                            getString(R.string.collection_more_collections, items.size()));
                        binding.collectionsMore.setVisibility(View.VISIBLE);
                      }
                    });
              }

              @Override
              public void onError(String message) {
                runOnUi(
                    () -> {
                      if (binding == null) return;
                      binding.collectionsLoading.setVisibility(View.GONE);
                      // 다시 불러오다 실패하면 지운 모음이 남아 보이지 않게 목록을 비우고 다시 시도를 보여 줘요.
                      items.clear();
                      adapter.notifyDataSetChanged();
                      showState(message, true);
                    });
              }
            });
  }

  private void showState(String message, boolean retry) {
    binding.collectionsMessage.setText(message);
    binding.collectionsRetry.setVisibility(retry ? View.VISIBLE : View.GONE);
    binding.collectionsState.setVisibility(View.VISIBLE);
  }

  private void hideState() {
    binding.collectionsState.setVisibility(View.GONE);
  }

  /** 응답이 왔을 때 화면이 이미 Activity에서 떨어졌으면 아무것도 하지 않아요. */
  private void runOnUi(Runnable action) {
    Activity activity = getActivity();
    if (activity != null) activity.runOnUiThread(action);
  }
}
