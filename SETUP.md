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

## 2. App veröffentlichen

### Variante A: nur am Handy (GitHub Pages, automatisch)

Bei jeder Änderung auf `main` baut GitHub die App und legt sie in den Ordner `docs/` auf `main`
(Commit „Build: …“ vom github-actions-Bot). Bitte `docs/` nicht von Hand bearbeiten.
Einmalig: **Settings → Pages → Source: „Deploy from a branch“ → Branch `main`, Ordner `/docs` → Save.**
Adresse: `https://lukasnews.github.io/timetable/`

### Variante B: am Computer (Firebase Hosting)

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

## 5. Erinnerungen per ntfy (eigener Server)

Die Erinnerungen verschickt GitHub Actions (kostenlos, weil das Repo öffentlich ist): Der Workflow
**„Erinnerungen“** prüft alle 5 Minuten, was fällig ist, und schickt es an
`https://ntfy.chaoten.online`. GitHub startet geplante Läufe oft ein paar Minuten verspätet,
eine Erinnerung kann also etwas später kommen. Verpasste Zeitfenster werden nachgeholt, und doppelt
geschickt wird nichts.

1. **Topics festlegen**, z. B. `mama`, `papa`, `familie`. Am Handy in der ntfy-App
   (Server `https://ntfy.chaoten.online`) das jeweilige Topic abonnieren.
2. **In der Kalender-App**
   - im Profil jeder Person (⚙️ → Personen) das **ntfy-Topic** eintragen
   - optional unter ⚙️ → Allgemein ein **Familien-Topic** für Termine ohne Person
   - bei einem Termin unter **Erinnerung** z. B. „15 Minuten vorher“ wählen
3. **In GitHub**: Settings → Secrets and variables → Actions → **New repository secret**
   - `NTFY_TOKEN` = Zugriffstoken des ntfy-Servers (muss auf die Topics schreiben dürfen)
   - `FAMILY_ID` = Familien-ID aus ⚙️ → Synchronisation
   - optional als **Variable** (nicht Secret) `NTFY_SERVER`, falls sich die Server-Adresse ändert
4. **Testen**: Actions → **Erinnerungen** → **Run workflow** (Häkchen „Test-Nachricht“ an).
   An jedes eingetragene Topic geht eine Test-Nachricht. Wenn der Lauf rot wird, steht der Grund im Log:
   `401/403` heißt, Token oder Rechte sind falsch, `400` heißt, das Payload-Format stimmt nicht.

Ganztägige Termine erinnern ab 08:00 Uhr am Tag. „1 Tag vorher“ bedeutet also 08:00 Uhr am Vortag.

## Entwicklung

```bash
npm run dev     # http://localhost:5173 (auch im WLAN erreichbar)
npm test        # Tests für Wiederholungen, Feiertage, Ferien
```

Ohne Firebase-Konfiguration speichert die App alles nur im Browser und startet mit einer
Beispiel-Familie. Die Beispiel-Personen lassen sich in den Einstellungen löschen.
