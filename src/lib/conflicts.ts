import type { CalEvent, Person } from '../types';
import { expand } from './recurrence';
import { addDays } from './dates';

export interface Conflict {
  person: Person;
  title: string;
  start: string;
  end: string;
  absent?: boolean;
}

/**
 * Überschneidungen eines Termins (erstes Vorkommen) mit anderen Terminen derselben Personen.
 * Fahrdienst zählt mit. Ganztägige Termine und Geburtstage zählen nicht als Konflikt.
 */
export function findConflicts(draft: CalEvent, events: CalEvent[], persons: Person[], ignoreIds: string[] = []): Conflict[] {
  if (draft.allDay || draft.kind === 'birthday') return [];
  const mine = new Set([...draft.personIds, ...(draft.driverIds ?? [])]);
  if (!mine.size) return [];
  const skip = new Set([draft.id, ...ignoreIds]);
  const others = events.filter((e) => !skip.has(e.id) && !(e.seriesId && skip.has(e.seriesId)) && (!e.allDay || e.absent) && e.kind !== 'birthday');
  const day = draft.start.slice(0, 10);
  const out: Conflict[] = [];
  for (const o of expand(others, addDays(day, -1), addDays(draft.end.slice(0, 10), 1))) {
    // Ganztägige Abwesenheit: Ende ist exklusiv (Datum ohne Uhrzeit)
    const oStart = o.event.allDay ? `${o.start}T00:00` : o.start;
    const oEnd = o.event.allDay ? `${o.end}T00:00` : o.end;
    if (!(oStart < draft.end && oEnd > draft.start)) continue;
    // das eigene Vorkommen einer Serie (beim Bearbeiten „nur dieser“) nicht melden
    if (o.event.id === draft.seriesId && o.occStart === draft.originalStart) continue;
    for (const id of [...o.event.personIds, ...(o.event.driverIds ?? [])]) {
      if (!mine.has(id)) continue;
      const person = persons.find((p) => p.id === id);
      if (person && !out.some((c) => c.person.id === id && c.title === o.event.title && c.start === o.start)) {
        out.push({ person, title: o.event.absent ? `abwesend: ${o.event.title}` : o.event.title, start: o.start, end: o.end, absent: !!o.event.absent });
      }
    }
  }
  return out;
}
