import { describe, expect, it } from 'vitest';
import type { EventInput } from '@fullcalendar/core';
import { focusRange, highlightKeys, scrollTimeFor, toSpanBars, visibleSpan } from '../viewLogic';

const ev = (id: string, start: string, end: string, extra: Partial<EventInput> = {}): EventInput =>
  ({ id, start, end, allDay: false, extendedProps: { kind: 'event', eventId: id, occStart: start, personIds: [] }, ...extra });

describe('Kalenderansicht (Tablet-Logik)', () => {
  it('mehrtägige Termine werden zu Balken mit echter Dauer', () => {
    const [bar, normal, midnight] = toSpanBars([
      ev('gw', '2026-11-20T14:15', '2026-11-22T11:00'),
      ev('a', '2026-11-20T10:00', '2026-11-20T11:00'),
      ev('m', '2026-11-20T20:00', '2026-11-21T00:00'),
    ]);
    expect(bar).toMatchObject({ allDay: true, start: '2026-11-20', end: '2026-11-23', editable: false });
    expect((bar.extendedProps as { spanText: string }).spanText).toBe('Fr 14:15 – So 11:00');
    expect(normal.allDay).toBe(false);
    expect(midnight.allDay).toBe(false); // bis Mitternacht bleibt im Raster
  });
  it('Tagesbereich erweitert sich für frühe und späte Termine, mehrtägige zählen nicht', () => {
    expect(visibleSpan([ev('a', '2026-11-20T10:00', '2026-11-20T11:00')], '06:00', '21:00')).toEqual({ min: '06:00', max: '21:00' });
    expect(visibleSpan([ev('l', '2026-11-20T22:00', '2026-11-20T22:30')], '06:00', '21:00')).toEqual({ min: '06:00', max: '23:00' });
    expect(visibleSpan([ev('f', '2026-11-20T05:15', '2026-11-20T06:00')], '06:00', '21:00')).toEqual({ min: '05:00', max: '21:00' });
    expect(visibleSpan([ev('m', '2026-11-20T21:30', '2026-11-21T00:00')], '06:00', '21:00')).toEqual({ min: '06:00', max: '24:00' });
    expect(visibleSpan([ev('gw', '2026-11-20T03:00', '2026-11-22T23:00')], '06:00', '21:00')).toEqual({ min: '06:00', max: '21:00' });
  });
  it('Hervorhebung: laufende dezent, nächster beginnender deutlich', () => {
    const evs = [ev('a', '2026-11-19T12:00', '2026-11-19T19:00'), ev('b', '2026-11-19T13:00', '2026-11-19T14:00'), ev('c', '2026-11-19T16:00', '2026-11-19T17:30'),
      ev('morgen', '2026-11-20T08:00', '2026-11-20T09:00')];
    const at = (t: string) => { const h = highlightKeys(evs, `2026-11-19T${t}`); return [[...h.running].map((k) => k.split('|')[0]), h.next?.split('|')[0]]; };
    expect(at('12:30')).toEqual([['a'], 'b']);
    expect(at('13:15')).toEqual([['a', 'b'], 'c']);
    expect(at('18:00')).toEqual([['a'], undefined]);
    expect(at('20:00')).toEqual([[], undefined]);
  });
  it('Fokus-Woche beginnt gestern und umfasst 7 Tage', () => {
    const r = focusRange(new Date('2026-11-19T15:30:00'));
    expect([r.start.getDate(), r.end.getDate(), (r.end.getTime() - r.start.getTime()) / 86400000]).toEqual([18, 25, 7]);
  });
  it('Einstieg eine halbe Stunde vor jetzt', () => {
    expect(scrollTimeFor(new Date('2026-11-19T16:40:00'))).toBe('16:00:00');
    expect(scrollTimeFor(new Date('2026-11-19T16:10:00'))).toBe('15:30:00');
    expect(scrollTimeFor(new Date('2026-11-19T00:20:00'))).toBe('07:00:00');
  });
});
