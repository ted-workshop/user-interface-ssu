package kr.ac.ssu.qletter;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
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
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** 로그인 성공 결과를 보관하고 화면에는 세션 변경만 알려요. */
public final class SessionStore {
  private static final String KEY = "qletter.session.v1";
  private final AtomicFile file;
  private final byte[] server;
  private final Handler timer = new Handler(Looper.getMainLooper());
  private final Runnable checkExpiry = this::checkExpiry;
  private final MutableLiveData<Long> changes = new MutableLiveData<>(0L);
  private long revision;
  private Session current;

  SessionStore(Context context, String baseUrl) {
    file = new AtomicFile(new File(context.getNoBackupFilesDir(), "qletter.session"));
    server = baseUrl.getBytes(StandardCharsets.UTF_8);
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
        if (restored.expiresAt > System.currentTimeMillis()) {
          current = restored;
          scheduleExpiry();
        } else file.delete();
      }
    } catch (FileNotFoundException empty) {
      // 첫 실행이거나 로그아웃한 상태예요.
    } catch (IOException | GeneralSecurityException unreadable) {
      file.delete();
    }
  }

  public synchronized void signIn(String token, String expiresAt) throws IOException {
    long expiresAtMillis = Session.expiryMillis(expiresAt);
    // 서버가 발급한 32바이트 base64url 세션 토큰 형태를 확인해요.
    if (token == null
        || !token.matches("[A-Za-z0-9_-]{43}")
        || expiresAtMillis <= System.currentTimeMillis())
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

  public synchronized boolean isSignedIn() {
    return snapshot() != null;
  }

  synchronized Session snapshot() {
    if (current != null && current.expiresAt <= System.currentTimeMillis()) clear();
    return current;
  }

  synchronized void clearIfCurrent(Session sent) {
    if (sent != null && current == sent) clear();
  }

  public synchronized void clear() {
    file.delete();
    if (current == null) return;
    current = null;
    timer.removeCallbacks(checkExpiry);
    notifyChange();
  }

  private void notifyChange() {
    changes.postValue(++revision);
  }

  private synchronized void checkExpiry() {
    if (snapshot() != null) scheduleExpiry();
  }

  private void scheduleExpiry() {
    timer.removeCallbacks(checkExpiry);
    timer.postDelayed(checkExpiry, Math.max(1, current.expiresAt - System.currentTimeMillis()));
  }
}
