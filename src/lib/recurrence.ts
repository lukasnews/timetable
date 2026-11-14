import { RRule, Weekday, type Options } from 'rrule';
import type { CalEvent, Recurrence } from '../types';
import { addDays, addMinutes, diffMinutes, fmtLike, parseLocal, weekdayMo0, WEEKDAYS, ORDINALS } from './dates';

const RR_DAYS = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU];
const FREQ = { daily: RRule.DAILY, weekly: RRule.WEEKLY, monthly: RRule.MONTHLY, yearly: RRule.YEARLY } as const;

/** n-ter Wochentag im Monat (1–4, 5 = letzter) für ein Datum */
export function nthOfMonth(start: string): number {
  return Math.min(5, Math.ceil(parseLocal(start).getUTCDate() / 7));
}

export function toRRule(start: string, rec: Recurrence): RRule {
  const dtstart = parseLocal(start);
  const opts: Partial<Options> = {
    freq: FREQ[rec.freq],
    interval: Math.max(1, rec.interval || 1),
    dtstart,
    tzid: undefined,
  };
  if (rec.freq === 'weekly') {
    const days = rec.byWeekday?.length ? rec.byWeekday : [weekdayMo0(start)];
    opts.byweekday = days.map((d) => RR_DAYS[d]);
  }
  if ((rec.freq === 'monthly' || rec.freq === 'yearly') && rec.monthlyMode === 'nthWeekday') {
    const n = nthOfMonth(start);
    opts.byweekday = [new Weekday(weekdayMo0(start), n === 5 ? -1 : n)];
    if (rec.freq === 'yearly') opts.bymonth = [dtstart.getUTCMonth() + 1];
  }
  if (rec.end.type === 'until') {
    // until inklusive des ganzen Tages
    opts.until = parseLocal(rec.end.until.slice(0, 10) + 'T23:59');
  } else if (rec.end.type === 'count') {
    opts.count = Math.max(1, rec.end.count);
  }
  return new RRule(opts);
}

export interface Occurrence {
  event: CalEvent;
  /** Start des Vorkommens (Wanduhr-String) */
  start: string;
  end: string;
  /** Ursprünglicher Start in der Serie (Schlüssel für Ausnahmen) */
  occStart: string;
  recurring: boolean;
}

/** Alle Vorkommen der Termine im Bereich [from, to) */
export function expand(events: CalEvent[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  const fromD = parseLocal(from);
  const toD = parseLocal(to);
  for (const ev of events) {
    const dur = diffMinutes(ev.start, ev.end);
    if (!ev.recurrence) {
      if (parseLocal(ev.end) > fromD && parseLocal(ev.start) < toD) {
        out.push({ event: ev, start: ev.start, end: ev.end, occStart: ev.originalStart ?? ev.start, recurring: !!ev.seriesId });
      }
      continue;
    }
    const rule = toRRule(ev.start, ev.recurrence);
    const ex = new Set(ev.exdates ?? []);
    // Vorkommen, die vor "from" beginnen, aber hineinragen, mitnehmen
    const searchFrom = new Date(fromD.getTime() - Math.max(dur, 0) * 60000 - 1);
    for (const d of rule.between(searchFrom, toD, true)) {
      const s = fmtLike(d, ev.allDay);
      if (ex.has(s)) continue;
      const e = addMinutes(s, dur, ev.allDay);
      if (parseLocal(e) <= fromD) continue;
      out.push({ event: ev, start: s, end: e, occStart: s, recurring: true });
    }
  }
  return out;
}

/** Ist "occStart" das erste Vorkommen der Serie? */
export function isFirstOccurrence(series: CalEvent, occStart: string): boolean {
  if (!series.recurrence) return true;
  const first = toRRule(series.start, series.recurrence).after(new Date(parseLocal(series.start).getTime() - 1), true);
  return !!first && fmtLike(first, series.allDay) === occStart;
}

/** Anzahl der Vorkommen vor occStart (für count-basierte Serien beim Teilen) */
export function countBefore(series: CalEvent, occStart: string): number {
  if (!series.recurrence) return 0;
  return toRRule(series.start, series.recurrence).between(new Date(-8.64e15), parseLocal(occStart), false).length;
}

/** Verschiebt die Wochentage einer Wochenregel um "days" Tage (z. B. Di → Mi beim Ziehen) */
export function shiftRecurrence(rec: Recurrence, days: number): Recurrence {
  const shift = ((days % 7) + 7) % 7;
  if (rec.freq !== 'weekly' || !rec.byWeekday?.length || shift === 0) return rec;
  return { ...rec, byWeekday: rec.byWeekday.map((d) => (d + shift) % 7).sort() };
}

/** Lesbare Beschreibung wie in Outlook */
export function describe(start: string, rec?: Recurrence): string {
  if (!rec) return 'Einmalig';
  const n = rec.interval || 1;
  let s = '';
  switch (rec.freq) {
    case 'daily':
      s = n === 1 ? 'Täglich' : `Alle ${n} Tage`;
      break;
    case 'weekly': {
      const days = (rec.byWeekday?.length ? rec.byWeekday : [weekdayMo0(start)]).map((d) => WEEKDAYS[d]);
      s = (n === 1 ? 'Jeden ' : n === 2 ? 'Jeden 2. ' : `Alle ${n} Wochen am `) + days.join(', ');
      break;
    }
    case 'monthly':
    case 'yearly': {
      const d = parseLocal(start);
      const unit = rec.freq === 'monthly' ? (n === 1 ? 'Jeden Monat' : `Alle ${n} Monate`) : n === 1 ? 'Jedes Jahr' : `Alle ${n} Jahre`;
      const month = rec.freq === 'yearly' ? ' im ' + d.toLocaleDateString('de-AT', { month: 'long', timeZone: 'UTC' }) : '';
      if (rec.monthlyMode === 'nthWeekday') {
        s = `${unit} am ${ORDINALS[nthOfMonth(start) - 1]} ${WEEKDAYS[weekdayMo0(start)]}${month}`;
      } else {
        s = rec.freq === 'yearly'
          ? `${unit} am ${d.getUTCDate()}. ${d.toLocaleDateString('de-AT', { month: 'long', timeZone: 'UTC' })}`
          : `${unit} am ${d.getUTCDate()}.`;
      }
    }
  }
  if (rec.end.type === 'until') s += `, bis ${rec.end.until.split('-').reverse().join('.')}`;
  if (rec.end.type === 'count') s += `, ${rec.end.count}×`;
  return s;
}

export type Scope = 'one' | 'following' | 'all';

export interface Change {
  start: string;
  end: string;
  allDay: boolean;
  patch?: Partial<CalEvent>;
}

export interface Mutation {
  put: CalEvent[];
  del: string[];
}

/**
 * Wendet eine Änderung an einem Vorkommen an (ziehen, Größe ändern, bearbeiten).
 * series = der Serien-Termin (oder der einzelne Termin), occStart = ursprünglicher Start.
 */
export function applyChange(
  series: CalEvent,
  occStart: string,
  change: Change,
  scope: Scope,
  allEvents: CalEvent[],
  newId: () => string,
): Mutation {
  const patch = change.patch ?? {};
  // Einzeltermin oder bereits bestehende Ausnahme
  if (!series.recurrence) {
    return { put: [{ ...series, ...patch, start: change.start, end: change.end, allDay: change.allDay }], del: [] };
  }

  if (scope === 'following' && isFirstOccurrence(series, occStart)) scope = 'all';

  if (scope === 'one') {
    const override: CalEvent = {
      ...series,
      ...patch,
      id: newId(),
      start: change.start,
      end: change.end,
      allDay: change.allDay,
      recurrence: undefined,
      exdates: undefined,
      seriesId: series.id,
      originalStart: occStart,
    };
    delete override.recurrence;
    delete override.exdates;
    return {
      put: [{ ...series, exdates: [...new Set([...(series.exdates ?? []), occStart])] }, override],
      del: [],
    };
  }

  const deltaMin = diffMinutes(occStart, change.start);
  const dayShift = Math.round(deltaMin / 1440);
  const newDur = diffMinutes(change.start, change.end);

  if (scope === 'all') {
    const newStart = change.allDay === series.allDay ? addMinutes(series.start, deltaMin, change.allDay) : change.start;
    const rec = patch.recurrence ?? shiftRecurrence(series.recurrence, dayShift);
    const updated: CalEvent = {
      ...series,
      ...patch,
      start: newStart,
      end: addMinutes(newStart, newDur, change.allDay),
      allDay: change.allDay,
      recurrence: rec,
      // Ausnahmen passen nach Zeitverschiebung nicht mehr
      exdates: deltaMin === 0 ? series.exdates : [],
    };
    const overrides = allEvents.filter((e) => e.seriesId === series.id).map((e) => e.id);
    return { put: [updated], del: deltaMin === 0 ? [] : overrides };
  }

  // scope === 'following': Serie abschneiden und neue Serie ab hier
  const prevDay = addDays(occStart.slice(0, 10), -1);
  let newEnd = series.recurrence.end;
  if (series.recurrence.end.type === 'count') {
    newEnd = { type: 'count', count: Math.max(1, series.recurrence.end.count - countBefore(series, occStart)) };
  }
  const truncated: CalEvent = {
    ...series,
    recurrence: { ...series.recurrence, end: { type: 'until', until: prevDay } },
    exdates: (series.exdates ?? []).filter((x) => x < occStart),
  };
  if (series.recurrence.end.type === 'count') {
    truncated.recurrence = { ...series.recurrence, end: { type: 'count', count: countBefore(series, occStart) } };
  }
  // Wiederholung im Dialog unverändert gelassen? Dann gilt sie als „nicht geändert“ (Restanzahl übernehmen)
  const recChanged = !!patch.recurrence && JSON.stringify(patch.recurrence) !== JSON.stringify(series.recurrence);
  const baseRec = recChanged ? patch.recurrence! : shiftRecurrence(series.recurrence, dayShift);
  const next: CalEvent = {
    ...series,
    ...patch,
    id: newId(),
    start: change.start,
    end: change.end,
    allDay: change.allDay,
    recurrence: { ...baseRec, end: recChanged ? baseRec.end : newEnd },
    exdates: (series.exdates ?? []).filter((x) => x >= occStart).map((x) => addMinutes(x, deltaMin)),
  };
  const overridesAfter = allEvents.filter((e) => e.seriesId === series.id && (e.originalStart ?? '') >= occStart);
  return {
    put: [truncated, next, ...overridesAfter.map((o) => ({ ...o, seriesId: next.id, originalStart: addMinutes(o.originalStart!, deltaMin) }))],
    del: [],
  };
}

/** Löschen eines Vorkommens */
export function applyDelete(series: CalEvent, occStart: string, scope: Scope, allEvents: CalEvent[]): Mutation {
  if (!series.recurrence) {
    // Ausnahme einer Serie: Vorkommen bleibt in der Serie ausgelassen
    return { put: [], del: [series.id] };
  }
  if (scope === 'following' && isFirstOccurrence(series, occStart)) scope = 'all';
  const overrides = allEvents.filter((e) => e.seriesId === series.id);
  if (scope === 'all') return { put: [], del: [series.id, ...overrides.map((o) => o.id)] };
  if (scope === 'one') return { put: [{ ...series, exdates: [...new Set([...(series.exdates ?? []), occStart])] }], del: [] };
  const truncated: CalEvent = {
    ...series,
    recurrence: { ...series.recurrence, end: { type: 'until', until: addDays(occStart.slice(0, 10), -1) } },
  };
  return {
    put: [truncated],
    del: overrides.filter((o) => (o.originalStart ?? '') >= occStart).map((o) => o.id),
  };
}
