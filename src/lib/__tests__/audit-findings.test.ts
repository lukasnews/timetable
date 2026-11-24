import { describe, expect, it } from 'vitest';
import { applyChange, expand } from '../recurrence';
import { parseQuick } from '../quickAdd';
import { parseICS, toICS } from '../ics';
import { plannedReminders } from '../../native';
import { digest, dueNotifications } from '../../../reminders/core';
import type { CalEvent, Person } from '../../types';

let n = 0;
const id = () => 'n' + ++n;
const weekly: CalEvent = { id: 's', title: 'Turnen', start: '2026-01-05T10:00', end: '2026-01-05T11:00', allDay: false, personIds: [],
  recurrence: { freq: 'weekly', interval: 1, byWeekday: [0], end: { type: 'never' } } };

describe('Prüfbericht: Zeit/Serien', () => {
  it('expand: Ende des Bereichs gehört nicht dazu', () => {
    const daily: CalEvent = { id: 'd', title: 'X', start: '2026-11-01', end: '2026-11-02', allDay: true, personIds: [], recurrence: { freq: 'daily', interval: 1, end: { type: 'never' } } };
    expect(expand([daily], '2026-11-24', '2026-11-25').map((o) => o.start)).toEqual(['2026-11-24']);
  });
  it('lange Erinnerungen (4 Wochen vorher) werden geplant und verschickt', () => {
    const ev: CalEvent = { id: 'e', title: 'Fest', start: '2026-12-22T10:00', end: '2026-12-22T11:00', allDay: false, personIds: [], reminderMinutes: 4 * 10080 };
    expect(plannedReminders([ev], [], { reminderPersons: [] }, '2026-11-20T08:00').map((p) => p.at)).toEqual(['2026-11-24T10:00']);
    const persons = [{ id: 'm', name: 'Mama', color: '#f00', ntfyTopic: 'fk-m' }] as Person[];
    expect(dueNotifications({ events: [ev], persons, from: '2026-11-24T09:55', to: '2026-11-24T10:00', sent: new Set() })).toHaveLength(1);
  });
  it('Serie „alle“ eine Stunde später: gelöschte Vorkommen bleiben gelöscht, Einzeländerungen bleiben', () => {
    const s = { ...weekly, exdates: ['2026-03-02T10:00', '2026-03-09T10:00'] };
    const ov: CalEvent = { ...weekly, id: 'o', recurrence: undefined, seriesId: 's', originalStart: '2026-03-09T10:00', start: '2026-03-09T12:00', end: '2026-03-09T13:00', title: 'Turnen spät' };
    const m = applyChange(s, '2026-02-23T10:00', { start: '2026-02-23T11:00', end: '2026-02-23T12:00', allDay: false }, 'all', [s, ov], id);
    expect(m.del).toEqual([]);
    const all = [...m.put];
    const occ = expand(all, '2026-02-28', '2026-03-15').map((o) => o.start);
    expect(occ).toEqual(['2026-03-09T12:00']); // 02.03. gelöscht, 09.03. als Einzeländerung
  });
  it('Serie „alle“ auf ganztägig: Serienbeginn bleibt', () => {
    const m = applyChange(weekly, '2026-11-23T10:00', { start: '2026-11-23', end: '2026-11-24', allDay: true }, 'all', [weekly], id);
    expect(m.put[0].start).toBe('2026-01-05');
    expect(expand(m.put, '2026-01-01', '2026-01-20').map((o) => o.start)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
  });
  it('Serie „alle“ früher beenden: Einzeländerungen danach werden entfernt', () => {
    const ov: CalEvent = { ...weekly, id: 'o', recurrence: undefined, seriesId: 's', originalStart: '2026-06-01T10:00', start: '2026-06-01T12:00', end: '2026-06-01T13:00' };
    const m = applyChange(weekly, '2026-01-05T10:00', { start: '2026-01-05T10:00', end: '2026-01-05T11:00', allDay: false,
      patch: { recurrence: { ...weekly.recurrence!, end: { type: 'until', until: '2026-03-31' } } } }, 'all', [weekly, ov], id);
    expect(m.del).toEqual(['o']);
  });
  it('Schnelleingabe über Mitternacht liefert kein Ende vor Beginn', () => {
    const q = parseQuick('Feier 20 bis 1 Uhr', [], '2026-11-24');
    expect(!q.end || q.end > (q.start ?? '')).toBe(true);
    expect(parseQuick('Party 17 bis 24 Uhr', [], '2026-11-24').end).toBe('23:59');
  });
  it('ICS: komplexe Serie mit UNTIL in UTC behält das letzte Vorkommen', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Treff\r\nDTSTART;TZID=Europe/Vienna:20261102T190000\r\nDTEND;TZID=Europe/Vienna:20261102T200000\r\nRRULE:FREQ=MONTHLY;BYDAY=1MO,3MO;UNTIL=20261207T180000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const ev = parseICS(ics, { source: 'T', timezone: 'Europe/Vienna', expandUntil: '2027-06-01' }).events;
    expect(ev.map((e) => e.start)).toEqual(['2026-11-02T19:00', '2026-11-16T19:00', '2026-12-07T19:00']);
  });
  it('ICS: „letzter Freitag“ wird nicht zum 4. Freitag', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:y\r\nSUMMARY:Stammtisch\r\nDTSTART;VALUE=DATE:20260227\r\nDTEND;VALUE=DATE:20260228\r\nRRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=4\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const ev = parseICS(ics, { source: 'T', timezone: 'Europe/Vienna', expandUntil: '2027-01-01' }).events;
    expect(expand(ev, '2026-05-01', '2026-06-01').map((o) => o.start)).toEqual(['2026-05-29']);
  });
  it('ICS-Export: Erinnerung ganztägiger Termine ab 08:00', () => {
    const ev: CalEvent = { id: 'g', title: 'Müll', start: '2026-12-01', end: '2026-12-02', allDay: true, personIds: [], reminderMinutes: 840, extraReminders: [0] };
    const t = toICS([ev], []);
    expect(t).toContain('TRIGGER:-PT360M'); // Vorabend 18:00
    expect(t).toContain('TRIGGER:PT480M'); // am Tag 08:00
  });
  it('Wochenübersicht nach Tagen sortiert, ohne 8. Tag', () => {
    const fri: CalEvent = { id: 'f', title: 'Freitag ganztags', start: '2026-12-04', end: '2026-12-05', allDay: true, personIds: [] };
    const tue: CalEvent = { id: 't', title: 'Dienstag', start: '2026-12-01T09:00', end: '2026-12-01T10:00', allDay: false, personIds: [] };
    const persons = [{ id: 'l', name: 'Lena', color: '#f00', ntfyTopic: 'fk-l', birthday: '2015-12-07' }] as Person[];
    const msg = digest({ events: [fri, tue], persons, from: '2026-11-30', days: 7, title: 'Woche' })[0].message;
    expect(msg.indexOf('Dienstag')).toBeLessThan(msg.indexOf('Freitag'));
    expect(msg).not.toContain('Lena');
  });
  it('Geburtstag am 29.02.: in anderen Jahren am 28.02. erinnern', () => {
    const p = [{ id: 'k', name: 'Kim', color: '#f00', birthday: '2012-02-29', birthdayReminder: 0 }] as Person[];
    expect(plannedReminders([], p, { reminderPersons: [] }, '2027-02-20T08:00').map((x) => x.at)).toEqual(['2027-02-28T08:00']);
  });
});
