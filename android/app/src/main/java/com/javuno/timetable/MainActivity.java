package com.javuno.timetable;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Eigenes Plugin: Termine für das Startbildschirm-Widget
        registerPlugin(WidgetPlugin.class);
        // Drucken (window.print() gibt es in der App nicht)
        registerPlugin(PrintPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
