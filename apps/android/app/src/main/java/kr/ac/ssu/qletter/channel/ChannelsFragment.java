package kr.ac.ssu.qletter.channel;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.view.ViewCompat;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import java.util.ArrayList;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.ApiError;
import kr.ac.ssu.qletter.common.ConfirmDialog;
import kr.ac.ssu.qletter.common.JsonCall;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.common.Ui;
import kr.ac.ssu.qletter.databinding.FragmentChannelsBinding;
import okhttp3.Call;

/** 채널을 확인·등록하고, 등록한 채널의 자동 확인을 중지·재개·삭제해요. */
public final class ChannelsFragment extends Fragment implements ChannelAdapter.Listener {
  private static final String REQUEST_DELETE_CHANNEL = "channel_delete_channel";
  private static final String TAG_DELETE_CHANNEL = "channel_delete_channel_dialog";

  private FragmentChannelsBinding binding;
  private ChannelApi api;
  private final List<Channel> channels = new ArrayList<>();
  private ChannelAdapter adapter;
  private ChannelPreview preview;
  private Channel pendingDelete;
  private Call loadCall;
  private Call previewCall;
  private Call actionCall;
  private int loadGeneration;
  private int previewGeneration;
  private boolean mutating;
  private String busyId;

  @Override
  public void onCreate(@Nullable Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getChildFragmentManager()
        .setFragmentResultListener(
            REQUEST_DELETE_CHANNEL,
            this,
            (key, result) -> {
              if (result.getBoolean(ConfirmDialog.RESULT_CONFIRMED) && pendingDelete != null)
                deleteChannel(pendingDelete);
            });
  }

  @Nullable
  @Override
  public View onCreateView(
      @NonNull LayoutInflater inflater,
      @Nullable ViewGroup container,
      @Nullable Bundle savedInstanceState) {
    binding = FragmentChannelsBinding.inflate(inflater, container, false);
    return binding.getRoot();
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
    super.onViewCreated(view, savedInstanceState);
    ViewCompat.setAccessibilityHeading(binding.channelTitle, true);
    api = new ChannelApi(((QletterApplication) requireActivity().getApplication()).api());
    adapter = new ChannelAdapter(channels, this);
    binding.channelList.setLayoutManager(new LinearLayoutManager(requireContext()));
    binding.channelList.setAdapter(adapter);
    binding.channelRetry.setOnClickListener(ignored -> loadChannels());
    binding.channelSearchButton.setOnClickListener(ignored -> findChannel());
    binding.channelSearchInput.setOnEditorActionListener(
        (field, action, event) -> {
          if (action == EditorInfo.IME_ACTION_SEARCH) {
            findChannel();
            return true;
          }
          return false;
        });
    binding.channelSearchInput.addTextChangedListener(
        new android.text.TextWatcher() {
          @Override
          public void beforeTextChanged(CharSequence text, int start, int count, int after) {}

          @Override
          public void onTextChanged(CharSequence text, int start, int before, int count) {}

          @Override
          public void afterTextChanged(android.text.Editable text) {
            binding.channelSearchError.setVisibility(View.GONE);
            if (preview != null) hidePreview();
          }
        });
    binding.channelPreviewCancel.setOnClickListener(ignored -> hidePreview());
    binding.channelPreviewRegister.setOnClickListener(ignored -> registerPreview());
    loadChannels();
  }

  private void findChannel() {
    if (binding == null || mutating) return;
    String input = binding.channelSearchInput.getText().toString().trim();
    binding.channelSearchError.setVisibility(View.GONE);
    hidePreview();
    if (input.isEmpty()) {
      binding.channelSearchError.setText(R.string.channel_error_input);
      binding.channelSearchError.setVisibility(View.VISIBLE);
      return;
    }
    setPreviewBusy(true);
    previewCall = cancel(previewCall);
    int generation = ++previewGeneration;
    previewCall =
        api.preview(
            input,
            new JsonCall.Result<ChannelPreview>() {
              @Override
              public void onSuccess(ChannelPreview value) {
                Ui.on(
                    ChannelsFragment.this,
                    () -> {
                      if (binding == null || generation != previewGeneration) return;
                      setPreviewBusy(false);
                      showPreview(value, input);
                    });
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(
                    ChannelsFragment.this,
                    () -> {
                      if (binding == null || generation != previewGeneration) return;
                      setPreviewBusy(false);
                      String field = error.field("input");
                      binding.channelSearchError.setText(
                          field != null
                              ? field
                              : ChannelErrors.message(
                                  getResources(),
                                  error,
                                  getString(R.string.channel_error_preview)));
                      binding.channelSearchError.setVisibility(View.VISIBLE);
                    });
              }
            });
  }

  private void showPreview(ChannelPreview value, String input) {
    preview = value;
    binding.channelPreviewAvatar.setText(initial(value.title()));
    binding.channelPreviewTitle.setText(
        value.title().isEmpty() ? getString(R.string.channel_unknown_title) : value.title());
    binding.channelPreviewSubtitle.setText(input.startsWith("@") ? input : value.shortUrl());
    binding.channelPreviewCard.setVisibility(View.VISIBLE);
  }

  private void hidePreview() {
    preview = null;
    if (binding != null) binding.channelPreviewCard.setVisibility(View.GONE);
  }

  private void registerPreview() {
    if (binding == null || preview == null || mutating) return;
    ChannelPreview target = preview;
    setPreviewBusy(true);
    previewCall = cancel(previewCall);
    int generation = ++previewGeneration;
    previewCall =
        api.register(
            target.youtubeChannelId(),
            new JsonCall.Result<Channel>() {
              @Override
              public void onSuccess(Channel channel) {
                Ui.on(
                    ChannelsFragment.this,
                    () -> {
                      if (binding == null || generation != previewGeneration) return;
                      setPreviewBusy(false);
                      hidePreview();
                      binding.channelSearchInput.setText("");
                      binding.channelSearchError.setVisibility(View.GONE);
                      channels.add(0, channel);
                      adapter.notifyItemInserted(0);
                      binding.channelEmptyState.setVisibility(View.GONE);
                      renderList();
                    });
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(
                    ChannelsFragment.this,
                    () -> {
                      if (binding == null || generation != previewGeneration) return;
                      setPreviewBusy(false);
                      String field = error.field("youtubeChannelId");
                      if (error.is("CHANNEL_EXISTS") || field != null) hidePreview();
                      binding.channelSearchError.setText(
                          field != null
                              ? field
                              : ChannelErrors.message(
                                  getResources(),
                                  error,
                                  getString(R.string.channel_error_register)));
                      binding.channelSearchError.setVisibility(View.VISIBLE);
                    });
              }
            });
  }

  private void loadChannels() {
    if (binding == null) return;
    loadCall = cancel(loadCall);
    int generation = ++loadGeneration;
    binding.channelLoading.setVisibility(View.VISIBLE);
    binding.channelErrorState.setVisibility(View.GONE);
    binding.channelEmptyState.setVisibility(View.GONE);
    binding.channelList.setVisibility(View.GONE);
    binding.channelCount.setVisibility(View.GONE);
    binding.channelMore.setVisibility(View.GONE);
    loadCall =
        api.list(
            new JsonCall.Result<ChannelApi.Page<Channel>>() {
              @Override
              public void onSuccess(ChannelApi.Page<Channel> page) {
                Ui.on(
                    ChannelsFragment.this,
                    () -> {
                      if (binding == null || generation != loadGeneration) return;
                      binding.channelLoading.setVisibility(View.GONE);
                      channels.clear();
                      channels.addAll(page.items);
                      adapter.notifyDataSetChanged();
                      renderList();
                      binding.channelMore.setVisibility(page.hasMore ? View.VISIBLE : View.GONE);
                      if (page.hasMore)
                        binding.channelMore.setText(
                            getString(R.string.channel_more, channels.size()));
                    });
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(
                    ChannelsFragment.this,
                    () -> {
                      if (binding == null || generation != loadGeneration) return;
                      binding.channelLoading.setVisibility(View.GONE);
                      channels.clear();
                      adapter.notifyDataSetChanged();
                      binding.channelError.setText(
                          ChannelErrors.message(
                              getResources(), error, getString(R.string.channel_error_load)));
                      binding.channelErrorState.setVisibility(View.VISIBLE);
                    });
              }
            });
  }

  private void renderList() {
    boolean empty = channels.isEmpty();
    binding.channelCount.setText(getString(R.string.channel_registered_count, channels.size()));
    binding.channelCount.setVisibility(empty ? View.GONE : View.VISIBLE);
    binding.channelList.setVisibility(empty ? View.GONE : View.VISIBLE);
    binding.channelEmptyState.setVisibility(empty ? View.VISIBLE : View.GONE);
    if (empty) binding.channelMore.setVisibility(View.GONE);
  }

  private void toggle(Channel channel) {
    if (binding == null || mutating) return;
    setMutating(channel.id());
    actionCall = cancel(actionCall);
    actionCall =
        api.updateStatus(
            channel.id(),
            !channel.active(),
            new JsonCall.Result<Channel>() {
              @Override
              public void onSuccess(Channel updated) {
                Ui.on(
                    ChannelsFragment.this,
                    () -> {
                      if (binding == null) return;
                      setMutating(null);
                      replace(updated);
                    });
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(
                    ChannelsFragment.this,
                    () -> {
                      if (binding == null) return;
                      setMutating(null);
                      if (error.is("NOT_FOUND")) remove(channel);
                      else
                        showToast(
                            ChannelErrors.message(
                                getResources(), error, getString(R.string.channel_error_status)));
                    });
              }
            });
  }

  private void deleteChannel(Channel channel) {
    if (binding == null || mutating) return;
    setMutating(channel.id());
    actionCall = cancel(actionCall);
    actionCall =
        api.delete(
            channel.id(),
            new JsonCall.Result<Void>() {
              @Override
              public void onSuccess(Void ignored) {
                Ui.on(
                    ChannelsFragment.this,
                    () -> {
                      if (binding == null) return;
                      setMutating(null);
                      remove(channel);
                    });
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(
                    ChannelsFragment.this,
                    () -> {
                      if (binding == null) return;
                      setMutating(null);
                      if (error.is("NOT_FOUND")) remove(channel);
                      else
                        showToast(
                            ChannelErrors.message(
                                getResources(), error, getString(R.string.channel_error_delete)));
                    });
              }
            });
  }

  private void replace(Channel updated) {
    for (int i = 0; i < channels.size(); i++) {
      if (channels.get(i).id().equals(updated.id())) {
        channels.set(i, updated);
        adapter.notifyItemChanged(i);
        return;
      }
    }
  }

  private void remove(Channel channel) {
    for (int i = 0; i < channels.size(); i++) {
      if (channels.get(i).id().equals(channel.id())) {
        channels.remove(i);
        adapter.notifyItemRemoved(i);
        break;
      }
    }
    renderList();
  }

  private void setMutating(@Nullable String id) {
    mutating = id != null;
    busyId = id;
    adapter.setBusyId(id);
  }

  private void setPreviewBusy(boolean busy) {
    binding.channelSearchButton.setText(busy ? R.string.common_working : R.string.channel_find);
    binding.channelSearchButton.setEnabled(!busy);
    binding.channelSearchInput.setEnabled(!busy);
    binding.channelPreviewRegister.setEnabled(!busy);
    binding.channelPreviewCancel.setEnabled(!busy);
  }

  private String initial(String title) {
    if (title == null || title.isEmpty()) return getString(R.string.channel_avatar_unknown);
    return new String(Character.toChars(title.codePointAt(0)));
  }

  private void showToast(String message) {
    if (binding != null) Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show();
  }

  private Call cancel(@Nullable Call call) {
    if (call != null) call.cancel();
    return null;
  }

  @Override
  public void onToggle(Channel channel) {
    toggle(channel);
  }

  @Override
  public void onDelete(Channel channel) {
    if (mutating) return;
    pendingDelete = channel;
    ConfirmDialog.show(
        getChildFragmentManager(),
        TAG_DELETE_CHANNEL,
        REQUEST_DELETE_CHANNEL,
        getString(R.string.channel_delete_title),
        getString(R.string.channel_delete_message, channel.title()),
        getString(R.string.channel_delete_confirm));
  }

  @Override
  public void onDestroyView() {
    super.onDestroyView();
    if (loadCall != null) loadCall.cancel();
    if (previewCall != null) previewCall.cancel();
    if (actionCall != null) actionCall.cancel();
    loadCall = null;
    previewCall = null;
    actionCall = null;
    binding = null;
    adapter = null;
  }
}
