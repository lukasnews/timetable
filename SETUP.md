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

### Variante A: automatisch (Cloudflare Pages)

Bei jeder Änderung auf `main` testet und baut GitHub die App und veröffentlicht sie auf Cloudflare
Pages (Workflow „Veröffentlichen“, Projekt `familienkalender` → `familienkalender-baf.pages.dev`).
Benötigt die Secrets `CLOUDFLARE_API_TOKEN` und `CLOUDFLARE_ACCOUNT_ID`. Eigene Domains (auch
`timetable.chaoten.online`) hängt der Workflow „Domain einer Familie verwalten“ an; DNS: CNAME auf
`familienkalender-baf.pages.dev`, über Cloudflare geleitet. GitHub Pages wird nicht mehr verwendet.

Regelmäßig laufende GitHub-Workflows gibt es keine mehr (Erinnerungen prüft nur der Cloudflare-Dienst).

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

## 5. Erinnerungen per ntfy

Ein **Cloudflare Worker** prüft alle 5 Minuten für alle angemeldeten Familien, was fällig ist, und
schickt es an den **ntfy-Server der jeweiligen Familie**. Doppelt verschickt wird nichts: Der Stand
liegt pro Familie in Firestore unter `meta/reminders`.

Für jede Familie gleich (in der App):
1. ⚙️ → Erinnerungen: **ntfy-Server** (z. B. `https://ntfy.sh` oder ein eigener) und
   **Zugangsschlüssel** (Token, das auf die Topics schreiben darf) eintragen. Ohne Server gehen
   keine Push-Nachrichten raus.
2. Im Profil jeder Person das **ntfy-Topic** eintragen (andere Familien: mit ihrem Präfix `fk-…`),
   optional ein **Familien-Topic**. In der ntfy-App unter diesem Server abonnieren.
3. Beim Termin eine **Erinnerung** wählen. Testen: einen Termin in ~15 Minuten mit Erinnerung
   „10 Minuten vorher“ anlegen.

Einrichtung des Dienstes (einmalig, Betreiber):
- **GitHub-Secrets** (Settings → Secrets and variables → Actions):
  - `FAMILY_ID`: Familie, deren bestehende Topics ohne Präfix erlaubt bleiben (und Schlüssel für die
    Android-Signatur) – sonst wird sie wie jede andere Familie behandelt
  - `CLOUDFLARE_API_TOKEN`: Cloudflare → My Profile → API Tokens → Create Token →
    Vorlage **„Edit Cloudflare Workers“** → Account auswählen → Create
  - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare-Dashboard → Workers & Pages → rechts „Account ID“
- **Einrichten**: Actions → **„Erinnerungsdienst einrichten (Cloudflare)“** → Run workflow. Danach
  läuft er von selbst, und Änderungen an `reminders/` spielt er automatisch ein.

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
  (`families/<ID>/…`, mind. 16 Zeichen, zufällig erzeugt). Die Regeln (`firestore.rules`) erlauben nur
  den Zugriff auf eine bekannte ID; eine Liste aller Familien oder Abfragen über alle Familien hinweg
  sind nicht erlaubt (live geprüft: beides wird mit 403 abgewiesen).
- **Erinnerungsdienst**: Die App meldet ihre Familie beim Worker an (`POST /register?family=…`).
  Der Worker speichert das Verzeichnis unter `families/<REGISTRY_ID>/meta/…`; `REGISTRY_ID` wird beim
  ersten Deploy zufällig erzeugt und liegt nur als Secret in Cloudflare. Alle 5 Minuten werden alle
  angemeldeten Familien reihum geprüft – für alle gleich, so viele, wie das Cloudflare-Limit erlaubt
  (`SUBREQUEST_BUDGET`, Standard 45; höchstens `MAX_FAMILIES`, Standard 50).
- **ntfy** (optional – die Android-App erinnert auch ohne): Jede Familie trägt unter ⚙️ →
  Erinnerungen → „Push per ntfy“ ihren **eigenen ntfy-Server** und **Zugangsschlüssel** ein; ohne
  Server werden keine ntfy-Nachrichten verschickt. Topics brauchen das geheime Präfix der Familie
  (`fk-…`, aus der Familien-ID abgeleitet). Für ntfy.sh unbedingt einen Zugangsschlüssel
  (ntfy.sh-Konto) eintragen: anonym gilt dort ein Tageslimit pro IP-Adresse, und Cloudflare-Worker
  teilen sich ihre IP-Adressen.
- **Kalender-Abo**: Der Abo-Link enthält einen eigenen geheimen Schlüssel und liefert nur die
  Termine der zugehörigen Familie.

Schutz vor Missbrauch: höchstens 3 neue Familien pro Anschluss und Tag (IP nur gehasht, nach
einem Tag gelöscht), insgesamt `MAX_FAMILIES`, inaktive Familien fliegen nach 60 Tagen aus dem
Verzeichnis. Die Firestore-Regeln begrenzen Feldanzahl und ID-Länge je Dokument.

**Firestore-Regeln veröffentlichen**: entweder einmal den Inhalt von `firestore.rules` in der
Firebase-Konsole (Firestore → Regeln) einfügen und veröffentlichen – oder das Secret
`FIREBASE_SERVICE_ACCOUNT` anlegen (Google Cloud → IAM → Dienstkonten → Konto mit Rolle
„Firebase Rules Admin“ → Schlüssel als JSON); dann veröffentlicht der Workflow
„Firestore-Regeln veröffentlichen“ jede Änderung automatisch.

**Kosten im Blick**: In der Google-Cloud-Konsole unter Abrechnung → Budgets eine Budget-Warnung
(z. B. 1 €) anlegen – Firestore-Kosten wachsen mit der Zahl der Familien.

**Eigene Adresse für den Dienst**: Liegt die Domain der App (aus `public/CNAME`) im selben
Cloudflare-Konto, richtet der Deploy-Workflow automatisch `erinnerungen.<domain>` ein; sonst bleibt
der Dienst unter `*.workers.dev` erreichbar.

### Eine App für alle Familien, eigene Adresse in den Einstellungen

Alle Familien – auch die eigene – nutzen dieselbe App unter `familienkalender-baf.pages.dev`
(Android-App: öffnet diese Adresse). Unter ⚙️ → Sync → „Eigene Adresse“ kann jede Familie ihre
Domain eintragen; die App prüft, ob die Domain angeschlossen ist. Danach wechselt der Browser
automatisch dorthin, und Einladungslinks, QR-Code, Kalender-Abo und Links in Push-Nachrichten
verwenden diese Adresse. Der Erinnerungsdienst ist unter jeder Adresse als `…/svc` erreichbar.

### Domain einer Familie anschließen

Jede Familie nutzt die gemeinsame App unter `familienkalender-baf.pages.dev` – oder ihre eigene
Domain (so auch `timetable.chaoten.online`):

1. Actions → **„Domain einer Familie verwalten“** → Run workflow → Aktion „hinzufügen“, Domain
   eintragen (z. B. `kalender.mueller.at`).
2. Die Zusammenfassung des Laufs zeigt den DNS-Eintrag, den die Familie bei ihrem Anbieter anlegt
   (CNAME auf `familienkalender-baf.pages.dev`).
3. Mit „anzeigen“ den Stand prüfen (aktiv, sobald DNS und Zertifikat fertig sind); mit „entfernen“
   wieder abhängen.

Nur wer Schreibrechte am Repository hat, kann den Workflow starten. Die Familien-Daten bleiben
getrennt wie bei allen anderen; Push-Links des Dienstes führen automatisch zu ihrer Domain.
