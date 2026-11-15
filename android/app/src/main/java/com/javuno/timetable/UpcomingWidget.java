package com.javuno.timetable;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Startbildschirm-Widget „Nächste Termine“.
 * Die App schreibt die kommenden Termine als JSON (siehe WidgetPlugin); hier werden
 * vergangene ausgeblendet und „Heute/Morgen“ zum Anzeigezeitpunkt berechnet.
 */
public class UpcomingWidget extends AppWidgetProvider {
    static final String PREFS = "familywidget";
    static final String KEY = "items";

    private static final int[] ROWS = { R.id.row0, R.id.row1, R.id.row2, R.id.row3, R.id.row4, R.id.row5 };
    private static final int[] BARS = { R.id.bar0, R.id.bar1, R.id.bar2, R.id.bar3, R.id.bar4, R.id.bar5 };
    private static final int[] WHEN = { R.id.when0, R.id.when1, R.id.when2, R.id.when3, R.id.when4, R.id.when5 };
    private static final int[] TITLE = { R.id.title0, R.id.title1, R.id.title2, R.id.title3, R.id.title4, R.id.title5 };
    private static final int[] WHO = { R.id.who0, R.id.who1, R.id.who2, R.id.who3, R.id.who4, R.id.who5 };

    static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, UpcomingWidget.class));
        for (int id : ids) render(ctx, mgr, id);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) render(ctx, mgr, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle newOptions) {
        render(ctx, mgr, id);
    }

    private static int rowsFor(AppWidgetManager mgr, int id) {
        Bundle o = mgr.getAppWidgetOptions(id);
        int h = o != null ? o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 180) : 180;
        int n = (h - 44) / 30; // Kopfzeile + ca. 30 dp je Zeile
        return Math.max(1, Math.min(ROWS.length, n));
    }

    static void render(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_upcoming);
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.widget_root, pi);

        Calendar cal = Calendar.getInstance();
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.getTime());
        String now = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm", Locale.US).format(cal.getTime());
        cal.add(Calendar.DATE, 1);
        String tomorrow = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.getTime());
        v.setTextViewText(R.id.header_date, new SimpleDateFormat("EEE, d. MMMM", Locale.GERMAN).format(new Date()));

        int max = rowsFor(mgr, id);
        int shown = 0;
        try {
            JSONArray items = new JSONArray(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]"));
            for (int i = 0; i < items.length() && shown < max; i++) {
                JSONObject it = items.getJSONObject(i);
                if (it.optString("end", "").compareTo(now) <= 0) continue; // schon vorbei
                String date = it.optString("date");
                String time = it.optString("time", "");
                String day = date.equals(today) ? "Heute" : date.equals(tomorrow) ? "Morgen" : weekday(date);
                v.setViewVisibility(ROWS[shown], View.VISIBLE);
                v.setTextViewText(WHEN[shown], time.isEmpty() ? day : day + " " + time);
                v.setTextViewText(TITLE[shown], it.optString("title"));
                String who = it.optString("who", "");
                v.setTextViewText(WHO[shown], who);
                v.setViewVisibility(WHO[shown], who.isEmpty() ? View.GONE : View.VISIBLE);
                int color;
                try { color = Color.parseColor(it.optString("color", "#94a3b8")); } catch (Exception e) { color = Color.GRAY; }
                v.setInt(BARS[shown], "setColorFilter", color);
                shown++;
            }
        } catch (Exception ignored) { }
        for (int i = shown; i < ROWS.length; i++) v.setViewVisibility(ROWS[i], View.GONE);
        v.setViewVisibility(R.id.empty, shown == 0 ? View.VISIBLE : View.GONE);
        mgr.updateAppWidget(id, v);
    }

    private static String weekday(String ymd) {
        try {
            Date d = new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(ymd);
            return new SimpleDateFormat("EE d.M.", Locale.GERMAN).format(d);
        } catch (Exception e) {
            return ymd;
        }
    }
}
