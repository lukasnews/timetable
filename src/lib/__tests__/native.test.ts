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
