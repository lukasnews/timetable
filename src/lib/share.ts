/**
 * Termin teilen: als Text (WhatsApp, SMS, E-Mail, Zwischenablage, Teilen-Menü) oder als Kalender-Datei (.ics).
 */
import type { CalEvent, Person } from '../types';
import { displayTitle } from './categories';
import { addDays } from './dates';
import { toICS } from './ics';

const day = (s: string) => new Date(s.slice(0, 10) + 'T12:00:00').toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });

export function shareText(ev: CalEvent, start: string, end: string, persons: Person[]): string {
  let when: string;
  if (ev.allDay) {
    const last = addDays(end, -1);
    when = last === start.slice(0, 10) ? `${day(start)}, ganztägig` : `${day(start)} – ${day(last)}`;
  } else {
    when = start.slice(0, 10) === end.slice(0, 10)
      ? `${day(start)}, ${start.slice(11, 16)}–${end.slice(11, 16)} Uhr`
      : `${day(start)} ${start.slice(11, 16)} – ${day(end)} ${end.slice(11, 16)} Uhr`;
  }
  const names = persons.filter((p) => ev.personIds.includes(p.id)).map((p) => p.name).join(', ');
  const drivers = persons.filter((p) => ev.driverIds?.includes(p.id)).map((p) => p.name).join(', ');
  return [
    `📅 ${displayTitle(ev)}`,
    when,
    names && `👤 ${names}`,
    ev.location && `📍 ${ev.location}`,
    ev.bring && `🎒 Mitbringen: ${ev.bring}`,
    drivers && `🚗 Fahrdienst: ${drivers}`,
    ev.notes?.trim(),
  ].filter(Boolean).join('\n');
}

/** Ein einzelnes Vorkommen als .ics-Datei (Serien werden als einzelner Termin geteilt) */
export function shareIcsFile(ev: CalEvent, start: string, end: string, persons: Person[]): File {
  const single: CalEvent = { ...ev, id: `${ev.id}-${start.replace(/[^0-9]/g, '')}`, start, end, recurrence: undefined, exdates: undefined, seriesId: undefined, originalStart: undefined };
  const name = (ev.title || 'Termin').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 40) || 'Termin';
  return new File([toICS([single], persons)], `${name}.ics`, { type: 'text/calendar' });
}
