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

import { sha256, hashPin } from '../pin';
import { createHash } from 'node:crypto';
d('PIN-Hash ohne Browser-Krypto', () => {
  it('eigene SHA-256 = Node-SHA-256', () => {
    for (const s of ['', 'abc', 'familienkalender:1234', 'x'.repeat(200)]) {
      const mine = [...sha256(new TextEncoder().encode(s))].map((b) => b.toString(16).padStart(2, '0')).join('');
      expect(mine).toBe(createHash('sha256').update(s).digest('hex'));
    }
  });
  it('hashPin liefert dasselbe wie vorher', async () => {
    expect(await hashPin('1234')).toBe(createHash('sha256').update('familienkalender:1234').digest('hex'));
  });
});

d('Serie teilen im Dialog', () => {
  it('Restanzahl bleibt erhalten, wenn die Wiederholung nicht geändert wurde', () => {
    const s: CalEvent = { ...weekly, recurrence: { freq: 'weekly', interval: 1, end: { type: 'count', count: 6 } } };
    const m = applyChange(s, '2026-11-17T16:00', { start: '2026-11-17T17:00', end: '2026-11-17T18:00', allDay: false, patch: { title: 'Neu', recurrence: s.recurrence } }, 'following', [s], id);
    const o = expand(m.put, '2026-11-01', '2027-03-01');
    expect(o).toHaveLength(6);
    expect(o.filter((x) => x.event.title === 'Neu')).toHaveLength(4);
  });
});

d('Schulferien OÖ laut Bildungsministerium (bmb.gv.at)', () => {
  // Erster und letzter freier Tag (Montag–Samstag laut Ministerium); die App zeigt die angrenzenden Wochenenden mit
  const inside = (y: number, title: string, first: string, last: string) => {
    const r = schoolHolidaysOOE(y).find((x) => x.title === title && x.start <= first && first < x.end)!;
    expect(r, `${title} ${y}`).toBeDefined();
    expect(r.start <= first && last < r.end).toBe(true);
  };
  it('2025/26', () => {
    inside(2026, 'Semesterferien', '2026-02-16', '2026-02-21');
    inside(2026, 'Osterferien', '2026-03-28', '2026-04-06');
    inside(2026, 'Pfingstferien', '2026-05-23', '2026-05-25');
    inside(2026, 'Sommerferien', '2026-07-11', '2026-09-13');
    inside(2025, 'Herbstferien', '2025-10-27', '2025-10-31');
    inside(2025, 'Weihnachtsferien', '2025-12-24', '2026-01-06');
  });
  it('2026/27', () => {
    inside(2027, 'Semesterferien', '2027-02-15', '2027-02-20');
    inside(2027, 'Osterferien', '2027-03-20', '2027-03-29');
    inside(2027, 'Pfingstferien', '2027-05-15', '2027-05-17');
    inside(2027, 'Sommerferien', '2027-07-10', '2027-09-12');
    inside(2026, 'Herbstferien', '2026-10-27', '2026-10-31');
    inside(2026, 'Weihnachtsferien', '2026-12-24', '2027-01-06');
    // erster Schultag nach den Sommerferien 2027 ist kein Ferientag mehr
    expect(schoolHolidaysOOE(2027).find((x) => x.title === 'Sommerferien')!.end).toBe('2027-09-13');
  });
});
