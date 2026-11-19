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
   (Wenn sich die Regeln ändern – z. B. für die automatische Sicherung kam `'backups'` dazu – einfach erneut einfügen.)
5. **Projekteinstellungen (Zahnrad) → Allgemein → Meine Apps → Web-App (`</>`) hinzufügen.**
   Die angezeigte `firebaseConfig` (`apiKey`, `authDomain`, `projectId`, …) kopieren.
   Diese Werte sind nicht geheim – geschützt wird über die Familien-ID.

## 2. App veröffentlichen

### Variante A: nur am Handy (GitHub Pages, automatisch)

Bei jeder Änderung auf `main` testet und baut GitHub die App und veröffentlicht sie direkt
(Workflow „Veröffentlichen"). Einmalig: **Settings → Pages → Source: „GitHub Actions"**.
Adresse: `https://timetable.chaoten.online/` (eigene Domain unter Settings → Pages → Custom domain;
DNS bei Cloudflare: CNAME `timetable` → `lukasnews.github.io`, „DNS only").

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

Zusätzlich, jeweils einzeln schaltbar unter ⚙️ → Allgemein: **Tagesübersicht** (Uhrzeit wählbar),
**Wochenübersicht** (Sonntag 18:00) und **Nachricht bei neuen/geänderten Terminen**. Geburtstage aus den
Profilen erinnern, wenn im Profil „An den Geburtstag erinnern“ gewählt ist. Der Dienst liest alle
5 Minuten nur Termine mit Erinnerung, damit die kostenlose Firestore-Grenze nicht erreicht wird.

**Kalender abonnieren:** Derselbe Dienst liefert unter `/cal/<Schlüssel>.ics` einen Abo-Link für Google-,
Outlook- oder Apple-Kalender (nur lesen). Den Link erstellt man in der App unter ⚙️ → Daten. Die Adresse
des Dienstes hinterlegt der Einrichtungs-Workflow automatisch.

Ganztägige Termine erinnern ab 08:00 Uhr am Tag. „Am Vorabend“ bedeutet 18:00 Uhr am Vortag.
Auf dem kostenlosen Cloudflare-Plan sind 5 zeitgesteuerte Auslöser pro Konto möglich, dieser Worker braucht einen.

## Entwicklung

```bash
npm run dev     # http://localhost:5173 (auch im WLAN erreichbar)
npm test        # Tests für Wiederholungen, Feiertage, Ferien
```

Ohne Firebase-Konfiguration speichert die App alles nur im Browser und startet mit einer
Beispiel-Familie. Die Beispiel-Personen lassen sich in den Einstellungen löschen.

## Android-App und Google Play

Die App wird bei Änderungen am Android-Teil automatisch gebaut (Workflow „Android-App bauen“,
auch per *Run workflow*). Ergebnis: **GitHub → Releases → „Android-App 1.0.x“** mit
`…apk` (direkt installieren) und `…aab` (Google Play).

Der Signierschlüssel wird beim ersten Lauf erzeugt, mit dem Secret `FAMILY_ID` verschlüsselt und im
privaten Entwurfs-Release **„android-signing“** aufbewahrt – nicht löschen und `FAMILY_ID` nicht ändern,
sonst lassen sich Updates nicht mehr über die installierte App installieren.

### Google Play (Interner Test – ideal für die Familie)

1. <https://play.google.com/console> → Entwicklerkonto anlegen (einmalig 25 $, Identitätsnachweis).
2. **App erstellen**: Name „Familienkalender“, Standardsprache Deutsch, App, kostenlos.
3. **Testen → Interner Test → Neuen Release erstellen** → die `.aab` aus dem neuesten GitHub-Release
   hochladen (die allererste Version muss von Hand hochgeladen werden) → „Google Play App-Signatur“ bestätigen.
4. Unter **Tester** eine E-Mail-Liste mit den Google-Konten der Familie anlegen und den
   **Link zur Teilnahme** an die Familie schicken → dort „Annehmen“ → App aus dem Play Store installieren.
5. Die Play Console verlangt einige Angaben (App-Inhalte): Datenschutzerklärung
   `https://timetable.chaoten.online/datenschutz.html`, Datensicherheit (keine Weitergabe, Daten verschlüsselt
   übertragen), Zielgruppe (Erwachsene/Familie, nicht für Kinder als Zielgruppe), keine Werbung,
   Berechtigung „Exakte Alarme“: Kalender-App mit Termin-Erinnerungen.

**Automatisch hochladen (optional):** Google Cloud Console → Dienstkonto anlegen → JSON-Schlüssel erstellen;
in der Play Console unter **Nutzer und Berechtigungen** das Dienstkonto einladen (Rechte: Releases verwalten).
Den Inhalt der JSON-Datei als GitHub-Secret **`PLAY_SERVICE_ACCOUNT_JSON`** speichern – ab dann landet jede
neue Version automatisch im internen Test.

> Für eine **öffentliche** Veröffentlichung verlangt Google bei neuen privaten Entwicklerkonten zuerst einen
> geschlossenen Test mit mindestens 12 Testern über 14 Tage. Für die Familie reicht der interne Test.

## 7. Weitere Familien

Die App kann von beliebig vielen Familien genutzt werden – jede legt unter ⚙️ → Synchronisation
einen **eigenen Familienkalender** an. Getrennt sind die Familien so:

- **Daten**: Jede Familie liegt in Firestore unter ihrer geheimen, zufälligen Familien-ID
  (`families/<ID>/…`). Die Regeln (`firestore.rules`) erlauben nur den Zugriff auf eine bekannte ID;
  eine Liste aller Familien oder Abfragen über alle Familien hinweg sind nicht erlaubt.
- **Erinnerungsdienst**: Die App meldet ihre Familie beim Worker an (`POST /register?family=…`).
  Der Worker speichert das Verzeichnis unter `families/<REGISTRY_ID>/meta/…`; `REGISTRY_ID` wird beim
  ersten Deploy zufällig erzeugt und liegt nur als Secret in Cloudflare. Alle 5 Minuten wird zuerst
  die eigene Familie (`FAMILY_ID`) geprüft, danach reihum die angemeldeten – so viele, wie das
  Cloudflare-Limit erlaubt (`SUBREQUEST_BUDGET`, Standard 45; höchstens `MAX_FAMILIES`, Standard 50).
- **ntfy**: Der eigene Server (`NTFY_SERVER` mit `NTFY_TOKEN`) gilt nur für die eigene Familie.
  Andere Familien tragen unter ⚙️ → Erinnerungen ihren **eigenen ntfy-Server** ein (z. B. ntfy.sh);
  dorthin wird ohne Token gesendet, und nur an Topics mit ihrem geheimen Präfix (`fk-…`, aus der
  Familien-ID abgeleitet). Ohne eigenen Server bekommt eine fremde Familie keine Push-Nachrichten –
  den Server des Dienstes einzutragen hilft nicht, er ist für sie gesperrt.
- **Kalender-Abo**: Der Abo-Link enthält einen eigenen geheimen Schlüssel und liefert nur die
  Termine der zugehörigen Familie.

Firestore-Kosten wachsen mit der Zahl der
Familien – bei vielen Familien das Kontingent in der Firebase-Konsole im Auge behalten.
