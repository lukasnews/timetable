import { describe, expect, it } from 'vitest';
import { nextCountdowns } from '../countdown';
import { findConflicts } from '../conflicts';
import { displayTitle } from '../categories';
import { digest } from '../../../reminders/core';
import type { CalEvent, Person, Timetable } from '../../types';

const P = (id: string, extra: Partial<Person> = {}): Person => ({ id, name: id, color: '#000', avatar: { style: 'adventurer', seed: id }, order: 0, ...extra });

describe('Countdown', () => {
  it('nächste Ferien und markierte Termine, sortiert', () => {
    const urlaub: CalEvent = { id: 'u', title: 'Urlaub Kroatien', start: '2026-12-01', end: '2026-12-08', allDay: true, personIds: [], countdown: true };
    const c = nextCountdowns([urlaub], '2026-11-14', true, 2);
    expect(c).toEqual([
      { title: 'Urlaub Kroatien', date: '2026-12-01', days: 17 },
      { title: 'Weihnachtsferien', date: '2026-12-24', days: 40 },
    ]);
    expect(nextCountdowns([urlaub], '2026-11-14', false, 2)).toHaveLength(1);
  });
  it('während laufender Ferien keine Ferien-Anzeige', () => {
    expect(nextCountdowns([], '2026-12-28', true)).toEqual([]);
  });
});

describe('Abwesenheit', () => {
  const reise: CalEvent = { id: 'r', title: 'Dienstreise', start: '2026-11-18', end: '2026-11-21', allDay: true, personIds: ['papa'], absent: true };
  it('Termin während Abwesenheit → Hinweis', () => {
    const c = findConflicts({ id: 'n', title: 'Elternabend', start: '2026-11-19T19:00', end: '2026-11-19T20:00', allDay: false, personIds: ['papa'] }, [reise], [P('papa')]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ absent: true, title: 'abwesend: Dienstreise' });
  });
  it('am Tag nach der Abwesenheit kein Hinweis', () => {
    expect(findConflicts({ id: 'n', title: 'X', start: '2026-11-21T09:00', end: '2026-11-21T10:00', allDay: false, personIds: ['papa'] }, [reise], [P('papa')])).toHaveLength(0);
  });
  it('Titel-Symbole', () => {
    expect(displayTitle(reise)).toBe('🧳 Dienstreise');
    expect(displayTitle({ title: 'Zahnarzt', category: 'arzt' })).toBe('🩺 Zahnarzt');
    expect(displayTitle({ title: 'Oma', kind: 'birthday', category: 'arzt' })).toBe('🎂 Oma');
  });
});

describe('Tagesübersicht mit Mitbringen', () => {
  const lena = P('lena', { hasTimetable: true, ntfyTopic: 'lena' });
  const mama = P('mama', { ntfyTopic: 'mama' });
  const tt: Timetable = { id: 'lena', showInCalendar: true, lessons: [
    { id: 'l1', weekday: 1, start: '08:00', end: '08:50', subject: 'Turnen', bring: 'Turnsachen' },
    { id: 'l2', weekday: 1, start: '09:00', end: '09:50', subject: 'Deutsch' },
  ] };
  it('Dienstag: Turnsachen für Lena und Mama, Mittwoch nichts', () => {
    const tue = digest({ events: [], persons: [lena, mama], from: '2026-11-17', days: 1, title: 'Heute', timetables: [tt] });
    expect(tue.map((n) => n.topic).sort()).toEqual(['lena', 'mama']);
    expect(tue[0].message).toBe('🎒 lena: Turnsachen (Turnen)');
    expect(digest({ events: [], persons: [lena, mama], from: '2026-11-18', days: 1, title: 'Heute', timetables: [tt] })).toHaveLength(0);
  });
  it('schulfreier Tag: nichts mitbringen', () => {
    const frei: CalEvent = { id: 'f', title: 'Schulautonom', start: '2026-11-17', end: '2026-11-18', allDay: true, personIds: ['lena'], schoolFree: true };
    const r = digest({ events: [frei], persons: [lena, mama], from: '2026-11-17', days: 1, title: 'Heute', timetables: [tt] });
    expect(r.every((n) => !n.message.includes('Turnsachen'))).toBe(true);
  });
  it('Termin mit Mitbringen und Kategorie', () => {
    const ev: CalEvent = { id: 'g', title: 'Geburtstagsfeier Tim', start: '2026-11-18T15:00', end: '2026-11-18T18:00', allDay: false, personIds: ['lena'], category: 'feier', bring: 'Geschenk' };
    const r = digest({ events: [ev], persons: [lena, mama], from: '2026-11-18', days: 1, title: 'Heute' });
    expect(r.find((n) => n.topic === 'lena')!.message).toBe('15:00 🎉 Geburtstagsfeier Tim (lena) 🎒 Geschenk');
  });
});

import { shareText } from '../share';
describe('Termin teilen', () => {
  it('Text mit Datum, Personen, Ort, Mitbringen und Fahrdienst', () => {
    const persons = [{ id: 'l', name: 'Lena', color: '#f00', avatar: { style: 'x', seed: 'l' }, order: 0 }, { id: 'm', name: 'Mama', color: '#0f0', avatar: { style: 'x', seed: 'm' }, order: 1 }];
    const ev = { id: 'e', title: 'Klavier', start: '2026-11-18T15:00', end: '2026-11-18T15:45', allDay: false, personIds: ['l'], driverIds: ['m'], location: 'Musikschule', bring: 'Notenheft', category: 'musik' };
    const t = shareText(ev, ev.start, ev.end, persons);
    expect(t).toBe('📅 🎵 Klavier\nMi., 18.11.2026, 15:00–15:45 Uhr\n👤 Lena\n📍 Musikschule\n🎒 Mitbringen: Notenheft\n🚗 Fahrdienst: Mama');
    expect(shareText({ ...ev, allDay: true, start: '2026-11-18', end: '2026-11-20' }, '2026-11-18', '2026-11-20', persons).split('\n')[1]).toBe('Mi., 18.11.2026 – Do., 19.11.2026');
  });
});
