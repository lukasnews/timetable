import type { CalEvent } from '../types';

export const CATEGORIES: { key: string; icon: string; label: string }[] = [
  { key: 'arzt', icon: '🩺', label: 'Arzt' },
  { key: 'sport', icon: '⚽', label: 'Sport' },
  { key: 'schule', icon: '📚', label: 'Schule' },
  { key: 'test', icon: '📝', label: 'Schularbeit/Test' },
  { key: 'musik', icon: '🎵', label: 'Musik' },
  { key: 'feier', icon: '🎉', label: 'Feier' },
  { key: 'arbeit', icon: '💼', label: 'Arbeit' },
  { key: 'freizeit', icon: '🎈', label: 'Freizeit' },
  { key: 'reise', icon: '✈️', label: 'Reise/Urlaub' },
  { key: 'haushalt', icon: '🏠', label: 'Haushalt' },
];

export const categoryIcon = (key?: string): string => CATEGORIES.find((c) => c.key === key)?.icon ?? '';

/** Titel mit Symbol (Kategorie, Abwesenheit, Geburtstag) */
export function displayTitle(ev: Pick<CalEvent, 'title' | 'category' | 'absent' | 'kind'>): string {
  const icon = ev.kind === 'birthday' ? '🎂' : ev.absent ? '🧳' : categoryIcon(ev.category);
  return icon ? `${icon} ${ev.title}` : ev.title;
}

/**
 * Kategorie aus dem Titel erraten („Zahnarzt“ → arzt, „Fußballtraining“ → sport).
 * Längster Treffer gewinnt („Schwimmbad“ = Freizeit statt „schwimm“ = Sport).
 * Kurze Wörter (≤ 4 Zeichen) zählen nur am Wortanfang oder -ende.
 */
const KEYWORDS: Record<string, string[]> = {
  test: ['schularbeit', 'test', 'prüfung', 'lernzielkontrolle', 'referat', 'mitarbeitskontrolle', 'stundenwiederholung', 'diktat'],
  arzt: ['arzt', 'ärztin', 'doktor', 'praxis', 'impfung', 'impfen', 'untersuchung', 'physio', 'therapie', 'krankenhaus', 'ordination', 'logopäd', 'ergotherap', 'kieferorthopäd', 'zahnspange', 'mutter-kind-pass', 'blutabnahme', 'röntgen', 'osteopath', 'hebamme', 'apotheke', 'optiker', 'zahnreinigung', 'arztbesuch', 'arzttermin'],
  sport: ['training', 'fußball', 'fussball', 'schwimm', 'turnen', 'tennis', 'handball', 'basketball', 'volleyball', 'judo', 'karate', 'reiten', 'reitstunde', 'ski', 'skikurs', 'joggen', 'lauf', 'yoga', 'fitness', 'gym', 'radfahren', 'klettern', 'tanzen', 'tanzkurs', 'ballett', 'eishockey', 'eislaufen', 'leichtathletik', 'turnier', 'kinderturnen', 'pilates', 'zumba', 'spinning', 'badminton', 'tischtennis', 'golf', 'kampfsport', 'boxen', 'surfen'],
  schule: ['schule', 'elternabend', 'elternsprechtag', 'sprechstunde', 'nachhilfe', 'wandertag', 'schikurs', 'schullandwoche', 'projekttag', 'zeugnis', 'kindergarten', 'krabbelstube', 'hort', 'lernen', 'hausübung', 'schulausflug', 'schulfest', 'schulstart', 'anmeldung schule', 'tag der offenen tür'],
  musik: ['klavier', 'gitarre', 'geige', 'violine', 'musikschule', 'chor', 'flöte', 'schlagzeug', 'konzert', 'band', 'orchester', 'musik', 'gesang', 'singen', 'cello', 'trompete', 'akkordeon', 'harmonika', 'keyboard', 'vorspiel'],
  feier: ['geburtstag', 'party', 'feier', 'fest', 'hochzeit', 'taufe', 'kommunion', 'firmung', 'jubiläum', 'grillen', 'silvester', 'weihnacht', 'ostern', 'muttertag', 'vatertag', 'namenstag', 'jahrestag', 'kindergeburtstag', 'polterabend', 'sponsion'],
  arbeit: ['arbeit', 'meeting', 'besprechung', 'dienst', 'büro', 'schicht', 'homeoffice', 'konferenz', 'dienstreise', 'workshop', 'schulung', 'kunde', 'kundentermin', 'mitarbeitergespräch', 'nachtdienst', 'bereitschaft'],
  freizeit: ['kino', 'zoo', 'schwimmbad', 'freibad', 'hallenbad', 'spielplatz', 'museum', 'theater', 'ausflug', 'wandern', 'therme', 'picknick', 'freunde', 'spieleabend', 'spielenachmittag', 'zirkus', 'tierpark', 'bowling', 'minigolf', 'playdate', 'besuch', 'oma', 'opa', 'essen gehen', 'restaurant', 'brunch', 'pfadfinder', 'jungschar', 'bibliothek', 'bücherei', 'gottesdienst', 'kirche'],
  reise: ['urlaub', 'reise', 'flug', 'flughafen', 'hotel', 'ferienlager', 'camp', 'zug', 'abreise', 'anreise', 'kurzurlaub', 'städtetrip', 'camping', 'kreuzfahrt'],
  haushalt: ['müll', 'restmüll', 'altpapier', 'gelber sack', 'gelbe tonne', 'biomüll', 'bio-tonne', 'einkaufen', 'einkauf', 'putzen', 'wäsche', 'handwerker', 'reparatur', 'rauchfangkehrer', 'pickerl', 'werkstatt', 'reifenwechsel', 'ablesen', 'zählerstand', 'installateur', 'elektriker', 'paket', 'sperrmüll', 'altstoff', 'friseur', 'frisör', 'tierarzt', 'hundeschule', 'gassi', 'garten', 'rasen'],
};
// tierarzt (Haushalt/Haustier) soll „arzt“ schlagen – längerer Treffer gewinnt ohnehin

const isLetter = (ch: string | undefined) => !!ch && /\p{L}/u.test(ch);

export function guessCategory(title: string): string | undefined {
  const t = title.toLowerCase();
  let best: { key: string; len: number } | undefined;
  for (const [key, words] of Object.entries(KEYWORDS)) {
    for (const w of words) {
      let i = t.indexOf(w);
      while (i >= 0) {
        const ok = w.length > 4 || !isLetter(t[i - 1]) || !isLetter(t[i + w.length]);
        if (ok && (!best || w.length > best.len)) best = { key, len: w.length };
        if (ok) break;
        i = t.indexOf(w, i + 1);
      }
    }
  }
  return best?.key;
}
