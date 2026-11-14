import { describe, expect, it, vi, afterEach } from 'vitest';
import { changeNotifications, digest, dueNotifications, localNow, run, type Config } from './core';
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

describe('Geburtstag aus Profil, Übersicht, Änderungen', () => {
  const ps: Person[] = [
    { ...persons[0], birthday: '1990-11-14', birthdayReminder: 840 },
    persons[1],
  ];
  it('Profil-Geburtstag erinnert am Vorabend an alle', () => {
    const r = dueNotifications({ events: [], persons: ps, from: '2026-11-13T17:55', to: '2026-11-13T18:00', sent: new Set() });
    expect(r.map((x) => x.n.topic).sort()).toEqual(['mama', 'papa']);
    expect(r[0].n.title).toBe('🎂 Mama wird 36');
    expect(dueNotifications({ events: [], persons: [{ ...ps[0], birthdayReminder: null }], from: '2026-11-13T17:55', to: '2026-11-13T18:00', sent: new Set() })).toHaveLength(0);
  });
  it('Tagesübersicht je Person nur eigene + Familientermine', () => {
    const evs = [ev({}), ev({ id: 'e2', title: 'Müll', personIds: [], allDay: true, start: '2026-11-13', end: '2026-11-14' }), ev({ id: 'e3', title: 'Papa-Termin', personIds: ['papa'], start: '2026-11-13T18:00', end: '2026-11-13T19:00' })];
    const d = digest({ events: evs, persons, from: '2026-11-13', days: 1, title: 'Heute' });
    const mama = d.find((n) => n.topic === 'mama')!.message;
    expect(mama).toContain('10:00 Zahnärztin (Mama)');
    expect(mama).toContain('Müll');
    expect(mama).not.toContain('Papa-Termin');
    expect(digest({ events: [], persons, from: '2026-11-13', days: 1, title: 'Heute' })).toHaveLength(0);
  });
  it('Änderung: nicht an die Person, die geändert hat', () => {
    const e = ev({ personIds: ['mama', 'papa'], changedBy: 'papa', createdAt: 2000, updatedAt: 2000 });
    const n = changeNotifications({ changed: [e], persons, since: 1000, today: '2026-11-13' });
    expect(n.map((x) => x.topic)).toEqual(['mama']);
    expect(n[0].title).toBe('Neu: Zahnärztin');
    expect(n[0].message).toContain('eingetragen von Papa');
    const old = changeNotifications({ changed: [{ ...e, createdAt: 500 }], persons, since: 1000, today: '2026-11-13' });
    expect(old[0].title).toBe('Geändert: Zahnärztin');
  });
});

describe('Tagesübersicht spät am Abend', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('wird auch bei 22:30 gesendet', async () => {
    const sv = (s: string) => ({ stringValue: s });
    const sent: any[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith(':runQuery')) return new Response('[{}]');
      if (url.includes('/events')) return new Response(JSON.stringify({ documents: [{ name: 'x/e1', fields: { title: sv('Abendtermin'), start: sv('2026-11-13T23:00'), end: sv('2026-11-13T23:30'), allDay: { booleanValue: false }, personIds: { arrayValue: {} } } }] }));
      if (url.includes('/persons')) return new Response(JSON.stringify({ documents: [{ name: 'x/mama', fields: { name: sv('Mama'), ntfyTopic: sv('mama') } }] }));
      if (url.includes('/meta?')) return new Response(JSON.stringify({ documents: [{ name: 'x/settings', fields: { ntfyDaily: sv('22:30') } }] }));
      if (url === 'https://ntfy.example') sent.push(JSON.parse(init!.body as string));
      return new Response('{}');
    });
    const cfg: Config = { apiKey: 'k', projectId: 'p', familyId: 'f', ntfyServer: 'https://ntfy.example', timezone: 'Europe/Vienna' };
    await run(cfg, 'id', new Date('2026-11-13T21:35:00Z'), () => {}); // 22:35 in Wien
    expect(sent.map((n) => n.title)).toEqual(['Heute im Kalender']);
    expect(sent[0].message).toContain('23:00 Abendtermin');
  });
});

describe('Lauf gegen gemockte APIs', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sendet JSON an ntfy mit Token und speichert den Stand', async () => {
    const sv = (s: string) => ({ stringValue: s });
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith(':runQuery')) return new Response(JSON.stringify([{ document: { name: 'x/e1', fields: {
        title: sv('Zahnärztin'), start: sv('2026-11-13T10:00'), end: sv('2026-11-13T10:30'), allDay: { booleanValue: false },
        personIds: { arrayValue: { values: [sv('mama')] } }, reminderMinutes: { integerValue: '30' } } } }, { readTime: 'x' }]));
      if (url.includes('/persons')) return new Response(JSON.stringify({ documents: [{ name: 'x/mama', fields: { name: sv('Mama'), ntfyTopic: sv('mama') } }] }));
      if (url.includes('/meta?')) return new Response(JSON.stringify({ documents: [{ name: 'x/reminders', fields: { lastRun: sv('2026-11-13T09:20'), sent: { arrayValue: {} } } }] }));
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
