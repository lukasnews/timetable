import { describe, expect, it } from 'vitest';
import { fetchRisIcs, isRisKalender, parseRisPage } from '../risMuell';
import { parseICS } from '../ics';

const page = (rows: [string, string][], next: boolean) => `<html><table class="ris_table"> <caption> Kalender </caption><tr class=" tableheaderrow even"> <th>Datum</th><th>Termin</th><th>Kalendertyp</th> </tr>${
  rows.map(([d, t]) => `<tr class="odd"> <td class="td_kal" data-label="">${d}  (Donnerstag) </td><td class="td_kal" data-label=""><a href="/x">${t}</a></td><td class="td_kal"><span>Markt A</span></td> </tr>`).join('')
}</table><p class="pager_container">${next ? '<a rel="Next" href="#">&gt;</a>' : ''}</p></html>`;

describe('Müllkalender von der Gemeindeseite (RIS/Gem2Go)', () => {
  const url = 'https://www.andorf.at/system/web/kalender.aspx?sprache=1&menuonr=1&typids=1,2,3';
  it('erkennt den Link', () => {
    expect(isRisKalender(url)).toBe(true);
    expect(isRisKalender('https://calendar.google.com/calendar/ical/x/basic.ics')).toBe(false);
  });
  it('liest Datum und Termin aus der Tabelle', () => {
    expect(parseRisPage(page([['19.11.2026', 'Gelber Sack'], ['03.12.2026', 'Restabfall 3-w&ouml;chentlich']], false)))
      .toEqual([{ date: '2026-11-19', title: 'Gelber Sack' }, { date: '2026-12-03', title: 'Restabfall 3-w&ouml;chentlich' }]);
  });
  it('lädt alle Seiten und erzeugt ganztägige Termine mit festen IDs', async () => {
    const pages = [page([['19.11.2026', 'Gelber Sack'], ['24.11.2026', 'Bioabfall']], true), page([['01.12.2026', 'Bioabfall']], false)];
    const got: string[] = [];
    const ics = await fetchRisIcs(url, async (u) => { got.push(u); return pages[got.length - 1]; });
    expect(got[1]).toContain('page=1');
    const r = parseICS(ics, { source: 'x' });
    expect(r.calendarName).toBe('Müll');
    expect(r.events.map((e) => [e.title, e.start, e.end, e.allDay])).toEqual([
      ['Gelber Sack', '2026-11-19', '2026-11-20', true], ['Bioabfall', '2026-11-24', '2026-11-25', true], ['Bioabfall', '2026-12-01', '2026-12-02', true]]);
    const again = parseICS(await fetchRisIcs(url, async () => pages[1]), { source: 'x' });
    expect(again.events[0].id).toBe(r.events[2].id);
  });
});
