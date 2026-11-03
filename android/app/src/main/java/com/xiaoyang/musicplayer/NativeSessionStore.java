package com.xiaoyang.musicplayer;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.nio.charset.StandardCharsets;

/** Encrypted, synchronously committed auth state; independent of WebView disk-flush timing. */
final class NativeSessionStore {
    private static final String ALIAS = "xiaoyang-auth-v1";
    private final SharedPreferences preferences;
    NativeSessionStore(Context context) { preferences = context.getSharedPreferences("native-auth", Context.MODE_PRIVATE); }
    private void validate(String key) {
        if (!"xiaoyang.supabase.auth.v1".equals(key) && !"xiaoyang.supabase.auth.v1-code-verifier".equals(key) && !"xiaoyang.supabase.auth.v1-flows-code-verifier".equals(key) && !"xiaoyang.supabase.auth.v1-user".equals(key)
            && !key.matches("xiaoyang\\.supabase\\.auth\\.v1-flow-[A-Za-z0-9_-]{1,100}-code-verifier")) throw new IllegalArgumentException("登录存储键无效");
        if (Build.VERSION.SDK_INT < 23) throw new IllegalStateException("安全登录存储需要 Android 6.0 或更新版本");
    }
    private SecretKey key() throws Exception {
        if (Build.VERSION.SDK_INT < 23) throw new IllegalStateException("安全登录存储需要 Android 6.0 或更新版本");
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        if (keys.containsAlias(ALIAS)) return (SecretKey) keys.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    String get(String name) throws Exception {
        validate(name); String saved = preferences.getString(name, null); if (saved == null) return null;
        try {
            String[] parts = saved.split(":", -1); if (parts.length != 2) throw new IllegalArgumentException();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (java.security.GeneralSecurityException | IllegalArgumentException error) {
            // A lost key or corrupted/foreign backup cannot be used as a session. Require login again.
            remove(name); return null;
        }
    }
    void set(String name, String value) throws Exception {
        validate(name); if (value == null || value.length() > 128 * 1024) throw new IllegalArgumentException("登录存储数据无效");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!preferences.edit().putString(name, encoded).commit()) throw new java.io.IOException("无法保存登录状态");
    }
    void remove(String name) throws Exception { validate(name); if (!preferences.edit().remove(name).commit()) throw new java.io.IOException("无法清除登录状态"); }
}
