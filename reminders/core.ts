/**
 * Erinnerungen per ntfy – Kernlogik (läuft in GitHub Actions, siehe reminders/run.ts).
 * Liest Termine aus Firestore, berechnet fällige Erinnerungen im Zeitfenster
 * (letzter Lauf, jetzt] und schickt sie an den ntfy-Server.
 */
import { expand } from '../src/lib/recurrence';
import { addDays, addMinutes } from '../src/lib/dates';
import type { CalEvent, FamilySettings, Person } from '../src/types';

export interface Config {
  apiKey: string;
  projectId: string;
  familyId: string;
  ntfyServer: string;
  ntfyToken?: string;
  timezone: string;
  appUrl?: string;
}

export interface ReminderState {
  id: 'reminders';
  lastRun?: string;
  sent?: string[];
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

export async function saveState(cfg: Config, token: string, s: ReminderState) {
  const body = { fields: {
    lastRun: { stringValue: s.lastRun ?? '' },
    sent: { arrayValue: { values: (s.sent ?? []).map((x) => ({ stringValue: x })) } },
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
  const occs = expand(events.filter((e) => e.reminderMinutes != null), addDays(from.slice(0, 10), -1), addDays(day, 4));
  for (const o of occs) {
    const ev = o.event;
    const start = ev.allDay ? `${o.start}T${ALL_DAY_TIME}` : o.start;
    const at = addMinutes(start, -(ev.reminderMinutes ?? 0));
    if (!(at > from && at <= to)) continue;
    const key = `${ev.id}|${o.occStart}|${ev.reminderMinutes}`;
    if (opts.sent.has(key)) continue;

    const ps = persons.filter((p) => ev.personIds?.includes(p.id));
    let topics = ps.map((p) => p.ntfyTopic).filter(Boolean) as string[];
    if (!topics.length) {
      const fam = opts.family?.ntfyFamilyTopic;
      topics = fam ? [fam] : persons.map((p) => p.ntfyTopic).filter(Boolean) as string[];
    }
    const occDay = o.start.slice(0, 10);
    const dayText = occDay === day ? 'Heute' : occDay === addDays(day, 1) ? 'Morgen' : occDay.split('-').reverse().join('.');
    const isBirthday = ev.kind === 'birthday';
    const age = isBirthday && ev.birthYear ? Number(occDay.slice(0, 4)) - ev.birthYear : undefined;
    const title = isBirthday ? `🎂 ${ev.title}${age ? ` wird ${age}` : ''}` : ev.title;
    const when = ev.allDay ? 'ganztägig' : `${o.start.slice(11)}–${o.end.slice(11)} Uhr`;
    const message = [`${dayText}, ${when}`, ps.map((p) => p.name).join(', '), ev.location ? `📍 ${ev.location}` : '']
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

export async function run(cfg: Config, token: string, now = new Date(), log = console.log) {
  const to = localNow(cfg.timezone, now);
  const [events, persons, meta] = await Promise.all([
    list<CalEvent>(cfg, token, 'events'),
    list<Person>(cfg, token, 'persons'),
    list<any>(cfg, token, 'meta'),
  ]);
  const state = (meta.find((m) => m.id === 'reminders') ?? { id: 'reminders' }) as ReminderState;
  const family = meta.find((m) => m.id === 'settings') as Partial<FamilySettings> | undefined;
  const floor = localNow(cfg.timezone, new Date(now.getTime() - MAX_CATCHUP_MIN * 60000));
  const fallback = localNow(cfg.timezone, new Date(now.getTime() - 10 * 60000));
  const from = state.lastRun && state.lastRun > floor ? state.lastRun : state.lastRun ? floor : fallback;
  const sent = new Set(state.sent ?? []);

  const due = dueNotifications({ events, persons, family, from, to, sent, appUrl: cfg.appUrl });
  const errors: string[] = [];
  for (const { key, n } of due) {
    try {
      await sendNtfy(cfg, n);
      sent.add(key);
      log(`✓ ${n.topic}: ${n.title}`);
    } catch (e) {
      errors.push(String(e instanceof Error ? e.message : e));
    }
  }
  log(`Zeitfenster ${from} – ${to}: ${due.length} Nachricht(en), ${errors.length} Fehler`);
  await saveState(cfg, token, { id: 'reminders', lastRun: to, sent: [...sent].slice(-300) });
  if (errors.length) throw new Error(errors.join('\n'));
}
