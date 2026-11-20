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
  /** Familie, deren alte ntfy-Topics ohne Präfix übergangsweise noch erlaubt sind (sonst wie alle anderen) */
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
  /** Öffentliche Adresse des Dienstes (eigene Domain) – die workers.dev-Adresse leitet dorthin weiter */
  PUBLIC_URL?: string;
  /** Adresse der App für andere Familien (Link in deren Push-Nachrichten, wenn ihre App keine meldet) */
  PUBLIC_APP_URL?: string;
}

interface Entry { id: string; familyId: string; feedToken?: string; at?: number; seen?: number; appUrl?: string }

/** Familien, deren App sich so lange nicht gemeldet hat, nimmt der Dienst aus dem Verzeichnis (sie melden sich beim nächsten Öffnen neu an) */
const STALE_MS = 60 * 86400_000;
/** Neue Familien pro Absender (IP) und Tag */
const NEW_PER_IP = 3;
let lastCleanup = '';

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
async function familyConfig(env: Env, familyId: string, entry?: Entry): Promise<Config> {
  // Alle Familien haben ein Präfix. Übergang (auf Wunsch): FAMILY_ID darf alte Topics ohne Präfix noch nutzen
  const cfg = config(env, familyId, await topicPrefix(familyId));
  if (familyId === env.FAMILY_ID) cfg.allowUnprefixed = true;
  // Links in Nachrichten: zur App-Adresse der Familie (ihre eigene Adresse aus den Einstellungen hat Vorrang, siehe run())
  cfg.appUrl = entry?.appUrl || env.PUBLIC_APP_URL || undefined;
  return cfg;
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
  return (await registry(env, token)).some((e) => e.familyId === familyId);
}

/** Alle 5 Minuten: alle angemeldeten Familien reihum – so viele, wie das Budget erlaubt (für alle gleich) */
async function check(env: Env) {
  calls = 0;
  const token = await idToken(config(env), env);
  if (!validId(env.REGISTRY_ID ?? null)) { console.log('REGISTRY_ID fehlt – keine Familien'); return; }
  const regCfg = config(env, env.REGISTRY_ID);
  let entries = await registry(env, token, true);
  // Umstellung: die Familie aus FAMILY_ID einmalig ins Verzeichnis übernehmen (danach meldet ihre App sich selbst)
  if (validId(env.FAMILY_ID) && !entries.some((e) => e.familyId === env.FAMILY_ID)) {
    const e: Entry = { id: await registryKey(env.FAMILY_ID), familyId: env.FAMILY_ID, at: Date.now(), seen: Date.now() };
    await commit(regCfg, token, 'meta', [e]);
    entries = [...entries, e];
    regCache = null;
  }
  // Zähler für Anmeldungen vom Vortag löschen (einmal am Tag)
  const today = new Date().toISOString().slice(0, 10);
  if (lastCleanup !== today) {
    lastCleanup = today;
    const oldRl = (await list<{ id: string }>(regCfg, token, 'backups').catch(() => [])).filter((d) => d.id.startsWith('rl-') && !d.id.startsWith(`rl-${today}`));
    if (oldRl.length) await commit(regCfg, token, 'backups', [], oldRl.map((d) => d.id)).catch(() => {});
  }
  // Verlassene Familien entfernen (auch Schutz davor, das Verzeichnis mit Schein-Familien zu füllen)
  const stale = entries.filter((e) => Date.now() - (e.seen ?? e.at ?? 0) > STALE_MS);
  if (stale.length) {
    await commit(regCfg, token, 'meta', [], stale.map((e) => e.id)).catch(() => {});
    regCache = null;
    console.log(`${stale.length} Familie(n) seit 60 Tagen inaktiv – aus dem Verzeichnis entfernt`);
  }
  const active = entries.filter((e) => !stale.includes(e));
  if (!active.length) return;
  const budget = Number(env.SUBREQUEST_BUDGET) || 45;
  const startAt = Math.floor(Date.now() / 300_000) % active.length;
  for (let i = 0; i < active.length; i++) {
    if (calls + 8 > budget) { console.log(`Budget erreicht – ${active.length - i} Familie(n) beim nächsten Lauf`); break; }
    const e = active[(startAt + i) % active.length];
    try { await run(await familyConfig(env, e.familyId, e), token, new Date(), () => {}, { by: 'cloudflare', dropIfEmpty: true }); }
    catch (err) {
      if (String(err).includes('FAMILY_GONE')) {
        await commit(regCfg, token, 'meta', [], [e.id]).catch(() => {});
        regCache = null;
        console.log(`Familie ${e.id.slice(0, 6)}: keine Daten mehr – aus dem Verzeichnis entfernt`);
      } else console.log(`Familie ${e.id.slice(0, 6)}: ${String(err).slice(0, 200)}`); // nur ins Server-Protokoll
    }
  }
}

/** Ein Feld in meta/reminders setzen, ohne den Rest zu überschreiben */
async function setStateField(cfg: Config, token: string, field: string, value: string) {
  await fetch(`https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/families/${cfg.familyId}/meta/reminders?updateMask.fieldPaths=${field}`, {
    method: 'PATCH', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ fields: { [field]: { stringValue: value } } }),
  });
}

/** Familie beim Dienst anmelden (nur wer die geheime Familien-ID kennt; die Familie muss Daten haben) */
async function register(env: Env, familyId: string, serviceUrl: string, clientIp = '', appOrigin = ''): Promise<Response> {
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
  if (!known && all.length >= max) return new Response('Der Dienst ist derzeit voll', { status: 503, headers: cors });
  // Schutz vor Massen-Anmeldungen: höchstens NEW_PER_IP neue Familien pro Absender und Tag (IP nur gehasht, nach 1 Tag gelöscht)
  if (!known && clientIp) {
    const day = new Date().toISOString().slice(0, 10);
    const id = `rl-${day}-${(await registryKey(clientIp + ':' + env.REGISTRY_ID)).slice(0, 16)}`;
    const regCfg = config(env, env.REGISTRY_ID);
    const doc = (await list<{ id: string; count?: number }>(regCfg, token, 'backups')).find((d) => d.id === id);
    if ((doc?.count ?? 0) >= NEW_PER_IP) return new Response('Zu viele neue Familien von diesem Anschluss – bitte morgen erneut versuchen', { status: 429, headers: cors });
    await commit(regCfg, token, 'backups', [{ id, count: (doc?.count ?? 0) + 1 } as { id: string }]);
  }
  const feedToken = meta.find((m) => m.id === 'settings')?.feedToken ?? '';
  const appUrl = /^https:\/\/[a-z0-9.-]+$/i.test(appOrigin) ? appOrigin + '/' : known?.appUrl;
  if ((!known || (known.feedToken ?? '') !== feedToken || (known.appUrl ?? '') !== (appUrl ?? '') || Date.now() - (known.seen ?? 0) > 86400_000)) {
    await commit(config(env, env.REGISTRY_ID), token, 'meta', [{ id: key, familyId, feedToken, at: known?.at ?? Date.now(), seen: Date.now(), ...(appUrl ? { appUrl } : {}) } as Entry]);
    regCache = null;
  }
  // Präfix sofort in der App anzeigen (nicht erst nach dem ersten Lauf)
  if (!known) await setStateField(cfg, token, 'topicPrefix', await topicPrefix(familyId));
  if (meta.find((m) => m.id === 'service')?.url !== serviceUrl) await commit(cfg, token, 'meta', [{ id: 'service', url: serviceUrl } as { id: string }]);
  return new Response('ok', { headers: cors });
}

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(check(env).catch((e) => console.error(String(e))));
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // Alte workers.dev-Adresse (enthält den Kontonamen): nur noch dauerhaft auf die eigene Domain weiterleiten,
    // so ziehen bestehende Kalender-Abos (z. B. ICSx⁵) von selbst um
    if (env.PUBLIC_URL && url.hostname.endsWith('.workers.dev')) {
      return new Response(null, { status: req.method === 'GET' || req.method === 'HEAD' ? 301 : 308,
        headers: { location: env.PUBLIC_URL.replace(/\/$/, '') + url.pathname + url.search, 'access-control-allow-origin': '*' } });
    }
    const fam = url.searchParams.get('family');
    // Anmelden: POST /register?family=…
    if (url.pathname === '/register') {
      if (req.method === 'OPTIONS') return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST' } });
      if (req.method !== 'POST' || !validId(fam)) return new Response('Ungültig', { status: 400, headers: { 'access-control-allow-origin': '*' } });
      // Über die App-Adresse (…/svc, Cloudflare Pages) aufgerufen: diese Adresse als Dienst-Adresse merken
      const base = req.headers.get('x-fk-base') ?? '';
      const serviceUrl = /^https:\/\/[a-z0-9.-]+\/svc$/i.test(base) ? base : url.origin;
      try { return await register(env, fam, serviceUrl, req.headers.get('cf-connecting-ip') ?? '', req.headers.get('origin') ?? ''); }
      catch (e) { return new Response(String(e instanceof Error ? e.message : e).slice(0, 200), { status: 500, headers: { 'access-control-allow-origin': '*' } }); }
    }
    // Manuell prüfen (nur mit Familien-ID): /run?family=…
    if (url.pathname === '/run' && validId(fam)) {
      const lines: string[] = [];
      try {
        // Nur die eigene Familie – für alle gleich
        const token = await idToken(config(env), env);
        const entry = (await registry(env, token)).find((e) => e.familyId === fam);
        if (!entry) return new Response('Nicht angemeldet', { status: 403 });
        await run(await familyConfig(env, fam, entry), token, new Date(), (s) => lines.push(s), { by: 'cloudflare', dropIfEmpty: true });
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
        // Welche Familie? Im Verzeichnis steht der Abo-Schlüssel (meldet die App bei der Anmeldung)
        const entry = (await registry(env, token)).find((e) => e.feedToken === m[1]);
        if (!entry) return new Response('Nicht gefunden', { status: 404 });
        const cfg = config(env, entry.familyId);
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
    return new Response('Familienkalender-Erinnerungen laufen.\n', { headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' } });
  },
};
