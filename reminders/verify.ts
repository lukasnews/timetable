/** Prüft nach dem Einrichten, ob der Cloudflare-Dienst läuft (meta/reminders.by === 'cloudflare'). */
import { readFileSync } from 'node:fs';
import { list, signUp, type Config, type ReminderState } from './core';

const line = readFileSync('.env.production', 'utf8').split('\n').find((l) => l.startsWith('VITE_FIREBASE_CONFIG='))!;
const fb = JSON.parse(line.slice('VITE_FIREBASE_CONFIG='.length));
const cfg: Config = { apiKey: fb.apiKey, projectId: fb.projectId, familyId: process.env.FAMILY_ID!.trim(), ntfyServer: '', timezone: 'Europe/Vienna' };
const since = Number(process.env.SINCE ?? Date.now());
const { idToken } = await signUp(cfg);
for (let i = 0; i < 16; i++) {
  const s = (await list<ReminderState>(cfg, idToken, 'meta')).find((m) => m.id === 'reminders');
  if (s?.by === 'cloudflare' && Number(s.at) >= since) {
    console.log(`✓ Cloudflare hat um ${new Date(Number(s.at)).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna' })} geprüft (Zeitfenster bis ${s.lastRun}).`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 30_000));
}
console.error('Cloudflare hat in 8 Minuten nicht geprüft. Bitte im Cloudflare-Dashboard unter Workers → familienkalender-erinnerungen → Logs nachsehen.');
process.exit(1);
