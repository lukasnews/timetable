package com.javuno.timetable;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Eigenes Plugin: Termine für das Startbildschirm-Widget
        registerPlugin(WidgetPlugin.class);
        // Drucken (window.print() gibt es in der App nicht)
        registerPlugin(PrintPlugin.class);
        super.onCreate(savedInstanceState);
        // Anzeigegröße der App (Einstellungen → Gerät): der Viewport-Tag der Seite soll gelten,
        // damit sich das Layout wie auf einem kleineren Gerät anpasst
        WebSettings ws = getBridge().getWebView().getSettings();
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
    }
}
