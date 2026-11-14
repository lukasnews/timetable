import { describe as d, expect, it } from 'vitest';
import { applyChange, applyDelete, describe, expand } from '../recurrence';
import { holidaysAT, schoolHolidaysOOE, isSchoolFree } from '../holidays';
import type { CalEvent } from '../../types';

let n = 0;
const id = () => 'new' + ++n;
const weekly: CalEvent = {
  id: 's', title: 'Training', start: '2026-11-03T16:00', end: '2026-11-03T17:30', allDay: false, personIds: [],
  recurrence: { freq: 'weekly', interval: 1, end: { type: 'never' } },
};

d('Wiederholungen', () => {
  it('expandiert wöchentlich', () => {
    const o = expand([weekly], '2026-11-01', '2026-12-01');
    expect(o.map((x) => x.start)).toEqual(['2026-11-03T16:00', '2026-11-10T16:00', '2026-11-17T16:00', '2026-11-24T16:00']);
  });
  it('jeden 2. Dienstag (alle 2 Wochen)', () => {
    const e = { ...weekly, recurrence: { freq: 'weekly' as const, interval: 2, end: { type: 'never' as const } } };
    expect(expand([e], '2026-11-01', '2026-12-01').map((x) => x.start.slice(0, 10))).toEqual(['2026-11-03', '2026-11-17']);
  });
  it('2. Dienstag im Monat', () => {
    const e: CalEvent = { ...weekly, start: '2026-11-10T19:00', end: '2026-11-10T20:00', recurrence: { freq: 'monthly', interval: 1, monthlyMode: 'nthWeekday', end: { type: 'never' } } };
    expect(expand([e], '2026-11-01', '2027-02-01').map((x) => x.start.slice(0, 10))).toEqual(['2026-11-10', '2026-12-08', '2027-01-12']);
    expect(describe(e.start, e.recurrence)).toBe('Jeden Monat am 2. Dienstag');
  });
  it('nur dieser Termin verschieben', () => {
    const m = applyChange(weekly, '2026-11-10T16:00', { start: '2026-11-11T16:00', end: '2026-11-11T17:30', allDay: false }, 'one', [weekly], id);
    const all = m.put;
    const o = expand(all, '2026-11-01', '2026-12-01').map((x) => x.start);
    expect(o).toContain('2026-11-11T16:00');
    expect(o).not.toContain('2026-11-10T16:00');
    expect(o).toHaveLength(4);
  });
  it('dieser und folgende', () => {
    const m = applyChange(weekly, '2026-11-17T16:00', { start: '2026-11-18T17:00', end: '2026-11-18T18:30', allDay: false }, 'following', [weekly], id);
    const o = expand(m.put, '2026-11-01', '2026-12-01').map((x) => x.start);
    expect(o).toEqual(['2026-11-03T16:00', '2026-11-10T16:00', '2026-11-18T17:00', '2026-11-25T17:00']);
  });
  it('alle verschieben ändert Wochentag', () => {
    const m = applyChange(weekly, '2026-11-10T16:00', { start: '2026-11-12T16:00', end: '2026-11-12T18:00', allDay: false }, 'all', [weekly], id);
    const o = expand(m.put, '2026-11-01', '2026-11-20').map((x) => x.start + '-' + x.end.slice(11));
    expect(o).toEqual(['2026-11-05T16:00-18:00', '2026-11-12T16:00-18:00', '2026-11-19T16:00-18:00']);
  });
  it('löschen einzeln', () => {
    const m = applyDelete(weekly, '2026-11-10T16:00', 'one', [weekly]);
    expect(expand(m.put, '2026-11-01', '2026-12-01')).toHaveLength(3);
  });
});

d('Feiertage/Ferien OÖ', () => {
  it('Ostern 2026', () => {
    expect(holidaysAT(2026).find((h) => h.title === 'Ostermontag')?.start).toBe('2026-04-06');
  });
  it('Semester- und Sommerferien OÖ 2026', () => {
    const f = schoolHolidaysOOE(2026);
    expect(f.find((x) => x.title === 'Semesterferien')).toMatchObject({ start: '2026-02-14', end: '2026-02-23' });
    expect(f.find((x) => x.title === 'Sommerferien')).toMatchObject({ start: '2026-07-11', end: '2026-09-14' });
  });
  it('schulfrei', () => {
    expect(isSchoolFree('2026-11-13')).toBe(false);
    expect(isSchoolFree('2026-10-28')).toBe(true);
    expect(isSchoolFree('2026-12-08')).toBe(true);
  });
});

import { parseFamilyInput } from '../../data/store';
d('Familien-Link erkennen', () => {
  const id = 'abcdefghijkmnpqrst2';
  const b64 = btoa(JSON.stringify({ familyId: id }));
  it('ID, Link, nur Teil nach join=', () => {
    expect(parseFamilyInput(id)).toBe(id);
    expect(parseFamilyInput(`https://timetable.chaoten.online/#join=${b64}`)).toBe(id);
    expect(parseFamilyInput(b64)).toBe(id);
    expect(parseFamilyInput('Unsinn')).toBeNull();
  });
});
