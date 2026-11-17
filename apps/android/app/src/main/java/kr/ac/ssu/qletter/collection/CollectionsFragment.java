package kr.ac.ssu.qletter.collection;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import java.util.ArrayList;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.databinding.BottomSheetNewCollectionBinding;
import kr.ac.ssu.qletter.databinding.FragmentCollectionsBinding;
import okhttp3.Call;

public class CollectionsFragment extends Fragment {
  private FragmentCollectionsBinding binding;
  private final List<ReportCollection> items = new ArrayList<>();
  private CollectionAdapter adapter;
  private Call loadCall;
  private CollectionApi collectionApi;

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
    adapter = new CollectionAdapter(items, this::showCollectionActions, this::openCollectionDetail);
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

  private void showNewCollectionSheet(int position) {
    BottomSheetDialog bottomSheetDialog = new BottomSheetDialog(requireContext());
    BottomSheetNewCollectionBinding sheet =
        BottomSheetNewCollectionBinding.inflate(getLayoutInflater());
    bottomSheetDialog.setContentView(sheet.getRoot());
    if (position != -1) {
      String oldName = items.get(position).getName();
      sheet.sheetTitle.setText(R.string.collection_rename);
      sheet.createCollectionButton.setText(R.string.collection_save);
      sheet.collectionNameInput.setText(oldName);
      sheet.collectionNameInput.setSelection(oldName.length());
    }
    sheet.createCollectionButton.setOnClickListener(
        view -> {
          String name = sheet.collectionNameInput.getText().toString().trim();
          if (name.isEmpty()) {
            sheet.collectionNameInput.setError(getString(R.string.collection_name_required));
            return;
          }

          sheet.createCollectionButton.setEnabled(false);
          ReportCollection original = position == -1 ? null : items.get(position);
          CollectionApi.Result<ReportCollection> result =
              new CollectionApi.Result<ReportCollection>() {
                @Override
                public void onSuccess(ReportCollection value) {
                  runOnUi(
                      () -> {
                        if (binding == null) return;
                        if (position == -1) {
                          items.add(0, value);
                          adapter.notifyItemInserted(0);
                          binding.collectionsMessage.setVisibility(View.GONE);
                          binding.collectionsList.scrollToPosition(0);
                        } else {
                          // 요청 중에 목록이 바뀌었을 수 있어서 위치를 다시 찾아요.
                          int current = items.indexOf(original);
                          if (current != -1) {
                            items.set(current, value);
                            adapter.notifyItemChanged(current);
                          }
                        }
                        bottomSheetDialog.dismiss();
                      });
                }

                @Override
                public void onError(String message) {
                  runOnUi(
                      () -> {
                        sheet.createCollectionButton.setEnabled(true);
                        sheet.collectionNameInput.setError(message);
                      });
                }
              };
          if (position == -1) {
            collectionApi.create(name, result);
          } else {
            collectionApi.rename(original.getId(), name, result);
          }
        });
    bottomSheetDialog.show();
  }

  private void confirmDelete(int position) {
    new AlertDialog.Builder(requireContext())
        .setTitle(R.string.collection_delete_title)
        .setMessage(getString(R.string.collection_delete_message, items.get(position).getName()))
        .setPositiveButton(
            R.string.collection_delete, ((dialog, which) -> deleteCollection(items.get(position))))
        .setNegativeButton(R.string.collection_cancel, null)
        .show();
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

  private void showCollectionActions(int position) {
    new AlertDialog.Builder(requireContext())
        .setTitle(items.get(position).getName())
        .setItems(
            new String[] {
              getString(R.string.collection_rename), getString(R.string.collection_delete)
            },
            ((dialog, which) -> {
              if (which == 0) {
                showNewCollectionSheet(position);
              } else if (which == 1) {
                confirmDelete(position);
              }
            }))
        .show();
  }

  private void openCollectionDetail(int position) {
    ReportCollection item = items.get(position);
    Intent intent = new Intent(requireContext(), CollectionDetailActivity.class);
    intent.putExtra(CollectionDetailActivity.EXTRA_ID, item.getId());
    intent.putExtra(CollectionDetailActivity.EXTRA_NAME, item.getName());
    intent.putExtra(CollectionDetailActivity.EXTRA_REPORT_COUNT, item.getReportCount());
    startActivity(intent);
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
