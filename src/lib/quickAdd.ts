/**
 * Schnelleingabe: „Morgen 15 Uhr Zahnarzt Lena“ → Datum, Uhrzeit, Personen und Titel.
 */
import type { Person } from '../types';
import { addDays, weekdayMo0 } from './dates';

export interface QuickParse {
  /** Titel ohne die erkannten Teile */
  title: string;
  date?: string;
  /** "HH:mm" */
  start?: string;
  end?: string;
  durationMin?: number;
  allDay?: boolean;
  personIds: string[];
  /** Wurde überhaupt etwas erkannt? */
  matched: boolean;
}

// \b kennt keine Umlaute → eigene Wortgrenzen
const B = '(?<![\\p{L}\\d])';
const E = '(?![\\p{L}\\d])';
const rx = (s: string) => new RegExp(s, 'giu');

const WD = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
const MONTHS: [number, string][] = [
  [1, 'jänner|januar|jän|jan'], [2, 'februar|feb'], [3, 'märz|mär|mar'], [4, 'april|apr'], [5, 'mai'], [6, 'juni|jun'],
  [7, 'juli|jul'], [8, 'august|aug'], [9, 'september|sept|sep'], [10, 'oktober|okt'], [11, 'november|nov'], [12, 'dezember|dez'],
];
const pad = (n: number) => String(n).padStart(2, '0');
const hm = (h: number, m: number) => `${pad(h)}:${pad(m)}`;
const okTime = (h: number, m: number) => h >= 0 && h <= 24 && m >= 0 && m < 60 && !(h === 24 && m > 0);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function ymd(y: number, m: number, d: number): string | undefined {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
}
/** Ohne Jahr: dieses Jahr, oder nächstes, falls schon vorbei */
function withYear(m: number, d: number, today: string): string | undefined {
  const y = Number(today.slice(0, 4));
  const a = ymd(y, m, d);
  if (a && a >= today) return a;
  return ymd(y + 1, m, d) ?? a;
}

export function parseQuick(input: string, persons: Person[], today: string): QuickParse {
  let s = ' ' + input + ' ';
  const out: QuickParse = { title: input.trim(), personIds: [], matched: false };
  const cut = (re: RegExp, fn: (m: RegExpExecArray) => boolean) => {
    s = s.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      return fn(m) ? ' ' : (m[0] as string);
    });
  };
  const PRE = `(?:${B}(?:am|ab|um|von|nächsten|nächste|kommenden|kommende|diesen|diese|den)\\s+)*`;

  // Ganztägig
  cut(rx(`${B}(?:ganztägig|ganztags|den ganzen tag)${E}`), () => { out.allDay = true; return true; });

  // Datum: heute / morgen / übermorgen
  cut(rx(`${PRE}${B}(übermorgen|morgen|heute)${E}`), (m) => {
    if (out.date) return false;
    const w = m[1].toLowerCase();
    out.date = addDays(today, w === 'heute' ? 0 : w === 'morgen' ? 1 : 2);
    return true;
  });
  // Wochentag → nächster solcher Tag (heute zählt nicht)
  cut(rx(`${PRE}${B}(${WD.join('|')})${E}`), (m) => {
    if (out.date) return false;
    const wd = WD.indexOf(m[1].toLowerCase());
    out.date = addDays(today, (wd - weekdayMo0(today) + 7) % 7 || 7);
    return true;
  });
  // 16.11. / 16.11.2026 / 16.11.26
  cut(rx(`${PRE}${B}(\\d{1,2})\\.\\s?(\\d{1,2})\\.(\\d{4}|\\d{2})?${E}`), (m) => {
    if (out.date) return false;
    const d = Number(m[1]), mo = Number(m[2]);
    const y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : 0;
    const v = y ? ymd(y, mo, d) : withYear(mo, d, today);
    if (!v) return false;
    out.date = v;
    return true;
  });
  // 3. Dezember (2026)
  cut(rx(`${PRE}${B}(\\d{1,2})\\.?\\s*(${MONTHS.map(([, n]) => n).join('|')})\\.?(?:\\s+(\\d{4}))?${E}`), (m) => {
    if (out.date) return false;
    const mo = MONTHS.find(([, n]) => new RegExp(`^(?:${n})$`, 'i').test(m[2]))![0];
    const v = m[3] ? ymd(Number(m[3]), mo, Number(m[1])) : withYear(mo, Number(m[1]), today);
    if (!v) return false;
    out.date = v;
    return true;
  });

  // Zeitraum: 15-17 Uhr, 15:00–16:30, von 15 bis 17 Uhr
  cut(rx(`${B}(von\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*(uhr\\s*)?(-|–|bis)\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*(uhr)?${E}`), (m) => {
    if (out.start) return false;
    const [h1, m1, h2, m2] = [Number(m[2]), Number(m[3] ?? 0), Number(m[6]), Number(m[7] ?? 0)];
    const sure = !!(m[1] || m[3] || m[4] || m[7] || m[8] || m[5] === 'bis');
    if (!sure || !okTime(h1, m1) || !okTime(h2, m2)) return false;
    // „17 bis 24 Uhr“ → bis 23:59; über Mitternacht („20 bis 1 Uhr“) nicht erkennen statt Ende vor Beginn zu liefern
    const s = hm(h1, m1), e = h2 === 24 && m2 === 0 ? '23:59' : hm(h2, m2);
    if (e <= s) return false;
    out.start = s;
    out.end = e;
    return true;
  });
  // Einzelzeit: 15 Uhr, 15:30, 15.30 Uhr, um 15
  cut(rx(`(?:${B}(?:um|ab)\\s+)?${B}(\\d{1,2})(?:[:.](\\d{2}))?\\s*uhr${E}`), (m) => setStart(m[1], m[2]));
  cut(rx(`(?:${B}(?:um|ab)\\s+)?${B}(\\d{1,2}):(\\d{2})${E}`), (m) => setStart(m[1], m[2]));
  cut(rx(`${B}um\\s+(\\d{1,2})(?:[:.](\\d{2}))?${E}`), (m) => setStart(m[1], m[2]));
  function setStart(h: string, mi?: string) {
    if (out.start) return false;
    const [hh, mm] = [Number(h), Number(mi ?? 0)];
    if (!okTime(hh, mm) || hh === 24) return false;
    out.start = hm(hh, mm);
    return true;
  }
  // Dauer: 2h, 1,5 Std, 90 min
  cut(rx(`(?:${B}für\\s+)?${B}(\\d+(?:[,.]\\d+)?)\\s*(h|std\\.?|stunden?|min\\.?|minuten)${E}`), (m) => {
    const n = Number(m[1].replace(',', '.'));
    const min = /^m/i.test(m[2]) ? n : n * 60;
    if (!(min > 0 && min <= 24 * 60)) return false;
    out.durationMin = Math.round(min);
    return true;
  });

  // Personen (auch „für Lena und Max“): Namen durch Platzhalter ersetzen, danach samt Bindewörtern entfernen
  const MARK = '\u0001';
  for (const p of [...persons].sort((a, b) => b.name.length - a.name.length)) {
    const name = p.name.trim();
    if (!name) continue;
    s = s.replace(rx(`${B}${escape(name)}${E}`), () => {
      if (!out.personIds.includes(p.id)) out.personIds.push(p.id);
      return MARK;
    });
  }
  s = s.replace(rx(`(?:${B}(?:für|mit)\\s+)?${MARK}(?:\\s*(?:,|&|${B}und${E})\\s*${MARK})*`), ' ');

  out.matched = !!(out.date || out.start || out.allDay || out.durationMin || out.personIds.length);
  let title = s.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim().replace(/^[,.\-–:;]+\s*|\s*[,\-–:;]+$/g, '').trim();
  title = title.replace(rx(`^(?:am|um|für|mit|und)${E}\\s*`), '').replace(rx(`\\s+(?:am|um|für|mit|und|ab|von|bis)$`), '').trim();
  out.title = title ? title[0].toUpperCase() + title.slice(1) : '';
  return out;
}
