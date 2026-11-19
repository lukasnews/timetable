/**
 * Reine Hilfsfunktionen der Kalenderansicht (testbar, ohne FullCalendar).
 */
import type { EventInput } from '@fullcalendar/core';
import type { OccProps } from './calendarEvents';
import { addDays } from './dates';

const isTimed = (e: EventInput): boolean =>
  !e.allDay && e.display !== 'background' && typeof e.start === 'string' && typeof e.end === 'string';
const props = (e: EventInput) => e.extendedProps as OccProps | undefined;
/** über mehrere Kalendertage (endet nicht genau um Mitternacht des Folgetags) */
const isMultiDay = (start: string, end: string) => {
  const sd = start.slice(0, 10), ed = end.slice(0, 10);
  return sd !== ed && !(ed === addDays(sd, 1) && end.slice(11, 16) === '00:00');
};

/** Tag/Woche: mehrtägige Termine mit Uhrzeit als Balken in der Ganztags-Zeile, mit echter Dauer */
export function toSpanBars(events: EventInput[]): EventInput[] {
  const fmt = (v: string) => `${new Date(v.slice(0, 10) + 'T12:00:00').toLocaleDateString('de-AT', { weekday: 'short' }).replace('.', '')} ${v.slice(11, 16)}`;
  return events.map((e) => {
    if (!isTimed(e)) return e;
    const start = e.start as string, end = e.end as string;
    if (!isMultiDay(start, end)) return e;
    const sd = start.slice(0, 10), ed = end.slice(0, 10);
    return {
      ...e, allDay: true, start: sd, end: end.slice(11, 16) === '00:00' ? ed : addDays(ed, 1), editable: false,
      extendedProps: { ...props(e), spanText: `${fmt(start)} – ${fmt(end)}` },
    };
  });
}

/** Sichtbarer Tagesbereich: eingestellt, aber erweitert um Termine außerhalb (mehrtägige zählen nicht) */
export function visibleSpan(events: EventInput[], dayStart: string, dayEnd: string): { min: string; max: string } {
  let min = dayStart, max = dayEnd;
  for (const e of events) {
    if (!isTimed(e) || props(e)?.kind === 'school') continue;
    const start = e.start as string, end = e.end as string;
    const toMidnight = end.slice(0, 10) === addDays(start.slice(0, 10), 1) && end.slice(11, 16) === '00:00';
    if (isMultiDay(start, end)) continue;
    const st = start.slice(11, 13) + ':00';
    const en = toMidnight ? '24:00' : end.slice(14, 16) === '00' ? end.slice(11, 16) : `${String(Number(end.slice(11, 13)) + 1).padStart(2, '0')}:00`;
    if (st < min) min = st;
    if (en > max) max = en;
  }
  return { min, max };
}

/** Heute: laufende Termine und der nächste beginnende (Schlüssel „eventId|occStart“) */
export function highlightKeys(events: EventInput[], now: string): { running: Set<string>; next?: string } {
  const running = new Set<string>();
  let next: { key: string; start: string } | undefined;
  const today = now.slice(0, 10);
  for (const e of events) {
    if (!isTimed(e)) continue;
    const x = props(e);
    if (!x?.eventId || x.kind === 'school') continue;
    const start = e.start as string, end = e.end as string;
    if (start.slice(0, 10) !== today || end.slice(0, 10) !== today || end <= now) continue;
    const key = x.eventId + '|' + x.occStart;
    if (start <= now) running.add(key);
    else if (!next || start < next.start) next = { key, start };
  }
  return { running, next: next?.key };
}

/** Fokus-Woche: gestern + 6 Tage */
export function focusRange(current: Date): { start: Date; end: Date } {
  const start = new Date(current); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 1);
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return { start, end };
}

/** Einstiegs-Uhrzeit: eine halbe Stunde vor jetzt, auf die halbe Stunde abgerundet; nachts 07:00 */
export function scrollTimeFor(now: Date): string {
  if (now.getHours() < 1) return '07:00:00';
  const d = new Date(now.getTime() - 30 * 60000);
  return `${String(d.getHours()).padStart(2, '0')}:${d.getMinutes() < 30 ? '00' : '30'}:00`;
}
