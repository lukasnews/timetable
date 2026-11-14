/**
 * iCalendar (.ics) lesen und schreiben.
 * Import: einfache Serien (täglich/wöchentlich/monatlich/jährlich) bleiben Serien,
 * kompliziertere Regeln werden in Einzeltermine aufgelöst.
 * Export: alle Termine inkl. Serien, Ausnahmen und Geburtstagen aus den Profilen.
 */
import { rrulestr } from 'rrule';
import type { CalEvent, Freq, Person, Recurrence } from '../types';
import { addDays, addMinutes, fmtLike, nowLocal, parseLocal, weekdayMo0 } from './dates';
import { nthOfMonth } from './recurrence';

const TZ = 'Europe/Vienna';
const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/* ---------------- Hilfsfunktionen ---------------- */

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

const unescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): Prop | null {
  // Doppelpunkt außerhalb von Anführungszeichen trennt Name;Params und Wert
  let inQ = false, i = 0;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ':' && !inQ) break;
  }
  if (i >= line.length) return null;
  const [name, ...rawParams] = line.slice(0, i).split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const [k, v = ''] = p.split('=');
    params[k.toUpperCase()] = v.replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

/** Wanduhrzeit in Wien für einen UTC-Zeitpunkt */
function viennaWallClock(d: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** ICS-Datum → Wanduhr-String ("YYYY-MM-DD" bzw. "YYYY-MM-DDTHH:mm") */
export function parseIcsDate(value: string, params: Record<string, string> = {}): { value: string; allDay: boolean } {
  const v = value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) throw new Error('Ungültiges Datum: ' + v);
  const [, y, mo, d, hh, mm, , z] = m;
  if (!hh || params.VALUE === 'DATE') return { value: `${y}-${mo}-${d}`, allDay: true };
  if (z) return { value: viennaWallClock(new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm))), allDay: false };
  // TZID oder "floating": als Wanduhrzeit übernehmen (Familienkalender liegt in einer Zeitzone)
  return { value: `${y}-${mo}-${d}T${hh}:${mm}`, allDay: false };
}

function parseDuration(v: string): number {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 60;
  const [, sign, w, d, h, mi] = m;
  const total = (+(w || 0)) * 10080 + (+(d || 0)) * 1440 + (+(h || 0)) * 60 + (+(mi || 0));
  return sign === '-' ? -total : total;
}

/** Kurzer, stabiler Hash für deterministische IDs (erneuter Import überschreibt statt zu verdoppeln) */
function hash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).padEnd(12, '0');
}

/* ---------------- Import ---------------- */

/** Versucht eine RRULE in unser Serienformat zu übersetzen; null = zu komplex */
export function mapRRule(rule: string, start: string): Recurrence | null {
  const p = Object.fromEntries(rule.split(';').map((kv) => kv.split('=')).map(([k, v]) => [k.toUpperCase(), v ?? '']));
  const freqMap: Record<string, Freq> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };
  const freq = freqMap[p.FREQ];
  if (!freq) return null;
  const supported = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'COUNT', 'UNTIL', 'BYMONTHDAY', 'BYMONTH', 'WKST']);
  if (Object.keys(p).some((k) => !supported.has(k))) return null;
  const rec: Recurrence = { freq, interval: Math.max(1, Number(p.INTERVAL) || 1), end: { type: 'never' } };
  const wd = weekdayMo0(start);
  if (p.BYDAY) {
    const parts = p.BYDAY.split(',');
    if (freq === 'weekly' && parts.every((x) => DAYS.includes(x))) {
      rec.byWeekday = parts.map((x) => DAYS.indexOf(x)).sort();
    } else if ((freq === 'monthly' || freq === 'yearly') && parts.length === 1) {
      const m = parts[0].match(/^([+-]?\d)([A-Z]{2})$/);
      if (!m || DAYS.indexOf(m[2]) !== wd) return null;
      const n = Number(m[1]);
      const startN = nthOfMonth(start);
      if (!(n === startN || (n === -1 && startN >= 4))) return null;
      rec.monthlyMode = 'nthWeekday';
    } else if (freq === 'daily' || parts.length) {
      return null;
    }
  }
  if (p.BYMONTHDAY && Number(p.BYMONTHDAY) !== Number(start.slice(8, 10))) return null;
  if (p.BYMONTH && Number(p.BYMONTH) !== Number(start.slice(5, 7))) return null;
  if (p.COUNT) rec.end = { type: 'count', count: Math.max(1, Number(p.COUNT)) };
  else if (p.UNTIL) rec.end = { type: 'until', until: parseIcsDate(p.UNTIL).value.slice(0, 10) };
  return rec;
}

export interface ImportResult {
  events: CalEvent[];
  calendarName?: string;
  skipped: number;
}

export function parseICS(text: string, opts: { source: string; expandUntil?: string } = { source: 'Import' }): ImportResult {
  const lines = unfold(text);
  if (!lines.some((l) => l.toUpperCase().startsWith('BEGIN:VCALENDAR'))) throw new Error('Das ist keine Kalenderdatei (.ics).');
  const expandUntil = opts.expandUntil ?? addDays(nowLocal().slice(0, 10), 730);
  const out: CalEvent[] = [];
  const overrides: { uid: string; recId: string; ev: CalEvent }[] = [];
  let calendarName: string | undefined;
  let skipped = 0;
  let cur: Prop[] | null = null;
  let depth = 0; // VALARM etc. innerhalb von VEVENT ignorieren

  for (const line of lines) {
    const pr = parseLine(line);
    if (!pr) continue;
    if (pr.name === 'X-WR-CALNAME' && !cur) calendarName = unescape(pr.value);
    if (pr.name === 'BEGIN') {
      if (pr.value.toUpperCase() === 'VEVENT' && !cur) { cur = []; depth = 0; continue; }
      if (cur) depth++;
      continue;
    }
    if (pr.name === 'END') {
      if (cur && depth > 0) { depth--; continue; }
      if (cur && pr.value.toUpperCase() === 'VEVENT') {
        try {
          const res = buildEvent(cur, opts.source, expandUntil);
          if (!res) skipped++;
          else if (res.recId) overrides.push({ uid: res.uid, recId: res.recId, ev: res.events[0] });
          else out.push(...res.events);
        } catch {
          skipped++;
        }
        cur = null;
      }
      continue;
    }
    if (cur && depth === 0) cur.push(pr);
  }

  // Geänderte Einzeltermine einer Serie: Serie bekommt eine Ausnahme, Änderung wird eigener Termin
  for (const o of overrides) {
    const master = out.find((e) => e.id === 'ics' + hash(o.uid));
    if (master?.recurrence) master.exdates = [...new Set([...(master.exdates ?? []), o.recId])];
    else {
      // aufgelöste Serie: passendes Vorkommen ersetzen
      const idx = out.findIndex((e) => e.id === 'ics' + hash(o.uid + '|' + o.recId));
      if (idx >= 0) out.splice(idx, 1);
    }
    out.push(o.ev);
  }
  return { events: out, calendarName, skipped };
}

function buildEvent(props: Prop[], source: string, expandUntil: string):
  { events: CalEvent[]; uid: string; recId?: string } | null {
  const get = (n: string) => props.find((p) => p.name === n);
  const all = (n: string) => props.filter((p) => p.name === n);
  if (get('STATUS')?.value.toUpperCase() === 'CANCELLED') return null;
  const dtstart = get('DTSTART');
  if (!dtstart) return null;
  const s = parseIcsDate(dtstart.value, dtstart.params);
  const allDay = s.allDay;
  let end: string;
  const dtend = get('DTEND');
  const dur = get('DURATION');
  if (dtend) end = parseIcsDate(dtend.value, dtend.params).value;
  else if (dur) end = addMinutes(s.value, parseDuration(dur.value), allDay);
  else end = allDay ? addDays(s.value, 1) : addMinutes(s.value, 60);
  if (end <= s.value) end = allDay ? addDays(s.value, 1) : addMinutes(s.value, 30);
  if (allDay && end.includes('T')) end = addDays(s.value, 1);

  const uid = get('UID')?.value || `${s.value}|${get('SUMMARY')?.value ?? ''}`;
  const recIdProp = get('RECURRENCE-ID');
  const recId = recIdProp ? parseIcsDate(recIdProp.value, recIdProp.params).value : undefined;
  const base: CalEvent = {
    id: 'ics' + hash(uid + (recId ? '|' + recId + '|override' : '')),
    title: unescape(get('SUMMARY')?.value ?? '(ohne Titel)').trim() || '(ohne Titel)',
    start: s.value,
    end,
    allDay,
    personIds: [],
    location: get('LOCATION') ? unescape(get('LOCATION')!.value) : undefined,
    notes: get('DESCRIPTION') ? unescape(get('DESCRIPTION')!.value).slice(0, 2000) : undefined,
    reminderMinutes: null,
    kind: 'event',
    importSource: source,
  };
  if (recId) return { events: [base], uid, recId };

  const exdates = all('EXDATE').flatMap((p) => p.value.split(',').map((v) => parseIcsDate(v, p.params).value));
  const rrule = get('RRULE')?.value;
  if (!rrule) return { events: [base], uid };

  const rec = mapRRule(rrule, s.value);
  if (rec) return { events: [{ ...base, recurrence: rec, exdates: exdates.length ? exdates : undefined }], uid };

  // Komplexe Regel: in Einzeltermine auflösen (bis expandUntil)
  const durMin = Math.round((parseLocal(end).getTime() - parseLocal(s.value).getTime()) / 60000);
  const dt = s.value.replace(/[-:]/g, '') + (allDay ? '' : '00');
  const rule = rrulestr(`DTSTART:${allDay ? dt + 'T000000' : dt}\nRRULE:${rrule.replace(/UNTIL=(\d{8})(?!T)/, 'UNTIL=$1T235959')}`);
  const ex = new Set(exdates);
  const events = rule.between(parseLocal(s.value), parseLocal(expandUntil), true).slice(0, 500)
    .map((d) => fmtLike(d, allDay))
    .filter((occ) => !ex.has(occ))
    .map((occ) => ({ ...base, id: 'ics' + hash(uid + '|' + occ), start: occ, end: addMinutes(occ, durMin, allDay) }));
  return { events, uid };
}

/* ---------------- Export ---------------- */

const icsDate = (v: string) => v.replace(/[-:]/g, '') + (v.includes('T') ? '00' : '');

function dateProp(name: string, v: string): string {
  return v.includes('T') ? `${name};TZID=${TZ}:${icsDate(v)}` : `${name};VALUE=DATE:${icsDate(v)}`;
}

function rruleOf(start: string, r: Recurrence): string {
  const parts = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === 'weekly') parts.push(`BYDAY=${(r.byWeekday?.length ? r.byWeekday : [weekdayMo0(start)]).map((d) => DAYS[d]).join(',')}`);
  if ((r.freq === 'monthly' || r.freq === 'yearly') && r.monthlyMode === 'nthWeekday') {
    const n = nthOfMonth(start);
    parts.push(`BYDAY=${n === 5 ? -1 : n}${DAYS[weekdayMo0(start)]}`);
    if (r.freq === 'yearly') parts.push(`BYMONTH=${Number(start.slice(5, 7))}`);
  }
  if (r.end.type === 'count') parts.push(`COUNT=${r.end.count}`);
  if (r.end.type === 'until') {
    // UNTIL in UTC; Ende des Tages in Wien ≈ 22:59 UTC
    parts.push(`UNTIL=${r.end.until.replace(/-/g, '')}T225959Z`);
  }
  return parts.join(';');
}

/** Lange Zeilen nach RFC 5545 auf 75 Zeichen umbrechen */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  out.push(rest);
  return out.join('\r\n');
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', `TZID:${TZ}`,
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

export function toICS(events: CalEvent[], persons: Person[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const names = (ids: string[]) => ids.map((id) => persons.find((p) => p.id === id)?.name).filter(Boolean).join(', ');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Familienkalender//DE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Familienkalender', `X-WR-TIMEZONE:${TZ}`, ...VTIMEZONE];

  const push = (ev: CalEvent, uid: string, extra: string[] = []) => {
    const who = names(ev.personIds);
    const title = ev.kind === 'birthday' ? `🎂 ${ev.title}` : ev.title;
    const drv = names(ev.driverIds ?? []);
    const desc = [who ? `Für: ${who}` : '', drv ? `Fahrdienst: ${drv}` : '', ev.kind === 'birthday' && ev.birthYear ? `Geburtsjahr: ${ev.birthYear}` : '', ev.notes ?? ''].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`, dateProp('DTSTART', ev.start), dateProp('DTEND', ev.end), `SUMMARY:${escape(title)}`);
    if (ev.location) lines.push(`LOCATION:${escape(ev.location)}`);
    if (desc) lines.push(`DESCRIPTION:${escape(desc)}`);
    lines.push(...extra);
    if (ev.reminderMinutes != null) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escape(title)}`, `TRIGGER:-PT${ev.reminderMinutes}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  };

  for (const ev of events) {
    const uid = `${ev.seriesId ?? ev.id}@familienkalender`;
    if (ev.seriesId && ev.originalStart) {
      push(ev, uid, [dateProp('RECURRENCE-ID', ev.originalStart)]);
    } else if (ev.recurrence) {
      const extra = [`RRULE:${rruleOf(ev.start, ev.recurrence)}`];
      for (const x of ev.exdates ?? []) extra.push(dateProp('EXDATE', x));
      push(ev, uid, extra);
    } else {
      push(ev, uid);
    }
  }
  // Geburtstage aus den Profilen
  for (const p of persons) {
    if (!p.birthday) continue;
    push({ id: 'bday-' + p.id, title: p.name, start: p.birthday, end: addDays(p.birthday, 1), allDay: true, personIds: [p.id], kind: 'birthday',
      birthYear: Number(p.birthday.slice(0, 4)), reminderMinutes: null }, `bday-${p.id}@familienkalender`, ['RRULE:FREQ=YEARLY']);
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
