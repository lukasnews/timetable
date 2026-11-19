/**
 * Erinnerungen per ntfy – Kernlogik (läuft in GitHub Actions, siehe reminders/run.ts).
 * Liest Termine aus Firestore, berechnet fällige Erinnerungen im Zeitfenster
 * (letzter Lauf, jetzt] und schickt sie an den ntfy-Server.
 */
import { expand } from '../src/lib/recurrence';
import { addDays, addMinutes } from '../src/lib/dates';
import type { CalEvent, FamilySettings, IcsSource, Person, Timetable } from '../src/types';
import { parseICS } from '../src/lib/ics';
import { planSync } from '../src/lib/icsSync';
import { fetchRisIcs, isRisKalender } from '../src/lib/risMuell';
import { displayTitle } from '../src/lib/categories';
import { isKidDayOff, lessonsForDay } from '../src/lib/calendarEvents';
import { isSchoolFree } from '../src/lib/holidays';

export interface Config {
  apiKey: string;
  projectId: string;
  familyId: string;
  ntfyServer: string;
  ntfyToken?: string;
  timezone: string;
  appUrl?: string;
  /** Wenn gesetzt: auf dem Standard-Server nur Topics mit diesem Präfix (Schutz zwischen Familien) */
  topicPrefix?: string;
}

export interface ReminderState {
  id: 'reminders';
  lastRun?: string;
  sent?: string[];
  /** Wer zuletzt geprüft hat: 'cloudflare' (Hauptweg) oder 'github' (Ersatz) */
  by?: string;
  /** Zeitpunkt (ms) des letzten Laufs */
  at?: number;
  /** Datum der letzten Tages-/Wochenübersicht */
  lastDaily?: string;
  lastWeekly?: string;
  /** Änderungen seit (ms) bereits gemeldet */
  changesAt?: number;
  /** Datum des letzten täglichen Abgleichs der importierten Kalender */
  lastIcsSync?: string;
  /** Ergebnis je Kalender (für die Anzeige in der App) */
  icsStatus?: IcsStatus[];
  /** Automatische Sicherung: Datum der letzten erfolgreichen / des letzten Versuchs, Fehler */
  lastBackup?: string;
  lastBackupTry?: string;
  /** Zeitpunkt (ms) des letzten Sicherungsversuchs – nach einem Fehler stündlich neu versuchen */
  backupTryAt?: number;
  backupError?: string;
  /** Für die Anzeige in der App: nötiges Topic-Präfix ('' = keins), verwendeter Server, abgewiesene Topics */
  topicPrefix?: string;
  ntfyServer?: string;
  blockedTopics?: string[];
}

export interface IcsStatus {
  id: string;
  at: number;
  count?: number;
  changed?: number;
  error?: string;
}

export interface Notification {
  topic: string;
  title: string;
  message: string;
  priority: number;
  tags: string[];
  click?: string;
}

/* ---------------- Firebase (REST) ---------------- */

export async function signUp(cfg: Config): Promise<{ idToken: string; refreshToken: string }> {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!r.ok) throw new Error(`Firebase-Anmeldung fehlgeschlagen: ${r.status} ${await r.text()}`);
  return r.json() as Promise<{ idToken: string; refreshToken: string }>;
}

export async function refresh(cfg: Config, refreshToken: string): Promise<string> {
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${cfg.apiKey}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  });
  if (!r.ok) throw new Error(`Token-Erneuerung fehlgeschlagen: ${r.status}`);
  return ((await r.json()) as { id_token: string }).id_token;
}

function fromValue(v: any): any {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields ?? {});
  return undefined;
}
const fromFields = (f: Record<string, any>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));

export function toValue(v: unknown): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.filter((x) => x !== undefined).map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v as Record<string, unknown>) } };
  return { nullValue: null };
}
export const toFields = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toValue(x)]));

const docsUrl = (cfg: Config) =>
  `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/families/${cfg.familyId}`;

export async function list<T>(cfg: Config, token: string, col: string): Promise<T[]> {
  const out: T[] = [];
  let page = '';
  do {
    const r = await fetch(`${docsUrl(cfg)}/${col}?pageSize=300${page ? '&pageToken=' + page : ''}`, { headers: { authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error(`Lesen von ${col} fehlgeschlagen: ${r.status} ${await r.text()}`);
    const j = (await r.json()) as { documents?: { name: string; fields?: any }[]; nextPageToken?: string };
    for (const d of j.documents ?? []) out.push({ ...fromFields(d.fields ?? {}), id: d.name.split('/').pop() } as T);
    page = j.nextPageToken ?? '';
  } while (page);
  return out;
}

/** Abfrage mit einem Feldfilter (liest nur die passenden Dokumente → spart Lesezugriffe) */
export async function query<T>(cfg: Config, token: string, col: string, field: string, op: 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL' | 'EQUAL', value: number | string): Promise<T[]> {
  const r = await fetch(`${docsUrl(cfg)}:runQuery`, {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }], where: { fieldFilter: { field: { fieldPath: field }, op, value: typeof value === 'string' ? { stringValue: value } : { integerValue: String(Math.floor(value)) } } } } }),
  });
  if (!r.ok) throw new Error(`Abfrage von ${col} fehlgeschlagen: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { document?: { name: string; fields?: any } }[];
  return j.filter((x) => x.document).map((x) => ({ ...fromFields(x.document!.fields ?? {}), id: x.document!.name.split('/').pop() } as T));
}

const docName = (cfg: Config, col: string, id: string) =>
  `projects/${cfg.projectId}/databases/(default)/documents/families/${cfg.familyId}/${col}/${id}`;

/** Mehrere Dokumente schreiben/löschen (in Paketen zu 400) */
export async function commit(cfg: Config, token: string, col: string, put: { id: string }[], del: string[] = []): Promise<void> {
  const writes = [
    ...put.map((d) => ({ update: { name: docName(cfg, col, d.id), fields: toFields({ ...d, updatedAt: Date.now() } as Record<string, unknown>) } })),
    ...del.map((id) => ({ delete: docName(cfg, col, id) })),
  ];
  for (let i = 0; i < writes.length; i += 400) {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents:commit`, {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ writes: writes.slice(i, i + 400) }),
    });
    if (!r.ok) throw new Error(`Schreiben in ${col} fehlgeschlagen: ${r.status} ${(await r.text()).slice(0, 300)}`);
  }
}

export async function saveState(cfg: Config, token: string, s: ReminderState) {
  const body = { fields: {
    lastRun: { stringValue: s.lastRun ?? '' },
    sent: { arrayValue: { values: (s.sent ?? []).map((x) => ({ stringValue: x })) } },
    by: { stringValue: s.by ?? '' },
    at: { integerValue: String(s.at ?? Date.now()) },
    lastDaily: { stringValue: s.lastDaily ?? '' },
    lastWeekly: { stringValue: s.lastWeekly ?? '' },
    changesAt: { integerValue: String(s.changesAt ?? 0) },
    lastIcsSync: { stringValue: s.lastIcsSync ?? '' },
    icsStatus: toValue(s.icsStatus ?? []),
    lastBackup: { stringValue: s.lastBackup ?? '' },
    lastBackupTry: { stringValue: s.lastBackupTry ?? '' },
    backupError: { stringValue: s.backupError ?? '' },
    backupTryAt: { integerValue: String(s.backupTryAt ?? 0) },
    topicPrefix: { stringValue: s.topicPrefix ?? '' },
    ntfyServer: { stringValue: s.ntfyServer ?? '' },
    blockedTopics: { arrayValue: { values: (s.blockedTopics ?? []).map((x) => ({ stringValue: x })) } },
  } };
  const r = await fetch(`${docsUrl(cfg)}/meta/reminders`, {
    method: 'PATCH', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Status speichern fehlgeschlagen: ${r.status} ${await r.text()}`);
}

/* ---------------- ntfy ---------------- */

export async function sendNtfy(cfg: Config, n: Notification): Promise<void> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.ntfyToken) headers.Authorization = `Bearer ${cfg.ntfyToken}`;
  const r = await fetch(cfg.ntfyServer.replace(/\/$/, ''), { method: 'POST', headers, body: JSON.stringify(n) });
  if (r.ok) return;
  const hint = r.status === 401 || r.status === 403 ? ' → Token oder Rechte für dieses Topic falsch'
    : r.status === 400 ? ' → Payload-Format falsch' : '';
  throw new Error(`ntfy ${r.status}${hint}: ${await r.text()}`);
}

const normServer = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase();

/**
 * Versand-Einstellungen für eine Familie.
 * - Eigene Familie (kein topicPrefix): Server des Dienstes mit Token, eigene Topics.
 * - Fremde Familien: nur ihr EIGENER Server (ohne den Token des Dienstes) – der Server des Dienstes
 *   ist für sie gesperrt, auch wenn sie ihn eintragen. Topics nur mit dem geheimen Präfix der Familie,
 *   damit sie auf öffentlichen Servern (z. B. ntfy.sh) nicht erratbar sind.
 */
export function ntfyFor(cfg: Config, family?: Partial<FamilySettings>): { cfg: Config; allowed: (topic: string) => boolean; missingServer?: boolean } {
  const own = family?.ntfyServer?.trim();
  const ownOk = !!own && /^https:\/\/[^\s/]+/i.test(own) && normServer(own) !== normServer(cfg.ntfyServer);
  const prefix = cfg.topicPrefix;
  if (!prefix) {
    return ownOk ? { cfg: { ...cfg, ntfyServer: own!, ntfyToken: undefined }, allowed: () => true } : { cfg, allowed: () => true };
  }
  if (!ownOk) return { cfg: { ...cfg, ntfyServer: '', ntfyToken: undefined }, allowed: () => false, missingServer: true };
  return { cfg: { ...cfg, ntfyServer: own!, ntfyToken: undefined }, allowed: (t) => t === prefix || t.startsWith(prefix + '-') };
}

/* ---------------- Logik ---------------- */

/** Wanduhrzeit in der Zeitzone der Familie: "YYYY-MM-DDTHH:mm" */
export function localNow(tz: string, date = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Ganztägige Termine: Bezugszeit 08:00 Uhr am Tag */
const ALL_DAY_TIME = '08:00';
/** Höchstens so weit zurück nachholen, falls Läufe ausgefallen sind */
const MAX_CATCHUP_MIN = 120;

/** Geburtstage aus den Profilen als (virtuelle) jährliche Termine für die ganze Familie */
export function profileBirthdays(persons: Person[]): CalEvent[] {
  return persons.filter((p) => p.birthday).map((p) => ({
    id: 'bday-' + p.id, title: p.name, start: p.birthday!, end: addDays(p.birthday!, 1), allDay: true, personIds: [],
    kind: 'birthday' as const, birthYear: Number(p.birthday!.slice(0, 4)), reminderMinutes: p.birthdayReminder ?? null,
    recurrence: { freq: 'yearly' as const, interval: 1, end: { type: 'never' as const } },
  }));
}

const topicsOf = (persons: Person[], ids: string[] | undefined, family?: Partial<FamilySettings>, except?: string): string[] => {
  const ps = persons.filter((p) => ids?.includes(p.id));
  let topics = ps.filter((p) => p.id !== except).map((p) => p.ntfyTopic).filter(Boolean) as string[];
  if (!ps.length) {
    topics = family?.ntfyFamilyTopic ? [family.ntfyFamilyTopic] : persons.filter((p) => p.id !== except).map((p) => p.ntfyTopic).filter(Boolean) as string[];
  }
  return [...new Set(topics)];
};

const dateText = (d: string, today: string) =>
  d === today ? 'Heute' : d === addDays(today, 1) ? 'Morgen'
    : new Date(d + 'T12:00:00Z').toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });

/** Tages- bzw. Wochenübersicht: je Topic eine Nachricht mit den passenden Terminen */
export function digest(opts: { events: CalEvent[]; persons: Person[]; family?: Partial<FamilySettings>; from: string; days: number; title: string; appUrl?: string; timetables?: Timetable[]; drivers?: boolean }): Notification[] {
  const { persons, family, from, days } = opts;
  // Mitbringen aus dem Stundenplan (nur Tagesübersicht, nur an Schultagen)
  const schoolBring = new Map<string, string[]>(); // personId → Zeilen
  if (days === 1 && opts.timetables && !isSchoolFree(from)) {
    const free = expand(opts.events.filter((e) => e.schoolFree), from, addDays(from, 1));
    for (const tt of opts.timetables) {
      const kid = persons.find((p) => p.id === tt.id && p.hasTimetable);
      if (!kid || isKidDayOff(tt, from) || free.some((o) => !o.event.personIds.length || o.event.personIds.includes(kid.id))) continue;
      const items = lessonsForDay(tt, from).filter((l) => l.bring).map((l) => `${l.bring} (${l.subject})`);
      if (items.length) schoolBring.set(kid.id, [`🎒 ${kid.name}: ${items.join(', ')}`]);
    }
  }
  const occs = expand([...opts.events, ...profileBirthdays(persons)], from, addDays(from, days)).sort((a, b) => a.start.localeCompare(b.start));
  const line = (o: (typeof occs)[number]) => {
    const ev = o.event;
    const names = persons.filter((p) => ev.personIds.includes(p.id)).map((p) => p.name).join(', ');
    const dayPart = days > 1 ? dateText(o.start.slice(0, 10) < from ? from : o.start.slice(0, 10), '') + ' ' : '';
    const t = ev.allDay ? '' : o.start.slice(11) + ' ';
    const drv = persons.filter((p) => ev.driverIds?.includes(p.id)).map((p) => p.name).join(', ');
    return `${dayPart}${t}${displayTitle(ev)}${names ? ` (${names})` : ''}${drv ? ` 🚗 ${drv}` : ''}${ev.bring ? ` 🎒 ${ev.bring}` : ''}`;
  };
  // Fahrdienst-Block (Wochenübersicht): je Fahrer eine Zeile
  const driverLine = (p: Person) => {
    const mine = occs.filter((o) => o.event.driverIds?.includes(p.id));
    if (!mine.length) return '';
    const items = mine.map((o) => {
      const kids = persons.filter((x) => o.event.personIds.includes(x.id) && x.id !== p.id).map((x) => x.name).join(', ');
      return `${dateText(o.start.slice(0, 10), '')}${o.event.allDay ? '' : ' ' + o.start.slice(11)} ${o.event.title}${kids ? ` (${kids})` : ''}`;
    });
    return `${p.name}: ${items.join(' · ')}`;
  };
  const driverBlock = (only?: string): string[] => {
    if (!opts.drivers || days <= 1) return [];
    const lines = persons.filter((p) => !only || p.id === only).map(driverLine).filter(Boolean);
    return lines.length ? ['', only ? '🚗 Du fährst:' : '🚗 Fahrdienst diese Woche:', ...lines.map((l) => (only ? l.replace(/^[^:]+: /, '') : l))] : [];
  };
  const targets = new Map<string, string | null>(); // topic → personId (null = alle)
  if (family?.ntfyFamilyTopic) targets.set(family.ntfyFamilyTopic, null);
  for (const p of persons) if (p.ntfyTopic && !targets.has(p.ntfyTopic)) targets.set(p.ntfyTopic, p.id);
  const out: Notification[] = [];
  for (const [topic, pid] of targets) {
    const mine = occs.filter((o) => pid === null || (!o.event.personIds.length && !o.event.driverIds?.length) || o.event.personIds.includes(pid) || !!o.event.driverIds?.includes(pid));
    // Mitbringen: an das Familien-Topic alle Kinder, sonst nur das eigene (Eltern ohne Stundenplan bekommen alle)
    const me = pid ? persons.find((p) => p.id === pid) : undefined;
    const bring = [...schoolBring.entries()].filter(([kid]) => pid === null || kid === pid || !me?.hasTimetable).flatMap(([, l]) => l);
    if (!mine.length && !bring.length) continue;
    const drv = driverBlock(pid ?? undefined);
    out.push({ topic, title: opts.title, message: [...mine.slice(0, 40).map(line), ...bring, ...drv].join('\n'), priority: 3, tags: ['spiral_calendar'], ...(opts.appUrl ? { click: opts.appUrl } : {}) });
  }
  return out;
}

/** Nachrichten zu neuen/geänderten Terminen */
export function changeNotifications(opts: { changed: CalEvent[]; persons: Person[]; family?: Partial<FamilySettings>; since: number; today: string; appUrl?: string }): Notification[] {
  const seen = new Set<string>();
  const list = opts.changed.filter((e) => !e.importSource).filter((e) => { const k = e.seriesId ?? e.id; if (seen.has(k)) return false; seen.add(k); return true; });
  const out: Notification[] = [];
  const describe = (ev: CalEvent) => {
    const names = opts.persons.filter((p) => ev.personIds?.includes(p.id)).map((p) => p.name).join(', ');
    const when = ev.allDay ? dateText(ev.start, opts.today) : `${dateText(ev.start.slice(0, 10), opts.today)}, ${ev.start.slice(11)} Uhr`;
    return [when + (ev.recurrence ? ' (Serie)' : ''), names].filter(Boolean).join('\n');
  };
  if (list.length > 4) {
    const by = list[0].changedBy;
    for (const topic of topicsOf(opts.persons, [], opts.family, by)) {
      out.push({ topic, title: `${list.length} Termine neu oder geändert`, message: list.slice(0, 8).map((e) => e.title).join(', '), priority: 2, tags: ['pencil2'], ...(opts.appUrl ? { click: opts.appUrl } : {}) });
    }
    return out;
  }
  for (const ev of list) {
    const isNew = !!ev.createdAt && ev.createdAt > opts.since;
    const who = opts.persons.find((p) => p.id === ev.changedBy)?.name;
    for (const topic of topicsOf(opts.persons, ev.personIds, opts.family, ev.changedBy)) {
      out.push({ topic, title: `${isNew ? 'Neu' : 'Geändert'}: ${ev.title}`, message: describe(ev) + (who ? `\n${isNew ? 'eingetragen' : 'geändert'} von ${who}` : ''),
        priority: 2, tags: [isNew ? 'heavy_plus_sign' : 'pencil2'], ...(opts.appUrl ? { click: opts.appUrl } : {}) });
    }
  }
  return out;
}

export function dueNotifications(opts: {
  events: CalEvent[];
  persons: Person[];
  family?: Partial<FamilySettings>;
  from: string; // exklusiv
  to: string; // inklusiv
  sent: Set<string>;
  appUrl?: string;
}): { key: string; n: Notification }[] {
  const { events, persons, from, to } = opts;
  const out: { key: string; n: Notification }[] = [];
  const day = to.slice(0, 10);
  const occs = expand([...events.filter((e) => e.reminderMinutes != null), ...profileBirthdays(persons).filter((e) => e.reminderMinutes != null)],
    addDays(from.slice(0, 10), -1), addDays(day, 4));
  for (const o of occs) {
    const ev = o.event;
    const start = ev.allDay ? `${o.start}T${ALL_DAY_TIME}` : o.start;
    const at = addMinutes(start, -(ev.reminderMinutes ?? 0));
    if (!(at > from && at <= to)) continue;
    const key = `${ev.id}|${o.occStart}|${ev.reminderMinutes}`;
    if (opts.sent.has(key)) continue;

    const ps = persons.filter((p) => ev.personIds?.includes(p.id));
    const drivers = persons.filter((p) => ev.driverIds?.includes(p.id));
    let topics = [...ps, ...drivers].map((p) => p.ntfyTopic).filter(Boolean) as string[];
    if (!ps.length && !drivers.length) topics = topicsOf(persons, [], opts.family);
    const occDay = o.start.slice(0, 10);
    const dayText = occDay === day ? 'Heute' : occDay === addDays(day, 1) ? 'Morgen' : occDay.split('-').reverse().join('.');
    const isBirthday = ev.kind === 'birthday';
    const age = isBirthday && ev.birthYear ? Number(occDay.slice(0, 4)) - ev.birthYear : undefined;
    const title = isBirthday ? `🎂 ${ev.title}${age ? ` wird ${age}` : ''}` : displayTitle(ev);
    const when = ev.allDay ? 'ganztägig' : `${o.start.slice(11)}–${o.end.slice(11)} Uhr`;
    const message = [`${dayText}, ${when}`, ps.map((p) => p.name).join(', '), drivers.length ? `🚗 Fahrdienst: ${drivers.map((p) => p.name).join(', ')}` : '', ev.bring ? `🎒 Mitbringen: ${ev.bring}` : '', ev.location ? `📍 ${ev.location}` : '']
      .filter(Boolean).join('\n');
    for (const topic of new Set(topics)) {
      out.push({
        key,
        n: {
          topic, title, message,
          priority: (ev.reminderMinutes ?? 0) <= 15 && !ev.allDay ? 4 : 3,
          tags: [isBirthday ? 'birthday' : 'calendar'],
          ...(opts.appUrl ? { click: opts.appUrl } : {}),
        },
      });
    }
  }
  return out;
}

/* ---------------- Importierte Kalender ---------------- */

export async function fetchIcs(url: string): Promise<string> {
  const u = url.trim().replace(/^webcal:\/\//i, 'https://');
  if (isRisKalender(u)) {
    return fetchRisIcs(u, async (x) => {
      const r = await fetch(x, { headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (Familienkalender)' } });
      if (!r.ok) throw new Error(`Gemeindeseite antwortet mit ${r.status}`);
      return r.text();
    });
  }
  const r = await fetch(u, { headers: { accept: 'text/calendar, text/plain, */*', 'user-agent': 'Familienkalender/1.0 (+https://timetable.chaoten.online)' } });
  if (!r.ok) throw new Error(`Server antwortet mit ${r.status}`);
  const text = await r.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Unter dem Link liegt keine Kalenderdatei (.ics)');
  return text;
}

export async function syncIcs(cfg: Config, token: string, sources: IcsSource[], today: string, log = console.log): Promise<IcsStatus[]> {
  const out: IcsStatus[] = [];
  for (const src of sources) {
    try {
      const parsed = parseICS(await fetchIcs(src.url!), { source: src.name }).events;
      const existing = await query<CalEvent>(cfg, token, 'events', 'importSource', 'EQUAL', src.name);
      const plan = planSync(parsed, existing, src, today);
      if (plan.put.length || plan.del.length) await commit(cfg, token, 'events', plan.put, plan.del);
      out.push({ id: src.id, at: Date.now(), count: plan.total, changed: plan.put.length + plan.del.length });
      log(`📅 ${src.name}: ${plan.total} Termine, ${plan.put.length} neu/geändert, ${plan.del.length} entfernt`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push({ id: src.id, at: Date.now(), error: msg.slice(0, 200) });
      log(`📅 ${src.name}: Fehler – ${msg}`);
    }
  }
  return out;
}

/* ---------------- Automatische Sicherung ---------------- */

const BACKUP_KEEP_DAYS = 91;

export async function backup(cfg: Config, token: string, today: string, persons: Person[], log = console.log): Promise<void> {
  const [events, timetables, meta] = await Promise.all([
    list<CalEvent>(cfg, token, 'events'), list<Timetable>(cfg, token, 'timetables'), list<any>(cfg, token, 'meta'),
  ]);
  const settings = meta.find((m) => m.id === 'settings');
  const templates = meta.find((m) => m.id === 'templates')?.items ?? [];
  const exportedAt = new Date().toISOString();
  const data = JSON.stringify({ format: 'familienkalender-backup', version: 1, exportedAt, persons, events, timetables, settings, templates });
  if (data.length > 950_000) throw new Error(`Sicherung zu groß (${Math.round(data.length / 1000)} kB) – bitte in der App „Sicherung speichern“ nutzen`);
  await commit(cfg, token, 'backups', [{ id: today, exportedAt, data, persons: persons.length, events: events.length } as { id: string }]);
  // Alte Sicherungen entfernen (nur die Namen lesen)
  const r = await fetch(`${docsUrl(cfg)}/backups?pageSize=300&mask.fieldPaths=exportedAt`, { headers: { authorization: 'Bearer ' + token } });
  if (r.ok) {
    const j = (await r.json()) as { documents?: { name: string }[] };
    const limit = addDays(today, -BACKUP_KEEP_DAYS);
    const old = (j.documents ?? []).map((d) => d.name.split('/').pop()!).filter((id) => id < limit);
    if (old.length) await commit(cfg, token, 'backups', [], old);
  }
  log(`💾 Sicherung ${today}: ${persons.length} Personen, ${events.length} Termine (${Math.round(data.length / 1000)} kB)`);
}

export interface RunOptions {
  by?: string;
  /** Ersatz-Lauf: überspringen, wenn ein anderer Dienst in den letzten Minuten geprüft hat */
  skipIfActive?: { other: string; withinMin: number };
  /** Fremde Familien: abbrechen (FAMILY_GONE), wenn es keine Daten mehr gibt */
  dropIfEmpty?: boolean;
}

export async function run(cfg: Config, token: string, now = new Date(), log = console.log, opts: RunOptions = {}) {
  const to = localNow(cfg.timezone, now);
  const today = to.slice(0, 10);
  // Nur Termine mit Erinnerung lesen (reminderMinutes ist sonst null)
  const [events, persons, meta] = await Promise.all([
    query<CalEvent>(cfg, token, 'events', 'reminderMinutes', 'GREATER_THAN_OR_EQUAL', 0),
    list<Person>(cfg, token, 'persons'),
    list<any>(cfg, token, 'meta'),
  ]);
  // Familie gelöscht (keine Personen, keine Einstellungen) → der Dienst nimmt sie aus dem Verzeichnis
  if (opts.dropIfEmpty && !persons.length && !meta.some((m) => m.id === 'settings')) throw new Error('FAMILY_GONE');
  const state = (meta.find((m) => m.id === 'reminders') ?? { id: 'reminders' }) as ReminderState;
  if (opts.skipIfActive && state.by === opts.skipIfActive.other && state.at && now.getTime() - state.at < opts.skipIfActive.withinMin * 60000) {
    log(`${opts.skipIfActive.other} ist aktiv (letzter Lauf ${Math.round((now.getTime() - state.at) / 60000)} min her) – nichts zu tun.`);
    return;
  }
  const family = meta.find((m) => m.id === 'settings') as Partial<FamilySettings> | undefined;
  const floor = localNow(cfg.timezone, new Date(now.getTime() - MAX_CATCHUP_MIN * 60000));
  const fallback = localNow(cfg.timezone, new Date(now.getTime() - 10 * 60000));
  const from = state.lastRun && state.lastRun > floor ? state.lastRun : state.lastRun ? floor : fallback;
  const sent = new Set(state.sent ?? []);
  const next: ReminderState = { ...state, id: 'reminders', lastRun: to, by: opts.by, at: now.getTime() };
  const errors: string[] = [];
  const nt = ntfyFor(cfg, family);
  const knownTopics = new Set([family?.ntfyFamilyTopic, ...persons.map((p) => p.ntfyTopic)].filter(Boolean) as string[]);
  const blocked = new Set<string>();
  next.topicPrefix = cfg.topicPrefix ?? '';
  next.ntfyServer = nt.cfg.ntfyServer;
  const send = async (n: Notification) => {
    if (!nt.allowed(n.topic)) { blocked.add(n.topic); log(`✗ ${n.topic}: ${nt.missingServer ? 'kein eigener ntfy-Server eingetragen' : `Topic ohne Präfix ${cfg.topicPrefix}`} – nicht gesendet`); return true; }
    try { await sendNtfy(nt.cfg, n); log(`✓ ${n.topic}: ${n.title}`); return true; }
    catch (e) { errors.push(String(e instanceof Error ? e.message : e)); return false; }
  };

  // 1) Erinnerungen
  const due = dueNotifications({ events, persons, family, from, to, sent, appUrl: cfg.appUrl });
  for (const { key, n } of due) if (await send(n)) sent.add(key);
  next.sent = [...sent].slice(-300);

  // 2) Tages-/Wochenübersicht (höchstens 3 Stunden nach der eingestellten Zeit nachholen)
  const within = (start: string) => to >= `${today}T${start}` && to < addMinutes(`${today}T${start}`, 180);
  const wantDaily = !!family?.ntfyDaily && /^\d\d:\d\d$/.test(family.ntfyDaily) && state.lastDaily !== today && within(family.ntfyDaily);
  const isSunday = new Date(today + 'T12:00:00Z').getUTCDay() === 0;
  const wantWeekly = !!family?.ntfyWeekly && isSunday && state.lastWeekly !== today && within('18:00');
  if (wantDaily || wantWeekly) {
    const [all, timetables] = await Promise.all([list<CalEvent>(cfg, token, 'events'), list<Timetable>(cfg, token, 'timetables')]);
    if (wantDaily) {
      for (const n of digest({ events: all, persons, family, from: today, days: 1, title: 'Heute im Kalender', appUrl: cfg.appUrl, timetables })) await send(n);
      next.lastDaily = today;
    }
    if (wantWeekly) {
      for (const n of digest({ events: all, persons, family, from: addDays(today, 1), days: 7, title: 'Nächste Woche im Kalender', appUrl: cfg.appUrl, drivers: family?.ntfyWeeklyDrivers !== false })) await send(n);
      next.lastWeekly = today;
    }
  }

  // 3) Neue/geänderte Termine
  if (family?.ntfyChanges) {
    const since = state.changesAt || 0;
    if (since > 0) {
      // 60 s Abstand, damit zusammengehörige Änderungen (z. B. Serie teilen) gemeinsam ankommen
      const until = now.getTime() - 60_000;
      const changed = (await query<CalEvent>(cfg, token, 'events', 'updatedAt', 'GREATER_THAN', since)).filter((e) => (e.updatedAt ?? 0) <= until);
      for (const n of changeNotifications({ changed, persons, family, since, today, appUrl: cfg.appUrl })) await send(n);
      next.changesAt = Math.max(since, until);
    } else {
      next.changesAt = now.getTime();
    }
  } else {
    next.changesAt = 0;
  }

  // Hinweis in der App bleibt, bis Topic bzw. Server korrigiert sind (nicht nur bis zum nächsten Lauf)
  next.blockedTopics = [...new Set([...blocked, ...(state.blockedTopics ?? []).filter((t) => !nt.allowed(t) && knownTopics.has(t))])].slice(0, 20);
  log(`Zeitfenster ${from} – ${to}: ${due.length} Erinnerung(en), ${errors.length} Fehler`);
  await saveState(cfg, token, next);

  // Zusatzaufgaben erst danach – vorher wird vermerkt, dass sie laufen, damit ein Abbruch
  // (z. B. Rechenzeit-Grenze) höchstens einmal am Tag passiert und Erinnerungen nie blockiert
  await extras(cfg, token, { state, next, family, persons, today, to, log });
  if (errors.length) throw new Error(errors.join('\n'));
}

async function extras(cfg: Config, token: string, x: { state: ReminderState; next: ReminderState; family?: Partial<FamilySettings>; persons: Person[]; today: string; to: string; log: (s: string) => void }) {
  const { state, next, family, persons, today, to, log } = x;
  // 4) Importierte Kalender mit Link: täglich ab 04:00, neue Links bzw. „Jetzt aktualisieren“ sofort
  const auto = (family?.icsSources ?? []).filter((s) => s.url && s.auto !== false);
  const status = (state.icsStatus ?? []).filter((st) => auto.some((a) => a.id === st.id));
  const daily = auto.length > 0 && state.lastIcsSync !== today && to >= `${today}T04:00`;
  const urgent = auto.filter((s) => { const st = status.find((y) => y.id === s.id); return !st || (!!s.requested && s.requested > st.at); });
  const todo = daily ? auto : urgent;
  // 5) Automatische Sicherung, wenn die letzte mindestens 7 Tage alt ist (ab 03:00, höchstens ein Versuch pro Tag)
  const backupAge = state.lastBackup ? (Date.parse(today) - Date.parse(state.lastBackup)) / 86400000 : Infinity;
  // höchstens ein Versuch pro Tag – nach einem Fehler (z. B. Regeln erst später angepasst) stündlich erneut
  const retryAfterError = !!state.backupError && Date.now() - (state.backupTryAt ?? 0) > 60 * 60_000;
  const wantBackup = backupAge >= 7 && to >= `${today}T03:00` && (state.lastBackupTry !== today || retryAfterError);
  if (!todo.length && !wantBackup) {
    if (status.length !== (state.icsStatus ?? []).length) { next.icsStatus = status; await saveState(cfg, token, next); }
    return;
  }

  // vormerken
  const pending = todo.map((s) => ({ id: s.id, at: Date.now(), error: 'Abgebrochen – wird morgen erneut versucht' }));
  next.icsStatus = [...status.filter((st) => !todo.some((s) => s.id === st.id)), ...pending];
  if (daily) next.lastIcsSync = today;
  if (wantBackup) { next.lastBackupTry = today; next.backupTryAt = Date.now(); next.backupError = 'Abgebrochen – wird in einer Stunde erneut versucht'; }
  await saveState(cfg, token, next);

  if (todo.length) {
    const res = await syncIcs(cfg, token, todo, today, log);
    next.icsStatus = [...status.filter((st) => !res.some((r) => r.id === st.id)), ...res];
  }
  if (wantBackup) {
    try {
      await backup(cfg, token, today, persons, log);
      next.lastBackup = today;
      next.backupError = '';
    } catch (e) {
      next.backupError = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      log('💾 Sicherung fehlgeschlagen: ' + next.backupError);
    }
  }
  await saveState(cfg, token, next);
}
