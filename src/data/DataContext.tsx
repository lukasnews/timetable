import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CalEvent, DeviceSettings, FamilySettings, Person, Timetable } from '../types';
import type { Store, SyncStatus } from './store';
import { loadCloudConfig, readJoinLink, saveCloudConfig } from './store';
import { LocalStore } from './localStore';
import { FirebaseStore } from './firebaseStore';
import type { Mutation } from '../lib/recurrence';
import { seedDemo } from './seed';

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
  dayStart: '06:00',
  dayEnd: '22:00',
};

interface Data {
  store: Store;
  status: SyncStatus;
  persons: Person[];
  events: CalEvent[];
  timetables: Timetable[];
  family: FamilySettings;
  device: DeviceSettings;
  setDevice: (d: Partial<DeviceSettings>) => void;
  apply: (m: Mutation) => void;
  savePerson: (p: Person) => void;
  deletePerson: (id: string) => void;
  saveTimetable: (t: Timetable) => void;
  saveFamily: (f: Partial<FamilySettings>) => void;
  switchStore: () => void;
}

const Ctx = createContext<Data | null>(null);

function createStore(): Store {
  const join = readJoinLink();
  if (join) {
    saveCloudConfig(join);
    history.replaceState(null, '', location.pathname + location.search);
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
    return { ...DEFAULT_DEVICE, ...JSON.parse(localStorage.getItem('fk.device') || '{}') };
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
  const [family, setFamily] = useState<FamilySettings>(DEFAULT_FAMILY);
  const [device, setDeviceState] = useState<DeviceSettings>(loadDevice);

  useEffect(() => {
    const offs = [
      store.onStatus(setStatus),
      store.subscribe<Person>('persons', (p) => setPersons([...p].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)))),
      store.subscribe<CalEvent>('events', setEvents),
      store.subscribe<Timetable>('timetables', setTimetables),
      store.subscribe<FamilySettings>('meta', (m) => setFamily({ ...DEFAULT_FAMILY, ...(m.find((x) => x.id === 'settings') ?? {}) })),
    ];
    return () => offs.forEach((o) => o());
  }, [store]);

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
      family,
      device,
      setDevice,
      apply: (m) => {
        m.put.forEach((e) => store.put('events', e));
        m.del.forEach((id) => store.remove('events', id));
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
    [store, status, persons, events, timetables, family, device, setDevice],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): Data {
  const v = useContext(Ctx);
  if (!v) throw new Error('DataProvider fehlt');
  return v;
}
