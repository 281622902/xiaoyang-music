package com.xiaoyang.musicplayer;

import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * 桌面歌词悬浮窗（v3.2.2）：TYPE_APPLICATION_OVERLAY 悬浮于所有应用之上，
 * 展示当前句 + 下一句歌词，支持拖动、点击回 App、长按关闭。
 * 依赖 MusicService 前台保活（同进程）；悬浮窗权限由用户在系统设置授予。
 */
public class LyricOverlayService extends Service {
    private WindowManager windowManager;
    private LinearLayout root;
    private TextView curView;
    private TextView nextView;
    private int lastX = 0, lastY = 120;
    private boolean playing = true;
    private static LyricOverlayService instance;

    public static LyricOverlayService getInstance() { return instance; }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(28, 18, 28, 18);
        root.setBackgroundColor(0xB3000000);
        // 圆角背景
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setColor(0xB3000000);
        bg.setCornerRadius(36);
        bg.setStroke(2, 0x3DFFFFFF);
        root.setBackground(bg);

        curView = new TextView(this);
        curView.setTextColor(0xFFFFFFFF);
        curView.setTextSize(16);
        curView.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        curView.setShadowLayer(3, 0, 0, 0x80000000);
        curView.setSingleLine(true);
        curView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        curView.setText("小杨音乐 · 等待歌词…");
        root.addView(curView);

        nextView = new TextView(this);
        nextView.setTextColor(0xB3FFFFFF);
        nextView.setTextSize(12);
        nextView.setSingleLine(true);
        nextView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        nextView.setText("");
        LinearLayout.LayoutParams np = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        np.topMargin = 6;
        root.addView(nextView, np);

        final WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = lastX;
        params.y = lastY;

        // 拖动 + 点击回 App + 长按关闭
        root.setOnTouchListener(new View.OnTouchListener() {
            private float downX, downY; private long downTime; private boolean moved;
            @Override public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = event.getRawX(); downY = event.getRawY();
                        downTime = System.currentTimeMillis(); moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx = event.getRawX() - downX, dy = event.getRawY() - downY;
                        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
                        if (moved) {
                            params.x = lastX + (int) dx;
                            params.y = lastY + (int) dy;
                            windowManager.updateViewLayout(root, params);
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (!moved) {
                            long held = System.currentTimeMillis() - downTime;
                            if (held > 700) { // 长按：关闭悬浮窗
                                stopSelf();
                            } else { // 单击：回到 App
                                Intent open = new Intent(LyricOverlayService.this, MainActivity.class);
                                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(open);
                            }
                        } else {
                            lastX = params.x; lastY = params.y;
                        }
                        return true;
                }
                return false;
            }
        });
        try {
            windowManager.addView(root, params);
        } catch (Exception e) {
            stopSelf();
        }
    }

    /** 由 NativeMusicPlugin 在每句歌词更新时调用 */
    public void updateLyric(String cur, String next, boolean playing) {
        this.playing = playing;
        if (curView != null && cur != null) curView.setText(cur);
        if (nextView != null) nextView.setText(next == null ? "" : next);
        float alpha = playing ? 1f : 0.45f;
        if (root != null) root.setAlpha(alpha);
    }

    @Override public void onDestroy() {
        instance = null;
        if (root != null) {
            try { windowManager.removeView(root); } catch (Exception ignored) {}
            root = null;
        }
        super.onDestroy();
    }

    public static boolean canDraw(android.content.Context ctx) {
        return Build.VERSION.SDK_INT >= 23 && Settings.canDrawOverlays(ctx);
    }
}
