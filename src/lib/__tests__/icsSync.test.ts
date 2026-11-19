import { describe, expect, it } from 'vitest';
import { planSync, reminderFor, staleImports } from '../icsSync';
import { isKidDayOff } from '../calendarEvents';
import type { CalEvent, IcsSource } from '../../types';

const ev = (id: string, start: string, extra: Partial<CalEvent> = {}): CalEvent => ({ id, title: 'Restmüll', start, end: start, allDay: true, personIds: [], ...extra });
const src: IcsSource = { id: 's', name: 'Müll', personIds: [], evening: '19:00', futureOnly: true };

describe('Importierte Kalender', () => {
  it('Vorabend-Erinnerung', () => {
    // 19:00 am Vortag bis 08:00 = 13 h
    expect(reminderFor({ allDay: true, start: '2026-11-20' }, src)).toBe(780);
    // mit Uhrzeit 07:30: 19:00 Vortag → 12,5 h
    expect(reminderFor({ allDay: false, start: '2026-11-20T07:30' }, src)).toBe(750);
    expect(reminderFor({ allDay: true, start: '2026-11-20' }, { reminder: null, evening: null })).toBeNull();
  });
  it('Abgleich schreibt nur Änderungen und entfernt fehlende künftige Termine', () => {
    const parsed = [ev('a', '2026-11-20', { end: '2026-11-21' }), ev('b', '2026-11-27', { end: '2026-11-28' })];
    const first = planSync(parsed, [], src, '2026-11-15');
    expect(first.put.length).toBe(2);
    // aus Firestore zurück (null statt fehlend, andere Schlüsselreihenfolge)
    const stored = first.put.map((e) => ({ ...e, notes: null as unknown as undefined, updatedAt: 1 }));
    const again = planSync(parsed, [...stored, ev('old', '2026-12-04', { end: '2026-12-05', importSource: 'Müll' }), ev('past', '2026-10-01', { end: '2026-10-02', importSource: 'Müll' })], src, '2026-11-15');
    expect(again.put).toEqual([]);
    expect(again.del).toEqual(['old']);
    const changed = planSync(parsed, stored, { ...src, evening: '20:00' }, '2026-11-15');
    expect(changed.put.length).toBe(2);
  });
  it('Schulautonome Tage', () => {
    const tt = { freeDays: [{ start: '2026-12-07', end: '2026-12-07' }, { start: '2027-02-01', end: '2027-02-03' }] };
    expect(isKidDayOff(tt, '2026-12-07')).toBe(true);
    expect(isKidDayOff(tt, '2027-02-02')).toBe(true);
    expect(isKidDayOff(tt, '2026-12-08')).toBe(false);
  });
});

describe('Aufräumen alter Importe', () => {
  it('löscht nur importierte Einzeltermine älter als ein Jahr', () => {
    const evs = [
      { id: 'alt', importSource: 'muell', end: '2025-11-10' },
      { id: 'neu', importSource: 'muell', end: '2025-12-01' },
      { id: 'eigen', end: '2024-01-01' },
      { id: 'serie', importSource: 'muell', end: '2024-01-01', recurrence: { freq: 'weekly' } },
    ];
    expect(staleImports(evs, '2026-11-19')).toEqual(['alt']);
  });
});
