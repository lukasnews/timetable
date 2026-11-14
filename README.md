# Familienkalender

Ein Familienkalender für das Wand-Tablet und die Handys: Auf einen Blick sieht man, was diese Woche
oder diesen Monat bei wem ansteht.

- **Monat, Woche, Tag** (am Handy startet er automatisch in der Tagesansicht)
- **Personen-Chips** oben zum Ein- und Ausblenden. Jede Person hat eine **Comic-Figur und eine eigene Farbe**.
  Doppelklick oder langes Drücken auf einen Chip zeigt nur diese Person.
- **Drag & Drop**: Termine verschieben, kürzen oder verlängern (am Touchscreen kurz gedrückt halten)
- **Serien wie in Outlook**: täglich, wöchentlich an mehreren Tagen, alle 2 Wochen, „2. Dienstag im Monat“,
  jährlich, Ende nach Datum oder nach Anzahl. Beim Ändern kommt die Frage
  „Nur dieser / dieser und folgende / alle“.
- **Termine für mehrere Personen** zeigen alle Avatare und einen Farbstreifen
- **Geburtstage** mit 🎂 und Alter (im Profil oder als eigener Termin)
- **Feiertage Österreich** und **Schulferien Oberösterreich** werden automatisch berechnet
- **Stundenplan pro Kind**: im Kalender nur Schulbeginn und -ende (nicht in den Ferien),
  in der eigenen Ansicht mit Fach, Lehrer/in und Klasse, auch A/B-Wochen
- **Offline-fähig (PWA)**: synchronisiert automatisch, sobald wieder Netz da ist (Firebase, kostenlos)
- **Ohne Login**. Geräte werden per QR-Code verbunden, die **Einstellungen sind mit PIN geschützt**.
- **Kiosk-Modus**: Bildschirm bleibt an, springt nach Inaktivität zurück auf heute, Nachtmodus
- **Erinnerungen** pro Gerät einstellbar (am Tablet aus, am Handy an), optional über den eigenen **ntfy**-Server (GitHub Actions)

Läuft unter **https://timetable.chaoten.online/** · Einrichtung: siehe **[SETUP.md](SETUP.md)**.

## Technik

React + TypeScript + Vite · FullCalendar · rrule · Firebase Firestore (Offline-Cache) ·
DiceBear (Comic-Avatare) · vite-plugin-pwa · GitHub Actions für Build und ntfy-Erinnerungen.
Eine spätere Android-App ist mit Capacitor möglich, ohne den Code neu zu schreiben.
