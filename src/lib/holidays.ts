/**
 * Österreichische Feiertage und Schulferien je Bundesland.
 * Ferienregeln laut Schulzeitgesetz (§ 2), geprüft gegen die Ferientermine des Bildungsministeriums 2024/25–2026/27:
 *  - Herbstferien: 27.–31. Oktober (alle)
 *  - Weihnachtsferien: 24. Dezember – 6. Jänner; ist der 23. Dezember ein Montag, ab 23. Dezember (alle)
 *  - Semesterferien: Woche ab dem 1. (W, NÖ), 2. (B, K, S, T, V) bzw. 3. Montag im Februar (OÖ, St);
 *    vom Ministerium per Verordnung verschobene Jahre stehen in SEMESTER_OVERRIDE
 *  - Osterferien: Samstag vor Palmsonntag – Ostermontag (alle)
 *  - Pfingstferien: Pfingstsamstag – Pfingstmontag (alle)
 *  - Sommerferien: 9 Wochen ab dem Samstag zwischen 28. Juni und 4. Juli (W, NÖ, B) bzw. 5. und 11. Juli (übrige)
 * Schulautonome Tage und Landespatron-Tage sind nicht enthalten – die kann man als normale Termine eintragen.
 */
import { addDays, fmtDate } from './dates';

export interface DayRange {
  title: string;
  start: string; // YYYY-MM-DD
  end: string; // exklusiv
}

function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}

const ymd = (y: number, m: number, d: number) => fmtDate(new Date(Date.UTC(y, m - 1, d)));

export function holidaysAT(year: number): DayRange[] {
  const e = fmtDate(easter(year));
  const list: [string, string][] = [
    [ymd(year, 1, 1), 'Neujahr'],
    [ymd(year, 1, 6), 'Heilige Drei Könige'],
    [addDays(e, 1), 'Ostermontag'],
    [ymd(year, 5, 1), 'Staatsfeiertag'],
    [addDays(e, 39), 'Christi Himmelfahrt'],
    [addDays(e, 50), 'Pfingstmontag'],
    [addDays(e, 60), 'Fronleichnam'],
    [ymd(year, 8, 15), 'Mariä Himmelfahrt'],
    [ymd(year, 10, 26), 'Nationalfeiertag'],
    [ymd(year, 11, 1), 'Allerheiligen'],
    [ymd(year, 12, 8), 'Mariä Empfängnis'],
    [ymd(year, 12, 25), 'Christtag'],
    [ymd(year, 12, 26), 'Stefanitag'],
  ];
  return list.map(([d, title]) => ({ title, start: d, end: addDays(d, 1) }));
}

function firstWeekdayOnOrAfter(y: number, m: number, d: number, weekday: number /* 0=So */): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  while (date.getUTCDay() !== weekday) date.setUTCDate(date.getUTCDate() + 1);
  return fmtDate(date);
}

export type FerienRegion = 'W' | 'N' | 'B' | 'K' | 'S' | 'St' | 'T' | 'V' | 'O';
export const FERIEN_REGIONS: [FerienRegion, string][] = [
  ['B', 'Burgenland'], ['K', 'Kärnten'], ['N', 'Niederösterreich'], ['O', 'Oberösterreich'], ['S', 'Salzburg'],
  ['St', 'Steiermark'], ['T', 'Tirol'], ['V', 'Vorarlberg'], ['W', 'Wien'],
];
export const regionName = (r?: FerienRegion) => FERIEN_REGIONS.find(([k]) => k === (r ?? 'O'))?.[1] ?? 'Oberösterreich';
const SEMESTER_WEEK: Record<FerienRegion, number> = { W: 1, N: 1, B: 2, K: 2, S: 2, T: 2, V: 2, O: 3, St: 3 };
/** Vom Bildungsministerium verschobene Semesterferien (Jahr → Bundesland → Februar-Woche), z. B. BGBl. II Nr. 322/2025 */
const SEMESTER_OVERRIDE: Record<number, Partial<Record<FerienRegion, number>>> = { 2027: { S: 3, T: 3, V: 3 } };
const EAST = new Set<FerienRegion>(['W', 'N', 'B']);

function christmas(y: number): DayRange {
  const d23 = new Date(Date.UTC(y, 11, 23)).getUTCDay();
  return { title: 'Weihnachtsferien', start: ymd(y, 12, d23 === 1 ? 23 : 24), end: ymd(y + 1, 1, 7) };
}

export function schoolHolidaysAT(year: number, region: FerienRegion = 'O'): DayRange[] {
  const e = fmtDate(easter(year));
  const week = SEMESTER_OVERRIDE[year]?.[region] ?? SEMESTER_WEEK[region] ?? 3;
  const semesterMon = addDays(firstWeekdayOnOrAfter(year, 2, 1, 1), (week - 1) * 7);
  const summerStart = EAST.has(region) ? firstWeekdayOnOrAfter(year, 6, 28, 6) : firstWeekdayOnOrAfter(year, 7, 5, 6);
  return [
    christmas(year - 1),
    { title: 'Semesterferien', start: addDays(semesterMon, -2), end: addDays(semesterMon, 7) },
    { title: 'Osterferien', start: addDays(e, -8), end: addDays(e, 2) },
    { title: 'Pfingstferien', start: addDays(e, 48), end: addDays(e, 51) },
    { title: 'Sommerferien', start: summerStart, end: addDays(summerStart, 9 * 7 + 2) },
    { title: 'Herbstferien', start: ymd(year, 10, 26), end: ymd(year, 11, 3) },
    christmas(year),
  ];
}

/** Schulferien Oberösterreich (Kurzform) */
export const schoolHolidaysOOE = (year: number) => schoolHolidaysAT(year, 'O');
/** Ferien-Funktion für ein Bundesland (für rangesBetween) */
export const schoolHolidaysFor = (region?: FerienRegion) => (year: number) => schoolHolidaysAT(year, region ?? 'O');

export function rangesBetween(from: string, to: string, fn: (y: number) => DayRange[]): DayRange[] {
  const y1 = Number(from.slice(0, 4)), y2 = Number(to.slice(0, 4));
  const seen = new Set<string>();
  const out: DayRange[] = [];
  for (let y = y1; y <= y2; y++) {
    for (const r of fn(y)) {
      const key = r.start + r.title;
      if (seen.has(key) || r.end <= from || r.start >= to) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

/** Ist dieser Tag schulfrei (Wochenende, Feiertag oder Ferien)? */
export function isSchoolFree(day: string, region: FerienRegion = 'O'): boolean {
  const y = Number(day.slice(0, 4));
  const wd = new Date(day + 'T00:00:00Z').getUTCDay();
  if (wd === 0 || wd === 6) return true;
  const inRange = (r: DayRange) => r.start <= day && day < r.end;
  return holidaysAT(y).some(inRange) || schoolHolidaysAT(y, region).some(inRange);
}
