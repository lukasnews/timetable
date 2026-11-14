import { describe, expect, it } from 'vitest';
import { parseICS, toICS, mapRRule } from '../ics';
import { expand } from '../recurrence';
import type { CalEvent, Person } from '../../types';

const muell = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Gemeinde//Abfall//DE\r
X-WR-CALNAME:Abfuhrtermine 2027\r
BEGIN:VEVENT\r
UID:rest-1@gemeinde\r
DTSTART;VALUE=DATE:20270105\r
DTEND;VALUE=DATE:20270106\r
SUMMARY:Restabfall\r
DESCRIPTION:Tonne bitte bis 6 Uhr\\, danke\r
BEGIN:VALARM\r
TRIGGER:-PT12H\r
ACTION:DISPLAY\r
END:VALARM\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:bio@gemeinde\r
DTSTART;VALUE=DATE:20270107\r
SUMMARY:Biotonne\r
RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TH;COUNT=4\r
EXDATE;VALUE=DATE:20270121\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:abgesagt@gemeinde\r
DTSTART;VALUE=DATE:20270110\r
SUMMARY:Fällt aus\r
STATUS:CANCELLED\r
END:VEVENT\r
END:VCALENDAR\r
`;

describe('ICS-Import', () => {
  it('Müllkalender mit Serie, Ausnahme und abgesagtem Termin', () => {
    const r = parseICS(muell, { source: 'Müll' });
    expect(r.calendarName).toBe('Abfuhrtermine 2027');
    expect(r.skipped).toBe(1);
    expect(r.events).toHaveLength(2);
    const rest = r.events.find((e) => e.title === 'Restabfall')!;
    expect(rest).toMatchObject({ start: '2027-01-05', end: '2027-01-06', allDay: true, importSource: 'Müll', notes: 'Tonne bitte bis 6 Uhr, danke' });
    const bio = r.events.find((e) => e.title === 'Biotonne')!;
    expect(bio.recurrence).toMatchObject({ freq: 'weekly', interval: 2, byWeekday: [3], end: { type: 'count', count: 4 } });
    expect(expand([bio], '2027-01-01', '2027-03-01').map((o) => o.start)).toEqual(['2027-01-07', '2027-02-04', '2027-02-18']);
  });
  it('gleiche Datei zweimal → gleiche IDs (überschreibt statt verdoppelt)', () => {
    expect(parseICS(muell, { source: 'a' }).events.map((e) => e.id)).toEqual(parseICS(muell, { source: 'a' }).events.map((e) => e.id));
  });
  it('UTC-Zeit wird Wiener Zeit, gefaltete Zeilen', () => {
    const t = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART:20270615T080000Z\nDTEND:20270615T090000Z\nSUMMARY:Sehr langer Titel der über\n  mehrere Zeilen geht\nEND:VEVENT\nEND:VCALENDAR';
    const e = parseICS(t, { source: 's' }).events[0];
    expect(e).toMatchObject({ start: '2027-06-15T10:00', end: '2027-06-15T11:00', allDay: false, title: 'Sehr langer Titel der über mehrere Zeilen geht' });
  });
  it('komplexe Regel wird aufgelöst', () => {
    const t = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:y\nDTSTART;VALUE=DATE:20270101\nSUMMARY:Monatsletzter Werktag\nRRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3\nEND:VEVENT\nEND:VCALENDAR';
    const r = parseICS(t, { source: 's', expandUntil: '2027-12-31' });
    expect(r.events.map((e) => e.start)).toEqual(['2027-01-29', '2027-02-26', '2027-03-31']);
  });
  it('geänderter Einzeltermin einer Serie', () => {
    const t = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:z\nDTSTART:20270104T170000\nDTEND:20270104T180000\nSUMMARY:Training\nRRULE:FREQ=WEEKLY\nEND:VEVENT\n' +
      'BEGIN:VEVENT\nUID:z\nRECURRENCE-ID:20270111T170000\nDTSTART:20270112T180000\nDTEND:20270112T190000\nSUMMARY:Training (verschoben)\nEND:VEVENT\nEND:VCALENDAR';
    const r = parseICS(t, { source: 's' });
    const occ = expand(r.events, '2027-01-01', '2027-01-20').map((o) => o.start).sort();
    expect(occ).toEqual(['2027-01-04T17:00', '2027-01-12T18:00', '2027-01-18T17:00']);
  });
  it('RRULE-Übersetzung', () => {
    expect(mapRRule('FREQ=MONTHLY;BYDAY=2TU', '2027-01-12')).toMatchObject({ freq: 'monthly', monthlyMode: 'nthWeekday' });
    expect(mapRRule('FREQ=MONTHLY;BYDAY=1TU', '2027-01-12')).toBeNull();
    expect(mapRRule('FREQ=YEARLY;UNTIL=20300101T000000Z', '2027-05-12')).toMatchObject({ end: { type: 'until', until: '2030-01-01' } });
  });
});

describe('ICS-Export', () => {
  const persons: Person[] = [{ id: 'p', name: 'Papa', color: '#00f', avatar: { style: 'adventurer', seed: 'a' }, order: 0, birthday: '1985-03-02' }];
  const evs: CalEvent[] = [
    { id: 's1', title: 'Yoga; Kurs', start: '2027-01-04T19:00', end: '2027-01-04T20:00', allDay: false, personIds: ['p'], reminderMinutes: 15,
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [0, 2], end: { type: 'until', until: '2027-06-30' } }, exdates: ['2027-01-11T19:00', '2027-01-18T19:00'] },
    { id: 'o1', title: 'Yoga (später)', start: '2027-01-18T20:00', end: '2027-01-18T21:00', allDay: false, personIds: ['p'], seriesId: 's1', originalStart: '2027-01-18T19:00' },
    { id: 'u1', title: 'Urlaub', start: '2027-07-01', end: '2027-07-15', allDay: true, personIds: [] },
  ];
  it('schreibt gültige Einträge', () => {
    const ics = toICS(evs, persons);
    expect(ics).toContain('DTSTART;TZID=Europe/Vienna:20270104T190000');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20270630T225959Z');
    expect(ics).toContain('EXDATE;TZID=Europe/Vienna:20270111T190000');
    expect(ics).toContain('RECURRENCE-ID;TZID=Europe/Vienna:20270118T190000');
    expect(ics).toContain(String.raw`SUMMARY:Yoga\; Kurs`);
    expect(ics).toContain('DTSTART;VALUE=DATE:20270701');
    expect(ics).toContain('TRIGGER:-PT15M');
    expect(ics).toContain('SUMMARY:🎂 Papa');
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
  });
  it('Export → Import ergibt dieselben Vorkommen', () => {
    const back = parseICS(toICS(evs, []), { source: 'x' }).events;
    const a = expand(evs, '2027-01-01', '2027-02-01').map((o) => o.start).sort();
    const b = expand(back, '2027-01-01', '2027-02-01').map((o) => o.start).sort();
    expect(b).toEqual(a);
  });
});
