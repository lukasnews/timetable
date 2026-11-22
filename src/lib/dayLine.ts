/** Uhrzeit-Text eines Vorkommens an einem bestimmten Tag – auch für Termine über mehrere Tage */
export function timeOnDay(o: { start: string; end: string; event: { allDay: boolean } }, day: string): string {
  if (o.event.allDay) return 'ganztägig';
  const sd = o.start.slice(0, 10), ed = o.end.slice(0, 10);
  const st = o.start.slice(11, 16), et = o.end.slice(11, 16);
  if (sd === day) return ed > day ? `ab ${st}` : st;
  if (ed > day) return 'ganztägig';
  return `bis ${et}`;
}

/** Findet das Vorkommen an diesem Tag statt? (ganztägig: Ende exklusiv; mit Uhrzeit: auch Folgetage bis zum Ende) */
export function occursOn(o: { start: string; end: string; event: { allDay: boolean } }, day: string): boolean {
  if (o.event.allDay) return o.start.slice(0, 10) <= day && o.end.slice(0, 10) > day;
  return o.start.slice(0, 10) <= day && (o.start.slice(0, 10) === day || o.end > `${day}T00:00`);
}
