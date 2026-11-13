import type { CalEvent, Lesson, Person, Timetable } from '../types';
import { addDays, todayLocal, weekdayMo0, uid } from '../lib/dates';
import type { LocalStore } from './localStore';

/** Beispiel-Familie beim allerersten Start (kann in den Einstellungen gelöscht werden) */
export function seedDemo(store: LocalStore) {
  const persons: Person[] = [
    { id: 'papa', name: 'Papa', color: '#3b82f6', avatar: { style: 'adventurer', seed: 'papa-42' }, order: 0 },
    { id: 'mama', name: 'Mama', color: '#ec4899', avatar: { style: 'adventurer', seed: 'mama-7' }, order: 1 },
    { id: 'lena', name: 'Lena', color: '#f59e0b', avatar: { style: 'bigSmile', seed: 'lena-3' }, birthday: '2016-05-12', hasTimetable: true, order: 2 },
    { id: 'max', name: 'Max', color: '#10b981', avatar: { style: 'bigSmile', seed: 'max-9' }, birthday: '2019-09-03', hasTimetable: true, order: 3 },
  ];
  persons.forEach((p) => store.put('persons', p));

  const today = todayLocal();
  const monday = addDays(today, -weekdayMo0(today));
  const at = (dayOffset: number, time: string) => `${addDays(monday, dayOffset)}T${time}`;
  const events: CalEvent[] = [
    { id: uid(), title: 'Fußballtraining', start: at(1, '16:00'), end: at(1, '17:30'), allDay: false, personIds: ['max'], location: 'Sportplatz',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 3], end: { type: 'never' } } },
    { id: uid(), title: 'Klavier', start: at(2, '15:00'), end: at(2, '15:45'), allDay: false, personIds: ['lena'],
      recurrence: { freq: 'weekly', interval: 2, end: { type: 'never' } } },
    { id: uid(), title: 'Yoga', start: at(0, '19:00'), end: at(0, '20:00'), allDay: false, personIds: ['mama'],
      recurrence: { freq: 'weekly', interval: 1, end: { type: 'never' } } },
    { id: uid(), title: 'Elternabend', start: at(3, '19:00'), end: at(3, '20:30'), allDay: false, personIds: ['papa', 'mama'], location: 'Volksschule' },
    { id: uid(), title: 'Zahnarzt', start: at(4, '08:30'), end: at(4, '09:00'), allDay: false, personIds: ['lena', 'mama'] },
    { id: uid(), title: 'Ausflug zu Oma', start: addDays(monday, 5), end: addDays(monday, 7), allDay: true, personIds: [] },
    { id: uid(), title: 'Müll (Restabfall)', start: addDays(monday, 2), end: addDays(monday, 3), allDay: true, personIds: [],
      recurrence: { freq: 'weekly', interval: 2, end: { type: 'never' } } },
  ];
  events.forEach((e) => store.put('events', e));

  const lessons = (subjects: string[][], ends: string[]): Lesson[] => {
    const starts = ['07:50', '08:45', '09:50', '10:45', '11:40', '12:35'];
    const ends2 = ['08:40', '09:35', '10:40', '11:35', '12:30', '13:25'];
    const out: Lesson[] = [];
    subjects.forEach((day, wd) => day.forEach((s, i) => {
      if (s && starts[i] < ends[wd]) out.push({ id: uid(), weekday: wd, start: starts[i], end: ends2[i], subject: s });
    }));
    return out;
  };
  const tts: Timetable[] = [
    { id: 'lena', showInCalendar: true, lessons: lessons([
      ['Deutsch', 'Mathematik', 'Englisch', 'Sachunterricht', 'Turnen'],
      ['Mathematik', 'Deutsch', 'Religion', 'Musik', 'Werken', 'Werken'],
      ['Deutsch', 'Sachunterricht', 'Mathematik', 'Zeichnen'],
      ['Englisch', 'Mathematik', 'Deutsch', 'Turnen', 'Turnen'],
      ['Deutsch', 'Mathematik', 'Religion', 'Sachunterricht'],
    ], ['13:30', '13:30', '12:00', '13:00', '12:00']) },
    { id: 'max', showInCalendar: true, lessons: lessons([
      ['Deutsch', 'Mathematik', 'Sachunterricht', 'Turnen'],
      ['Mathematik', 'Deutsch', 'Musik', 'Zeichnen'],
      ['Deutsch', 'Mathematik', 'Religion'],
      ['Deutsch', 'Sachunterricht', 'Mathematik', 'Turnen'],
      ['Mathematik', 'Deutsch', 'Werken'],
    ], ['12:00', '12:00', '11:00', '12:00', '11:00']) },
  ];
  tts.forEach((t) => store.put('timetables', t));
}
