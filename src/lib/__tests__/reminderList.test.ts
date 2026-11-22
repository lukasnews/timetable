import { describe, expect, it } from 'vitest';
import { reminderLabel, remindersOf, withReminders } from '../reminderList';
import { plannedReminders } from '../../native';
import { toICS } from '../ics';
import type { CalEvent } from '../../types';

const ev = (p: Partial<CalEvent>): CalEvent => ({ id: 'e', title: 'Zahnarzt', start: '2026-11-25T10:00', end: '2026-11-25T10:30', allDay: false, personIds: [], ...p });

describe('Mehrere Erinnerungen', () => {
  it('liest altes Feld + Zusatzliste, ohne Doppelte, größte zuerst', () => {
    expect(remindersOf({ reminderMinutes: 30, extraReminders: [5, 30, 15] })).toEqual([30, 15, 5]);
    expect(remindersOf({ reminderMinutes: null })).toEqual([]);
    expect(remindersOf({ reminderMinutes: 0 })).toEqual([0]);
  });
  it('speichert früheste im alten Feld (für ältere App-Versionen und den Dienst)', () => {
    expect(withReminders([5, 30])).toEqual({ reminderMinutes: 30, extraReminders: [5] });
    expect(withReminders([15])).toEqual({ reminderMinutes: 15, extraReminders: undefined });
    expect(withReminders([])).toEqual({ reminderMinutes: null, extraReminders: undefined });
  });
  it('Beschriftungen', () => {
    expect(reminderLabel(0)).toBe('Zum Beginn');
    expect(reminderLabel(45)).toBe('45 Minuten vorher');
    expect(reminderLabel(90)).toBe('1 Stunde 30 Minuten vorher');
    expect(reminderLabel(2880)).toBe('2 Tage vorher');
    expect(reminderLabel(840, true)).toBe('Am Vorabend, 18:00');
    expect(reminderLabel(10080, true)).toBe('1 Woche vorher, 08:00');
  });
  it('plant am Gerät jede Erinnerung einzeln (z. B. 30 und 5 Minuten vorher)', () => {
    const plan = plannedReminders([ev({ reminderMinutes: 30, extraReminders: [5] })], [], { reminderPersons: [] }, '2026-11-20T08:00');
    expect(plan.map((p) => p.at)).toEqual(['2026-11-25T09:30', '2026-11-25T09:55']);
    expect(new Set(plan.map((p) => p.id)).size).toBe(2);
  });
  it('eine Woche vorher wird auch geplant', () => {
    const plan = plannedReminders([ev({ start: '2026-11-30T10:00', end: '2026-11-30T11:00', reminderMinutes: 10080 })], [], { reminderPersons: [] }, '2026-11-20T08:00');
    expect(plan.map((p) => p.at)).toEqual(['2026-11-23T10:00']);
  });
  it('Export enthält einen Alarm je Erinnerung', () => {
    const ics = toICS([ev({ reminderMinutes: 45, extraReminders: [15] })], []);
    expect(ics.match(/BEGIN:VALARM/g)?.length).toBe(2);
    expect(ics).toContain('TRIGGER:-PT45M');
    expect(ics).toContain('TRIGGER:-PT15M');
  });
});

import { digest } from '../../../reminders/core';
import { plannedDigests } from '../../native';
import { timeOnDay } from '../dayLine';

describe('Termine über mehrere Tage in der Tagesübersicht', () => {
  const urlaub: CalEvent = { id: 'u', title: 'Urlaub', start: '2026-11-20', end: '2026-11-25', allDay: true, personIds: [] };
  const seminar: CalEvent = { id: 't', title: 'Seminar', start: '2026-11-21T09:00', end: '2026-11-23T17:00', allDay: false, personIds: [] };
  const persons = [{ id: 'm', name: 'Mama', color: '#f00', ntfyTopic: 'fk-m' } as never];
  it('Uhrzeit-Text je Tag', () => {
    const o = { start: seminar.start, end: seminar.end, event: seminar };
    expect([timeOnDay(o, '2026-11-21'), timeOnDay(o, '2026-11-22'), timeOnDay(o, '2026-11-23')]).toEqual(['ab 09:00', 'ganztägig', 'bis 17:00']);
  });
  it('App: an jedem Tag dabei, richtig beschriftet', () => {
    const plan = plannedDigests([urlaub, seminar], [], { reminderPersons: [], dailyDigest: '06:30' }, '2026-11-21T05:00');
    const day = (d: string) => plan.find((x) => x.at === `${d}T06:30`)?.largeBody;
    expect(day('2026-11-21')).toBe('ganztägig Urlaub\nab 09:00 Seminar');
    expect(day('2026-11-22')).toBe('ganztägig Urlaub\nganztägig Seminar');
    expect(day('2026-11-23')).toBe('ganztägig Urlaub\nbis 17:00 Seminar');
    expect(day('2026-11-25')).toBeUndefined();
  });
  it('ntfy: an jedem Tag dabei, richtig beschriftet', () => {
    const msg = (d: string) => digest({ events: [urlaub, seminar], persons, from: d, days: 1, title: 'Heute' })[0]?.message;
    expect(msg('2026-11-22')).toBe('Urlaub\nganztägig Seminar');
    expect(msg('2026-11-23')).toBe('Urlaub\nbis 17:00 Seminar');
    expect(msg('2026-11-24')).toBe('Urlaub');
  });
});
