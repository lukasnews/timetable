import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromFieldsForTest, toFields } from './core';

/** Kleine Firestore-Attrappe: db[familie][sammlung][id] = Felder */
type Db = Record<string, Record<string, Record<string, Record<string, unknown>>>>;
const PRIMARY = 'primaryfamily000000';
const REG = 'registryregistryregistry0000000';
const env = { FIREBASE_API_KEY: 'k', FIREBASE_PROJECT_ID: 'p', FIREBASE_REFRESH_TOKEN: 'rt', FAMILY_ID: PRIMARY, REGISTRY_ID: REG, NTFY_SERVER: 'https://ntfy.dienst.example', NTFY_TOKEN: 'TOK' };
const W = 'https://worker.example';

function fakeFirestore(db: Db) {
  const sent: { url: string; body: any; headers: any }[] = [];
  const docs = (fam: string, col: string) => Object.entries(db[fam]?.[col] ?? {}).map(([id, f]) => ({ name: `projects/p/databases/(default)/documents/families/${fam}/${col}/${id}`, fields: toFields(f) }));
  const fetchMock = async (input: string, init?: RequestInit) => {
    const url = String(input);
    let body: any;
    try { body = init?.body ? JSON.parse(String(init.body)) : undefined; } catch { body = String(init?.body); }
    if (url.startsWith('https://securetoken')) return new Response(JSON.stringify({ id_token: 'ID' }));
    if (url.startsWith('https://ntfy')) { sent.push({ url, body, headers: init?.headers }); return new Response('{}'); }
    if (url.endsWith(':commit')) {
      for (const w of body.writes) {
        const name: string = w.update?.name ?? w.delete;
        const [, fam, col, id] = name.match(/families\/([^/]+)\/([^/]+)\/([^/]+)$/)!;
        db[fam] ??= {}; db[fam][col] ??= {};
        if (w.delete) delete db[fam][col][id]; else db[fam][col][id] = fromFieldsForTest(w.update.fields);
      }
      return new Response('{}');
    }
    let m = url.match(/families\/([^/]+):runQuery$/) ?? url.match(/families\/([^/]+)\/?:runQuery$/);
    if (m) {
      const col = body.structuredQuery.from[0].collectionId;
      return new Response(JSON.stringify(docs(m[1], col).filter((d) => body.structuredQuery.where.fieldFilter.field.fieldPath in d.fields).map((d) => ({ document: d }))));
    }
    m = url.match(/families\/([^/]+)\/([^/?]+)\/([^/?]+)(\?|$)/);
    if (m && (init?.method === 'PATCH')) {
      const [, fam, col, id] = m;
      db[fam] ??= {}; db[fam][col] ??= {};
      db[fam][col][id] = { ...(url.includes('updateMask') ? db[fam][col][id] : {}), ...fromFieldsForTest(body.fields) };
      return new Response('{}');
    }
    m = url.match(/families\/([^/]+)\/([^/?]+)\?/);
    if (m) return new Response(JSON.stringify({ documents: docs(m[1], m[2]) }));
    return new Response('nicht gefunden', { status: 404 });
  };
  return { fetchMock, sent };
}

async function loadWorker(db: Db) {
  const ff = fakeFirestore(db);
  vi.resetModules();
  vi.stubGlobal('fetch', ff.fetchMock);
  const mod = (await import('./worker')).default;
  return { worker: mod, sent: ff.sent };
}

describe('Worker: mehrere Familien', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.unstubAllGlobals());

  it('Anmeldung nur für Familien mit Daten; legt Verzeichnis, Dienst-Adresse und Präfix an', async () => {
    const db: Db = { famaaaaaaaaaaaaaaaa: { persons: { p1: { name: 'A' } }, meta: { settings: { feedToken: 'feedaaaaaaaaaaaaaaaa' } } } };
    const { worker } = await loadWorker(db);
    expect((await worker.fetch(new Request(`${W}/register?family=unbekanntunbekannt`, { method: 'POST' }), env)).status).toBe(404);
    expect((await worker.fetch(new Request(`${W}/register?family=famaaaaaaaaaaaaaaaa`, { method: 'GET' }), env)).status).toBe(400);
    expect((await worker.fetch(new Request(`${W}/register?family=famaaaaaaaaaaaaaaaa`, { method: 'POST' }), env)).status).toBe(200);
    const entry = Object.values(db[REG].meta)[0] as any;
    expect(entry).toMatchObject({ familyId: 'famaaaaaaaaaaaaaaaa', feedToken: 'feedaaaaaaaaaaaaaaaa' });
    expect(entry.seen).toBeGreaterThan(0);
    expect(db.famaaaaaaaaaaaaaaaa.meta.service.url).toBe(W);
    expect(String(db.famaaaaaaaaaaaaaaaa.meta.reminders.topicPrefix)).toMatch(/^fk-/);
  });

  it('Import-Proxy und Lauf nur für angemeldete Familien', async () => {
    const db: Db = { famaaaaaaaaaaaaaaaa: { persons: { p1: { name: 'A' } } } };
    const { worker } = await loadWorker(db);
    expect((await worker.fetch(new Request(`${W}/ics?family=famaaaaaaaaaaaaaaaa&url=https://x.example/a.ics`), env)).status).toBe(403);
    expect((await worker.fetch(new Request(`${W}/run?family=famaaaaaaaaaaaaaaaa`), env)).status).toBe(403);
    await worker.fetch(new Request(`${W}/register?family=famaaaaaaaaaaaaaaaa`, { method: 'POST' }), env);
    expect((await worker.fetch(new Request(`${W}/run?family=famaaaaaaaaaaaaaaaa`), env)).status).toBe(200);
  });

  it('Abo-Link liefert nur die Termine der zugehörigen Familie', async () => {
    const ev = (t: string) => ({ title: t, start: '2026-11-25T10:00', end: '2026-11-25T11:00', allDay: false, personIds: [] });
    const db: Db = {
      [PRIMARY]: { persons: { p: { name: 'P' } }, events: { e: ev('Termin-Eigene') }, meta: { settings: { feedToken: 'feedprimaryprimaryprim' } } },
      famaaaaaaaaaaaaaaaa: { persons: { p1: { name: 'A' } }, events: { e: ev('Termin-A') }, meta: { settings: { feedToken: 'feedaaaaaaaaaaaaaaaa' } } },
    };
    const { worker } = await loadWorker(db);
    await worker.fetch(new Request(`${W}/register?family=famaaaaaaaaaaaaaaaa`, { method: 'POST' }), env);
    const a = await (await worker.fetch(new Request(`${W}/cal/feedaaaaaaaaaaaaaaaa.ics`), env)).text();
    expect(a).toContain('Termin-A');
    expect(a).not.toContain('Termin-Eigene');
    const p = await (await worker.fetch(new Request(`${W}/cal/feedprimaryprimaryprim.ics`), env)).text();
    expect(p).toContain('Termin-Eigene');
    expect(p).not.toContain('Termin-A');
    expect((await worker.fetch(new Request(`${W}/cal/feedfalschfalschfalsch.ics`), env)).status).toBe(404);
  });

  it('Cron: verlassene und gelöschte Familien fliegen raus; Fehler fremder Familien landen nicht in der Ausgabe der eigenen', async () => {
    const old = Date.now() - 70 * 86400_000;
    const db: Db = {
      [PRIMARY]: { persons: { p: { name: 'P' } } },
      [REG]: { meta: {
        alt: { familyId: 'famaltaltaltaltalta', at: old, seen: old },
        weg: { familyId: 'famwegwegwegwegwegw', at: Date.now(), seen: Date.now() },
        aktiv: { familyId: 'famaktivaktivaktiva', at: Date.now(), seen: Date.now() },
      } },
      famaltaltaltaltalta: { persons: { p: { name: 'Alt' } } },
      famaktivaktivaktiva: { persons: { p: { name: 'Aktiv', ntfyTopic: 'geheimes-thema' } } },
    };
    const { worker } = await loadWorker(db);
    const out = await (await worker.fetch(new Request(`${W}/run?family=${PRIMARY}`), env)).text();
    expect(Object.keys(db[REG].meta).sort()).toEqual(['aktiv']);
    expect(db.famaktivaktivaktiva.meta.reminders).toBeDefined(); // wurde verarbeitet
    expect(out).not.toMatch(/famalt|famweg|famaktiv|Familie /);
  });
});
