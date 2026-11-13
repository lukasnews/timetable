/**
 * Erinnerungs-Dienst für ntfy (Cloudflare Worker, kostenlos).
 * Läuft alle 5 Minuten, liest die Termine aus Firestore und schickt fällige
 * Erinnerungen an die ntfy-Topics der betroffenen Personen.
 * Einrichtung: siehe SETUP.md, Abschnitt "Erinnerungen per ntfy".
 */
import { expand } from '../src/lib/recurrence';
import { addDays, addMinutes } from '../src/lib/dates';
import type { CalEvent, Person } from '../src/types';

interface Env {
  FIREBASE_API_KEY: string;
  FIREBASE_PROJECT_ID: string;
  FAMILY_ID: string;
  /** Refresh-Token eines anonymen Firebase-Nutzers (über /token?family=… erzeugen) */
  FIREBASE_REFRESH_TOKEN?: string;
  NTFY_SERVER?: string;
  /** Optionales Zugriffstoken für geschützte ntfy-Topics */
  NTFY_TOKEN?: string;
  /** Topic für Termine der ganzen Familie (ohne Person) */
  FAMILY_TOPIC?: string;
  TIMEZONE?: string;
}

const INTERVAL_MIN = 5;

async function signUp(env: Env): Promise<{ idToken: string; refreshToken: string }> {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!r.ok) throw new Error('signUp ' + r.status + ' ' + (await r.text()));
  return r.json();
}

let cached: { token: string; until: number } | null = null;
async function idToken(env: Env): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  if (!env.FIREBASE_REFRESH_TOKEN) {
    const s = await signUp(env);
    cached = { token: s.idToken, until: Date.now() + 50 * 60000 };
    return s.idToken;
  }
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${env.FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(env.FIREBASE_REFRESH_TOKEN)}`,
  });
  if (!r.ok) throw new Error('refresh ' + r.status + ' ' + (await r.text()));
  const j = (await r.json()) as { id_token: string };
  cached = { token: j.id_token, until: Date.now() + 50 * 60000 };
  return j.id_token;
}

/** Firestore-REST-Werte in normale Objekte umwandeln */
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
function fromFields(f: Record<string, any>) {
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));
}

async function list<T>(env: Env, token: string, col: string): Promise<T[]> {
  const out: T[] = [];
  let page = '';
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/families/${env.FAMILY_ID}/${col}?pageSize=300${page ? '&pageToken=' + page : ''}`;
    const r = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error(`list ${col} ${r.status} ${await r.text()}`);
    const j = (await r.json()) as { documents?: { name: string; fields: any }[]; nextPageToken?: string };
    for (const d of j.documents ?? []) out.push({ ...fromFields(d.fields ?? {}), id: d.name.split('/').pop() } as T);
    page = j.nextPageToken ?? '';
  } while (page);
  return out;
}

/** Aktuelle Wanduhrzeit in der Zeitzone der Familie als "YYYY-MM-DDTHH:mm" */
function localNow(tz: string, date = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export async function run(env: Env, now = new Date()) {
  const tz = env.TIMEZONE || 'Europe/Vienna';
  const to = localNow(tz, now);
  const from = localNow(tz, new Date(now.getTime() - INTERVAL_MIN * 60000));
  const token = await idToken(env);
  const [events, persons] = await Promise.all([list<CalEvent>(env, token, 'events'), list<Person>(env, token, 'persons')]);
  const day = to.slice(0, 10);
  const occs = expand(events.filter((e) => e.reminderMinutes != null), addDays(day, -1), addDays(day, 4));
  const sent: string[] = [];
  for (const o of occs) {
    const ev = o.event;
    const start = ev.allDay ? `${o.start}T08:00` : o.start;
    const at = addMinutes(start, -(ev.reminderMinutes ?? 0));
    if (!(at > from && at <= to)) continue;
    const ps = persons.filter((p) => ev.personIds?.includes(p.id));
    let topics = ps.map((p) => p.ntfyTopic).filter(Boolean) as string[];
    if (!topics.length) topics = env.FAMILY_TOPIC ? [env.FAMILY_TOPIC] : (ps.length ? [] : persons.map((p) => p.ntfyTopic).filter(Boolean) as string[]);
    const when = ev.allDay ? 'Ganztägig' : `${o.start.slice(11)} Uhr`;
    const dateText = o.start.slice(0, 10) === day ? 'Heute' : o.start.slice(0, 10).split('-').reverse().join('.');
    const body = [`${dateText}, ${when}`, ps.map((p) => p.name).join(', '), ev.location].filter(Boolean).join(' · ');
    for (const t of new Set(topics)) {
      const headers: Record<string, string> = {
        // RFC 2047, damit Umlaute im Titel ankommen
        Title: `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(ev.title)))}?=`,
        Tags: ev.kind === 'birthday' ? 'birthday' : 'calendar',
      };
      if (env.NTFY_TOKEN) headers.Authorization = 'Bearer ' + env.NTFY_TOKEN;
      await fetch(`${(env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '')}/${encodeURIComponent(t)}`, { method: 'POST', headers, body });
      sent.push(`${t}: ${ev.title}`);
    }
  }
  return sent;
}

export default {
  async scheduled(_e: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(run(env).then((s) => s.length && console.log('gesendet', s)).catch((e) => console.error(e)));
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // Einmalig: Refresh-Token erzeugen (nur mit gültiger Familien-ID)
    if (url.pathname === '/token' && url.searchParams.get('family') === env.FAMILY_ID) {
      const s = await signUp(env);
      return new Response(s.refreshToken);
    }
    // Test: /test?family=… schickt sofort fällige Erinnerungen der letzten 5 Minuten
    if (url.pathname === '/test' && url.searchParams.get('family') === env.FAMILY_ID) {
      return Response.json(await run(env));
    }
    return new Response('Familienkalender-Erinnerungen laufen.');
  },
};
