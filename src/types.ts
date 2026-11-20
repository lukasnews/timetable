/**
 * Zeiten werden als "lokale Wanduhrzeit" gespeichert (ohne Zeitzone):
 *  - Termine mit Uhrzeit: "YYYY-MM-DDTHH:mm"
 *  - Ganztägig:           "YYYY-MM-DD" (Ende exklusiv, wie bei FullCalendar)
 * Die Familie lebt in einer Zeitzone, damit gibt es keine Sommerzeit-Probleme.
 */

export interface AvatarSpec {
  style: string;
  seed: string;
  /** Baukasten: gewählte Merkmale (null = „keine“, z. B. keine Brille) – Rest bestimmt der Seed */
  opts?: Record<string, string | null>;
}

export interface Person {
  id: string;
  name: string;
  color: string;
  avatar: AvatarSpec;
  /** "YYYY-MM-DD" – erzeugt automatisch einen Geburtstag im Kalender */
  birthday?: string;
  /** Hat einen Stundenplan (Kind) */
  hasTimetable?: boolean;
  /** Erinnerung an den Geburtstag aus dem Profil: Minuten vor 08:00 am Tag (null/undefined = keine) */
  birthdayReminder?: number | null;
  /** ntfy-Topic für Erinnerungen dieser Person */
  ntfyTopic?: string;
  order: number;
  updatedAt?: number;
}

export type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Recurrence {
  freq: Freq;
  interval: number;
  /** 0 = Montag … 6 = Sonntag (nur weekly) */
  byWeekday?: number[];
  /** monthly / yearly: am selben Tag im Monat oder am n-ten Wochentag ("2. Dienstag") */
  monthlyMode?: 'dayOfMonth' | 'nthWeekday';
  end: { type: 'never' } | { type: 'until'; until: string } | { type: 'count'; count: number };
}

export interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  personIds: string[];
  /** Fahrdienst (optional): wer bringt/holt */
  driverIds?: string[];
  location?: string;
  notes?: string;
  /** Minuten vor Beginn, null = keine Erinnerung */
  reminderMinutes?: number | null;
  kind?: 'event' | 'birthday';
  /** Bei Geburtstagen: Geburtsjahr für die Altersanzeige */
  birthYear?: number;
  recurrence?: Recurrence;
  /** Ausgelassene Vorkommen (Start-String des Vorkommens) */
  exdates?: string[];
  /** Ausnahme einer Serie: Verweis auf die Serie + ursprünglicher Start */
  seriesId?: string;
  originalStart?: string;
  /** Importiert aus einer .ics-Datei/URL: Herkunft (zum gemeinsamen Entfernen) */
  importSource?: string;
  /** Schulfrei: an diesen Tagen keine Schulzeit anzeigen (für die gewählten Personen bzw. alle) */
  schoolFree?: boolean;
  /** Kategorie (Symbol vor dem Titel), siehe CATEGORIES */
  category?: string;
  /** Was mitzubringen ist (z. B. „Turnsachen“) */
  bring?: string;
  /** Countdown bis zu diesem Termin in der Kopfzeile anzeigen */
  countdown?: boolean;
  /** Abwesenheit der gewählten Personen (z. B. Dienstreise) */
  absent?: boolean;
  createdAt?: number;
  /** Person, die zuletzt geändert hat (Geräte-Einstellung „Ich bin“) */
  changedBy?: string;
  /** Gerät, auf dem zuletzt geändert wurde (zufällige Kennung, für „Änderungen beim Öffnen“) */
  changedOn?: string;
  updatedAt?: number;
}

export interface Lesson {
  id: string;
  /** 0 = Montag … 4 = Freitag */
  weekday: number;
  start: string; // "HH:mm"
  end: string; // "HH:mm"
  subject: string;
  teacher?: string;
  room?: string;
  /** Was zu dieser Stunde mitzubringen ist (z. B. „Turnsachen“) */
  bring?: string;
  /** Für A/B-Wochen: undefined = jede Woche */
  week?: 'A' | 'B';
}

export interface Timetable {
  id: string; // = personId
  lessons: Lesson[];
  /** Wenn gesetzt: KW gerade = A oder B */
  abWeeks?: boolean;
  evenWeekIs?: 'A' | 'B';
  showInCalendar: boolean;
  /** Schulautonome / schulfreie Tage nur für dieses Kind (Ende inklusive) */
  freeDays?: FreeDay[];
  updatedAt?: number;
}

export interface FreeDay {
  start: string; // "YYYY-MM-DD"
  end: string; // "YYYY-MM-DD", inklusive
  label?: string;
}

export interface QuickLink {
  id: string;
  /** Emoji als Symbol */
  icon: string;
  label: string;
  url: string;
  /** Android-App (Paketname, z. B. com.beispiel.essen) – startet die installierte App */
  androidPackage?: string;
  /** auch in den Details von Geburtstagen anzeigen */
  onBirthday?: boolean;
}

/** Importierter Kalender (.ics) mit seinen Einstellungen */
export interface IcsSource {
  id: string;
  /** = importSource der Termine */
  name: string;
  /** Link → wird vom Dienst täglich automatisch aktualisiert */
  url?: string;
  /** Automatisch aktualisieren (nur mit Link) */
  auto?: boolean;
  personIds: string[];
  /** Erinnerung in Minuten vorher (wie bei Terminen), null = keine */
  reminder?: number | null;
  /** Erinnerung am Vorabend um diese Uhrzeit "HH:mm" (hat Vorrang vor reminder) */
  evening?: string | null;
  /** Nur zukünftige Termine übernehmen */
  futureOnly?: boolean;
  /** „Jetzt aktualisieren“ angefordert (ms) */
  requested?: number;
}

export interface FamilySettings {
  id: 'settings';
  pinHash?: string;
  showHolidays: boolean;
  showSchoolHolidays: boolean;
  /** Bundesland für die Schulferien (fehlt = Oberösterreich) */
  ferienRegion?: import('./lib/holidays').FerienRegion;
  /** ntfy-Topic für Termine der ganzen Familie (ohne Person) */
  ntfyFamilyTopic?: string;
  /** Eigener ntfy-Server der Familie (leer = Server des Erinnerungsdienstes) */
  ntfyServer?: string;
  /** Zeitzone der Familie (IANA, z. B. Europe/Vienna) – für Erinnerungsdienst, Import und Export */
  timezone?: string;
  /** Eigene Adresse der Familie (Domain, z. B. kalender.mueller.at) – Einladungslinks, Abo-Link und Browser nutzen sie */
  appDomain?: string;
  /** Zugangsschlüssel für den eigenen ntfy-Server (z. B. ntfy.sh-Konto) – nur für die eigene Familie sichtbar */
  ntfyToken?: string;
  /** Geheimer Schlüssel für den Abo-Link (Kalender in Google/Outlook abonnieren) */
  feedToken?: string;
  /** Tagesübersicht per ntfy: Uhrzeit "HH:mm" (leer = aus) */
  ntfyDaily?: string;
  /** Wochenübersicht am Sonntag um 18:00 */
  ntfyWeekly?: boolean;
  /** Wochenübersicht mit Fahrdienst-Block (Standard: an) */
  ntfyWeeklyDrivers?: boolean;
  /** Nachricht bei neuen/geänderten Terminen */
  ntfyChanges?: boolean;
  /** Ort für die Wettervorhersage */
  weather?: { name: string; lat: number; lon: number };
  /** Importierte Kalender (Müllkalender usw.) */
  icsSources?: IcsSource[];
  /** Schnellzugriff auf andere Apps/Seiten (z. B. Essensplan, Wunschliste) */
  quickLinks?: QuickLink[];
  updatedAt?: number;
}

export interface DeviceSettings {
  defaultView: 'auto' | 'month' | 'week' | 'focus' | 'day';
  kiosk: boolean;
  wakeLock: boolean;
  idleReturnMinutes: number;
  nightMode: boolean;
  nightFrom: string;
  nightTo: string;
  reminders: boolean;
  /** Erinnerungen nur für diese Personen (leer = alle) */
  reminderPersons: string[];
  /** Android-App: Tagesübersicht als Benachrichtigung am Gerät ("HH:mm", leer = aus) */
  dailyDigest?: string;
  /** Android-App: Wochenübersicht Sonntag 18:00 am Gerät */
  weeklyDigest?: boolean;
  /** Beim Öffnen zeigen, was andere seit dem letzten Mal neu eingetragen oder geändert haben (Standard: an) */
  changeHint?: boolean;
  /** Stundenplan-Blöcke auch in der Monatsansicht */
  schoolInMonth: boolean;
  /** Wetter im Kalender anzeigen */
  showWeather: boolean;
  /** Countdown (Ferien, markierte Termine) in der Kopfzeile */
  showCountdown: boolean;
  /** „Ich bin“: Person an diesem Gerät (für Änderungs-Nachrichten) */
  me?: string;
  /** Kalender gesperrt: kein Verschieben/Ändern per Ziehen, Tippen zeigt Details */
  locked: boolean;
  /** Entsperren nur mit PIN */
  lockNeedsPin: boolean;
  /** Uhrzeit im Schulstreifen anzeigen (sonst schmaler Streifen nur mit Farbe und Gesicht) */
  schoolTimes?: boolean;
  /** Schulzeiten im Kalender anzeigen (Schalter in der Leiste) */
  showSchool: boolean;
  /** importierte Kalender (Name), die auf diesem Gerät ausgeblendet sind */
  hiddenSources?: string[];
  /** Knöpfe zum Ein-/Ausblenden der importierten Kalender in der oberen Leiste */
  sourceChips?: boolean;
  theme: 'auto' | 'light' | 'dark';
  dayStart: string;
  dayEnd: string;
  /** Stundenhöhe in Tag/Woche: kompakt = mehr Stunden sichtbar */
  rowHeight?: 'compact' | 'normal' | 'large';
  /** Anzeigegröße (1 = 100 %) – z. B. 1.3 fürs Wand-Tablet */
  uiScale: number;
  /** Bildschirmschoner: tagsüber Uhr + nächste Termine */
  saverDay: boolean;
  /** Bildschirmschoner: nachts gedimmte Uhr (Zeitraum = nightFrom–nightTo) */
  saverNight: boolean;
  /** Bildschirmschoner nach so vielen Minuten ohne Berührung */
  saverMinutes: number;
  /** Version der gespeicherten Geräte-Einstellungen */
  v?: number;
}

/** Vorlage für häufige Termine */
export interface EventTemplate {
  id: string;
  title: string;
  durationMin: number;
  allDay: boolean;
  /** Übliche Beginnzeit "HH:mm" (optional) */
  time?: string;
  personIds: string[];
  driverIds?: string[];
  location?: string;
  reminderMinutes?: number | null;
  category?: string;
  bring?: string;
}
