import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android-App (Capacitor).
 * Die App lädt die veröffentlichte Web-App – Updates kommen so automatisch, ohne neue APK.
 * Native Teile: Erinnerungen direkt am Gerät (Local Notifications) und die Zurück-Taste.
 */
const config: CapacitorConfig = {
  appId: 'online.chaoten.familienkalender',
  appName: 'Familienkalender',
  webDir: 'dist',
  server: {
    url: 'https://timetable.chaoten.online/',
    androidScheme: 'https',
    // Ohne Netz beim allerersten Start: eigene Hinweis-Seite aus der App
    errorPath: 'offline.html',
  },
  android: {
    backgroundColor: '#f3c896',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_notify',
      iconColor: '#b8611c',
    },
  },
};

export default config;
