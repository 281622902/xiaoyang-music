package com.xiaoyang.musicplayer;

import android.net.Uri;
import android.os.Bundle;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.util.UnstableApi;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Shared by a new queue and a paused cold-start restoration. */
@UnstableApi
final class NativeQueue {
    static boolean http(String value) {
        if (value == null) return false;
        Uri uri = Uri.parse(value);
        return ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))
            && uri.getHost() != null && uri.getUserInfo() == null;
    }
    static JSONObject track(MediaItem item) {
        try { return new JSONObject(item.mediaMetadata.extras != null ? item.mediaMetadata.extras.getString("track", "{}") : "{}"); }
        catch (Exception error) { return new JSONObject(); }
    }
    static List<MediaItem> items(JSONArray tracks, String base, String currentUrl, int index, String quality) throws Exception {
        if (tracks.length() > 5000) throw new IllegalArgumentException("播放队列过长");
        List<MediaItem> items = new ArrayList<>();
        for (int i = 0; i < tracks.length(); i++) {
            JSONObject t = tracks.getJSONObject(i);
            String id = t.optString("id"), vendor = t.optString("vendor", "netease"), key = vendor + "|" + id;
            Uri uri;
            if ("device".equals(vendor)) {
                String local = t.optString("url");
                if (!local.startsWith("content://")) throw new IllegalArgumentException("本地歌曲需要 Android 文件选择器授权");
                uri = Uri.parse(local);
            } else {
                if (!http(base)) throw new IllegalArgumentException("请配置音乐后端地址");
                if (i == index && http(currentUrl)) uri = Uri.parse(currentUrl);
                else if ("cloud".equals(vendor)) {
                    if (!http(t.optString("url"))) throw new IllegalArgumentException("歌曲地址无效");
                    uri = Uri.parse(base + "/api/stream").buildUpon().appendQueryParameter("url", t.optString("url")).build();
                } else {
                    Uri endpoint = Uri.parse(base + "/api/song").buildUpon().appendQueryParameter("id", id).appendQueryParameter("vendor", vendor)
                        .appendQueryParameter("name", t.optString("name")).appendQueryParameter("artist", t.optString("artist")).appendQueryParameter("quality", quality).build();
                    uri = new Uri.Builder().scheme("xymusic").authority("song").appendQueryParameter("endpoint", endpoint.toString())
                        .appendQueryParameter("base", base).appendQueryParameter("key", key).appendQueryParameter("epoch", String.valueOf(MusicService.epoch)).build();
                }
            }
            Bundle extras = new Bundle(); extras.putString("track", t.toString());
            MediaMetadata.Builder metadata = new MediaMetadata.Builder().setTitle(t.optString("name")).setArtist(t.optString("artist")).setAlbumTitle(t.optString("album")).setExtras(extras);
            if (http(t.optString("pic")) && http(base)) metadata.setArtworkUri(Uri.parse(base + "/api/pic").buildUpon().appendQueryParameter("url", t.optString("pic")).build());
            // Let Media3 sniff the container. Forcing audio/mpeg breaks non-MP3 local music.
            items.add(new MediaItem.Builder().setMediaId(key).setUri(uri).setMediaMetadata(metadata.build()).build());
        }
        return items;
    }
}
