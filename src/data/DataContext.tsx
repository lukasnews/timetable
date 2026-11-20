import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CalEvent, DeviceSettings, EventTemplate, FamilySettings, Person, Timetable } from '../types';
import type { Store, SyncStatus } from './store';
import { loadCloudConfig, readJoinLink, saveCloudConfig } from './store';
import { LocalStore } from './localStore';
import { FirebaseStore } from './firebaseStore';
import type { Mutation } from '../lib/recurrence';
import { seedDemo } from './seed';

/** Erinnerungsdienst (Cloudflare) – für alle Familien; jede meldet sich mit ihrer geheimen ID an */
const DEFAULT_SERVICE_URL = (import.meta.env.VITE_SERVICE_URL as string | undefined) || undefined;
const DEFAULT_FAMILY: FamilySettings = { id: 'settings', showHolidays: true, showSchoolHolidays: true };

export const DEFAULT_DEVICE: DeviceSettings = {
  defaultView: 'auto',
  kiosk: false,
  wakeLock: true,
  idleReturnMinutes: 5,
  nightMode: false,
  nightFrom: '21:30',
  nightTo: '06:00',
  reminders: false,
  reminderPersons: [],
  schoolInMonth: false,
  showWeather: true,
  showCountdown: true,
  locked: true,
  lockNeedsPin: false,
  showSchool: true,
  theme: 'auto',
  dayStart: '00:00',
  dayEnd: '24:00',
  uiScale: 1,
  saverDay: false,
  saverNight: false,
  saverMinutes: 5,
};

interface Data {
  store: Store;
  status: SyncStatus;
  persons: Person[];
  events: CalEvent[];
  timetables: Timetable[];
  templates: EventTemplate[];
  saveTemplates: (t: EventTemplate[]) => void;
  /** Adresse des Erinnerungsdienstes (für den Abo-Link), vom Einrichtungs-Workflow hinterlegt */
  serviceUrl?: string;
  /** Status des Dienstes (letzter Lauf, importierte Kalender, automatische Sicherung) */
  service: ServiceState;
  family: FamilySettings;
  device: DeviceSettings;
  setDevice: (d: Partial<DeviceSettings>) => void;
  /** Wendet Änderungen an und gibt die Umkehrung zurück (für „Rückgängig“) */
  apply: (m: Mutation) => Mutation;
  savePerson: (p: Person) => void;
  deletePerson: (id: string) => void;
  saveTimetable: (t: Timetable) => void;
  saveFamily: (f: Partial<FamilySettings>) => void;
  switchStore: () => void;
}

export interface ServiceState {
  icsStatus?: { id: string; at: number; count?: number; changed?: number; error?: string }[];
  lastBackup?: string;
  backupError?: string;
  at?: number;
  /** Nötiges Präfix für ntfy-Topics dieser Familie ('' = keins) */
  topicPrefix?: string;
  /** Server, über den der Dienst verschickt */
  ntfyServer?: string;
  /** Topics, an die nicht gesendet wurde (ohne Präfix) */
  blockedTopics?: string[];
  ntfyError?: string;
}

const Ctx = createContext<Data | null>(null);

function createStore(): Store {
  const join = readJoinLink();
  if (join) {
    history.replaceState(null, '', location.pathname + location.search);
    const current = loadCloudConfig();
    // Schon mit einem ANDEREN Familienkalender verbunden: nicht stillschweigend wechseln (sonst wäre der eigene weg)
    const ok = !current || current.familyId === join.familyId
      || window.confirm('Dieses Gerät ist schon mit einem Familienkalender verbunden.\n\nZu dem Familienkalender aus dem Link wechseln? '
        + 'Der bisherige bleibt erhalten und kann unter ⚙️ → Synchronisation wieder verbunden werden.');
    if (ok) {
      if (current && current.familyId !== join.familyId) localStorage.setItem('fk.cloud.prev', JSON.stringify(current));
      saveCloudConfig(join);
    }
  }
  const cfg = loadCloudConfig();
  if (cfg) {
    try {
      return new FirebaseStore(cfg);
    } catch (e) {
      console.error('Cloud-Start fehlgeschlagen, nutze lokalen Speicher', e);
    }
  }
  const local = new LocalStore();
  if (!localStorage.getItem('fk.seeded') && local.all('persons').length === 0) {
    localStorage.setItem('fk.seeded', '1');
    seedDemo(local);
  }
  return local;
}

function loadDevice(): DeviceSettings {
  try {
    const stored = JSON.parse(localStorage.getItem('fk.device') || '{}');
    // v2: Standard ist jetzt der ganze Tag (früher 6–22 Uhr) – alte gespeicherte Werte übernehmen wir nicht
    if (!stored.v || stored.v < 2) {
      delete stored.dayStart;
      delete stored.dayEnd;
      stored.v = 2;
    }
    return { ...DEFAULT_DEVICE, ...stored };
  } catch {
    return DEFAULT_DEVICE;
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store>(createStore);
  const [status, setStatus] = useState<SyncStatus>('local');
  const [persons, setPersons] = useState<Person[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [serviceUrl, setServiceUrl] = useState<string | undefined>();
  const [service, setService] = useState<ServiceState>({});
  const [family, setFamily] = useState<FamilySettings>(DEFAULT_FAMILY);
  const [device, setDeviceState] = useState<DeviceSettings>(loadDevice);

  useEffect(() => {
    const offs = [
      store.onStatus(setStatus),
      store.subscribe<Person>('persons', (p) => setPersons([...p].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)))),
      store.subscribe<CalEvent>('events', setEvents),
      store.subscribe<Timetable>('timetables', setTimetables),
      store.subscribe<any>('meta', (m) => {
        setFamily({ ...DEFAULT_FAMILY, ...(m.find((x) => x.id === 'settings') ?? {}) });
        setTemplates(m.find((x) => x.id === 'templates')?.items ?? []);
        // Fest eingebaute Adresse hat Vorrang (z. B. eigene Domain statt der alten workers.dev-Adresse)
        setServiceUrl(store.mode === 'cloud' ? DEFAULT_SERVICE_URL || m.find((x) => x.id === 'service')?.url || undefined : m.find((x) => x.id === 'service')?.url || undefined);
        const r = m.find((x) => x.id === 'reminders');
        setService(r ? { icsStatus: r.icsStatus, lastBackup: r.lastBackup || undefined, backupError: r.backupError || undefined, at: r.at,
          topicPrefix: r.topicPrefix || undefined, ntfyServer: r.ntfyServer || undefined, blockedTopics: r.blockedTopics?.length ? r.blockedTopics : undefined, ntfyError: r.ntfyError || undefined } : {});
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [store]);

  // Beim Erinnerungsdienst anmelden (einmal am Tag bzw. wenn sich der Abo-Schlüssel ändert) – nur mit der eigenen geheimen ID
  const hasData = persons.length > 0;
  useEffect(() => {
    const fid = loadCloudConfig()?.familyId;
    if (store.mode !== 'cloud' || !serviceUrl || !fid || !hasData) return;
    const key = `${fid}|${family.feedToken ?? ''}|${new Date().toISOString().slice(0, 10)}`;
    try { if (localStorage.getItem('fk.registered') === key) return; } catch { return; }
    const t = setTimeout(() => {
      fetch(`${serviceUrl}/register?family=${encodeURIComponent(fid)}`, { method: 'POST' })
        .then((r) => { if (r.ok) localStorage.setItem('fk.registered', key); })
        .catch(() => { /* offline – später erneut */ });
    }, 3000);
    return () => clearTimeout(t);
  }, [store, serviceUrl, hasData, family.feedToken]);

  const setDevice = useCallback((d: Partial<DeviceSettings>) => {
    setDeviceState((prev) => {
      const next = { ...prev, ...d };
      localStorage.setItem('fk.device', JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo<Data>(
    () => ({
      store,
      status,
      persons,
      events,
      timetables,
      templates,
      saveTemplates: (items) => store.put('meta', { id: 'templates', items }),
      serviceUrl,
      service,
      family,
      device,
      setDevice,
      apply: (m) => {
        const byId = new Map(events.map((e) => [e.id, e]));
        const touched = [...new Set([...m.put.map((e) => e.id), ...m.del])];
        const undo: Mutation = {
          put: touched.map((id) => byId.get(id)).filter(Boolean) as CalEvent[],
          del: m.put.map((e) => e.id).filter((id) => !byId.has(id)),
        };
        m.put.forEach((e) => store.put('events', { ...e, createdAt: e.createdAt ?? (byId.has(e.id) ? byId.get(e.id)!.createdAt ?? 1 : Date.now()), changedBy: device.me || undefined }));
        m.del.forEach((id) => store.remove('events', id));
        return undo;
      },
      savePerson: (p) => store.put('persons', p),
      deletePerson: (id) => {
        store.remove('persons', id);
        store.remove('timetables', id);
        events.filter((e) => e.personIds.includes(id)).forEach((e) => store.put('events', { ...e, personIds: e.personIds.filter((x) => x !== id) }));
      },
      saveTimetable: (t) => store.put('timetables', t),
      saveFamily: (f) => store.put('meta', { ...family, ...f, id: 'settings' }),
      switchStore: () => setStore(createStore()),
    }),
    [store, status, persons, events, timetables, templates, serviceUrl, service, family, device, setDevice],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): Data {
  const v = useContext(Ctx);
  if (!v) throw new Error('DataProvider fehlt');
  return v;
}
