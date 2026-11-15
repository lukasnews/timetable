package com.javuno.timetable;

import android.content.Context;
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
}
