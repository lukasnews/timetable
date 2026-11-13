/**
 * Einstieg für GitHub Actions (.github/workflows/reminders.yml).
 * Benötigte Secrets: FAMILY_ID, NTFY_TOKEN. Optional: NTFY_SERVER.
 * Firebase-Werte kommen aus .env.production.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { run, signUp, refresh, sendNtfy, list, type Config } from './core';
import type { Person, FamilySettings } from '../src/types';

const TOKEN_FILE = '.reminder-state/refresh-token';

function firebaseFromEnvFile() {
  const line = readFileSync('.env.production', 'utf8').split('\n').find((l) => l.startsWith('VITE_FIREBASE_CONFIG='));
  if (!line) throw new Error('VITE_FIREBASE_CONFIG fehlt in .env.production');
  return JSON.parse(line.slice('VITE_FIREBASE_CONFIG='.length));
}

async function main() {
  const fb = firebaseFromEnvFile();
  const familyId = process.env.FAMILY_ID?.trim();
  if (!familyId) {
    console.log('FAMILY_ID ist nicht gesetzt – Erinnerungen sind noch nicht eingerichtet.');
    return;
  }
  const cfg: Config = {
    apiKey: fb.apiKey,
    projectId: fb.projectId,
    familyId,
    ntfyServer: process.env.NTFY_SERVER?.trim() || 'https://ntfy.chaoten.online',
    ntfyToken: process.env.NTFY_TOKEN?.trim() || undefined,
    timezone: process.env.TIMEZONE || 'Europe/Vienna',
    appUrl: process.env.APP_URL || 'https://lukasnews.github.io/timetable/',
  };

  // Anonyme Firebase-Kennung wiederverwenden (über den Actions-Cache), statt jedes Mal eine neue anzulegen
  let token: string;
  try {
    if (!existsSync(TOKEN_FILE)) throw new Error('kein Token');
    token = await refresh(cfg, readFileSync(TOKEN_FILE, 'utf8').trim());
  } catch {
    const s = await signUp(cfg);
    mkdirSync('.reminder-state', { recursive: true });
    writeFileSync(TOKEN_FILE, s.refreshToken);
    token = s.idToken;
  }

  if (process.env.TEST === 'true') {
    const [persons, meta] = await Promise.all([list<Person>(cfg, token, 'persons'), list<any>(cfg, token, 'meta')]);
    const family = meta.find((m) => m.id === 'settings') as Partial<FamilySettings> | undefined;
    const targets = [
      ...persons.filter((p) => p.ntfyTopic).map((p) => ({ topic: p.ntfyTopic!, name: p.name })),
      ...(family?.ntfyFamilyTopic ? [{ topic: family.ntfyFamilyTopic, name: 'Familie' }] : []),
    ];
    if (!targets.length) throw new Error('Kein ntfy-Topic eingetragen (Profil der Person oder Einstellungen → Allgemein).');
    for (const t of targets) {
      await sendNtfy(cfg, { topic: t.topic, title: 'Familienkalender', message: `Test für ${t.name}: Erinnerungen funktionieren ✓`, priority: 3, tags: ['white_check_mark'], click: cfg.appUrl });
      console.log(`✓ Test an ${t.topic} (${t.name})`);
    }
    return;
  }
  await run(cfg, token);
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
