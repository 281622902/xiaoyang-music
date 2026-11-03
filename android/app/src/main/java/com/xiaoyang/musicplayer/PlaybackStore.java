package com.xiaoyang.musicplayer;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import org.json.JSONArray;
import org.json.JSONObject;

/** Private device-only state. Never uploaded by cloud playlist synchronization. */
@UnstableApi
final class PlaybackStore {
    private final SharedPreferences preferences;
    PlaybackStore(Context context) { preferences = context.getSharedPreferences("native-playback", Context.MODE_PRIVATE); }
    void save(Player player) {
        try {
            if (player.getMediaItemCount() == 0) { preferences.edit().remove("snapshot").apply(); return; }
            JSONArray tracks = new JSONArray();
            for (int i = 0; i < player.getMediaItemCount(); i++) {
                JSONObject original = NativeQueue.track(player.getMediaItemAt(i)), t = new JSONObject();
                for (String key : new String[]{"id", "vendor", "name", "artist", "album", "pic", "duration", "persistent", "storedCopy"}) {
                    if (original.has(key)) t.put(key, original.get(key));
                }
                // Provider URLs expire: restore their identifiers and resolve again only after Play.
                // Device URIs and legacy direct-link favorites have no provider identifier to resolve.
                if ("device".equals(t.optString("vendor")) || "cloud".equals(t.optString("vendor"))) t.put("url", original.optString("url"));
                tracks.put(t);
            }
            JSONObject state = new JSONObject().put("schema", 1).put("tracks", tracks).put("index", player.getCurrentMediaItemIndex())
                .put("position", Math.max(0, player.getCurrentPosition())).put("base", MusicService.backendBase).put("quality", MusicService.quality)
                .put("repeat", player.getRepeatMode()).put("shuffle", player.getShuffleModeEnabled()).put("epoch", MusicService.epoch);
            String encoded = state.toString();
            if (encoded.length() <= 2 * 1024 * 1024) preferences.edit().putString("snapshot", encoded).apply();
        } catch (Exception ignored) { /* A malformed item must not stop playback. */ }
    }
    boolean restore(Player player) {
        try {
            String encoded = preferences.getString("snapshot", null);
            if (encoded == null || encoded.length() > 2 * 1024 * 1024) return false;
            JSONObject state = new JSONObject(encoded);
            if (state.optInt("schema") != 1) return false;
            JSONArray tracks = state.getJSONArray("tracks");
            if (tracks.length() == 0) return false;
            MusicService.backendBase = state.optString("base");
            MusicService.quality = state.optString("quality", "standard");
            MusicService.epoch = Math.max(0, state.optLong("epoch"));
            int index = Math.max(0, Math.min(state.optInt("index"), tracks.length() - 1));
            player.setMediaItems(NativeQueue.items(tracks, MusicService.backendBase, "", index, MusicService.quality), index, Math.max(0, state.optLong("position")));
            int repeat = state.optInt("repeat", Player.REPEAT_MODE_ALL);
            player.setRepeatMode(repeat >= Player.REPEAT_MODE_OFF && repeat <= Player.REPEAT_MODE_ALL ? repeat : Player.REPEAT_MODE_ALL);
            player.setShuffleModeEnabled(state.optBoolean("shuffle"));
            player.setPlayWhenReady(false);
            // Leave STATE_IDLE: no sound, network request or content read until explicit Play.
            return true;
        } catch (Exception ignored) { return false; }
    }
}
