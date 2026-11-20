import { describe, expect, it } from 'vitest';
import { plannedReminders } from '../../native';
import type { CalEvent, Person } from '../../types';

const P = (id: string, name: string, extra: Partial<Person> = {}): Person => ({ id, name, color: '#000', avatar: { style: 'x', seed: id }, order: 0, ...extra });
const persons = [P('m', 'Mama'), P('l', 'Lena', { birthday: '2016-11-20', birthdayReminder: 0 })];
const ev = (p: Partial<CalEvent>): CalEvent => ({ id: 'e', title: 'Zahnarzt', start: '2026-11-16T10:00', end: '2026-11-16T10:30', allDay: false, personIds: ['m'], reminderMinutes: 60, category: 'arzt', ...p });

describe('Erinnerungen am Gerät', () => {
  it('plant künftige Erinnerungen mit Text, ohne vergangene', () => {
    const plan = plannedReminders([ev({}), ev({ id: 'alt', start: '2026-11-15T08:00', end: '2026-11-15T09:00' })], persons, { reminderPersons: [] }, '2026-11-15T12:00');
    const z = plan.find((n) => n.title === '🩺 Zahnarzt')!;
    expect(z.at).toBe('2026-11-16T09:00');
    expect(z.body).toBe('Heute, 10:00 Uhr · Mama');
    expect(plan.some((n) => n.title.includes('Zahnarzt') && n.at < '2026-11-15T12:00')).toBe(false);
    expect(plan.find((n) => n.title.startsWith('🎂'))).toMatchObject({ title: '🎂 Lena wird 10', at: '2026-11-20T08:00' });
  });
  it('Personenfilter, Familientermine bleiben', () => {
    const evs = [ev({}), ev({ id: 'f', title: 'Müll', personIds: [], allDay: true, start: '2026-11-17', end: '2026-11-18', category: undefined, reminderMinutes: 780 })];
    const plan = plannedReminders(evs, persons, { reminderPersons: ['l'] }, '2026-11-15T12:00');
    expect(plan.map((n) => n.title)).toEqual(['Müll', '🎂 Lena wird 10']);
    expect(plan[0]).toMatchObject({ at: '2026-11-16T19:00', body: 'Morgen, ganztägig' });
  });
});

describe('Widget', () => {
  it('nächste Termine: Vergangenes weg, Ganztägiges zuerst, Geburtstag mit Alter', async () => {
    const { widgetItems } = await import('../../native');
    const evs = [
      ev({ id: 'a', start: '2026-11-15T09:00', end: '2026-11-15T10:00', title: 'Vorbei' }),
      ev({ id: 'b', start: '2026-11-15T15:00', end: '2026-11-15T16:00', title: 'Klavier', category: 'musik', personIds: ['l'] }),
      ev({ id: 'c', start: '2026-11-15', end: '2026-11-16', allDay: true, title: 'Ausflug', personIds: [], category: undefined }),
    ];
    const items = widgetItems(evs, persons, '2026-11-15T12:00');
    expect(items.map((i) => i.title)).toEqual(['Ausflug', '🎵 Klavier', '🎂 Lena wird 10']);
    expect(items[1]).toMatchObject({ date: '2026-11-15', time: '15:00', who: 'Lena', color: '#000' });
    expect(items[0]).toMatchObject({ time: '', end: '2026-11-16T00:00', color: '#94a3b8' });
  });
});

import { plannedDigests } from '../../native';
describe('Tages- und Wochenübersicht am Gerät', () => {
  const persons = [{ id: 'l', name: 'Lena', color: '#f00', avatar: { style: 'adventurer', seed: 'x' }, order: 0 }] as never[];
  const e = (id: string, start: string, end: string, extra = {}) => ({ id, title: id, start, end, allDay: !start.includes('T'), personIds: ['l'], ...extra }) as never;
  const evs = [e('Zahnarzt', '2026-11-16T08:30', '2026-11-16T09:00'), e('Ausflug', '2026-11-21', '2026-11-23'), e('Turnen', '2026-11-18T15:00', '2026-11-18T16:00')];
  it('Tagesübersicht nur an Tagen mit Terminen, zur eingestellten Uhrzeit', () => {
    const d = plannedDigests(evs, persons, { reminderPersons: [], dailyDigest: '06:30' }, '2026-11-15T20:00');
    expect(d.map((x) => x.at)).toEqual(['2026-11-16T06:30', '2026-11-18T06:30', '2026-11-21T06:30', '2026-11-22T06:30']);
    expect(d[0].title).toBe('Heute: 1 Termin');
    expect(d[0].body).toBe('08:30 Zahnarzt (Lena)');
    expect(d[2].body).toBe('ganztägig Ausflug (Lena)');
  });
  it('Wochenübersicht Sonntag 18:00 mit den Terminen der nächsten Woche', () => {
    const d = plannedDigests(evs, persons, { reminderPersons: [], weeklyDigest: true }, '2026-11-15T12:00');
    expect(d[0].at).toBe('2026-11-15T18:00');
    expect(d[0].title).toBe('Nächste Woche: 4 Termine');
    expect(d[0].largeBody).toBe('Mo 08:30 Zahnarzt (Lena)\nMi 15:00 Turnen (Lena)\nSa ganztägig Ausflug (Lena)\nSo ganztägig Ausflug (Lena)');
  });
  it('aus = nichts geplant', () => {
    expect(plannedDigests(evs, persons, { reminderPersons: [] }, '2026-11-15T12:00')).toEqual([]);
  });
});

import { parsePendingDate } from '../../native';
describe('Zeitpunkt aus Android lesen', () => {
  it('Javas Date.toString mit „CET“ als Ortszeit (nicht UTC)', () => {
    const d = parsePendingDate('Fri Nov 20 17:25:00 CET 2026')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 20, 17, 25]);
    expect(parsePendingDate('Sun Jul 05 08:00:00 GMT+02:00 2026')!.getHours()).toBe(8);
    expect(parsePendingDate('2026-11-20T16:25:00.000Z')!.toISOString()).toBe('2026-11-20T16:25:00.000Z');
    expect(parsePendingDate(undefined)).toBeNull();
  });
});
