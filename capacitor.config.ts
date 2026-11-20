import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android-App (Capacitor).
 * Die App lädt die veröffentlichte Web-App – Updates kommen so automatisch, ohne neue APK.
 * Native Teile: Erinnerungen direkt am Gerät (Local Notifications) und die Zurück-Taste.
 */
const config: CapacitorConfig = {
  appId: 'com.javuno.timetable',
  appName: 'Familienkalender',
  webDir: 'dist',
  server: {
    // Eine App für alle Familien: öffnet die neutrale Adresse. Eigene Domains der Familien nutzen die Links,
    // in der App selbst ist die Adresse unsichtbar.
    url: 'https://familienkalender-baf.pages.dev/',
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
