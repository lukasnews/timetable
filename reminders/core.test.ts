import { describe, expect, it, vi, afterEach } from 'vitest';
import { dueNotifications, localNow, run, type Config } from './core';
import type { CalEvent, Person } from '../src/types';

const persons: Person[] = [
  { id: 'mama', name: 'Mama', color: '#f00', avatar: { style: 'adventurer', seed: 'x' }, order: 0, ntfyTopic: 'mama' },
  { id: 'papa', name: 'Papa', color: '#00f', avatar: { style: 'adventurer', seed: 'y' }, order: 1, ntfyTopic: 'papa' },
];
const ev = (p: Partial<CalEvent>): CalEvent => ({ id: 'e1', title: 'Zahnärztin', start: '2026-11-13T10:00', end: '2026-11-13T10:30', allDay: false, personIds: ['mama'], reminderMinutes: 30, ...p });

describe('Fällige Erinnerungen', () => {
  it('schickt an das Topic der Person', () => {
    const r = dueNotifications({ events: [ev({})], persons, from: '2026-11-13T09:25', to: '2026-11-13T09:30', sent: new Set() });
    expect(r).toHaveLength(1);
    expect(r[0].n).toMatchObject({ topic: 'mama', title: 'Zahnärztin', priority: 3, tags: ['calendar'] });
    expect(r[0].n.message).toContain('Heute, 10:00–10:30 Uhr');
  });
  it('nicht doppelt senden', () => {
    const first = dueNotifications({ events: [ev({})], persons, from: '2026-11-13T09:25', to: '2026-11-13T09:30', sent: new Set() });
    const again = dueNotifications({ events: [ev({})], persons, from: '2026-11-13T09:00', to: '2026-11-13T09:40', sent: new Set([first[0].key]) });
    expect(again).toHaveLength(0);
  });
  it('außerhalb des Zeitfensters nichts', () => {
    expect(dueNotifications({ events: [ev({})], persons, from: '2026-11-13T09:30', to: '2026-11-13T09:35', sent: new Set() })).toHaveLength(0);
  });
  it('Familien-Termin an Familien-Topic, sonst an alle', () => {
    const e = ev({ personIds: [] });
    const a = dueNotifications({ events: [e], persons, family: { ntfyFamilyTopic: 'familie' }, from: '2026-11-13T09:25', to: '2026-11-13T09:30', sent: new Set() });
    expect(a.map((x) => x.n.topic)).toEqual(['familie']);
    const b = dueNotifications({ events: [e], persons, from: '2026-11-13T09:25', to: '2026-11-13T09:30', sent: new Set() });
    expect(b.map((x) => x.n.topic).sort()).toEqual(['mama', 'papa']);
  });
  it('Serie und Geburtstag mit Alter', () => {
    const s = ev({ start: '2026-11-03T10:00', end: '2026-11-03T10:30', recurrence: { freq: 'weekly', interval: 1, end: { type: 'never' } } });
    expect(dueNotifications({ events: [s], persons, from: '2026-11-17T09:25', to: '2026-11-17T09:30', sent: new Set() })).toHaveLength(1);
    const g = ev({ kind: 'birthday', title: 'Oma', allDay: true, start: '2026-11-14', end: '2026-11-15', birthYear: 1950, reminderMinutes: 1440,
      recurrence: { freq: 'yearly', interval: 1, end: { type: 'never' } } });
    const r = dueNotifications({ events: [g], persons, from: '2026-11-13T07:55', to: '2026-11-13T08:00', sent: new Set() });
    expect(r[0].n.title).toBe('🎂 Oma wird 76');
    expect(r[0].n.message).toContain('Morgen');
  });
  it('Wiener Zeit', () => {
    expect(localNow('Europe/Vienna', new Date('2026-11-13T08:30:00Z'))).toBe('2026-11-13T09:30');
    expect(localNow('Europe/Vienna', new Date('2026-07-01T08:30:00Z'))).toBe('2026-07-01T10:30');
  });
});

describe('Lauf gegen gemockte APIs', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sendet JSON an ntfy mit Token und speichert den Stand', async () => {
    const sv = (s: string) => ({ stringValue: s });
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/events')) return new Response(JSON.stringify({ documents: [{ name: 'x/e1', fields: {
        title: sv('Zahnärztin'), start: sv('2026-11-13T10:00'), end: sv('2026-11-13T10:30'), allDay: { booleanValue: false },
        personIds: { arrayValue: { values: [sv('mama')] } }, reminderMinutes: { integerValue: '30' } } }] }));
      if (url.includes('/persons')) return new Response(JSON.stringify({ documents: [{ name: 'x/mama', fields: { name: sv('Mama'), ntfyTopic: sv('mama') } }] }));
      if (url.endsWith('/meta')) return new Response(JSON.stringify({ documents: [{ name: 'x/reminders', fields: { lastRun: sv('2026-11-13T09:20'), sent: { arrayValue: {} } } }] }));
      return new Response('{}');
    });
    const cfg: Config = { apiKey: 'k', projectId: 'p', familyId: 'f', ntfyServer: 'https://ntfy.example', ntfyToken: 'TOK', timezone: 'Europe/Vienna' };
    await run(cfg, 'id', new Date('2026-11-13T08:31:00Z'), () => {});
    const ntfy = calls.find((c) => c.url === 'https://ntfy.example')!;
    expect((ntfy.init!.headers as Record<string, string>).Authorization).toBe('Bearer TOK');
    expect(JSON.parse(ntfy.init!.body as string)).toMatchObject({ topic: 'mama', title: 'Zahnärztin', priority: 3, tags: ['calendar'] });
    const save = calls.find((c) => c.url.endsWith('/meta/reminders'))!;
    expect(JSON.parse(save.init!.body as string).fields.lastRun.stringValue).toBe('2026-11-13T09:31');
  });
});
