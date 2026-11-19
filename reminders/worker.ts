/**
 * Cloudflare Worker: prüft alle 5 Minuten fällige Erinnerungen und schickt sie per ntfy.
 * Eingerichtet und aktualisiert über .github/workflows/deploy-worker.yml.
 */
import { commit, fetchIcs, list, run, refresh, type Config } from './core';
import { registryKey, topicPrefix } from '../src/lib/familyKey';
import { toICS } from '../src/lib/ics';
import type { CalEvent, FamilySettings, Person } from '../src/types';

interface Env {
  FIREBASE_API_KEY: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_REFRESH_TOKEN: string;
  /** Die „eigene“ Familie (bestehende ntfy-Topics ohne Präfix erlaubt) */
  FAMILY_ID: string;
  /** Geheimer Pfad des Verzeichnisses aller angemeldeten Familien (nur der Dienst kennt ihn) */
  REGISTRY_ID?: string;
  /** Höchstzahl angemeldeter Familien (Standard 50) */
  MAX_FAMILIES?: string;
  /** Unteranfragen pro Lauf (Cloudflare Free: 50) */
  SUBREQUEST_BUDGET?: string;
  NTFY_TOKEN?: string;
  NTFY_SERVER?: string;
  APP_URL?: string;
}

interface Entry { id: string; familyId: string; feedToken?: string; at?: number }

let cached: { token: string; until: number } | null = null;

// Unteranfragen zählen, damit ein Lauf das Limit von Cloudflare nicht reißt
let calls = 0;
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((...a: Parameters<typeof fetch>) => { calls++; return realFetch(...a); }) as typeof fetch;

async function idToken(cfg: Config, env: Env): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const token = await refresh(cfg, env.FIREBASE_REFRESH_TOKEN);
  cached = { token, until: Date.now() + 50 * 60_000 };
  return token;
}

const validId = (s: string | null): s is string => !!s && /^[a-z0-9]{16,40}$/.test(s);

function config(env: Env, familyId = env.FAMILY_ID, prefix?: string): Config {
  return {
    apiKey: env.FIREBASE_API_KEY,
    projectId: env.FIREBASE_PROJECT_ID,
    familyId,
    ntfyServer: env.NTFY_SERVER || 'https://ntfy.chaoten.online',
    ntfyToken: env.NTFY_TOKEN,
    timezone: 'Europe/Vienna',
    appUrl: env.APP_URL || 'https://timetable.chaoten.online/',
    topicPrefix: prefix,
  };
}

/** Konfiguration für eine Familie: fremde Familien nur mit Topic-Präfix */
async function familyConfig(env: Env, familyId: string): Promise<Config> {
  return config(env, familyId, familyId === env.FAMILY_ID ? undefined : await topicPrefix(familyId));
}

let regCache: { at: number; entries: Entry[] } | null = null;
async function registry(env: Env, token: string, fresh = false): Promise<Entry[]> {
  if (!validId(env.REGISTRY_ID ?? null)) return [];
  if (!fresh && regCache && Date.now() - regCache.at < 60_000) return regCache.entries;
  const entries = (await list<Entry>(config(env, env.REGISTRY_ID), token, 'meta')).filter((e) => validId(e.familyId));
  regCache = { at: Date.now(), entries };
  return entries;
}

async function isKnown(env: Env, token: string, familyId: string): Promise<boolean> {
  if (familyId === env.FAMILY_ID) return true;
  return (await registry(env, token)).some((e) => e.familyId === familyId);
}

/** Alle 5 Minuten: eigene Familie zuerst, dann reihum so viele angemeldete, wie das Budget erlaubt */
async function check(env: Env, log: (s: string) => void = console.log) {
  calls = 0;
  const base = config(env);
  const token = await idToken(base, env);
  let mainError: unknown = null;
  try { await run(base, token, new Date(), log, { by: 'cloudflare' }); } catch (e) { mainError = e; }
  const others = (await registry(env, token, true).catch(() => [] as Entry[])).filter((e) => e.familyId !== env.FAMILY_ID);
  const budget = Number(env.SUBREQUEST_BUDGET) || 45;
  const startAt = Math.floor(Date.now() / 300_000) % others.length;
  for (let i = 0; i < others.length; i++) {
    if (calls + 8 > budget) { log(`Budget erreicht – ${others.length - i} Familie(n) beim nächsten Lauf`); break; }
    const e = others[(startAt + i) % others.length];
    try { await run(await familyConfig(env, e.familyId), token, new Date(), () => {}, { by: 'cloudflare' }); }
    catch (err) { log(`Familie ${e.id.slice(0, 6)}: ${String(err).slice(0, 200)}`); }
  }
  if (mainError) throw mainError;
}

/** Familie beim Dienst anmelden (nur wer die geheime Familien-ID kennt; die Familie muss Daten haben) */
async function register(env: Env, familyId: string, serviceUrl: string): Promise<Response> {
  const cors = { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8' };
  if (!validId(env.REGISTRY_ID ?? null)) return new Response('Der Dienst nimmt keine weiteren Familien auf', { status: 503, headers: cors });
  const cfg = config(env, familyId);
  const token = await idToken(cfg, env);
  const [meta, persons] = await Promise.all([list<{ id: string; feedToken?: string; url?: string }>(cfg, token, 'meta'), list<{ id: string }>(cfg, token, 'persons')]);
  if (!persons.length && !meta.some((m) => m.id === 'settings')) return new Response('Unbekannte Familie', { status: 404, headers: cors });
  const all = await registry(env, token, true);
  const key = await registryKey(familyId);
  const known = all.find((e) => e.id === key);
  const max = Number(env.MAX_FAMILIES) || 50;
  if (!known && familyId !== env.FAMILY_ID && all.length >= max) return new Response('Der Dienst ist derzeit voll', { status: 503, headers: cors });
  const feedToken = meta.find((m) => m.id === 'settings')?.feedToken ?? '';
  if (familyId !== env.FAMILY_ID && (!known || (known.feedToken ?? '') !== feedToken)) {
    await commit(config(env, env.REGISTRY_ID), token, 'meta', [{ id: key, familyId, feedToken, at: known?.at ?? Date.now() } as Entry]);
    regCache = null;
  }
  if (meta.find((m) => m.id === 'service')?.url !== serviceUrl) await commit(cfg, token, 'meta', [{ id: 'service', url: serviceUrl } as { id: string }]);
  return new Response('ok', { headers: cors });
}

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(check(env).catch((e) => console.error(String(e))));
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const fam = url.searchParams.get('family');
    // Anmelden: POST /register?family=…
    if (url.pathname === '/register') {
      if (req.method === 'OPTIONS') return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST' } });
      if (req.method !== 'POST' || !validId(fam)) return new Response('Ungültig', { status: 400, headers: { 'access-control-allow-origin': '*' } });
      try { return await register(env, fam, url.origin); }
      catch (e) { return new Response(String(e instanceof Error ? e.message : e).slice(0, 200), { status: 500, headers: { 'access-control-allow-origin': '*' } }); }
    }
    // Manuell prüfen (nur mit Familien-ID): /run?family=…
    if (url.pathname === '/run' && validId(fam)) {
      const lines: string[] = [];
      try {
        if (fam === env.FAMILY_ID) await check(env, (s) => lines.push(s));
        else {
          const cfg = await familyConfig(env, fam);
          const token = await idToken(cfg, env);
          if (!(await isKnown(env, token, fam))) return new Response('Nicht angemeldet', { status: 403 });
          await run(cfg, token, new Date(), (s) => lines.push(s), { by: 'cloudflare' });
        }
        return new Response(lines.join('\n') + '\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      } catch (e) {
        return new Response('Fehler: ' + String(e), { status: 500 });
      }
    }
    // .ics-Link für die App laden (viele Server erlauben das nicht direkt aus dem Browser): /ics?family=…&url=…
    if (url.pathname === '/ics') {
      const cors = { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8' };
      if (!validId(fam) || !(await isKnown(env, await idToken(config(env), env), fam))) return new Response('Nicht erlaubt', { status: 403, headers: cors });
      const target = url.searchParams.get('url') ?? '';
      if (!/^(https?|webcal):\/\//i.test(target)) return new Response('Ungültiger Link', { status: 400, headers: cors });
      try {
        return new Response(await fetchIcs(target), { headers: { ...cors, 'content-type': 'text/calendar; charset=utf-8' } });
      } catch (e) {
        return new Response(String(e instanceof Error ? e.message : e), { status: 502, headers: cors });
      }
    }
    // Kalender abonnieren: /cal/<geheimer Schlüssel>.ics  (optional ?p=<Personen-ID>)
    const m = url.pathname.match(/^\/cal\/([A-Za-z0-9]{16,64})(?:\.ics)?$/);
    if (m) {
      try {
        const token = await idToken(config(env), env);
        // Welche Familie? Im Verzeichnis steht der Abo-Schlüssel – sonst die eigene Familie
        const entry = (await registry(env, token)).find((e) => e.feedToken === m[1]);
        const cfg = config(env, entry?.familyId ?? env.FAMILY_ID);
        const settings = (await list<FamilySettings>(cfg, token, 'meta')).find((x) => x.id === 'settings');
        if (!settings?.feedToken || settings.feedToken !== m[1]) return new Response('Nicht gefunden', { status: 404 });
        const [events, persons] = await Promise.all([list<CalEvent>(cfg, token, 'events'), list<Person>(cfg, token, 'persons')]);
        const pid = url.searchParams.get('p');
        const mine = pid ? events.filter((e) => (!e.personIds?.length && !e.driverIds?.length) || e.personIds?.includes(pid) || e.driverIds?.includes(pid)) : events;
        const fixed = mine.map((e) => ({ ...e, personIds: e.personIds ?? [] }));
        return new Response(toICS(fixed, persons), {
          headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'public, max-age=900' },
        });
      } catch (e) {
        return new Response('Fehler: ' + String(e), { status: 500 });
      }
    }
    return new Response('Familienkalender-Erinnerungen laufen.\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};
