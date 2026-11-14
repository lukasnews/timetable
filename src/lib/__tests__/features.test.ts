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
