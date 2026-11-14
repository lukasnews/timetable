/**
 * Cloudflare Worker: prüft alle 5 Minuten fällige Erinnerungen und schickt sie per ntfy.
 * Eingerichtet und aktualisiert über .github/workflows/deploy-worker.yml.
 */
import { list, run, refresh, type Config } from './core';
import { toICS } from '../src/lib/ics';
import type { CalEvent, FamilySettings, Person } from '../src/types';

interface Env {
  FIREBASE_API_KEY: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_REFRESH_TOKEN: string;
  FAMILY_ID: string;
  NTFY_TOKEN?: string;
  NTFY_SERVER?: string;
  APP_URL?: string;
}

let cached: { token: string; until: number } | null = null;

async function idToken(cfg: Config, env: Env): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const token = await refresh(cfg, env.FIREBASE_REFRESH_TOKEN);
  cached = { token, until: Date.now() + 50 * 60_000 };
  return token;
}

function config(env: Env): Config {
  return {
    apiKey: env.FIREBASE_API_KEY,
    projectId: env.FIREBASE_PROJECT_ID,
    familyId: env.FAMILY_ID,
    ntfyServer: env.NTFY_SERVER || 'https://ntfy.chaoten.online',
    ntfyToken: env.NTFY_TOKEN,
    timezone: 'Europe/Vienna',
    appUrl: env.APP_URL || 'https://timetable.chaoten.online/',
  };
}

async function check(env: Env, log: (s: string) => void = console.log) {
  const cfg = config(env);
  await run(cfg, await idToken(cfg, env), new Date(), log, { by: 'cloudflare' });
}

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(check(env).catch((e) => console.error(String(e))));
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // Manuell prüfen (nur mit Familien-ID): /run?family=…
    if (url.pathname === '/run' && url.searchParams.get('family') === env.FAMILY_ID) {
      const lines: string[] = [];
      try {
        await check(env, (s) => lines.push(s));
        return new Response(lines.join('\n') + '\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      } catch (e) {
        return new Response('Fehler: ' + String(e), { status: 500 });
      }
    }
    // Kalender abonnieren: /cal/<geheimer Schlüssel>.ics  (optional ?p=<Personen-ID>)
    const m = url.pathname.match(/^\/cal\/([A-Za-z0-9]{16,64})(?:\.ics)?$/);
    if (m) {
      try {
        const cfg = config(env);
        const token = await idToken(cfg, env);
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
