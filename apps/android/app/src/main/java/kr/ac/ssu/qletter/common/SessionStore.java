package kr.ac.ssu.qletter.common;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import androidx.annotation.WorkerThread;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.InvalidKeyException;
import java.security.KeyStore;
import java.util.concurrent.CancellationException;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import java.util.function.LongSupplier;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** 로그인 성공 결과를 보관하고 화면에는 세션 변경만 알려요. */
public final class SessionStore {
  private static final String KEY = "qletter.session.v1";
  private static final Executor WORKER = Executors.newSingleThreadExecutor();
  private final Context context;
  private final byte[] server;
  private final Handler timer = new Handler(Looper.getMainLooper());
  private final Runnable checkExpiry = this::refreshExpiryAsync;
  private final LongSupplier clock;
  private volatile long logoutVersion;
  private final MutableLiveData<Long> changes = new MutableLiveData<>();
  private long revision;
  private volatile Session current;
  private boolean initialized;

  SessionStore(Context context, String baseUrl) {
    this(context, baseUrl, System::currentTimeMillis);
  }

  SessionStore(Context context, String baseUrl, LongSupplier clock) {
    this.context = context;
    this.clock = clock;
    server = baseUrl.getBytes(StandardCharsets.UTF_8);
  }

  void restoreAsync() {
    WORKER.execute(this::restore);
  }

  private AtomicFile sessionFile() {
    return new AtomicFile(new File(context.getNoBackupFilesDir(), "qletter.session"));
  }

  synchronized void restore() {
    // 먼저 끝난 로그인이나 로그아웃이 있으면 저장된 이전 세션을 다시 적용하지 않아요.
    if (initialized) return;
    AtomicFile file = sessionFile();
    try (DataInputStream input = new DataInputStream(file.openRead())) {
      byte[] iv = new byte[12];
      input.readFully(iv);
      int size = input.readUnsignedShort();
      if (size < 16 || size > 256) throw new IOException("세션 길이 오류");
      byte[] encrypted = new byte[size];
      input.readFully(encrypted);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, iv));
      cipher.updateAAD(server);
      try (DataInputStream data =
          new DataInputStream(new ByteArrayInputStream(cipher.doFinal(encrypted)))) {
        Session restored = new Session(data.readUTF(), data.readLong());
        if (restored.expiresAt > clock.getAsLong()) {
          current = restored;
          scheduleExpiry();
        } else file.delete();
      }
    } catch (FileNotFoundException empty) {
      // 첫 실행이거나 로그아웃한 상태예요.
    } catch (IOException | GeneralSecurityException unreadable) {
      file.delete();
    }
    initialized = true;
    notifyChange();
  }

  /** 저장 결과를 메인 스레드에 전달해요. 성공이면 오류가 null이에요. */
  public void signInAsync(String token, String expiresAt, Consumer<Exception> onComplete) {
    long version = logoutVersion;
    WORKER.execute(
        () -> {
          try {
            Session saved;
            synchronized (this) {
              if (version != logoutVersion) throw new CancellationException();
              signIn(token, expiresAt);
              saved = current;
            }
            timer.post(
                () -> onComplete.accept(snapshot() == saved ? null : new CancellationException()));
          } catch (IOException | IllegalArgumentException | CancellationException failure) {
            timer.post(() -> onComplete.accept(failure));
          }
        });
  }

  @WorkerThread
  synchronized void signIn(String token, String expiresAt) throws IOException {
    long expiresAtMillis = Session.expiryMillis(expiresAt);
    // 서버가 발급한 32바이트 base64url 세션 토큰 형태를 확인해요.
    if (token == null
        || !token.matches("[A-Za-z0-9_-]{43}")
        || expiresAtMillis <= clock.getAsLong())
      throw new IllegalArgumentException("유효한 세션이 필요해요.");
    try {
      ByteArrayOutputStream plain = new ByteArrayOutputStream();
      try (DataOutputStream data = new DataOutputStream(plain)) {
        data.writeUTF(token);
        data.writeLong(expiresAtMillis);
      }
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, key(true));
      cipher.updateAAD(server);
      byte[] encrypted = cipher.doFinal(plain.toByteArray());
      AtomicFile file = sessionFile();
      FileOutputStream output = file.startWrite();
      try {
        DataOutputStream data = new DataOutputStream(output);
        data.write(cipher.getIV());
        data.writeShort(encrypted.length);
        data.write(encrypted);
        file.finishWrite(output);
      } catch (IOException failure) {
        file.failWrite(output);
        throw failure;
      }
    } catch (GeneralSecurityException failure) {
      throw new IOException("세션을 저장할 수 없어요.", failure);
    }
    initialized = true;
    current = new Session(token, expiresAtMillis);
    notifyChange();
    scheduleExpiry();
  }

  private static SecretKey key(boolean create) throws GeneralSecurityException, IOException {
    KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
    keys.load(null);
    SecretKey existing = (SecretKey) keys.getKey(KEY, null);
    if (existing != null) return existing;
    if (!create) throw new InvalidKeyException();
    KeyGenerator generator =
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
    generator.init(
        new KeyGenParameterSpec.Builder(
                KEY, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
    return generator.generateKey();
  }

  public LiveData<Long> changes() {
    return changes;
  }

  public boolean isSignedIn() {
    return snapshot() != null;
  }

  Session snapshot() {
    Session session = current;
    return session != null && session.expiresAt > clock.getAsLong() ? session : null;
  }

  synchronized void clearIfCurrent(Session sent) {
    if (sent != null && current == sent) clearSession();
  }

  public synchronized void clear() {
    logoutVersion++;
    clearSession();
  }

  private void clearSession() {
    sessionFile().delete();
    if (current == null && initialized) return;
    initialized = true;
    current = null;
    timer.removeCallbacks(checkExpiry);
    notifyChange();
  }

  private void notifyChange() {
    changes.postValue(++revision);
  }

  void refreshExpiryAsync() {
    WORKER.execute(this::checkExpiry);
  }

  private synchronized void checkExpiry() {
    if (current == null) return;
    if (snapshot() == null) clearSession();
    else scheduleExpiry();
  }

  private void scheduleExpiry() {
    timer.removeCallbacks(checkExpiry);
    timer.postDelayed(checkExpiry, Math.max(1, current.expiresAt - clock.getAsLong()));
  }
}
