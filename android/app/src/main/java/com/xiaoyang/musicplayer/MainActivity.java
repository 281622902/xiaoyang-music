package com.xiaoyang.musicplayer;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeMusicPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
