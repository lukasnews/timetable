/**
 * Wartung (GitHub Actions, .github/workflows/maintenance.yml):
 *   ACTION=delete-events → löscht alle Termine der Familie (Personen, Stundenpläne, Einstellungen bleiben)
 */
import { readFileSync } from 'node:fs';
import { list, signUp, type Config } from './core';

async function main() {
  const line = readFileSync('.env.production', 'utf8').split('\n').find((l) => l.startsWith('VITE_FIREBASE_CONFIG='))!;
  const fb = JSON.parse(line.slice('VITE_FIREBASE_CONFIG='.length));
  const familyId = process.env.FAMILY_ID?.trim();
  if (!familyId) throw new Error('FAMILY_ID fehlt');
  const cfg: Config = { apiKey: fb.apiKey, projectId: fb.projectId, familyId, ntfyServer: '', timezone: 'Europe/Vienna' };
  const action = process.env.ACTION;
  if (process.env.CONFIRM !== 'LÖSCHEN') throw new Error('Zur Sicherheit im Feld „confirm“ das Wort LÖSCHEN eingeben.');

  const { idToken } = await signUp(cfg);
  if (action === 'delete-events') {
    const events = await list<{ id: string; title?: string }>(cfg, idToken, 'events');
    console.log(`${events.length} Termin(e) gefunden`);
    const base = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/families/${familyId}/events`;
    let n = 0;
    for (const e of events) {
      const r = await fetch(`${base}/${e.id}`, { method: 'DELETE', headers: { authorization: 'Bearer ' + idToken } });
      if (!r.ok) throw new Error(`Löschen fehlgeschlagen (${r.status}): ${await r.text()}`);
      n++;
    }
    const rest = await list(cfg, idToken, 'events');
    console.log(`✓ ${n} Termin(e) gelöscht, übrig: ${rest.length}`);
    return;
  }
  throw new Error(`Unbekannte Aktion: ${action}`);
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
