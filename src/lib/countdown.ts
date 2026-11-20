import type { CalEvent } from '../types';
import { expand } from './recurrence';
import { addDays } from './dates';
import { rangesBetween, schoolHolidaysFor, type FerienRegion } from './holidays';

export interface Countdown { title: string; date: string; days: number }

/** Nächste Countdowns: markierte Termine und (optional) die nächsten Schulferien */
export function nextCountdowns(events: CalEvent[], today: string, withFerien: boolean, max = 2, region?: FerienRegion): Countdown[] {
  const ferien = schoolHolidaysFor(region);
  const until = addDays(today, 366);
  const days = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86400000);
  const out: Countdown[] = [];
  for (const o of expand(events.filter((e) => e.countdown), addDays(today, 1), until)) {
    const d = o.start.slice(0, 10);
    if (d > today && !out.some((c) => c.title === o.event.title)) out.push({ title: o.event.title, date: d, days: days(d) });
  }
  if (withFerien) {
    const f = rangesBetween(addDays(today, 1), until, ferien).filter((r) => r.start > today).sort((a, b) => a.start.localeCompare(b.start))[0];
    // Laufende Ferien nicht mitzählen
    const running = rangesBetween(today, addDays(today, 1), ferien).length > 0;
    if (f && !running) out.push({ title: f.title, date: f.start, days: days(f.start) });
  }
  return out.sort((a, b) => a.days - b.days).slice(0, max);
}
