import { describe, expect, it } from 'vitest';
import { parseQuick } from '../quickAdd';
import type { Person } from '../../types';

const P = (id: string, name: string): Person => ({ id, name, color: '#000', avatar: { style: 'x', seed: id }, order: 0 });
const persons = [P('l', 'Lena'), P('m', 'Max'), P('a', 'Anna Lena')];
const today = '2026-11-15'; // Sonntag

describe('Schnelleingabe', () => {
  it('Morgen 15 Uhr Zahnarzt Lena', () => {
    const q = parseQuick('Morgen 15 Uhr Zahnarzt Lena', persons, today);
    expect(q).toMatchObject({ title: 'Zahnarzt', date: '2026-11-16', start: '15:00', personIds: ['l'], matched: true });
  });
  it('Wochentag, Zeitraum und mehrere Personen', () => {
    const q = parseQuick('Schwimmen am Mittwoch von 16 bis 17:30 für Lena und Max', persons, today);
    expect(q).toMatchObject({ title: 'Schwimmen', date: '2026-11-18', start: '16:00', end: '17:30' });
    expect(q.personIds.sort()).toEqual(['l', 'm']);
  });
  it('Datum mit und ohne Jahr', () => {
    expect(parseQuick('Elternabend 3.12. 19:30', persons, today)).toMatchObject({ title: 'Elternabend', date: '2026-12-03', start: '19:30' });
    expect(parseQuick('Impfung 10.1.', persons, today).date).toBe('2027-01-10');
    expect(parseQuick('Feier am 24. Dezember', persons, today)).toMatchObject({ title: 'Feier', date: '2026-12-24' });
    expect(parseQuick('Urlaub 2.8.2027 ganztägig', persons, today)).toMatchObject({ title: 'Urlaub', date: '2027-08-02', allDay: true });
  });
  it('Dauer und „um“', () => {
    expect(parseQuick('Training übermorgen um 18 für 1,5 Std', persons, today)).toMatchObject({ title: 'Training', date: '2026-11-17', start: '18:00', durationMin: 90 });
  });
  it('längerer Name zuerst, ohne Treffer bleibt Titel gleich', () => {
    expect(parseQuick('Ballett Anna Lena', persons, today).personIds).toEqual(['a']);
    const q = parseQuick('Oma besuchen', persons, today);
    expect(q).toMatchObject({ title: 'Oma besuchen', matched: false });
  });
  it('Zahlen im Titel sind keine Uhrzeit', () => {
    const q = parseQuick('Klasse 3-4 Ausflug', persons, today);
    expect(q.start).toBeUndefined();
  });
});
