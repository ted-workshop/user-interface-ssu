package kr.ac.ssu.qletter.account;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import java.util.ArrayList;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.auth.Account;
import kr.ac.ssu.qletter.auth.AuthActivity;
import kr.ac.ssu.qletter.auth.AuthInput;
import kr.ac.ssu.qletter.common.ApiError;
import kr.ac.ssu.qletter.common.ConfirmDialog;
import kr.ac.ssu.qletter.common.JsonCall;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.common.SessionStore;
import kr.ac.ssu.qletter.common.Ui;
import kr.ac.ssu.qletter.databinding.FragmentAccountBinding;
import okhttp3.Call;

/** 로그인 계정, 수신 주소, 확인 주기를 관리해요. */
public final class AccountFragment extends Fragment implements RecipientAdapter.Listener {
  private static final String REQUEST_DELETE_RECIPIENT = "account_delete_recipient";
  private static final String TAG_DELETE_RECIPIENT = "account_delete_recipient_dialog";
  private static final String STATE_PENDING_CODE_ID = "pendingCodeId";
  private static final String STATE_PENDING_CODE_EMAIL = "pendingCodeEmail";

  private static final int[] INTERVALS = {60, 360, 1440};
  private static final int[] INTERVAL_LABELS = {
    R.string.account_interval_60, R.string.account_interval_360, R.string.account_interval_1440
  };

  private FragmentAccountBinding binding;
  private AccountApi api;
  private final List<Recipient> recipients = new ArrayList<>();
  private RecipientAdapter adapter;
  private Account account;
  private int interval = 360;
  private boolean intervalLoaded;
  private Call meCall;
  private Call recipientsCall;
  private Call settingsCall;
  private int meGeneration;
  private int recipientsGeneration;
  private int settingsGeneration;
  private final List<Call> actionCalls = new ArrayList<>();
  @Nullable private String pendingCodeId;
  @Nullable private String pendingCodeEmail;
  private boolean mutating;

  @Override
  public void onCreate(@Nullable Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (savedInstanceState != null) {
      pendingCodeId = savedInstanceState.getString(STATE_PENDING_CODE_ID);
      pendingCodeEmail = savedInstanceState.getString(STATE_PENDING_CODE_EMAIL);
    }
    getChildFragmentManager()
        .setFragmentResultListener(
            REQUEST_DELETE_RECIPIENT,
            this,
            (key, result) -> {
              String id = result.getString(ConfirmDialog.RESULT_ID);
              if (result.getBoolean(ConfirmDialog.RESULT_CONFIRMED) && id != null)
                deleteRecipient(id);
            });
    getChildFragmentManager()
        .setFragmentResultListener(
            RecipientCodeDialog.REQUEST_KEY,
            this,
            (key, result) -> {
              showToast(getString(R.string.account_code_verified));
              loadRecipients();
            });
    getChildFragmentManager()
        .setFragmentResultListener(
            NicknameDialog.REQUEST_KEY,
            this,
            (key, result) -> {
              String nickname = result.getString(NicknameDialog.RESULT_NICKNAME);
              if (nickname != null) applyNickname(nickname);
            });
  }

  @Nullable
  @Override
  public View onCreateView(
      @NonNull LayoutInflater inflater,
      @Nullable ViewGroup container,
      @Nullable Bundle savedInstanceState) {
    binding = FragmentAccountBinding.inflate(inflater, container, false);
    return binding.getRoot();
  }

  @Override
  public void onResume() {
    super.onResume();
    if (pendingCodeId != null && pendingCodeEmail != null && binding != null) {
      String id = pendingCodeId;
      String email = pendingCodeEmail;
      pendingCodeId = null;
      pendingCodeEmail = null;
      RecipientCodeDialog.show(getChildFragmentManager(), id, email);
    }
  }

  @Override
  public void onSaveInstanceState(@NonNull Bundle outState) {
    super.onSaveInstanceState(outState);
    outState.putString(STATE_PENDING_CODE_ID, pendingCodeId);
    outState.putString(STATE_PENDING_CODE_EMAIL, pendingCodeEmail);
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
    super.onViewCreated(view, savedInstanceState);
    api = new AccountApi(((QletterApplication) requireActivity().getApplication()).api());
    adapter = new RecipientAdapter(recipients, this);
    binding.accountRecipientsList.setLayoutManager(new LinearLayoutManager(requireContext()));
    binding.accountRecipientsList.setAdapter(adapter);
    binding.accountRetry.setOnClickListener(ignored -> load());
    binding.accountRecipientsRetry.setOnClickListener(ignored -> loadRecipients());
    binding.accountIntervalRetry.setOnClickListener(ignored -> loadSettings());
    binding.accountRecipientAdd.setOnClickListener(ignored -> addRecipient());
    binding.accountRecipientInput.setOnEditorActionListener(
        (field, action, event) -> {
          if (action == EditorInfo.IME_ACTION_DONE) {
            addRecipient();
            return true;
          }
          return false;
        });
    binding.accountIntervalValue.setOnClickListener(ignored -> chooseInterval());
    binding.accountChangeNickname.setOnClickListener(ignored -> openNicknameDialog());
    binding.accountLogout.setOnClickListener(ignored -> logout());
    binding.accountRecipientInput.addTextChangedListener(
        new android.text.TextWatcher() {
          @Override
          public void beforeTextChanged(CharSequence text, int start, int count, int after) {}

          @Override
          public void onTextChanged(CharSequence text, int start, int before, int count) {}

          @Override
          public void afterTextChanged(android.text.Editable text) {
            binding.accountRecipientInput.setError(null);
          }
        });
    binding.accountChangePassword.setOnClickListener(
        ignored -> {
          if (account == null) return;
          startActivity(AuthActivity.passwordChangeIntent(requireContext(), account.email()));
        });
    load();
  }

  private QletterApplication app() {
    return (QletterApplication) requireActivity().getApplication();
  }

  private void load() {
    binding.accountLoading.setVisibility(View.VISIBLE);
    binding.accountErrorState.setVisibility(View.GONE);
    binding.accountContent.setVisibility(View.GONE);
    if (meCall != null) meCall.cancel();
    int generation = ++meGeneration;
    meCall =
        api.me(
            new JsonCall.Result<Account>() {
              @Override
              public void onSuccess(Account value) {
                Ui.on(
                    AccountFragment.this,
                    () -> {
                      if (binding == null || generation != meGeneration) return;
                      account = value;
                      binding.accountEmail.setText(value.email());
                      binding.accountNickname.setText(value.nickname());
                      binding.accountLoading.setVisibility(View.GONE);
                      binding.accountContent.setVisibility(View.VISIBLE);
                    });
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(
                    AccountFragment.this,
                    () -> {
                      if (binding == null || generation != meGeneration) return;
                      binding.accountLoading.setVisibility(View.GONE);
                      binding.accountError.setText(
                          AccountErrors.message(
                              getResources(), error, getString(R.string.account_error_load)));
                      binding.accountErrorState.setVisibility(View.VISIBLE);
                    });
              }
            });
    loadRecipients();
    loadSettings();
  }

  private void loadRecipients() {
    if (binding == null) return;
    recipientsCall = cancel(recipientsCall);
    int generation = ++recipientsGeneration;
    binding.accountRecipientsStatus.setVisibility(View.VISIBLE);
    binding.accountRecipientsStatus.setText(R.string.account_recipients_loading);
    binding.accountRecipientsRetry.setVisibility(View.GONE);
    binding.accountRecipientsList.setVisibility(View.GONE);
    binding.accountRecipientsMore.setVisibility(View.GONE);
    recipientsCall =
        api.recipients(
            new JsonCall.Result<AccountApi.Page<Recipient>>() {
              @Override
              public void onSuccess(AccountApi.Page<Recipient> page) {
                Ui.on(
                    AccountFragment.this,
                    () -> {
                      if (binding == null || generation != recipientsGeneration) return;
                      recipients.clear();
                      recipients.addAll(page.items);
                      adapter.notifyDataSetChanged();
                      binding.accountRecipientsStatus.setVisibility(View.GONE);
                      binding.accountRecipientsList.setVisibility(
                          recipients.isEmpty() ? View.GONE : View.VISIBLE);
                      if (recipients.isEmpty()) {
                        binding.accountRecipientsStatus.setText(R.string.account_recipients_empty);
                        binding.accountRecipientsStatus.setVisibility(View.VISIBLE);
                      }
                      if (page.hasMore) {
                        binding.accountRecipientsMore.setText(
                            getString(R.string.account_recipients_more, recipients.size()));
                        binding.accountRecipientsMore.setVisibility(View.VISIBLE);
                      } else {
                        binding.accountRecipientsMore.setVisibility(View.GONE);
                      }
                    });
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(
                    AccountFragment.this,
                    () -> {
                      if (binding == null || generation != recipientsGeneration) return;
                      recipients.clear();
                      adapter.notifyDataSetChanged();
                      binding.accountRecipientsList.setVisibility(View.GONE);
                      binding.accountRecipientsStatus.setText(
                          AccountErrors.message(
                              getResources(),
                              error,
                              getString(R.string.account_recipients_error_text)));
                      binding.accountRecipientsStatus.setVisibility(View.VISIBLE);
                      binding.accountRecipientsRetry.setVisibility(View.VISIBLE);
                    });
              }
            });
  }

  private void loadSettings() {
    if (binding == null) return;
    settingsCall = cancel(settingsCall);
    int generation = ++settingsGeneration;
    binding.accountIntervalStatus.setVisibility(View.GONE);
    binding.accountIntervalRetry.setVisibility(View.GONE);
    binding.accountIntervalValue.setText(R.string.account_interval_loading);
    binding.accountIntervalValue.setEnabled(false);
    settingsCall =
        api.settings(
            new JsonCall.Result<Integer>() {
              @Override
              public void onSuccess(Integer value) {
                Ui.on(
                    AccountFragment.this,
                    () -> {
                      if (binding == null || generation != settingsGeneration) return;
                      interval = value;
                      intervalLoaded = true;
                      binding.accountIntervalValue.setText(label(value));
                      binding.accountIntervalValue.setEnabled(true);
                    });
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(
                    AccountFragment.this,
                    () -> {
                      if (binding == null || generation != settingsGeneration) return;
                      intervalLoaded = false;
                      binding.accountIntervalValue.setText(R.string.account_interval_error_text);
                      binding.accountIntervalValue.setEnabled(false);
                      binding.accountIntervalStatus.setText(
                          AccountErrors.message(
                              getResources(),
                              error,
                              getString(R.string.account_interval_error_text)));
                      binding.accountIntervalStatus.setVisibility(View.VISIBLE);
                      binding.accountIntervalRetry.setVisibility(View.VISIBLE);
                    });
              }
            });
  }

  private void addRecipient() {
    if (binding == null || mutating) return;
    String email = AuthInput.email(binding.accountRecipientInput.getText().toString());
    binding.accountRecipientInput.setError(null);
    if (!AuthInput.validEmail(email)) {
      binding.accountRecipientInput.setError(getString(R.string.account_error_email));
      binding.accountRecipientInput.requestFocus();
      return;
    }
    setMutating(true);
    actionCalls.add(
        api.addRecipient(
            email,
            new JsonCall.Result<Recipient>() {
              @Override
              public void onSuccess(Recipient recipient) {
                Ui.on(
                    AccountFragment.this,
                    () -> {
                      if (binding == null) return;
                      setMutating(false);
                      binding.accountRecipientInput.setText("");
                      recipients.add(0, recipient);
                      adapter.notifyItemInserted(0);
                      binding.accountRecipientsStatus.setVisibility(View.GONE);
                      binding.accountRecipientsList.setVisibility(View.VISIBLE);
                      requestVerification(recipient);
                    });
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(
                    AccountFragment.this,
                    () -> {
                      if (binding == null) return;
                      setMutating(false);
                      String field = error.field("email");
                      if (error.is("RECIPIENT_EXISTS") || field != null) {
                        binding.accountRecipientInput.setError(
                            field != null ? field : getString(R.string.account_error_exists));
                        binding.accountRecipientInput.requestFocus();
                      } else {
                        showToast(
                            AccountErrors.message(
                                getResources(), error, getString(R.string.account_error_add)));
                      }
                    });
              }
            }));
  }

  private void requestVerification(Recipient recipient) {
    actionCalls.add(
        api.requestVerification(
            recipient.id(),
            new JsonCall.Result<Void>() {
              @Override
              public void onSuccess(Void ignored) {
                Ui.on(
                    AccountFragment.this,
                    () -> showRecipientCode(recipient.id(), recipient.email()));
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(
                    AccountFragment.this,
                    () ->
                        showToast(
                            AccountErrors.message(
                                getResources(), error, getString(R.string.account_error_mail))));
              }
            }));
  }

  private void deleteRecipient(String id) {
    if (mutating || id == null) return;
    setMutating(true);
    actionCalls.add(
        api.deleteRecipient(
            id,
            new JsonCall.Result<Void>() {
              @Override
              public void onSuccess(Void ignored) {
                Ui.on(
                    AccountFragment.this,
                    () -> {
                      if (binding == null) return;
                      setMutating(false);
                      removeRecipient(id);
                    });
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(
                    AccountFragment.this,
                    () -> {
                      if (binding == null) return;
                      setMutating(false);
                      if (error.is("NOT_FOUND")) removeRecipient(id);
                      else
                        showToast(
                            AccountErrors.message(
                                getResources(), error, getString(R.string.account_error_delete)));
                    });
              }
            }));
  }

  private void removeRecipient(String id) {
    for (int i = 0; i < recipients.size(); i++) {
      if (recipients.get(i).id().equals(id)) {
        recipients.remove(i);
        adapter.notifyItemRemoved(i);
        break;
      }
    }
    if (recipients.isEmpty()) {
      binding.accountRecipientsList.setVisibility(View.GONE);
      binding.accountRecipientsMore.setVisibility(View.GONE);
      binding.accountRecipientsStatus.setText(R.string.account_recipients_empty);
      binding.accountRecipientsStatus.setVisibility(View.VISIBLE);
    }
  }

  private void chooseInterval() {
    if (binding == null || mutating || !intervalLoaded) return;
    int checked = 0;
    for (int i = 0; i < INTERVALS.length; i++) if (INTERVALS[i] == interval) checked = i;
    String[] labels = new String[INTERVAL_LABELS.length];
    for (int i = 0; i < labels.length; i++) labels[i] = getString(INTERVAL_LABELS[i]);
    new AlertDialog.Builder(requireContext(), R.style.ThemeOverlay_Qletter_Dialog)
        .setTitle(R.string.account_interval_dialog_title)
        .setSingleChoiceItems(
            labels,
            checked,
            (dialog, which) -> {
              dialog.dismiss();
              saveInterval(INTERVALS[which]);
            })
        .setNegativeButton(R.string.common_cancel, null)
        .show();
  }

  private void saveInterval(int minutes) {
    if (minutes == interval) return;
    setMutating(true);
    actionCalls.add(
        api.updateInterval(
            minutes,
            new JsonCall.Result<Integer>() {
              @Override
              public void onSuccess(Integer value) {
                Ui.on(
                    AccountFragment.this,
                    () -> {
                      if (binding == null) return;
                      setMutating(false);
                      interval = value;
                      binding.accountIntervalValue.setText(label(value));
                    });
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(
                    AccountFragment.this,
                    () -> {
                      if (binding == null) return;
                      setMutating(false);
                      showToast(
                          AccountErrors.message(
                              getResources(), error, getString(R.string.account_error_interval)));
                    });
              }
            }));
  }

  private void logout() {
    if (binding == null || mutating) return;
    SessionStore sessions = app().sessions();
    setMutating(true);
    binding.accountLogout.setText(R.string.common_working);
    api.logout(
        new JsonCall.Result<Void>() {
          @Override
          public void onSuccess(Void ignored) {
            sessions.clear();
            Ui.on(AccountFragment.this, () -> releaseLogout(null));
          }

          @Override
          public void onError(ApiError error) {
            // 서버에 알리지 못해도 이 기기의 토큰은 지워요.
            sessions.clear();
            Ui.on(
                AccountFragment.this,
                () -> releaseLogout(getString(R.string.account_logout_failed)));
          }
        });
  }

  private void releaseLogout(@Nullable String warning) {
    if (binding != null) {
      setMutating(false);
      binding.accountLogout.setText(R.string.account_logout);
    }
    if (warning != null) showToast(warning);
  }

  private void setMutating(boolean value) {
    mutating = value;
    if (binding != null) {
      binding.accountRecipientAdd.setEnabled(!value);
      binding.accountIntervalValue.setEnabled(!value && intervalLoaded);
      binding.accountChangeNickname.setEnabled(!value);
      binding.accountLogout.setEnabled(!value);
    }
  }

  private String label(int minutes) {
    for (int i = 0; i < INTERVALS.length; i++)
      if (INTERVALS[i] == minutes) return getString(INTERVAL_LABELS[i]);
    return getString(R.string.account_interval_360);
  }

  private void showToast(String message) {
    if (binding != null) Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show();
  }

  private Call cancel(@Nullable Call call) {
    if (call != null) call.cancel();
    return null;
  }

  @Override
  public void onVerify(Recipient recipient) {
    if (mutating) return;
    showRecipientCode(recipient.id(), recipient.email());
  }

  @Override
  public void onDelete(Recipient recipient) {
    if (mutating) return;
    ConfirmDialog.show(
        getChildFragmentManager(),
        TAG_DELETE_RECIPIENT,
        REQUEST_DELETE_RECIPIENT,
        getString(R.string.account_delete_recipient_title),
        getString(R.string.account_delete_recipient_message, recipient.email()),
        getString(R.string.account_delete_recipient_confirm),
        recipient.id());
  }

  /** 성공한 변경을 현재 화면과 계정 정보에 반영해요. */
  private void applyNickname(String nickname) {
    if (binding == null) return;
    if (account != null) account = account.withNickname(nickname);
    binding.accountNickname.setText(nickname);
    showToast(getString(R.string.account_nickname_saved));
  }

  private void openNicknameDialog() {
    if (binding == null || account == null || mutating) return;
    if (!isResumed() || getChildFragmentManager().isStateSaved()) return;
    NicknameDialog.open(getChildFragmentManager(), account.nickname());
  }

  void showRecipientCode(String id, String email) {
    if (binding == null) return;
    if (!isResumed() || getChildFragmentManager().isStateSaved()) {
      pendingCodeId = id;
      pendingCodeEmail = email;
      return;
    }
    pendingCodeId = null;
    pendingCodeEmail = null;
    RecipientCodeDialog.show(getChildFragmentManager(), id, email);
  }

  @Override
  public void onDestroyView() {
    super.onDestroyView();
    if (meCall != null) meCall.cancel();
    if (recipientsCall != null) recipientsCall.cancel();
    if (settingsCall != null) settingsCall.cancel();
    for (Call call : actionCalls) call.cancel();
    actionCalls.clear();
    meCall = null;
    recipientsCall = null;
    settingsCall = null;
    binding = null;
    adapter = null;
  }
}
