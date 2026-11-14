import { describe, expect, it } from 'vitest';
import { findConflicts } from '../conflicts';
import type { CalEvent, Person } from '../../types';

const P = (id: string): Person => ({ id, name: id, color: '#000', avatar: { style: 'adventurer', seed: id }, order: 0 });
const persons = [P('lena'), P('papa'), P('mama')];
const E = (p: Partial<CalEvent>): CalEvent => ({ id: 'x', title: 'X', start: '2026-11-18T15:00', end: '2026-11-18T16:00', allDay: false, personIds: ['lena'], ...p });

describe('Terminkonflikte', () => {
  const klavier = E({ id: 'k', title: 'Klavier', start: '2026-11-04T15:00', end: '2026-11-04T15:45', recurrence: { freq: 'weekly', interval: 2, end: { type: 'never' } } });
  it('Überschneidung mit Serien-Vorkommen', () => {
    const c = findConflicts(E({ id: 'neu', title: 'Zahnarzt', start: '2026-11-18T15:30', end: '2026-11-18T16:00' }), [klavier], persons);
    expect(c).toMatchObject([{ title: 'Klavier', start: '2026-11-18T15:00' }]);
    expect(c[0].person.id).toBe('lena');
  });
  it('angrenzend, andere Person, andere Woche, ganztägig → kein Konflikt', () => {
    expect(findConflicts(E({ id: 'n', start: '2026-11-18T15:45', end: '2026-11-18T16:30' }), [klavier], persons)).toHaveLength(0);
    expect(findConflicts(E({ id: 'n', personIds: ['mama'] }), [klavier], persons)).toHaveLength(0);
    expect(findConflicts(E({ id: 'n', start: '2026-11-11T15:00', end: '2026-11-11T16:00' }), [klavier], persons)).toHaveLength(0);
    expect(findConflicts(E({ id: 'n', allDay: true, start: '2026-11-18', end: '2026-11-19' }), [klavier], persons)).toHaveLength(0);
  });
  it('Fahrdienst zählt mit, eigener Termin nicht', () => {
    const training = E({ id: 't', title: 'Training', personIds: ['lena'], driverIds: ['papa'] });
    expect(findConflicts(E({ id: 'n', title: 'Meeting', personIds: ['papa'] }), [training], persons).map((c) => c.person.id)).toEqual(['papa']);
    expect(findConflicts(training, [training], persons)).toHaveLength(0);
  });
  it('Vorkommen einer Serie kollidiert nicht mit sich selbst', () => {
    const occ = { ...klavier, id: 'k#occ', seriesId: 'k', originalStart: '2026-11-18T15:00', start: '2026-11-18T15:00', end: '2026-11-18T15:45' };
    expect(findConflicts(occ, [klavier], persons)).toHaveLength(0);
  });
});
