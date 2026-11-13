/** Hilfsfunktionen für "Wanduhr"-Zeitstrings. Intern als UTC-Date gerechnet. */

const pad = (n: number) => String(n).padStart(2, '0');

export function parseLocal(s: string): Date {
  const [d, t] = s.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t ? t.split(':').map(Number) : [0, 0];
  return new Date(Date.UTC(y, m - 1, day, hh, mm));
}

export function fmtDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fmtDateTime(d: Date): string {
  return `${fmtDate(d)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function fmtLike(d: Date, allDay: boolean): string {
  return allDay ? fmtDate(d) : fmtDateTime(d);
}

export function addMinutes(s: string, minutes: number, allDay = !s.includes('T')): string {
  const d = parseLocal(s);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return fmtLike(d, allDay);
}

export function addDays(s: string, days: number): string {
  return addMinutes(s, days * 1440);
}

export function diffMinutes(a: string, b: string): number {
  return Math.round((parseLocal(b).getTime() - parseLocal(a).getTime()) / 60000);
}

/** Native lokale Date (z. B. von FullCalendar) → Wanduhr-String */
export function fromNative(d: Date, allDay: boolean): string {
  const s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return allDay ? s : `${s}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function nowLocal(): string {
  return fromNative(new Date(), false);
}

export function todayLocal(): string {
  return fromNative(new Date(), true);
}

/** 0 = Montag … 6 = Sonntag */
export function weekdayMo0(s: string): number {
  return (parseLocal(s).getUTCDay() + 6) % 7;
}

export function isoWeek(s: string): number {
  const d = parseLocal(s);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const ORDINALS = ['1.', '2.', '3.', '4.', 'letzten'];
