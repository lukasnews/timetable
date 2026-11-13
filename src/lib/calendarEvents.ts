import type { EventInput } from '@fullcalendar/core';
import type { CalEvent, Person, Timetable, Lesson } from '../types';
import { expand } from './recurrence';
import { addDays, isoWeek, weekdayMo0 } from './dates';
import { holidaysAT, rangesBetween, schoolHolidaysOOE, isSchoolFree } from './holidays';

export interface OccProps {
  kind: 'event' | 'birthday' | 'personBirthday' | 'school' | 'holiday' | 'ferien';
  eventId?: string;
  occStart?: string;
  recurring?: boolean;
  personIds: string[];
  location?: string;
  age?: number;
}

/** Ist ein Termin bei gewählten Personen sichtbar? Termine ohne Person = ganze Familie, immer sichtbar */
export function visibleFor(personIds: string[], selected: Set<string>, allPersons: Person[]): boolean {
  const known = personIds.filter((id) => allPersons.some((p) => p.id === id));
  if (known.length === 0) return true;
  return known.some((id) => selected.has(id));
}

export function lessonsForDay(tt: Timetable, day: string): Lesson[] {
  const wd = weekdayMo0(day);
  let weekType: 'A' | 'B' | undefined;
  if (tt.abWeeks) {
    const even = isoWeek(day) % 2 === 0;
    weekType = even ? (tt.evenWeekIs ?? 'A') : (tt.evenWeekIs === 'B' ? 'A' : 'B');
  }
  return tt.lessons
    .filter((l) => l.weekday === wd && (!l.week || !weekType || l.week === weekType))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export function buildEvents(opts: {
  events: CalEvent[];
  persons: Person[];
  timetables: Timetable[];
  selected: Set<string>;
  from: string; // YYYY-MM-DD
  to: string;
  showHolidays: boolean;
  showSchoolHolidays: boolean;
  showSchool: boolean;
}): EventInput[] {
  const { events, persons, timetables, selected, from, to } = opts;
  const out: EventInput[] = [];
  const byId = new Map(persons.map((p) => [p.id, p]));

  for (const occ of expand(events, from, to)) {
    const ev = occ.event;
    if (!visibleFor(ev.personIds, selected, persons)) continue;
    const isBirthday = ev.kind === 'birthday';
    const age = isBirthday && ev.birthYear ? Number(occ.start.slice(0, 4)) - ev.birthYear : undefined;
    const props: OccProps = {
      kind: isBirthday ? 'birthday' : 'event',
      eventId: ev.id,
      occStart: occ.occStart,
      recurring: occ.recurring,
      personIds: ev.personIds.filter((id) => byId.has(id)),
      location: ev.location,
      age,
    };
    out.push({
      id: `${ev.id}|${occ.occStart}`,
      title: ev.title,
      start: occ.start,
      end: occ.end,
      allDay: ev.allDay,
      extendedProps: props,
      classNames: isBirthday ? ['ev-birthday'] : [],
    });
  }

  // Geburtstage aus den Profilen
  for (const p of persons) {
    if (!p.birthday || !selected.has(p.id)) continue;
    const [by, bm, bd] = p.birthday.split('-');
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
      const d = `${y}-${bm}-${bd}`;
      if (d < from || d >= to) continue;
      out.push({
        id: `bday-${p.id}-${y}`,
        title: p.name,
        start: d,
        end: addDays(d, 1),
        allDay: true,
        editable: false,
        classNames: ['ev-birthday'],
        extendedProps: { kind: 'personBirthday', personIds: [p.id], age: y - Number(by) } satisfies OccProps,
      });
    }
  }

  if (opts.showHolidays) {
    for (const h of rangesBetween(from, to, holidaysAT)) {
      out.push({ id: `hol-${h.start}`, title: h.title, start: h.start, end: h.end, allDay: true, editable: false,
        classNames: ['ev-holiday'], extendedProps: { kind: 'holiday', personIds: [] } satisfies OccProps });
      out.push({ id: `holbg-${h.start}`, start: h.start, end: h.end, allDay: true, display: 'background', classNames: ['bg-holiday'] });
    }
  }
  if (opts.showSchoolHolidays) {
    for (const f of rangesBetween(from, to, schoolHolidaysOOE)) {
      out.push({ id: `fer-${f.start}`, title: f.title, start: f.start, end: f.end, allDay: true, display: 'background',
        classNames: ['bg-ferien'], extendedProps: { kind: 'ferien', personIds: [] } satisfies OccProps });
    }
  }

  // Schulzeiten (nur Beginn–Ende)
  if (opts.showSchool) {
    for (const tt of timetables) {
      const p = byId.get(tt.id);
      if (!p || !p.hasTimetable || !tt.showInCalendar || !selected.has(p.id)) continue;
      for (let d = from; d < to; d = addDays(d, 1)) {
        if (isSchoolFree(d)) continue;
        const ls = lessonsForDay(tt, d);
        if (!ls.length) continue;
        const start = ls.reduce((m, l) => (l.start < m ? l.start : m), ls[0].start);
        const end = ls.reduce((m, l) => (l.end > m ? l.end : m), ls[0].end);
        out.push({
          id: `school-${p.id}-${d}`,
          title: 'Schule',
          start: `${d}T${start}`,
          end: `${d}T${end}`,
          editable: false,
          classNames: ['ev-school'],
          extendedProps: { kind: 'school', personIds: [p.id] } satisfies OccProps,
        });
      }
    }
  }
  return out;
}
