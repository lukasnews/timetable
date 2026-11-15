package com.javuno.timetable;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Drucken in der App: Androids WebView unterstützt window.print() nicht.
 * Öffnet den System-Druckdialog (Vorschau, Drucker wählen oder als PDF speichern)
 * mit der aktuellen Seite in der Druckansicht.
 */
@CapacitorPlugin(name = "AppPrint")
public class PrintPlugin extends Plugin {
    @PluginMethod
    public void print(PluginCall call) {
        String name = call.getString("name", "Familienkalender");
        boolean landscape = call.getBoolean("landscape", true);
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                WebView wv = getBridge().getWebView();
                PrintDocumentAdapter adapter = wv.createPrintDocumentAdapter(name);
                PrintAttributes.MediaSize size = landscape ? PrintAttributes.MediaSize.ISO_A4.asLandscape() : PrintAttributes.MediaSize.ISO_A4;
                PrintAttributes attrs = new PrintAttributes.Builder().setMediaSize(size).build();
                pm.print(name, adapter, attrs);
                call.resolve(new JSObject());
            } catch (Exception e) {
                call.reject("Drucken nicht möglich: " + e.getMessage());
            }
        });
    }
}
