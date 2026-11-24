import type { CalEvent } from '../types';

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Jährliche Geburtstage am 29.02. gibt es nur in Schaltjahren – in den anderen Jahren am 28.02. feiern
 * (wie in der Kalenderansicht). Dafür einzelne Termine für die Jahre rund um „today“ erzeugen.
 */
export function withFeb29(events: CalEvent[], today: string): CalEvent[] {
  const y0 = Number(today.slice(0, 4));
  return events.flatMap((ev) => {
    if (ev.recurrence?.freq !== 'yearly' || ev.start.slice(5, 10) !== '02-29') return [ev];
    const out: CalEvent[] = [];
    for (let y = y0 - 1; y <= y0 + 2; y++) {
      const d = `${y}-02-${leap(y) ? '29' : '28'}`;
      out.push({ ...ev, id: `${ev.id}-${y}`, start: d, end: `${y}-03-01`, recurrence: undefined, originalStart: undefined });
    }
    return out;
  });
}
