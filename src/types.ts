/**
 * Zeiten werden als "lokale Wanduhrzeit" gespeichert (ohne Zeitzone):
 *  - Termine mit Uhrzeit: "YYYY-MM-DDTHH:mm"
 *  - Ganztägig:           "YYYY-MM-DD" (Ende exklusiv, wie bei FullCalendar)
 * Die Familie lebt in einer Zeitzone, damit gibt es keine Sommerzeit-Probleme.
 */

export interface AvatarSpec {
  style: string;
  seed: string;
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
  updatedAt?: number;
}

export interface FamilySettings {
  id: 'settings';
  pinHash?: string;
  showHolidays: boolean;
  showSchoolHolidays: boolean;
  /** ntfy-Topic für Termine der ganzen Familie (ohne Person) */
  ntfyFamilyTopic?: string;
  updatedAt?: number;
}

export interface DeviceSettings {
  defaultView: 'auto' | 'month' | 'week' | 'day';
  kiosk: boolean;
  wakeLock: boolean;
  idleReturnMinutes: number;
  nightMode: boolean;
  nightFrom: string;
  nightTo: string;
  reminders: boolean;
  /** Erinnerungen nur für diese Personen (leer = alle) */
  reminderPersons: string[];
  /** Stundenplan-Blöcke auch in der Monatsansicht */
  schoolInMonth: boolean;
  /** Schulzeiten im Kalender anzeigen (Schalter in der Leiste) */
  showSchool: boolean;
  theme: 'auto' | 'light' | 'dark';
  dayStart: string;
  dayEnd: string;
  /** Version der gespeicherten Geräte-Einstellungen */
  v?: number;
}
