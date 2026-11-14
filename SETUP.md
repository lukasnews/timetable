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
Adresse: `https://timetable.chaoten.online/` (eigene Domain über `public/CNAME`; DNS bei Cloudflare:
CNAME `timetable` → `lukasnews.github.io`, „DNS only“). Die alte github.io-Adresse leitet automatisch weiter.

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

Ein **Cloudflare Worker** prüft alle 5 Minuten, was fällig ist, und schickt es an
`https://ntfy.chaoten.online`. GitHub Actions (Workflow „Erinnerungen“) ist nur der Ersatz und
springt ein, wenn Cloudflare länger als 15 Minuten nicht geprüft hat. Doppelt verschickt wird
nichts: Der Stand liegt in Firestore unter `meta/reminders`.

1. **Topics festlegen**, z. B. `timetable-papa`. Am Handy in der ntfy-App
   (Server `https://ntfy.chaoten.online`) abonnieren.
2. **In der Kalender-App**: im Profil jeder Person das **ntfy-Topic** eintragen, optional unter
   ⚙️ → Allgemein ein **Familien-Topic**. Beim Termin eine **Erinnerung** wählen.
3. **GitHub-Secrets** (Settings → Secrets and variables → Actions):
   - `NTFY_TOKEN`: Token des ntfy-Servers (muss auf die Topics schreiben dürfen)
   - `FAMILY_ID`: aus ⚙️ → Synchronisation
   - `CLOUDFLARE_API_TOKEN`: Cloudflare → My Profile → API Tokens → Create Token →
     Vorlage **„Edit Cloudflare Workers“** → Account auswählen → Create
   - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare-Dashboard → Workers & Pages → rechts „Account ID“
4. **Einrichten**: Actions → **„Erinnerungsdienst einrichten (Cloudflare)“** → Run workflow.
   Der Workflow lädt den Worker hoch, übergibt die Secrets und wartet, bis Cloudflare das erste Mal
   geprüft hat. Danach läuft er von selbst, und Änderungen an `reminders/` spielt er automatisch ein.
5. **Testen**: Actions → **Erinnerungen** → Run workflow schickt eine Test-Nachricht an alle Topics.

Ganztägige Termine erinnern ab 08:00 Uhr am Tag. „Am Vorabend“ bedeutet 18:00 Uhr am Vortag.
Auf dem kostenlosen Cloudflare-Plan sind 5 zeitgesteuerte Auslöser pro Konto möglich, dieser Worker braucht einen.

## Entwicklung

```bash
npm run dev     # http://localhost:5173 (auch im WLAN erreichbar)
npm test        # Tests für Wiederholungen, Feiertage, Ferien
```

Ohne Firebase-Konfiguration speichert die App alles nur im Browser und startet mit einer
Beispiel-Familie. Die Beispiel-Personen lassen sich in den Einstellungen löschen.
