package com.xiaoyang.musicplayer;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONObject;

/** Audio belongs to this service, so screen off and WebView suspension do not stop the queue. */
@UnstableApi
public class MusicService extends MediaSessionService {
    private MediaSession session;
    static volatile long epoch = 0;
    static final ConcurrentHashMap<String, JSONObject> resolved = new ConcurrentHashMap<>();
    // Reopening a ranged request must keep the same resolved file, including after a seek.
    private static final java.util.Map<String, Uri> playableUrls = java.util.Collections.synchronizedMap(
        new java.util.LinkedHashMap<String, Uri>(32,0.75f,true) {
            @Override protected boolean removeEldestEntry(java.util.Map.Entry<String, Uri> entry) { return size()>512; }
        });
    static void resetSources() { playableUrls.clear(); resolved.clear(); }

    @Override public void onCreate() {
        super.onCreate();
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setUserAgent("XiaoyangMusic/Android").setConnectTimeoutMs(12000).setReadTimeoutMs(22000);
        DefaultDataSource.Factory upstream = new DefaultDataSource.Factory(this, http);
        ResolvingDataSource.Factory resolving = new ResolvingDataSource.Factory(upstream, dataSpec -> {
            Uri uri = dataSpec.uri;
            if (!"xymusic".equals(uri.getScheme())) return dataSpec;
            Uri cached = playableUrls.get(uri.toString());
            if (cached != null) return dataSpec.withUri(cached);
            String endpoint = uri.getQueryParameter("endpoint"), base = uri.getQueryParameter("base"), key = uri.getQueryParameter("key");
            if (endpoint == null || base == null || key == null || !(endpoint.startsWith("https://") || endpoint.startsWith("http://"))) throw new IOException("Invalid music source");
            HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setConnectTimeout(12000); connection.setReadTimeout(22000);
            JSONObject song;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) { bytes.write(buffer,0,count); if(bytes.size()>2*1024*1024) throw new IOException("Music response too large"); }
                JSONObject response = new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
                song = response.optJSONObject("data");
                if(response.optInt("code")!=200 || song==null) throw new IOException("Song resolution failed");
            } catch (org.json.JSONException error) { throw new IOException("Invalid music response",error); }
            finally { connection.disconnect(); }
            String url = song.optString("url");
            if (!(url.startsWith("https://") || url.startsWith("http://"))) throw new IOException("No playable song URL");
            resolved.put(key,song);
            Uri stream = Uri.parse(base + "/api/stream").buildUpon().appendQueryParameter("url",url).build();
            playableUrls.put(uri.toString(),stream);
            return dataSpec.withUri(stream);
        });
        ExoPlayer player = new ExoPlayer.Builder(this).setMediaSourceFactory(new DefaultMediaSourceFactory(resolving)
            .setLoadErrorHandlingPolicy(new DefaultLoadErrorHandlingPolicy(1))).build();
        player.setAudioAttributes(new AudioAttributes.Builder().setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).setUsage(C.USAGE_MEDIA).build(),true);
        player.setHandleAudioBecomingNoisy(true);
        player.setWakeMode(C.WAKE_MODE_LOCAL);
        player.addListener(new Player.Listener() {
            @Override public void onPlayerError(PlaybackException error) {
                MediaItem item = player.getCurrentMediaItem();
                if (item != null && item.localConfiguration != null) playableUrls.remove(item.localConfiguration.uri.toString());
            }
        });
        PendingIntent launch = PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        session = new MediaSession.Builder(this,player).setSessionActivity(launch).build();
    }
    @Override @Nullable public MediaSession onGetSession(MediaSession.ControllerInfo info) { return session; }
    @Override public void onTaskRemoved(@Nullable Intent rootIntent) {
        if(session==null || !session.getPlayer().getPlayWhenReady() || session.getPlayer().getMediaItemCount()==0) stopSelf();
    }
    @Override public void onDestroy() {
        if(session!=null){session.getPlayer().release();session.release();session=null;}
        resetSources(); super.onDestroy();
    }
}
