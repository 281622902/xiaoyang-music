package com.xiaoyang.musicplayer;

import android.content.ComponentName;
import android.content.Intent;
import android.app.Activity;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.provider.OpenableColumns;
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
        state.put("connected",true);state.put("epoch",MusicService.epoch);state.put("paused",!controller.getPlayWhenReady() || controller.getPlayerError()!=null || controller.getPlaybackState()==Player.STATE_ENDED);state.put("playing",controller.isPlaying());state.put("position",controller.getCurrentPosition()/1000.0);
        long duration=controller.getDuration();state.put("duration",duration==C.TIME_UNSET?0:duration/1000.0);state.put("readyState",controller.getPlaybackState()==Player.STATE_READY?4:1);state.put("ended",controller.getPlaybackState()==Player.STATE_ENDED);state.put("index",controller.getCurrentMediaItemIndex());
        state.put("mode",controller.getShuffleModeEnabled()?"random":controller.getRepeatMode()==Player.REPEAT_MODE_ONE?"single":controller.getRepeatMode()==Player.REPEAT_MODE_ALL?"list":"sequential");
        if(includeQueue){JSArray tracks=new JSArray();for(int i=0;i<controller.getMediaItemCount();i++){MediaItem item=controller.getMediaItemAt(i);JSONObject t=track(item);JSONObject full=MusicService.resolved.get(item.mediaId);if(full!=null){try{t.put("url",full.optString("url"));t.put("lyric",full.optString("lyric"));}catch(Exception ignored){}}tracks.put(t);}state.put("queue",tracks);}
        if(controller.getPlayerError()!=null)state.put("error",controller.getPlayerError().getErrorCodeName());
        return state;
    }
    private void emit(){if(controller!=null){MediaItem item=controller.getCurrentMediaItem();String id=item!=null?item.mediaId:"";JSONObject full=MusicService.resolved.get(id);String signature=MusicService.epoch+"|"+controller.getMediaItemCount()+"|"+controller.getCurrentMediaItemIndex()+"|"+id+"|"+(full!=null?full.hashCode():0);boolean changed=!signature.equals(lastQueueSignature);lastQueueSignature=signature;notifyListeners("state",snapshot(changed));}}
    @PluginMethod public void getState(PluginCall call){ready(call,()->{});}
    @PluginMethod public void getLaunchConfig(PluginCall call){main.post(()->{JSObject result=new JSObject();Intent intent=getActivity().getIntent();String backend=intent.getStringExtra("xy_backend");if((getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0 && "http://localhost:3000".equals(backend))result.put("developmentBackend",backend);intent.removeExtra("xy_backend");call.resolve(result);});}
    private List<MediaItem> mediaItems(JSONArray tracks,String base,String currentUrl,int index,String quality)throws Exception{
        List<MediaItem> items=new ArrayList<>();
        for(int i=0;i<tracks.length();i++){
            JSONObject t=tracks.getJSONObject(i);String id=t.optString("id"),vendor=t.optString("vendor","netease"),key=vendor+"|"+id;
            Uri uri;
            if("device".equals(vendor)){String local=t.optString("url");if(!local.startsWith("content://"))throw new IllegalArgumentException("本地歌曲需要 Android 文件选择器授权");uri=Uri.parse(local);}
            else if(i==index && currentUrl!=null && (currentUrl.startsWith("http://") || currentUrl.startsWith("https://")))uri=Uri.parse(currentUrl);
            else if("cloud".equals(vendor))uri=Uri.parse(base+"/api/stream").buildUpon().appendQueryParameter("url",t.optString("url")).build();
            else {
                Uri endpoint=Uri.parse(base+"/api/song").buildUpon().appendQueryParameter("id",id).appendQueryParameter("vendor",vendor).appendQueryParameter("name",t.optString("name")).appendQueryParameter("artist",t.optString("artist")).appendQueryParameter("quality",quality).build();
                uri=new Uri.Builder().scheme("xymusic").authority("song").appendQueryParameter("endpoint",endpoint.toString()).appendQueryParameter("base",base).appendQueryParameter("key",key).appendQueryParameter("epoch",String.valueOf(MusicService.epoch)).build();
            }
            Bundle extras=new Bundle();extras.putString("track",t.toString());
            MediaMetadata.Builder metadata=new MediaMetadata.Builder().setTitle(t.optString("name")).setArtist(t.optString("artist")).setAlbumTitle(t.optString("album")).setExtras(extras);
            String pic=t.optString("pic");if(pic.startsWith("http://")||pic.startsWith("https://"))metadata.setArtworkUri(Uri.parse(base+"/api/pic").buildUpon().appendQueryParameter("url",pic).build());
            items.add(new MediaItem.Builder().setMediaId(key).setUri(uri).setMediaMetadata(metadata.build()).setMimeType("audio/mpeg").build());
        }return items;
    }
    @PluginMethod public void setQueue(PluginCall call){ready(call,()->{
        JSArray tracks=call.getArray("tracks",new JSArray());int index=call.getInt("index",0);String base=call.getString("base","");String url=call.getString("url","");
        if(!(base.startsWith("http://")||base.startsWith("https://")))throw new IllegalArgumentException("请配置音乐后端地址");
        String quality=call.getString("quality","standard");if(!java.util.Arrays.asList("standard","ex","lossless","hires").contains(quality))quality="standard";
        MusicService.epoch=call.getInt("epoch",0);List<MediaItem> items=mediaItems(tracks,base,url,index,quality);
        boolean same=items.size()>=controller.getMediaItemCount() && controller.getMediaItemCount()>0;
        for(int i=0;same&&i<controller.getMediaItemCount();i++)if(!controller.getMediaItemAt(i).mediaId.equals(items.get(i).mediaId))same=false;
        if(call.getBoolean("preserve",false)&&same){if(items.size()>controller.getMediaItemCount())controller.addMediaItems(items.subList(controller.getMediaItemCount(),items.size()));}
        else {MusicService.resetSources();controller.setMediaItems(items,Math.max(0,Math.min(index,items.size()-1)),Math.round(call.getDouble("position",0.0)*1000));controller.prepare();}
        String mode=call.getString("mode","list");controller.setShuffleModeEnabled("random".equals(mode));controller.setRepeatMode("single".equals(mode)?Player.REPEAT_MODE_ONE:"sequential".equals(mode)?Player.REPEAT_MODE_OFF:Player.REPEAT_MODE_ALL);
        controller.setPlayWhenReady(call.getBoolean("play",false));emit();
    });}
    @PluginMethod public void play(PluginCall call){ready(call,()->{if(controller.getPlaybackState()==Player.STATE_IDLE)controller.prepare();controller.play();});}
    @PluginMethod public void retry(PluginCall call){ready(call,()->{
        int index=controller.getCurrentMediaItemIndex();if(index<0||controller.getMediaItemCount()==0)throw new IllegalArgumentException("请先选择歌曲");
        String base=call.getString("base","");if(!(base.startsWith("http://")||base.startsWith("https://")))throw new IllegalArgumentException("请配置音乐后端地址");
        String quality=call.getString("quality","standard");if(!java.util.Arrays.asList("standard","ex","lossless","hires").contains(quality))quality="standard";
        JSArray tracks=new JSArray();for(int i=0;i<controller.getMediaItemCount();i++)tracks.put(track(controller.getMediaItemAt(i)));
        long position=controller.getCurrentPosition();controller.stop();MusicService.resetSources();
        controller.setMediaItems(mediaItems(tracks,base,"",index,quality),index,Math.max(0,position));
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
    @Override protected void handleOnDestroy(){destroyed=true;main.removeCallbacksAndMessages(null);files.shutdownNow();if(future!=null)MediaController.releaseFuture(future);controller=null;}
}
