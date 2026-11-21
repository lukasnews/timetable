import type { CalEvent } from '../types';

/** Höchstens so viele Erinnerungen pro Termin */
export const MAX_REMINDERS = 5;

/** Alle Erinnerungen eines Termins (Minuten vor Beginn bzw. vor 08:00 bei ganztägigen), ohne Doppelte, größte zuerst */
export function remindersOf(ev: Pick<CalEvent, 'reminderMinutes' | 'extraReminders'>): number[] {
  const all = [ev.reminderMinutes, ...(ev.extraReminders ?? [])].filter((m): m is number => typeof m === 'number' && Number.isFinite(m) && m >= 0);
  return [...new Set(all.map((m) => Math.round(m)))].sort((a, b) => b - a).slice(0, MAX_REMINDERS);
}

/** Speicherform: erste (früheste) Erinnerung im alten Feld – ältere App-Versionen und der Dienst finden den Termin so weiter –, Rest extra */
export function withReminders(list: number[]): Pick<CalEvent, 'reminderMinutes' | 'extraReminders'> {
  const r = remindersOf({ reminderMinutes: null, extraReminders: list });
  return { reminderMinutes: r[0] ?? null, extraReminders: r.length > 1 ? r.slice(1) : undefined };
}

const PLAIN: Record<number, string> = { 0: 'Zum Beginn', 60: '1 Stunde vorher', 1440: '1 Tag vorher', 10080: '1 Woche vorher' };
const ALL_DAY: Record<number, string> = { 0: 'Am Tag, 08:00', 840: 'Am Vorabend, 18:00', 1440: '1 Tag vorher, 08:00', 2880: '2 Tage vorher, 08:00', 10080: '1 Woche vorher, 08:00' };

/** „15 Minuten vorher“, „1 Stunde 30 Minuten vorher“, „2 Tage vorher“ … */
export function reminderLabel(min: number, allDay = false): string {
  if (allDay && ALL_DAY[min]) return ALL_DAY[min];
  if (PLAIN[min]) return PLAIN[min];
  if (min === 840 && allDay) return 'Am Vorabend, 18:00';
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  const parts = [d && `${d} ${d === 1 ? 'Tag' : 'Tage'}`, h && `${h} ${h === 1 ? 'Stunde' : 'Stunden'}`, m && `${m} ${m === 1 ? 'Minute' : 'Minuten'}`].filter(Boolean);
  return `${parts.join(' ')} vorher${allDay ? ' (ab 08:00)' : ''}`;
}

/** Kurzform für Knöpfe: „5 Min.“, „1 Std.“, „2 Tage“ */
export function reminderShort(min: number, allDay = false): string {
  if (min === 0) return allDay ? 'Am Tag' : 'Beginn';
  if (allDay && min === 840) return 'Vorabend';
  if (min % 1440 === 0) return `${min / 1440} ${min === 1440 ? 'Tag' : 'Tage'}`;
  if (min % 60 === 0) return `${min / 60} Std.`;
  if (min > 60) return `${Math.floor(min / 60)} Std. ${min % 60} Min.`;
  return `${min} Min.`;
}
