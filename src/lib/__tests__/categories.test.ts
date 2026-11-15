import { describe, expect, it } from 'vitest';
import { guessCategory } from '../categories';

describe('Kategorie aus dem Titel', () => {
  it.each([
    ['Zahnarzt', 'arzt'], ['Kinderarzt Lena', 'arzt'], ['Fußballtraining', 'sport'], ['Schwimmen', 'sport'],
    ['Schwimmbad mit Freunden', 'freizeit'], ['Mathe-Schularbeit', 'test'], ['Englisch Test', 'test'], ['Mathetest', 'test'],
    ['Elternabend', 'schule'], ['Skikurs', 'sport'], ['Schikurs 3b', 'schule'], ['Klavierstunde', 'musik'],
    ['Geburtstag Oma', 'feier'], ['Restmüll', 'haushalt'], ['Gelber Sack', 'haushalt'], ['Tierarzt Hund', 'haushalt'],
    ['Urlaub Kroatien', 'reise'], ['Meeting', 'arbeit'], ['Kino', 'freizeit'],
  ])('%s → %s', (t, k) => expect(guessCategory(t)).toBe(k));
  it('ohne Treffer und keine Treffer mitten im Wort', () => {
    expect(guessCategory('Irgendwas')).toBeUndefined();
    expect(guessCategory('Ablaufdatum notieren')).toBeUndefined(); // „lauf“ mitten im Wort zählt nicht
    expect(guessCategory('Arztbesuch')).toBe('arzt');
  });
});
