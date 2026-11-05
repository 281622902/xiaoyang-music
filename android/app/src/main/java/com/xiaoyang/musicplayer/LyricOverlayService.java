package com.xiaoyang.musicplayer;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * 桌面歌词悬浮窗（v3.3.0 重设计）：TYPE_APPLICATION_OVERLAY 悬浮于所有应用之上。
 *
 * 视觉对标网易云音乐 / QQ 音乐 / 酷狗的「桌面歌词卡片」：
 *   · 半透明深色毛玻璃卡：GradientDrawable 双色渐变底 + 1dp 半透明白描边 + 24dp 大圆角 + 悬浮阴影
 *   · 顶部信息条：品牌绿小圆点 + 歌名(13sp 中粗) + · + 歌手(11sp 次要色)，整体克制
 *   · 主歌词区：17sp(可调 13~24) 白色中等粗细，最多两行，超长省略
 *   · 翻译行：11sp #B3FFFFFF，最多一行（有译文才显示）
 *   · 下一句：11sp #66FFFFFF，最多一行，作为「预读」暗示
 *   · 底部：2dp 圆角细进度条（底 #33FFFFFF + 品牌绿前景）+ 右侧 mm:ss / mm:ss(10sp #80FFFFFF)
 *   · 右下角「A－ / A＋」字号按钮（26dp 宽，半透明圆角底）
 *
 * 交互：整卡拖动移动、单击空白区回到 App、长按 700ms 关闭悬浮窗。
 * 依赖 MusicService 前台保活（同进程）；悬浮窗权限由用户在系统设置授予。
 */
public class LyricOverlayService extends Service {
    // ── 视觉常量 ───────────────────────────────────────────────
    /** 品牌绿：顶部圆点 + 进度条前景 */
    private static final int ACCENT = Color.parseColor("#2FBF9F");
    private static final int COLOR_CUR = 0xFFFFFFFF;      // 主歌词
    private static final int COLOR_TRANS = 0xB3FFFFFF;    // 翻译行
    private static final int COLOR_NEXT = 0x66FFFFFF;     // 下一句（预读）
    private static final int COLOR_TIME = 0x80FFFFFF;     // 时间
    private static final int COLOR_TRACK = 0x33FFFFFF;    // 进度条底
    private static final int COLOR_TITLE = 0xF2FFFFFF;    // 歌名
    private static final int COLOR_ARTIST = 0x99FFFFFF;   // 歌手
    private static final int COLOR_BUTTON_BG = 0x1FFFFFFF; // 字号按钮底
    private static final int COLOR_BUTTON_STROKE = 0x33FFFFFF;
    private static final int COLOR_BUTTON_TEXT = 0xCCFFFFFF;
    /** 卡片最大宽度（dp） */
    private static final int CARD_MAX_WIDTH_DP = 320;

    private static final String PREFS_NAME = "xy_music";
    private static final String PREF_FONT_SIZE = "lyric_font_size";
    private static final int FONT_MIN = 13;
    private static final int FONT_MAX = 24;
    private static final int FONT_DEFAULT = 17;

    private WindowManager windowManager;
    /** 窗口根容器：透明 + 四周留白给阴影，避免卡片阴影被窗口边界裁掉；同时是整卡拖动命中区 */
    private FrameLayout root;

    private TextView titleView;
    private TextView artistView;
    private TextView curView;
    private TextView transView;
    private TextView nextView;
    private TextView timeView;
    private ProgressLine progressView;
    private TextView fontMinus;
    private TextView fontPlus;

    private SharedPreferences prefs;
    private int fontSize = FONT_DEFAULT;
    private int positionMs = -1;
    private int durationMs = -1;
    /** 前端推送的进度（0~1），用于原生拿不到 position/duration 时的兜底 */
    private float jsProgress = 0f;
    /** 当前是否播放中，用于暂停时冻结进度条 */
    private boolean playing = false;
    /** 上一次刷新进度的时刻（毫秒），用于按真实时间平滑推进进度条 */
    private long lastTick = 0;
    private int lastX = 0, lastY = 120;
    private boolean closing = false;
    /** 静态实例：被插件线程读取、由主线程写入，需 volatile 保证可见性 */
    private static volatile LyricOverlayService instance;
    /** 用户长按关闭后的标记：避免下一句歌词立刻把悬浮窗重新拉起来 */
    private static volatile boolean closedByUser = false;

    public static LyricOverlayService getInstance() { return instance; }

    /** 是否已被用户长按关闭 */
    public static boolean isClosedByUser() { return closedByUser; }

    /** 用户主动关闭悬浮窗（设置里重新开启时调用） */
    public static void resetClosedByUser() { closedByUser = false; }

    /** 主线程 Handler：长按 700ms 关闭 + 进度条 250ms 平滑刷新 */
    private final Handler handler = new Handler(Looper.getMainLooper());

    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (closing) return;
            long now = SystemClock.uptimeMillis();
            if (playing && durationMs > 0 && positionMs >= 0) {
                int delta = (int) (now - lastTick);
                if (delta > 0) positionMs = Math.min(durationMs, positionMs + delta);
            }
            lastTick = now;
            refreshProgress();
            handler.postDelayed(this, 250);
        }
    };

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        fontSize = clampFont(prefs.getInt(PREF_FONT_SIZE, FONT_DEFAULT));
        lastTick = SystemClock.uptimeMillis();

        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;

        // 根容器：只做阴影留白与拖动命中区，卡片本体在 root 内
        root = new FrameLayout(this);
        root.setClipChildren(false);
        root.setClipToPadding(false);
        int shadowRoom = dp(12);
        root.setPadding(shadowRoom, shadowRoom, shadowRoom, shadowRoom);

        LinearLayout card = buildCard();
        // 宽度取定值（≤320dp 且不超出屏幕）：底部进度条用 weight 填充，需要确定的父宽度
        int cardWidth = Math.min(dp(CARD_MAX_WIDTH_DP),
                Math.max(dp(220), getResources().getDisplayMetrics().widthPixels - dp(32)));
        FrameLayout.LayoutParams cardLp = new FrameLayout.LayoutParams(cardWidth, FrameLayout.LayoutParams.WRAP_CONTENT);
        root.addView(card, cardLp);

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

        // 拖动 + 单击回 App + 长按关闭
        // 字号按钮是可点击子控件，会先消费触摸，不会触发这里的拖动/单击逻辑
        root.setOnTouchListener(new View.OnTouchListener() {
            private float downX, downY; private boolean moved; private boolean longPressed;
            private final Runnable longPress = new Runnable() {
                @Override public void run() {
                    if (moved || closing) return;
                    longPressed = true;
                    closing = true; // 关闭流程中不再更新窗口布局，避免视图已移除时报错
                    closedByUser = true; // 标记为用户主动关闭：后续歌词推送不再把悬浮窗拉回来
                    stopSelf(); // 长按 700ms：关闭悬浮窗
                }
            };
            @Override public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = event.getRawX(); downY = event.getRawY();
                        moved = false; longPressed = false;
                        handler.removeCallbacks(longPress);
                        handler.postDelayed(longPress, 700);
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx = event.getRawX() - downX, dy = event.getRawY() - downY;
                        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
                            if (!moved) handler.removeCallbacks(longPress); // 开始拖动 → 取消长按
                            moved = true;
                        }
                        if (moved && !closing) {
                            params.x = lastX + (int) dx;
                            params.y = lastY + (int) dy;
                            try { windowManager.updateViewLayout(root, params); } catch (Exception ignored) {}
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        handler.removeCallbacks(longPress);
                        if (moved) {
                            lastX = params.x; lastY = params.y;
                        } else if (!longPressed) { // 单击（未长按）：回到 App
                            Intent open = new Intent(LyricOverlayService.this, MainActivity.class);
                            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(open);
                        }
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        handler.removeCallbacks(longPress);
                        return true;
                }
                return false;
            }
        });
        try {
            windowManager.addView(root, params);
            // 视图已挂载后再暴露实例，保证插件拿到 instance 时首帧可写
            instance = this;
            handler.postDelayed(ticker, 250);
        } catch (Exception e) {
            stopSelf();
        }
    }

    /** 组装卡片：信息条 + 主歌词 + 翻译 + 预读 + 进度条 + 字号按钮 */
    private LinearLayout buildCard() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(14), dp(10), dp(14), dp(10));
        // 半透明深色毛玻璃底：左上 → 右下渐变 + 1dp 半透明白描边 + 24dp 圆角
        GradientDrawable bg = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[]{0xE6141B26, 0xE60A0E14});
        bg.setCornerRadius(dp(24));
        bg.setStroke(dp(1), 0x2EFFFFFF);
        box.setBackground(bg);
        box.setElevation(dp(10)); // 悬浮阴影（API21+）

        // ── 顶部信息条 ──
        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);

        View dot = new View(this);
        GradientDrawable dotBg = new GradientDrawable();
        dotBg.setShape(GradientDrawable.OVAL);
        dotBg.setColor(ACCENT);
        dot.setBackground(dotBg);
        LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(7), dp(7));
        dotLp.rightMargin = dp(7);
        top.addView(dot, dotLp);

        titleView = new TextView(this);
        titleView.setTextColor(COLOR_TITLE);
        titleView.setTextSize(13);
        titleView.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        titleView.setText("未知歌曲");
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        titleLp.rightMargin = dp(4);
        top.addView(titleView, titleLp);

        TextView sep = new TextView(this);
        sep.setTextColor(0x66FFFFFF);
        sep.setTextSize(11);
        sep.setText("·");
        top.addView(sep);

        artistView = new TextView(this);
        artistView.setTextColor(COLOR_ARTIST);
        artistView.setTextSize(11);
        artistView.setSingleLine(true);
        artistView.setEllipsize(TextUtils.TruncateAt.END);
        artistView.setMaxWidth(dp(110));
        artistView.setText("");
        LinearLayout.LayoutParams artistLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        artistLp.leftMargin = dp(4);
        top.addView(artistView, artistLp);

        LinearLayout.LayoutParams topLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        topLp.bottomMargin = dp(8);
        box.addView(top, topLp);

        // ── 主歌词 ──
        curView = new TextView(this);
        curView.setTextColor(COLOR_CUR);
        curView.setTextSize(fontSize);
        curView.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        curView.setMaxLines(2);
        curView.setEllipsize(TextUtils.TruncateAt.END);
        curView.setLineSpacing(0, 1.12f);
        curView.setShadowLayer(dp(4), 0, dp(1), 0x80000000);
        curView.setText("小杨音乐 · 等待歌词…");
        box.addView(curView);

        // ── 翻译行（有译文才显示） ──
        transView = new TextView(this);
        transView.setTextColor(COLOR_TRANS);
        transView.setTextSize(11);
        transView.setMaxLines(1);
        transView.setEllipsize(TextUtils.TruncateAt.END);
        transView.setVisibility(View.GONE);
        LinearLayout.LayoutParams transLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        transLp.topMargin = dp(3);
        box.addView(transView, transLp);

        // ── 下一句（预读暗示） ──
        nextView = new TextView(this);
        nextView.setTextColor(COLOR_NEXT);
        nextView.setTextSize(11);
        nextView.setMaxLines(1);
        nextView.setEllipsize(TextUtils.TruncateAt.END);
        nextView.setText("");
        LinearLayout.LayoutParams nextLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        nextLp.topMargin = dp(3);
        box.addView(nextView, nextLp);

        // ── 底部：进度条 + 时间 + 字号按钮 ──
        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.HORIZONTAL);
        bottom.setGravity(Gravity.CENTER_VERTICAL);

        progressView = new ProgressLine(this);
        progressView.setAccent(ACCENT);
        LinearLayout.LayoutParams barLp = new LinearLayout.LayoutParams(0, dp(2), 1f);
        bottom.addView(progressView, barLp);

        timeView = new TextView(this);
        timeView.setTextColor(COLOR_TIME);
        timeView.setTextSize(10);
        timeView.setText("--:-- / --:--");
        LinearLayout.LayoutParams timeLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        timeLp.leftMargin = dp(8);
        bottom.addView(timeView, timeLp);

        fontMinus = buildFontButton("A－", "减小字号");
        fontPlus = buildFontButton("A＋", "增大字号");
        LinearLayout.LayoutParams minusLp = new LinearLayout.LayoutParams(dp(26), dp(22));
        minusLp.leftMargin = dp(8);
        bottom.addView(fontMinus, minusLp);
        LinearLayout.LayoutParams plusLp = new LinearLayout.LayoutParams(dp(26), dp(22));
        plusLp.leftMargin = dp(4);
        bottom.addView(fontPlus, plusLp);

        LinearLayout.LayoutParams bottomLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        bottomLp.topMargin = dp(10);
        box.addView(bottom, bottomLp);

        return box;
    }

    /** 字号按钮：半透明圆角底 + 描边；自身可点击，不参与卡片拖动 */
    private TextView buildFontButton(String label, String desc) {
        TextView btn = new TextView(this);
        btn.setText(label);
        btn.setTextColor(COLOR_BUTTON_TEXT);
        btn.setTextSize(13);
        btn.setGravity(Gravity.CENTER);
        btn.setIncludeFontPadding(false);
        btn.setContentDescription(desc);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(COLOR_BUTTON_BG);
        bg.setCornerRadius(dp(6));
        bg.setStroke(dp(1), COLOR_BUTTON_STROKE);
        btn.setBackground(bg);
        btn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { adjustFontSize(v == fontPlus ? 1 : -1); }
        });
        return btn;
    }

    private void adjustFontSize(int delta) {
        fontSize = clampFont(fontSize + delta);
        if (curView != null) curView.setTextSize(fontSize);
        if (prefs != null) prefs.edit().putInt(PREF_FONT_SIZE, fontSize).apply();
    }

    private int clampFont(int size) {
        if (size < FONT_MIN) return FONT_MIN;
        if (size > FONT_MAX) return FONT_MAX;
        return size;
    }

    private int dp(float value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    /**
     * 由 NativeMusicPlugin 在每句歌词更新时调用（主线程）。
     *
     * @param cur      当前句歌词
     * @param next     下一句歌词（预读）
     * @param trans    翻译行，可为空
     * @param title    歌名，可为空
     * @param artist   歌手，可为空
     * @param playing  是否正在播放（false 时整卡降到 0.5 透明度）
     * @param progress 播放进度 0~1
     */
    public void updateLyric(String cur, String next, String trans, String title, String artist,
                            boolean playing, float progress) {
        if (curView != null) curView.setText(cur == null ? "" : cur);
        if (nextView != null) nextView.setText(next == null ? "" : next);
        if (transView != null) {
            String t = trans == null ? "" : trans.trim();
            transView.setText(t);
            transView.setVisibility(t.isEmpty() ? View.GONE : View.VISIBLE);
        }
        if (titleView != null) {
            String t = title == null ? "" : title.trim();
            titleView.setText(t.isEmpty() ? "未知歌曲" : t);
        }
        if (artistView != null) artistView.setText(artist == null ? "" : artist);
        // 记录播放状态与前端进度（原生拿不到时长时用它兜底）
        this.playing = playing;
        float p = progress;
        if (p < 0f) p = 0f;
        if (p > 1f) p = 1f;
        this.jsProgress = p;
        // 暂停时整卡降到 0.5 透明度，播放时恢复
        if (root != null) root.setAlpha(playing ? 1f : 0.5f);
        refreshProgress();
    }

    /**
     * 同步播放时间（用于右下角 mm:ss / mm:ss 显示与进度条）。
     *
     * @param positionMs 当前播放位置（毫秒），&lt;0 表示未知
     * @param durationMs 总时长（毫秒），&lt;0 表示未知
     */
    public void setPlaybackTime(int positionMs, int durationMs) {
        this.positionMs = positionMs;
        this.durationMs = durationMs;
        lastTick = SystemClock.uptimeMillis();
        refreshProgress();
    }

    /** 刷新进度条与时间文本：优先用原生 position/duration，否则回退到前端进度 */
    private void refreshProgress() {
        float p;
        if (durationMs > 0 && positionMs >= 0) {
            p = positionMs / (float) durationMs;
        } else {
            p = jsProgress;
        }
        if (progressView != null) progressView.setProgress(p);
        if (timeView != null) {
            String t = formatTime(positionMs, durationMs);
            // 文本不变就不重设，避免 250ms 一次的无谓 relayout
            if (!t.contentEquals(timeView.getText())) timeView.setText(t);
        }
    }

    /** 毫秒 → mm:ss；未知时显示 --:-- */
    private String formatTime(int positionMs, int durationMs) {
        String cur = positionMs >= 0 ? clock(positionMs / 1000) : "--:--";
        String total = durationMs >= 0 ? clock(durationMs / 1000) : "--:--";
        return cur + " / " + total;
    }

    private String clock(int seconds) {
        if (seconds < 0) seconds = 0;
        int m = seconds / 60;
        int s = seconds % 60;
        return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    }

    @Override public void onDestroy() {
        instance = null;
        closing = true;
        handler.removeCallbacks(ticker);
        handler.removeCallbacksAndMessages(null);
        if (root != null) {
            try { windowManager.removeView(root); } catch (Exception ignored) {}
            root = null;
        }
        super.onDestroy();
    }

    public static boolean canDraw(android.content.Context ctx) {
        return Build.VERSION.SDK_INT >= 23 && Settings.canDrawOverlays(ctx);
    }

    /** 2dp 细进度条：底色 #33FFFFFF，前景品牌绿，圆角（纯 framework 绘制，无三方依赖） */
    private static final class ProgressLine extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private int accent = ACCENT;
        private float progress = 0f;

        ProgressLine(Context context) { super(context); }

        void setAccent(int color) { accent = color; invalidate(); }

        void setProgress(float value) {
            float p = value < 0f ? 0f : (value > 1f ? 1f : value);
            if (Math.abs(p - progress) < 0.001f) return;
            progress = p;
            invalidate();
        }

        @Override protected void onDraw(Canvas canvas) {
            float w = getWidth();
            float h = getHeight();
            if (w <= 0 || h <= 0) return;
            float r = h / 2f;
            paint.setColor(COLOR_TRACK);
            canvas.drawRoundRect(0f, 0f, w, h, r, r, paint);
            float filled = w * progress;
            if (filled > 0f) {
                paint.setColor(accent);
                canvas.drawRoundRect(0f, 0f, filled, h, r, r, paint);
            }
        }
    }
}
