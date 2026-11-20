package com.javuno.timetable;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Nimmt die nächsten Termine aus der App entgegen und aktualisiert das Widget. */
@CapacitorPlugin(name = "FamilyWidget")
public class WidgetPlugin extends Plugin {
    @PluginMethod
    public void update(PluginCall call) {
        String json = call.getString("items", "[]");
        Context ctx = getContext();
        ctx.getSharedPreferences(UpcomingWidget.PREFS, Context.MODE_PRIVATE).edit().putString(UpcomingWidget.KEY, json).apply();
        UpcomingWidget.refreshAll(ctx);
        call.resolve(new JSObject());
    }

    /** Fragt den Startbildschirm, ob er das Widget hinzufügen soll (Android 8+, wenn der Launcher es kann). */
    @PluginMethod
    public void pin(PluginCall call) {
        Context ctx = getContext();
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        JSObject r = new JSObject();
        r.put("placed", mgr.getAppWidgetIds(new ComponentName(ctx, UpcomingWidget.class)).length);
        boolean ok = Build.VERSION.SDK_INT >= 26 && mgr.isRequestPinAppWidgetSupported()
            && mgr.requestPinAppWidget(new ComponentName(ctx, UpcomingWidget.class), null, null);
        r.put("requested", ok);
        call.resolve(r);
    }

    /** Wie viele Widgets liegen am Startbildschirm? */
    @PluginMethod
    public void count(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("placed", AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, UpcomingWidget.class)).length);
        call.resolve(r);
    }
}
