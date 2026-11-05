package com.xiaoyang.musicplayer;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.MessageDigest;
import java.util.ArrayList;

/**
 * 设备授权（v3.5.0 防泄露机制）——设备指纹来源。
 *
 * 设备指纹 = SHA-256(ANDROID_ID | 包名 | 签名证书 SHA-256) 的前 16 位十六进制。
 *
 * 选这三个要素的原因：
 *   · ANDROID_ID：同一台设备重装 App 不变，换机必变（恢复出厂设置会变）；
 *   · 包名：挡住「改包名重打包」的二次分发；
 *   · 签名证书：挡住「同包名用不同签名重打包」（最强的一道，因为
 *     攻击者必须用原签名才能装到已安装同包名的设备上）。
 *
 * 三者合起来，让「一份 APK 泄露 → 别人装机」这条路在服务端授权码
 * 校验处被挡住：授权码绑定 device_id，别人的设备指纹不同，码直接失效。
 */
@CapacitorPlugin(name = "DeviceAuth")
public class DeviceAuthPlugin extends Plugin {

    /** 取设备指纹；取不到时返回空串（由前端决定降级策略） */
    @PluginMethod
    public void deviceId(PluginCall call) {
        try {
            JSObject ret = new JSObject();
            ret.put("deviceId", deviceId(getContext()));
            ret.put("androidId", androidId(getContext()));
            ret.put("packageName", getContext().getPackageName());
            ret.put("signer", signerHash(getContext()));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读取设备信息失败：" + (e.getMessage() == null ? "未知错误" : e.getMessage()));
        }
    }

    /** App 版本号（授权码版本校验要用）
     *  从 PackageManager 读已安装包的 versionName/versionCode —— 不依赖 BuildConfig，
     *  因为 AGP 8.x 默认不生成 BuildConfig（要 buildFeatures.buildConfig=true 才生成）。
     *  用包信息还有额外好处：拿到的就是「实际装在设备上的那个包」的版本，不会和安装的 APK 对不上。
     */
    @PluginMethod
    public void appVersion(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageManager pm = ctx.getPackageManager();
            PackageInfo info = pm.getPackageInfo(ctx.getPackageName(), 0);
            JSObject ret = new JSObject();
            ret.put("version", info.versionName == null ? "" : info.versionName);
            // getLongVersionCode() 是 API 28 才有的；minSdk 22，需要按版本分支
            long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? info.getLongVersionCode()
                    : info.versionCode;
            ret.put("versionCode", versionCode);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读取版本失败：" + (e.getMessage() == null ? "未知错误" : e.getMessage()));
        }
    }

    /* ---------------- 内部实现 ---------------- */

    private static String androidId(Context ctx) {
        try {
            String id = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ANDROID_ID);
            return id == null ? "" : id;
        } catch (Exception e) {
            return "";
        }
    }

    /** 签名证书 SHA-256（多签时取第一个；兼容 v1/v2/v3）
     *  API 28+ 走 GET_SIGNING_CERTIFICATES：只用 v2/v3 签名时，
     *  老的 GET_SIGNATURES 会返回 null，指纹就废了。
     *  注意：不同 SDK 的 android.jar 里 PackageManager.getSigningInfo() 不一定存在，
     *  所以统一用 PackageInfo.signingInfo 字段读，避免编译期找不到符号。
     */
    @SuppressWarnings("deprecation")
    private static String signerHash(Context ctx) {
        try {
            PackageManager pm = ctx.getPackageManager();
            String pkg = ctx.getPackageName();
            Signature[] signs = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
                SigningInfo si = info.signingInfo;
                if (si != null) {
                    signs = si.hasMultipleSigners() ? si.getApkContentsSigners() : si.getSigningCertificateHistory();
                }
            }
            if (signs == null || signs.length == 0) {
                PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES);
                signs = info.signatures;
            }
            if (signs == null || signs.length == 0) return "";
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(signs[0].toByteArray());
            return hex(md.digest());
        } catch (Exception e) {
            return "";
        }
    }

    private static String deviceId(Context ctx) {
        try {
            String raw = androidId(ctx) + "|" + ctx.getPackageName() + "|" + signerHash(ctx);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(raw.getBytes("UTF-8"));
            return hex(md.digest()).substring(0, 16);
        } catch (Exception e) {
            return "";
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            String h = Integer.toHexString(b & 0xff);
            if (h.length() == 1) sb.append('0');
            sb.append(h);
        }
        return sb.toString();
    }
}
