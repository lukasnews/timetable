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
