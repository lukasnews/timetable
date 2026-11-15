/**
 * Abgleich importierter Kalender (.ics) – gemeinsam für die App und den Cloudflare-Dienst.
 */
import type { CalEvent, IcsSource } from '../types';

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Ganztägige Termine: Bezugszeit 08:00 Uhr (wie bei den Erinnerungen) */
const ALL_DAY_MIN = 8 * 60;

/** Erinnerung (Minuten vorher) für einen Termin dieser Quelle */
export function reminderFor(ev: Pick<CalEvent, 'allDay' | 'start'>, src: Pick<IcsSource, 'reminder' | 'evening'>): number | null {
  if (src.evening && /^\d\d:\d\d$/.test(src.evening)) {
    const startMin = ev.allDay ? ALL_DAY_MIN : toMin(ev.start.slice(11, 16));
    return 1440 - toMin(src.evening) + startMin;
  }
  return src.reminder ?? null;
}

/** Einstellungen der Quelle auf einen (geparsten oder vorhandenen) Termin anwenden */
export function applySource(ev: CalEvent, src: IcsSource): CalEvent {
  return { ...ev, importSource: src.name, personIds: src.personIds ?? [], reminderMinutes: reminderFor(ev, src) };
}

const SKIP = new Set(['updatedAt', 'createdAt', 'changedBy']);
/** Stabile Darstellung (Schlüssel sortiert, null/undefined weggelassen) */
function stable(v: unknown, top = false): string {
  if (Array.isArray(v)) return '[' + v.map((x) => stable(x)).join(',') + ']';
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => (v as any)[k] != null && !(top && SKIP.has(k))).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stable((v as any)[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
const same = (a: CalEvent, b: CalEvent) => stable(a, true) === stable(b, true);

/**
 * Was muss geschrieben/gelöscht werden?
 * - neue/geänderte Termine → put (unveränderte werden nicht neu geschrieben)
 * - künftige Termine der Quelle, die in der Datei fehlen → del
 */
export function planSync(parsed: CalEvent[], existing: CalEvent[], src: IcsSource, today: string): { put: CalEvent[]; del: string[]; total: number } {
  const mine = existing.filter((e) => e.importSource === src.name);
  const byId = new Map(mine.map((e) => [e.id, e]));
  const wanted = parsed
    .filter((e) => !src.futureOnly || e.recurrence || e.end.slice(0, 10) >= today)
    .map((e) => applySource(e, src));
  const put: CalEvent[] = [];
  for (const e of wanted) {
    const old = byId.get(e.id);
    if (old && same(old, e)) continue;
    put.push(old?.createdAt ? { ...e, createdAt: old.createdAt } : e);
  }
  const ids = new Set(wanted.map((e) => e.id));
  const del = mine.filter((e) => !ids.has(e.id) && (e.recurrence || e.end.slice(0, 10) >= today)).map((e) => e.id);
  return { put, del, total: wanted.length };
}

/** Erinnerungs-Auswahl für importierte Kalender */
export const SOURCE_REMINDERS: { value: string; label: string }[] = [
  { value: '', label: 'Keine' },
  { value: 'evening', label: 'Am Vorabend' },
  { value: '0', label: 'Am Tag, 08:00 bzw. zum Beginn' },
  { value: '60', label: '1 Stunde vorher' },
  { value: '1440', label: '1 Tag vorher' },
];
export const EVENING_TIMES = ['17:00', '18:00', '19:00', '20:00', '21:00'];

export const sourceReminderValue = (s: Pick<IcsSource, 'reminder' | 'evening'>) =>
  s.evening ? 'evening' : s.reminder == null ? '' : String(s.reminder);
export function setSourceReminder(s: IcsSource, value: string): IcsSource {
  if (value === 'evening') return { ...s, evening: s.evening || '19:00', reminder: null };
  return { ...s, evening: null, reminder: value === '' ? null : Number(value) };
}
