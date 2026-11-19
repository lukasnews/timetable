/**
 * Müllabfuhrtermine von Gemeinde-Webseiten im RIS-Kommunal-System (Gem2Go, z. B. andorf.at) als .ics.
 * Link-Form: https://<gemeinde>/system/web/kalender.aspx?…&typids=<Kalendertypen der Straße>
 */
export const isRisKalender = (url: string) => /\/system\/web\/kalender\.aspx\?/i.test(url) && /[?&]typids=/i.test(url);

const decode = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();

/** Zeilen der Ergebnistabelle: Datum (TT.MM.JJJJ) + Termin */
export function parseRisPage(html: string): { date: string; title: string }[] {
  const out: { date: string; title: string }[] = [];
  const table = html.match(/<table class="ris_table">([\s\S]*?)<\/table>/i)?.[1] ?? '';
  for (const row of table.split(/<tr[\s>]/i).slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => decode(m[1]));
    const d = cells[0]?.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (d && cells[1]) out.push({ date: `${d[3]}-${d[2]}-${d[1]}`, title: cells[1] });
  }
  return out;
}

export const hasNextPage = (html: string) => /rel="Next"/i.test(html);

const ymd = (s: string) => s.replace(/-/g, '');
const nextDay = (s: string) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,');

export function risToIcs(rows: { date: string; title: string }[], host: string, name = 'Müll'): string {
  const seen = new Set<string>();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Familienkalender//RIS-Muell//DE', `X-WR-CALNAME:${esc(name)}`];
  for (const r of rows) {
    const uid = `ris-${ymd(r.date)}-${slug(r.title)}@${host}`;
    if (seen.has(uid)) continue;
    seen.add(uid);
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTART;VALUE=DATE:${ymd(r.date)}`, `DTEND;VALUE=DATE:${ymd(nextDay(r.date))}`, `SUMMARY:${esc(r.title)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** Alle Seiten laden (max. 12) und als Kalenderdatei liefern */
export async function fetchRisIcs(url: string, get: (u: string) => Promise<string>): Promise<string> {
  const u = new URL(url);
  u.searchParams.delete('page');
  const rows: { date: string; title: string }[] = [];
  for (let p = 0; p < 12; p++) {
    if (p) u.searchParams.set('page', String(p));
    const html = await get(u.toString());
    const page = parseRisPage(html);
    rows.push(...page);
    if (!page.length || !hasNextPage(html)) break;
  }
  if (!rows.length) throw new Error('Auf der Gemeindeseite wurden keine Abfuhrtermine gefunden');
  return risToIcs(rows, u.hostname);
}
