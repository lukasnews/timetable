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
      if (url.includes('/meta?')) return new Response(JSON.stringify({ documents: [{ name: 'x/settings', fields: { ntfyDaily: sv('22:30'), ntfyServer: sv('https://ntfy.example') } }] }));
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
      if (url.includes('/meta?')) return new Response(JSON.stringify({ documents: [{ name: 'x/reminders', fields: { lastRun: sv('2026-11-13T09:20'), sent: { arrayValue: {} } } },
        { name: 'x/settings', fields: { ntfyServer: sv('https://ntfy.example'), ntfyToken: sv('TOK') } }] }));
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

describe('Fremde Familie auf dem gemeinsamen Server', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sendet nur über den eigenen Server, nicht an Topics ohne Präfix, und meldet sie in der App', async () => {
    const sv = (s: string) => ({ stringValue: s });
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith(':runQuery')) return new Response(JSON.stringify([{ document: { name: 'x/e1', fields: {
        title: sv('Zahnärztin'), start: sv('2026-11-13T10:00'), end: sv('2026-11-13T10:30'), allDay: { booleanValue: false },
        personIds: { arrayValue: { values: [sv('mama'), sv('papa')] } }, reminderMinutes: { integerValue: '30' } } } }]));
      if (url.includes('/persons')) return new Response(JSON.stringify({ documents: [
        { name: 'x/mama', fields: { name: sv('Mama'), ntfyTopic: sv('mama') } },
        { name: 'x/papa', fields: { name: sv('Papa'), ntfyTopic: sv('fk-abc-papa') } }] }));
      if (url.includes('/meta?')) return new Response(JSON.stringify({ documents: [{ name: 'x/reminders', fields: { lastRun: sv('2026-11-13T09:20'), sent: { arrayValue: {} } } },
        { name: 'x/settings', fields: { ntfyServer: sv('https://ntfy.familie.example') } }] }));
      return new Response('{}');
    });
    const cfg: Config = { apiKey: 'k', projectId: 'p', familyId: 'f', ntfyServer: 'https://ntfy.example', ntfyToken: 'TOK', timezone: 'Europe/Vienna', topicPrefix: 'fk-abc' };
    await run(cfg, 'id', new Date('2026-11-13T08:31:00Z'), () => {});
    expect(calls.some((c) => c.url === 'https://ntfy.example')).toBe(false);
    const own = calls.filter((c) => c.url === 'https://ntfy.familie.example');
    expect(own.map((c) => JSON.parse(c.init!.body as string).topic)).toEqual(['fk-abc-papa']);
    expect((own[0].init!.headers as Record<string, string>).Authorization).toBeUndefined();
    const save = JSON.parse(calls.find((c) => c.url.endsWith('/meta/reminders'))!.init!.body as string).fields;
    expect(save.blockedTopics.arrayValue.values.map((v: any) => v.stringValue)).toEqual(['mama']);
    expect(save.topicPrefix.stringValue).toBe('fk-abc');
  });
  it('Hinweis auf abgewiesene Topics bleibt auch in Läufen ohne fällige Erinnerung', async () => {
    const sv = (s: string) => ({ stringValue: s });
    const saves: any[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith(':runQuery')) return new Response('[]');
      if (url.includes('/persons')) return new Response(JSON.stringify({ documents: [{ name: 'x/mama', fields: { name: sv('Mama'), ntfyTopic: sv('mama') } }] }));
      if (url.includes('/meta?')) return new Response(JSON.stringify({ documents: [{ name: 'x/reminders', fields: { lastRun: sv('2026-11-13T09:20'), blockedTopics: { arrayValue: { values: [sv('mama'), sv('alt')] } } } },
        { name: 'x/settings', fields: { ntfyServer: sv('https://ntfy.familie.example') } }] }));
      if (url.endsWith('/meta/reminders')) saves.push(JSON.parse(init!.body as string));
      return new Response('{}');
    });
    await run({ apiKey: 'k', projectId: 'p', familyId: 'f', ntfyServer: 'https://ntfy.example', timezone: 'Europe/Vienna', topicPrefix: 'fk-abc' }, 'id', new Date('2026-11-13T08:31:00Z'), () => {});
    expect(saves[0].fields.blockedTopics.arrayValue.values.map((v: any) => v.stringValue)).toEqual(['mama']); // „alt“ gibt es nicht mehr
  });
});

describe('Zeitzone der Familie', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('erinnert nach der Uhr der Familie (London statt Wien)', async () => {
    const sv = (s: string) => ({ stringValue: s });
    const sent: any[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === 'https://ntfy.example') { sent.push(JSON.parse(init!.body as string)); return new Response('{}'); }
      if (url.endsWith(':runQuery')) return new Response(JSON.stringify([{ document: { name: 'x/e1', fields: {
        title: sv('Zahnarzt'), start: sv('2026-11-13T10:00'), end: sv('2026-11-13T10:30'), allDay: { booleanValue: false },
        personIds: { arrayValue: { values: [sv('mama')] } }, reminderMinutes: { integerValue: '30' } } } }]));
      if (url.includes('/persons')) return new Response(JSON.stringify({ documents: [{ name: 'x/mama', fields: { name: sv('Mama'), ntfyTopic: sv('mama') } }] }));
      if (url.includes('/meta?')) return new Response(JSON.stringify({ documents: [{ name: 'x/reminders', fields: { lastRun: sv('2026-11-13T09:20'), sent: { arrayValue: {} } } },
        { name: 'x/settings', fields: { ntfyServer: sv('https://ntfy.example'), timezone: sv('Europe/London') } }] }));
      return new Response('{}');
    });
    const cfg: Config = { apiKey: 'k', projectId: 'p', familyId: 'f', ntfyServer: '', timezone: 'Europe/Vienna' };
    await run(cfg, 'id', new Date('2026-11-13T08:31:00Z'), () => {}); // 08:31 in London → noch nicht fällig
    expect(sent).toEqual([]);
    await run(cfg, 'id', new Date('2026-11-13T09:31:00Z'), () => {}); // 09:31 in London → fällig (10:00 − 30 min)
    expect(sent.map((n) => n.title)).toEqual(['Zahnarzt']);
  });
});

describe('Versandfehler', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('lässt das Zeitfenster offen und meldet den Fehler, damit der nächste Lauf nachholt', async () => {
    const sv = (s: string) => ({ stringValue: s });
    const saves: any[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === 'https://ntfy.example') return new Response('{"error":"limit reached: daily message quota reached"}', { status: 429 });
      if (url.endsWith(':runQuery')) return new Response(JSON.stringify([{ document: { name: 'x/e1', fields: {
        title: sv('Zahnärztin'), start: sv('2026-11-13T10:00'), end: sv('2026-11-13T10:30'), allDay: { booleanValue: false },
        personIds: { arrayValue: { values: [sv('mama')] } }, reminderMinutes: { integerValue: '30' } } } }]));
      if (url.includes('/persons')) return new Response(JSON.stringify({ documents: [{ name: 'x/mama', fields: { name: sv('Mama'), ntfyTopic: sv('mama') } }] }));
      if (url.includes('/meta?')) return new Response(JSON.stringify({ documents: [{ name: 'x/reminders', fields: { lastRun: sv('2026-11-13T09:20'), sent: { arrayValue: {} } } },
        { name: 'x/settings', fields: { ntfyServer: sv('https://ntfy.example'), ntfyToken: sv('TOK') } }] }));
      if (url.endsWith('/meta/reminders')) saves.push(JSON.parse(init!.body as string));
      return new Response('{}');
    });
    const cfg: Config = { apiKey: 'k', projectId: 'p', familyId: 'f', ntfyServer: 'https://ntfy.example', timezone: 'Europe/Vienna' };
    await expect(run(cfg, 'id', new Date('2026-11-13T08:31:00Z'), () => {})).rejects.toThrow('429');
    expect(saves[0].fields.lastRun.stringValue).toBe('2026-11-13T09:20');
    expect(saves[0].fields.ntfyError.stringValue).toContain('429');
    expect(saves[0].fields.sent.arrayValue.values ?? []).toEqual([]);
  });
});

describe('Importierte Kalender und Sicherung im Lauf', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('lädt neuen Link, schreibt Termine mit Vorabend-Erinnerung und legt eine Sicherung an', async () => {
    const sv = (s: string) => ({ stringValue: s });
    const commits: any[] = [];
    const saves: any[] = [];
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a1\r\nSUMMARY:Restmüll\r\nDTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === 'https://gemeinde.example/muell.ics') return new Response(ics);
      if (url.endsWith(':runQuery')) return new Response('[{}]');
      if (url.endsWith(':commit')) { commits.push(JSON.parse(init!.body as string)); return new Response('{}'); }
      if (url.includes('/backups?')) return new Response(JSON.stringify({ documents: [{ name: 'x/2026-01-01' }, { name: 'x/2026-11-01' }] }));
      if (url.includes('/persons')) return new Response(JSON.stringify({ documents: [] }));
      if (url.includes('/events') || url.includes('/timetables')) return new Response(JSON.stringify({ documents: [] }));
      if (url.includes('/meta?')) return new Response(JSON.stringify({ documents: [{ name: 'x/settings', fields: {
        icsSources: { arrayValue: { values: [{ mapValue: { fields: { id: sv('s1'), name: sv('Müll'), url: sv('webcal://gemeinde.example/muell.ics'), personIds: { arrayValue: {} }, evening: sv('19:00') } } }] } } } }] }));
      if (url.endsWith('/meta/reminders')) saves.push(JSON.parse(init!.body as string));
      return new Response('{}');
    });
    const cfg: Config = { apiKey: 'k', projectId: 'p', familyId: 'f', ntfyServer: 'https://ntfy.example', timezone: 'Europe/Vienna' };
    await run(cfg, 'id', new Date('2026-11-15T08:31:00Z'), () => {});
    const evWrite = commits.flatMap((c) => c.writes).find((w: any) => w.update?.name.includes('/events/'));
    expect(evWrite.update.fields.title.stringValue).toBe('Restmüll');
    expect(evWrite.update.fields.importSource.stringValue).toBe('Müll');
    expect(evWrite.update.fields.reminderMinutes.integerValue).toBe('780');
    const bk = commits.flatMap((c) => c.writes).find((w: any) => w.update?.name.endsWith('/backups/2026-11-15'));
    expect(JSON.parse(bk.update.fields.data.stringValue).format).toBe('familienkalender-backup');
    expect(commits.flatMap((c) => c.writes).filter((w: any) => w.delete).map((w: any) => w.delete.split('/').pop())).toEqual(['2026-01-01']);
    const last = saves[saves.length - 1].fields;
    expect(last.lastBackup.stringValue).toBe('2026-11-15');
    expect(last.backupError.stringValue).toBe('');
    expect(last.icsStatus.arrayValue.values[0].mapValue.fields.count.integerValue).toBe('1');
  });
});

describe('Wochenübersicht mit Fahrdienst', () => {
  it('Familien-Topic bekommt alle Fahrer, Person nur die eigenen Fahrten', () => {
    const fam = { ntfyFamilyTopic: 'familie' };
    const evs = [
      ev({ id: 'f1', title: 'Schwimmen', personIds: ['mama'], driverIds: ['papa'], start: '2026-11-17T16:00', end: '2026-11-17T17:00' }),
      ev({ id: 'f2', title: 'Arzt', personIds: [], start: '2026-11-18T09:00', end: '2026-11-18T10:00' }),
    ];
    const d = digest({ events: evs, persons, family: fam, from: '2026-11-16', days: 7, title: 'Woche', drivers: true });
    const familie = d.find((n) => n.topic === 'familie')!.message;
    expect(familie).toContain('🚗 Fahrdienst diese Woche:');
    expect(familie).toContain('Papa: Di., 17.11. 16:00 Schwimmen (Mama)');
    const papa = d.find((n) => n.topic === 'papa')!.message;
    expect(papa).toContain('🚗 Du fährst:\nDi., 17.11. 16:00 Schwimmen (Mama)');
    expect(d.find((n) => n.topic === 'mama')!.message).not.toContain('Du fährst');
    const off = digest({ events: evs, persons, family: fam, from: '2026-11-16', days: 7, title: 'Woche', drivers: false });
    expect(off.find((n) => n.topic === 'familie')!.message).not.toContain('🚗 Fahrdienst');
  });
});

describe('Mehrere Erinnerungen im Dienst', () => {
  it('schickt 30 und 5 Minuten vorher je einmal, mit eigenem Schlüssel', () => {
    const e = ev({ reminderMinutes: 30, extraReminders: [5] });
    const persons = [{ id: 'mama', name: 'Mama', color: '#f00', ntfyTopic: 'fk-x' } as never];
    const a = dueNotifications({ events: [e], persons, from: '2026-11-13T09:29', to: '2026-11-13T09:30', sent: new Set() });
    const b = dueNotifications({ events: [e], persons, from: '2026-11-13T09:54', to: '2026-11-13T09:55', sent: new Set(a.map((x) => x.key)) });
    expect(a.map((x) => x.key)).toEqual(['e1|2026-11-13T10:00|30']);
    expect(b.map((x) => x.key)).toEqual(['e1|2026-11-13T10:00|5']);
    expect(b[0].n.priority).toBe(4);
  });
});

describe('Tagesübersicht per ntfy', () => {
  afterEach(() => vi.unstubAllGlobals());
  const sv = (s: string) => ({ stringValue: s });
  const setup = (ntfyStatus: number, withEvent: boolean) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === 'https://ntfy.example') return new Response(ntfyStatus === 200 ? '{}' : 'down', { status: ntfyStatus });
      if (url.endsWith(':runQuery')) return new Response(JSON.stringify([{ readTime: 'x' }]));
      if (url.includes('/events?')) return new Response(JSON.stringify({ documents: withEvent ? [{ name: 'x/e1', fields: {
        title: sv('Zahnärztin'), start: sv('2026-11-13T10:00'), end: sv('2026-11-13T10:30'), allDay: { booleanValue: false },
        personIds: { arrayValue: { values: [sv('mama')] } } } }] : [] }));
      if (url.includes('/persons')) return new Response(JSON.stringify({ documents: [{ name: 'x/mama', fields: { name: sv('Mama'), ntfyTopic: sv('mama') } }] }));
      if (url.includes('/meta?')) return new Response(JSON.stringify({ documents: [{ name: 'x/reminders', fields: { lastRun: sv('2026-11-13T07:30'), sent: { arrayValue: {} } } },
        { name: 'x/settings', fields: { ntfyServer: sv('https://ntfy.example'), ntfyDaily: sv('06:30') } }] }));
      if (url.includes('/timetables')) return new Response(JSON.stringify({ documents: [] }));
      return new Response('{}');
    });
    return calls;
  };
  const cfg: Config = { apiKey: 'k', projectId: 'p', familyId: 'f', ntfyServer: '', timezone: 'Europe/Vienna' };
  const saved = (calls: { url: string; init?: RequestInit }[]) => JSON.parse(calls.filter((c) => c.url.endsWith('/meta/reminders')).pop()!.init!.body as string).fields;

  it('schickt die Übersicht und merkt sich das Ergebnis', async () => {
    const calls = setup(200, true);
    await run(cfg, 'id', new Date('2026-11-13T05:35:00Z'), () => {}); // 06:35 in Wien
    expect(calls.some((c) => c.url === 'https://ntfy.example' && JSON.parse(c.init!.body as string).title === 'Heute im Kalender')).toBe(true);
    expect(saved(calls).lastDaily.stringValue).toBe('2026-11-13');
    expect(saved(calls).dailyInfo.stringValue).toBe('2026-11-13 06:35 · an 1 Topic gesendet');
  });
  it('ohne Termine: nichts senden, aber anzeigen warum', async () => {
    const calls = setup(200, false);
    await run(cfg, 'id', new Date('2026-11-13T05:35:00Z'), () => {});
    expect(calls.some((c) => c.url === 'https://ntfy.example')).toBe(false);
    expect(saved(calls).dailyInfo.stringValue).toContain('keine Termine');
  });
  it('Versand gescheitert: nicht als erledigt markieren (wird erneut versucht)', async () => {
    const calls = setup(500, true);
    await run(cfg, 'id', new Date('2026-11-13T05:35:00Z'), () => {}).catch(() => {});
    expect(saved(calls).lastDaily.stringValue).toBe('');
    expect(saved(calls).dailyInfo.stringValue).toContain('erneut versucht');
  });
});
