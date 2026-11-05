package com.xiaoyang.musicplayer;

import android.content.ComponentName;
import android.content.Intent;
import android.app.Activity;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.provider.OpenableColumns;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

@UnstableApi
@CapacitorPlugin(name="NativeMusic")
public class NativeMusicPlugin extends Plugin {
    private MediaController controller;
    private ListenableFuture<MediaController> future;
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean destroyed;
    private boolean visible = true;
    private String lastQueueSignature = "";
    private final java.util.concurrent.ExecutorService files = java.util.concurrent.Executors.newSingleThreadExecutor();
    private final java.util.concurrent.ExecutorService authFiles = java.util.concurrent.Executors.newSingleThreadExecutor();
    private final Runnable ticker = new Runnable(){public void run(){if(!destroyed){if(visible)emit();main.postDelayed(this,visible?500:2000);}}};
    @Override public void load() { main.post(()->{connect();main.post(ticker);handleFileIntent(getActivity().getIntent());}); }
    private void connect() {
        if(future!=null || destroyed)return;
        future = new MediaController.Builder(getContext(),new SessionToken(getContext(),new ComponentName(getContext(),MusicService.class))).buildAsync();
        future.addListener(()->{try{controller=future.get();controller.addListener(new Player.Listener(){
            @Override public void onEvents(Player player,Player.Events events){emit();}
        });emit();}catch(Exception ignored){future=null;}},ContextCompat.getMainExecutor(getContext()));
    }
    private interface Operation {void apply() throws Exception;}
    private void ready(PluginCall call,Operation operation){main.post(()->{if(controller==null){connect();call.reject("原生播放器正在连接，请稍后重试");return;}try{operation.apply();call.resolve(snapshot());}catch(Exception error){call.reject(error.getMessage(),error);}});}
    private JSONObject track(MediaItem item) {
        try{return new JSONObject(item.mediaMetadata.extras!=null?item.mediaMetadata.extras.getString("track","{}"):"{}");}catch(Exception error){return new JSONObject();}
    }
    private JSObject snapshot(){return snapshot(true);}
    private JSObject snapshot(boolean includeQueue){
        JSObject state=new JSObject();if(controller==null){state.put("connected",false);return state;}
        state.put("connected",true);state.put("restored",MusicService.restored);state.put("epoch",MusicService.epoch);state.put("paused",!controller.getPlayWhenReady() || controller.getPlayerError()!=null || controller.getPlaybackState()==Player.STATE_ENDED);state.put("playing",controller.isPlaying());state.put("position",controller.getCurrentPosition()/1000.0);
        long duration=controller.getDuration();state.put("duration",duration==C.TIME_UNSET?(controller.getCurrentMediaItem()!=null?track(controller.getCurrentMediaItem()).optDouble("duration",0):0):duration/1000.0);state.put("readyState",controller.getPlaybackState()==Player.STATE_READY?4:1);state.put("ended",controller.getPlaybackState()==Player.STATE_ENDED);state.put("index",controller.getCurrentMediaItemIndex());
        state.put("mode",controller.getShuffleModeEnabled()?"random":controller.getRepeatMode()==Player.REPEAT_MODE_ONE?"single":controller.getRepeatMode()==Player.REPEAT_MODE_ALL?"list":"sequential");
        if(includeQueue){JSArray tracks=new JSArray();for(int i=0;i<controller.getMediaItemCount();i++){MediaItem item=controller.getMediaItemAt(i);JSONObject t=track(item);JSONObject full=MusicService.resolved.get(item.mediaId);if(full!=null){try{t.put("url",full.optString("url"));t.put("lyric",full.optString("lyric"));}catch(Exception ignored){}}tracks.put(t);}state.put("queue",tracks);}
        if(controller.getPlayerError()!=null)state.put("error",controller.getPlayerError().getErrorCodeName());
        return state;
    }
    private void emit(){if(controller!=null){MediaItem item=controller.getCurrentMediaItem();String id=item!=null?item.mediaId:"";JSONObject full=MusicService.resolved.get(id);String signature=MusicService.epoch+"|"+controller.getMediaItemCount()+"|"+controller.getCurrentMediaItemIndex()+"|"+id+"|"+(full!=null?full.hashCode():0);boolean changed=!signature.equals(lastQueueSignature);lastQueueSignature=signature;notifyListeners("state",snapshot(changed));}}
    @PluginMethod public void getState(PluginCall call){ready(call,()->{});}
    @PluginMethod public void authStorageGet(PluginCall call){authFiles.execute(()->{try{String value=new NativeSessionStore(getContext()).get(call.getString("key",""));JSObject result=new JSObject();result.put("value",value==null?JSONObject.NULL:value);call.resolve(result);}catch(Exception error){call.reject("无法读取本机登录状态，请重新登录",error);}});}
    @PluginMethod public void authStorageSet(PluginCall call){authFiles.execute(()->{try{new NativeSessionStore(getContext()).set(call.getString("key",""),call.getString("value"));call.resolve();}catch(Exception error){call.reject("无法保存本机登录状态，请重试",error);}});}
    @PluginMethod public void authStorageRemove(PluginCall call){authFiles.execute(()->{try{new NativeSessionStore(getContext()).remove(call.getString("key",""));call.resolve();}catch(Exception error){call.reject("无法清除本机登录状态，请重试",error);}});}
    @PluginMethod public void getLaunchConfig(PluginCall call){main.post(()->{JSObject result=new JSObject();Intent intent=getActivity().getIntent();String backend=intent.getStringExtra("xy_backend");if((getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0 && "http://localhost:3000".equals(backend))result.put("developmentBackend",backend);intent.removeExtra("xy_backend");call.resolve(result);});}
    @PluginMethod public void setQueue(PluginCall call){ready(call,()->{
        JSArray tracks=call.getArray("tracks",new JSArray());int index=call.getInt("index",0);String base=call.getString("base","");String url=call.getString("url","");
        String quality=call.getString("quality","standard");if(!java.util.Arrays.asList("standard","ex","lossless","hires").contains(quality))quality="standard";
        MusicService.epoch=call.getInt("epoch",0);List<MediaItem> items=NativeQueue.items(tracks,base,url,index,quality);
        MusicService.backendBase=base;MusicService.quality=quality;MusicService.restored=false;
        boolean same=items.size()>=controller.getMediaItemCount() && controller.getMediaItemCount()>0;
        for(int i=0;same&&i<controller.getMediaItemCount();i++)if(!controller.getMediaItemAt(i).mediaId.equals(items.get(i).mediaId))same=false;
        if(call.getBoolean("preserve",false)&&same){if(items.size()>controller.getMediaItemCount())controller.addMediaItems(items.subList(controller.getMediaItemCount(),items.size()));}
        else {MusicService.resetSources();controller.setMediaItems(items,Math.max(0,Math.min(index,items.size()-1)),Math.round(call.getDouble("position",0.0)*1000));controller.prepare();}
        String mode=call.getString("mode","list");controller.setShuffleModeEnabled("random".equals(mode));controller.setRepeatMode("single".equals(mode)?Player.REPEAT_MODE_ONE:"sequential".equals(mode)?Player.REPEAT_MODE_OFF:Player.REPEAT_MODE_ALL);
        controller.setPlayWhenReady(call.getBoolean("play",false));emit();
    });}
    @PluginMethod public void play(PluginCall call){ready(call,()->{if(controller.getPlaybackState()==Player.STATE_IDLE)controller.prepare();MusicService.restored=false;controller.play();});}
    // 倍速（v3.2.0）：Media3 原生变速不变调，1.0 恢复正常
    // ── 桌面歌词悬浮窗（v3.2.2）──────────────────────────────────
    // 前端播放器每句歌词调用：{show, cur, next, trans, title, artist, playing, progress}。
    // show=true 且无悬浮窗权限 → resolve({needsPermission:true})，前端引导授权后重试。
    // v3.3.0：扩展信息条（歌名/歌手）、翻译行与播放进度，供新版悬浮窗卡片渲染。
    @PluginMethod public void lyricOverlay(PluginCall call) {
        boolean show = Boolean.TRUE.equals(call.getBoolean("show", false));
        if (!show) {
            getContext().stopService(new Intent(getContext(), LyricOverlayService.class));
            LyricOverlayService.resetClosedByUser(); // 设置里关闭 → 允许下次再开启
            call.resolve();
            return;
        }
        if (!LyricOverlayService.canDraw(getContext())) {
            JSObject result = new JSObject(); result.put("needsPermission", true);
            call.resolve(result);
            return;
        }
        // 逐句推送一定带 progress 字段；设置页手动开启不带 → 视为用户显式重开
        Float progressValue = call.getFloat("progress");
        if (progressValue == null) LyricOverlayService.resetClosedByUser();
        if (LyricOverlayService.isClosedByUser()) {
            // 用户已长按关闭：不再被逐句推送重新拉起（需在设置里重新开启）
            JSObject closed = new JSObject(); closed.put("closedByUser", true);
            call.resolve(closed);
            return;
        }
        try {
            if (LyricOverlayService.getInstance() == null) {
                getContext().startService(new Intent(getContext(), LyricOverlayService.class));
            }
        } catch (Exception e) { call.reject("无法启动悬浮窗：" + (e.getMessage() == null ? "系统拒绝" : e.getMessage()), e); return; }
        String cur = call.getString("cur", "");
        String next = call.getString("next", "");
        String trans = call.getString("trans", "");
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        boolean playing = Boolean.TRUE.equals(call.getBoolean("playing", true));
        final float progress = progressValue == null ? 0f : progressValue.floatValue();
        // 服务刚启动时 onCreate 尚未执行（startService 异步），重试几次把首帧内容推上去
        final int[] attempts = {0};
        final Runnable push = new Runnable() {
            @Override public void run() {
                LyricOverlayService svc = LyricOverlayService.getInstance();
                if (svc == null) {
                    if (attempts[0]++ < 10) { main.postDelayed(this, 60); return; }
                    return;
                }
                // 播放时间取原生 Media3 控制器（安卓真实播放源），未知时显示 --:--
                int positionMs = -1, durationMs = -1;
                try {
                    if (controller != null) {
                        positionMs = (int) controller.getCurrentPosition();
                        long duration = controller.getDuration();
                        if (duration != C.TIME_UNSET && duration > 0) durationMs = (int) duration;
                    }
                } catch (Exception ignored) {}
                svc.setPlaybackTime(positionMs, durationMs);
                svc.updateLyric(cur, next, trans, title, artist, playing, progress);
            }
        };
        main.post(push);
        call.resolve();
    }
    // 跳系统「显示在其他应用上层」授权页
    @PluginMethod public void overlayPermission(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) { call.reject("无法跳转授权页：" + (e.getMessage() == null ? "系统拒绝" : e.getMessage()), e); }
    }

    @PluginMethod public void setSpeed(PluginCall call){
        Double d = call.getDouble("speed", 1.0);
        float speed = d == null ? 1.0f : d.floatValue();
        if(speed<0.25f||speed>4f){call.reject("倍速范围 0.25x - 4x");return;}
        main.post(()->{if(controller!=null)controller.setPlaybackSpeed(speed);});
        call.resolve();
    }
    @PluginMethod public void retry(PluginCall call){ready(call,()->{
        int index=controller.getCurrentMediaItemIndex();if(index<0||controller.getMediaItemCount()==0)throw new IllegalArgumentException("请先选择歌曲");
        String base=call.getString("base","");
        String quality=call.getString("quality","standard");if(!java.util.Arrays.asList("standard","ex","lossless","hires").contains(quality))quality="standard";
        JSArray tracks=new JSArray();for(int i=0;i<controller.getMediaItemCount();i++)tracks.put(track(controller.getMediaItemAt(i)));
        MusicService.backendBase=base;MusicService.quality=quality;MusicService.restored=false;
        long position=controller.getCurrentPosition();controller.stop();MusicService.resetSources();
        controller.setMediaItems(NativeQueue.items(tracks,base,"",index,quality),index,Math.max(0,position));
        controller.prepare();controller.play();lastQueueSignature="";emit();
    });}
    @PluginMethod public void pause(PluginCall call){ready(call,()->controller.pause());}
    @PluginMethod public void stop(PluginCall call){ready(call,()->{MusicService.epoch=call.getInt("epoch",0);controller.stop();controller.clearMediaItems();});}
    @PluginMethod public void seek(PluginCall call){ready(call,()->controller.seekTo(Math.max(0,Math.round(call.getDouble("position",0.0)*1000))));}
    @PluginMethod public void next(PluginCall call){ready(call,()->{if(controller.hasNextMediaItem()){controller.seekToNextMediaItem();controller.play();}});}
    @PluginMethod public void previous(PluginCall call){ready(call,()->{controller.seekToPrevious();controller.play();});}
    @PluginMethod public void setMode(PluginCall call){ready(call,()->{String mode=call.getString("mode","list");controller.setShuffleModeEnabled("random".equals(mode));controller.setRepeatMode("single".equals(mode)?Player.REPEAT_MODE_ONE:"sequential".equals(mode)?Player.REPEAT_MODE_OFF:Player.REPEAT_MODE_ALL);});}
    @PluginMethod public void setVolume(PluginCall call){ready(call,()->controller.setVolume(Math.max(0,Math.min(1,call.getFloat("volume",1f)))));}
    @PluginMethod public void pickFiles(PluginCall call){
        Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("audio/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call,pick,"pickResult");
    }
    @ActivityCallback private void pickResult(PluginCall call,ActivityResult result){
        if(call==null)return;if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null){JSObject empty=new JSObject();empty.put("tracks",new JSArray());call.resolve(empty);return;}
        Intent data=result.getData();List<Uri> uris=new ArrayList<>();
        if(data.getClipData()!=null){for(int i=0;i<Math.min(data.getClipData().getItemCount(),200);i++)uris.add(data.getClipData().getItemAt(i).getUri());}else if(data.getData()!=null)uris.add(data.getData());
        readFiles(uris,data.getFlags(),call);
    }
    private String[] durableCopy(Uri uri,String filename)throws Exception{
        java.io.File directory=new java.io.File(getContext().getFilesDir(),"music-imports");if(!directory.exists()&&!directory.mkdirs())throw new java.io.IOException("Cannot create music storage");
        java.io.File temporary=java.io.File.createTempFile("pending-",".audio",directory);
        java.security.MessageDigest hash=java.security.MessageDigest.getInstance("SHA-256");long total=0;
        try{
            try(java.io.InputStream input=getContext().getContentResolver().openInputStream(uri);java.io.OutputStream output=new java.io.FileOutputStream(temporary)){
                if(input==null)throw new java.io.IOException("File cannot be opened");byte[] buffer=new byte[65536];int n;
                while((n=input.read(buffer))!=-1){total+=n;if(total>256L*1024*1024||Thread.currentThread().isInterrupted()||directory.getUsableSpace()<1024*1024)throw new java.io.IOException("Music copy exceeds available space or size limit");hash.update(buffer,0,n);output.write(buffer,0,n);}
            }
            StringBuilder hex=new StringBuilder();for(byte value:hash.digest())hex.append(String.format(java.util.Locale.ROOT,"%02x",value&0xff));
            String ext=filename.contains(".")?filename.substring(filename.lastIndexOf('.')+1).toLowerCase(java.util.Locale.ROOT):"audio";if(!ext.matches("[a-z0-9]{1,8}"))ext="audio";
            java.io.File stored=new java.io.File(directory,hex+"."+ext);if(!stored.exists()&&!temporary.renameTo(stored))throw new java.io.IOException("Music could not be saved");
            Uri owned=androidx.core.content.FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",stored);
            return new String[]{owned.toString(),"device:"+hex};
        }finally{if(temporary.exists())temporary.delete();}
    }
    private void readFiles(List<Uri> uris,int flags,@androidx.annotation.Nullable PluginCall call){files.execute(()->{
        JSArray tracks=new JSArray();for(Uri uri:uris){if(!"content".equals(uri.getScheme()))continue;
            boolean persistent=false;try{getContext().getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);persistent=true;}catch(SecurityException ignored){}
            String filename="本地音乐";try(Cursor cursor=getContext().getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst())filename=cursor.getString(0);}catch(Exception ignored){}
            String playable=uri.toString(),identity="device:"+java.util.UUID.nameUUIDFromBytes(uri.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));boolean copied=false;
            if(!persistent){try{String[] owned=durableCopy(uri,filename);playable=owned[0];identity=owned[1];persistent=true;copied=true;}catch(Exception ignored){}}
            JSONObject track=new JSONObject();try{track.put("id",identity);track.put("vendor","device");track.put("url",playable);track.put("name",filename);track.put("artist","本地音乐");track.put("album","");track.put("persistent",persistent);track.put("storedCopy",copied);track.put("duration",0);
                MediaMetadataRetriever metadata=new MediaMetadataRetriever();try{metadata.setDataSource(getContext(),uri);String title=metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE),artist=metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST),album=metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM),duration=metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);if(title!=null&&!title.isEmpty())track.put("name",title);if(artist!=null&&!artist.isEmpty())track.put("artist",artist);if(album!=null)track.put("album",album);if(duration!=null)track.put("duration",Long.parseLong(duration)/1000.0);}catch(Exception ignored){}finally{try{metadata.release();}catch(Exception ignored){}}
                tracks.put(track);
            }catch(Exception ignored){}
        }
        JSObject data=new JSObject();data.put("tracks",tracks);main.post(()->{if(call!=null)call.resolve(data);else notifyListeners("localFiles",data,true);});
    });}
    private void handleFileIntent(Intent intent){if(intent==null)return;Uri uri=null;if(Intent.ACTION_VIEW.equals(intent.getAction()))uri=intent.getData();else if(Intent.ACTION_SEND.equals(intent.getAction()))uri=intent.getParcelableExtra(Intent.EXTRA_STREAM);if(uri!=null)readFiles(java.util.Collections.singletonList(uri),intent.getFlags(),null);}
    @Override protected void handleOnNewIntent(Intent intent){handleFileIntent(intent);}
    @Override protected void handleOnPause(){visible=false;}
    @Override protected void handleOnResume(){visible=true;main.post(()->{connect();lastQueueSignature="";emit();});}
    @Override protected void handleOnDestroy(){destroyed=true;main.removeCallbacksAndMessages(null);files.shutdownNow();authFiles.shutdown();if(future!=null)MediaController.releaseFuture(future);controller=null;}

    // ── App 内更新（2026-11-05）：下载 APK 到缓存目录 → 调系统安装器，全程不经浏览器 ──
    private final java.util.concurrent.atomic.AtomicBoolean apkDownloading = new java.util.concurrent.atomic.AtomicBoolean(false);
    @PluginMethod public void downloadApk(PluginCall call) {
        String url = call.getString("url");
        String version = call.getString("version", "latest");
        if (url == null || url.isEmpty()) { call.reject("缺少下载地址"); return; }
        if (!apkDownloading.compareAndSet(false, true)) { call.reject("已有下载任务进行中"); return; }
        getBridge().execute(() -> {
            java.io.File out = null;
            try {
                java.io.File dir = getContext().getCacheDir();
                out = new java.io.File(dir, "xiaoyang-music-" + version + "-android.apk");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) xiaoyang-music-updater");
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) { conn.disconnect(); throw new Exception("HTTP " + code); }
                long total = conn.getContentLength();
                java.io.InputStream in = conn.getInputStream();
                java.io.FileOutputStream fos = new java.io.FileOutputStream(out);
                byte[] buf = new byte[65536]; long done = 0; int n; int lastPercent = -1;
                while ((n = in.read(buf)) > 0) {
                    fos.write(buf, 0, n); done += n;
                    if (total > 0) {
                        int percent = (int) (done * 100 / total);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            JSObject p = new JSObject(); p.put("percent", percent); p.put("received", done); p.put("total", total);
                            notifyListeners("apkProgress", p);
                        }
                    }
                }
                fos.close(); in.close(); conn.disconnect();
                JSObject result = new JSObject();
                result.put("path", out.getAbsolutePath());
                result.put("size", out.length());
                call.resolve(result);
            } catch (Exception e) {
                if (out != null) out.delete();
                call.reject("下载失败：" + (e.getMessage() == null ? "网络异常" : e.getMessage()), e);
            } finally {
                apkDownloading.set(false);
            }
        });
    }
    @PluginMethod public void openApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) { call.reject("缺少安装包路径"); return; }
        try {
            java.io.File file = new java.io.File(path);
            if (!file.exists() || file.length() < 1024) { call.reject("安装包不存在或已损坏，请重新下载"); return; }
            android.content.Context ctx = getContext();
            if (android.os.Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
                JSObject result = new JSObject(); result.put("needsPermission", true);
                call.resolve(result);
                return;
            }
            installApk(file);
            call.resolve();
        } catch (Exception e) { call.reject("无法启动安装：" + (e.getMessage() == null ? "系统拒绝" : e.getMessage()), e); }
    }
    @PluginMethod public void requestInstallPermission(PluginCall call) {
        try {
            android.content.Context ctx = getContext();
            if (android.os.Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
                Intent i = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
            }
            call.resolve();
        } catch (Exception e) { call.reject("无法跳转安装权限设置：" + (e.getMessage() == null ? "系统拒绝" : e.getMessage()), e); }
    }
    private void installApk(java.io.File file) throws Exception {
        android.content.Context ctx = getContext();
        Uri uri = androidx.core.content.FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(intent);
    }

    // ── 单曲下载 + 离线播放（v3.2.1）：音频流 → MediaStore 公共音乐目录（API 29+ 免存储权限），
    //    完成后返回 device 轨目（content:// URI 跨重启有效），前端 addLocalTracks 入库即播 ──
    @PluginMethod public void downloadTrack(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("name", "未知歌曲");
        String artist = call.getString("artist", "");
        if (url == null || url.isEmpty()) { call.reject("该歌曲没有可下载的地址"); return; }
        getBridge().execute(() -> {
            java.io.File tmp = null;
            try {
                // 1) 下载到缓存临时文件（进度事件 downloadProgress）
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) xiaoyang-music");
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) { conn.disconnect(); throw new Exception("HTTP " + code); }
                String mime = conn.getContentType() == null ? "" : conn.getContentType().toLowerCase();
                boolean flac = mime.contains("flac") || url.toLowerCase().contains(".flac");
                boolean m4a = mime.contains("mp4") || url.toLowerCase().contains(".m4a");
                String ext = flac ? ".flac" : m4a ? ".m4a" : ".mp3";
                String fileMime = flac ? "audio/flac" : m4a ? "audio/mp4" : "audio/mpeg";
                long total = conn.getContentLength();
                tmp = new java.io.File(getContext().getCacheDir(), "dl-" + System.currentTimeMillis() + ext);
                java.io.InputStream in = conn.getInputStream();
                java.io.FileOutputStream fos = new java.io.FileOutputStream(tmp);
                byte[] buf = new byte[65536]; long done = 0; int n; int lastPercent = -1;
                while ((n = in.read(buf)) > 0) {
                    fos.write(buf, 0, n); done += n;
                    if (total > 0) {
                        int percent = (int) (done * 100 / total);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            JSObject p = new JSObject(); p.put("percent", percent); p.put("name", name);
                            notifyListeners("downloadProgress", p);
                        }
                    }
                }
                fos.close(); in.close(); conn.disconnect();
                // 2) 写入系统媒体库
                String safeName = (artist.isEmpty() ? name : artist + " - " + name).replaceAll("[\\\\/:*?\"<>|]", "_");
                if (safeName.length() > 90) safeName = safeName.substring(0, 90);
                Uri mediaUri;
                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    android.content.ContentValues cv = new android.content.ContentValues();
                    cv.put(android.provider.MediaStore.Audio.Media.DISPLAY_NAME, safeName + ext);
                    cv.put(android.provider.MediaStore.Audio.Media.MIME_TYPE, fileMime);
                    cv.put(android.provider.MediaStore.Audio.Media.RELATIVE_PATH, "Music/小杨音乐");
                    cv.put(android.provider.MediaStore.Audio.Media.IS_PENDING, 1);
                    mediaUri = getContext().getContentResolver().insert(android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, cv);
                    if (mediaUri == null) throw new Exception("无法创建媒体库条目");
                    try (java.io.OutputStream os = getContext().getContentResolver().openOutputStream(mediaUri)) {
                        java.io.FileInputStream fi = new java.io.FileInputStream(tmp);
                        byte[] cp = new byte[65536]; int r;
                        while ((r = fi.read(cp)) > 0) os.write(cp, 0, r);
                        fi.close();
                    }
                    android.content.ContentValues done2 = new android.content.ContentValues();
                    done2.put(android.provider.MediaStore.Audio.Media.IS_PENDING, 0);
                    getContext().getContentResolver().update(mediaUri, done2, null, null);
                } else {
                    // API <29：应用外部私有音乐目录（无需权限，卸载随 App 移除）
                    java.io.File dir = new java.io.File(getContext().getExternalFilesDir(android.os.Environment.DIRECTORY_MUSIC), "小杨音乐");
                    if (!dir.exists()) dir.mkdirs();
                    java.io.File out = new java.io.File(dir, safeName + ext);
                    java.io.FileInputStream fi = new java.io.FileInputStream(tmp);
                    java.io.FileOutputStream fo = new java.io.FileOutputStream(out);
                    byte[] cp = new byte[65536]; int r;
                    while ((r = fi.read(cp)) > 0) fo.write(cp, 0, r);
                    fi.close(); fo.close();
                    android.media.MediaScannerConnection.scanFile(getContext(), new String[]{out.getAbsolutePath()}, new String[]{fileMime}, null);
                    mediaUri = Uri.fromFile(out);
                }
                tmp.delete(); tmp = null;
                // 3) 组装 device 轨目（与 readFiles 的 id 规则一致，跨重启 content URI 有效）
                JSObject track = new JSObject();
                track.put("id", "device:" + java.util.UUID.nameUUIDFromBytes(mediaUri.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                track.put("vendor", "device");
                track.put("url", mediaUri.toString());
                track.put("name", name);
                track.put("artist", artist.isEmpty() ? "下载音乐" : artist);
                track.put("album", "");
                track.put("persistent", true);
                track.put("storedCopy", false);
                track.put("duration", 0);
                JSArray tracks = new JSArray(); tracks.put(track);
                JSObject data = new JSObject(); data.put("tracks", tracks);
                call.resolve(data);
            } catch (Exception e) {
                if (tmp != null) tmp.delete();
                call.reject("下载失败：" + (e.getMessage() == null ? "网络异常" : e.getMessage()), e);
            }
        });
    }
}
