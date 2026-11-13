# Einrichtung

Alles hier ist kostenlos: Firebase „Spark“-Tarif (ohne Kreditkarte) und optional Cloudflare Workers (Free).
Dauer: etwa 15 Minuten.

## 1. Firebase-Projekt anlegen (Datenspeicher + Sync)

1. Auf <https://console.firebase.google.com> mit einem Google-Konto anmelden → **Projekt hinzufügen**
   (Name z. B. `familienkalender`, Google Analytics nicht nötig).
2. **Build → Authentication → Jetzt starten → Anmeldemethode „Anonym“ aktivieren.**
   (Die Familie meldet sich nie an – jedes Gerät bekommt unsichtbar eine anonyme Kennung.)
3. **Build → Firestore Database → Datenbank erstellen**, Standort `europe-west3 (Frankfurt)`,
   im Produktionsmodus starten.
4. Unter **Firestore → Regeln** den Inhalt von [`firestore.rules`](firestore.rules) einfügen → **Veröffentlichen**.
5. **Projekteinstellungen (Zahnrad) → Allgemein → Meine Apps → Web-App (`</>`) hinzufügen.**
   Die angezeigte `firebaseConfig` (`apiKey`, `authDomain`, `projectId`, …) kopieren.
   Diese Werte sind nicht geheim – geschützt wird über die Familien-ID.

## 2. App veröffentlichen (Firebase Hosting)

```bash
npm install
npm run build
npx firebase-tools login
npx firebase-tools use --add          # das Projekt von oben wählen
npx firebase-tools deploy             # lädt App + Firestore-Regeln hoch
```

Danach läuft die App unter `https://<projekt-id>.web.app`.

Optional kann die Konfiguration fest eingebaut werden: `.env.example` nach `.env` kopieren,
`VITE_FIREBASE_CONFIG` ausfüllen und neu bauen. Dann muss sie nirgends eingefügt werden.

## 3. Familienkalender anlegen und Geräte verbinden

1. Am **Tablet** die App öffnen → Zahnrad → **Synchronisation** → Firebase-Konfiguration einfügen
   → **Neuen Familienkalender anlegen**. Was bisher lokal eingetragen war, wird hochgeladen.
2. Dort erscheint ein **QR-Code**. Mit jedem Handy scannen → die App öffnet sich und ist verbunden.
3. Am Handy im Browser-Menü **„Zum Startbildschirm hinzufügen“** wählen, dann läuft sie wie eine App.
4. Unter **Allgemein** eine **PIN** setzen, damit die Kinder die Einstellungen nicht ändern.

> Der Link bzw. QR-Code ist der Schlüssel zum Kalender. Nur innerhalb der Familie teilen.

## 4. Wand-Tablet (Kiosk)

- Einstellungen → **Dieses Gerät** → Kiosk-Modus an, „Bildschirm nicht abschalten“, Nachtmodus.
- Android: App über Chrome zum Startbildschirm hinzufügen. Für echten Kiosk-Betrieb eignet sich
  z. B. „Fully Kiosk Browser“ oder die Bildschirmfixierung von Android.

## 5. Erinnerungen per ntfy (optional)

Am Handy kann jedes Gerät unter **Dieses Gerät → Erinnerungen** Benachrichtigungen zeigen,
solange die App geöffnet ist. Damit Erinnerungen **immer** ankommen, gibt es einen kleinen
Dienst, der alle 5 Minuten prüft und über [ntfy](https://ntfy.sh) Push-Nachrichten schickt.

1. Die **ntfy-App** am Handy installieren und ein Topic abonnieren, z. B. `familie-mama-x7k2q`
   (möglichst schwer zu erraten, es ist öffentlich).
2. In der Kalender-App im Profil der Person dasselbe Topic unter **ntfy-Topic** eintragen.
3. Kostenloses Konto auf <https://dash.cloudflare.com> anlegen, dann:

```bash
cd worker
npx wrangler login
npx wrangler secret put FIREBASE_API_KEY      # apiKey aus der firebaseConfig
npx wrangler secret put FIREBASE_PROJECT_ID   # projectId
npx wrangler secret put FAMILY_ID             # aus Einstellungen → Synchronisation
npx wrangler deploy
```

4. Einmalig ein dauerhaftes Token erzeugen:
   `https://familienkalender-erinnerungen.<dein-name>.workers.dev/token?family=<FAMILY_ID>` öffnen,
   den angezeigten Text kopieren und mit `npx wrangler secret put FIREBASE_REFRESH_TOKEN` speichern.
5. Optional `FAMILY_TOPIC` setzen: Termine ohne Person („ganze Familie“) gehen dorthin.
   Ohne `FAMILY_TOPIC` gehen sie an alle Personen mit Topic.

Ein eigener ntfy-Server geht auch: `NTFY_SERVER` in `worker/wrangler.toml` ändern,
für geschützte Topics `NTFY_TOKEN` als Secret setzen.

## Entwicklung

```bash
npm run dev     # http://localhost:5173 (auch im WLAN erreichbar)
npm test        # Tests für Wiederholungen, Feiertage, Ferien
```

Ohne Firebase-Konfiguration speichert die App alles nur im Browser und startet mit einer
Beispiel-Familie. Die Beispiel-Personen lassen sich in den Einstellungen löschen.
