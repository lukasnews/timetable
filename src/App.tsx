import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type FullCalendar from '@fullcalendar/react';
import { useData } from './data/DataContext';
import { CalendarView, type ChangeInfo, type ViewName } from './components/CalendarView';
import { EventDialog, type EditDraft } from './components/EventDialog';
import { SettingsDialog, type SettingsTab } from './components/SettingsDialog';
import { TimetableView } from './components/TimetableView';
import { PinDialog, ScopeDialog } from './components/Dialogs';
import { Avatar, Icon } from './components/ui';
import { applyChange, applyDelete, type Scope } from './lib/recurrence';
import { addMinutes, diffMinutes, fromNative, uid } from './lib/dates';
import type { CalEvent } from './types';
import { useInstall } from './install';
import { isNight, useClock, useIdle, useMedia, useReminders, useWakeLock } from './hooks';

type Mode = ViewName | 'timetable';

const VIEW_LABELS: [Mode, string, string][] = [
  ['dayGridMonth', 'Monat', 'M'],
  ['timeGridWeek', 'Woche', 'W'],
  ['timeGridDay', 'Tag', 'T'],
  ['timetable', 'Stundenplan', '📚'],
];

export default function App() {
  const data = useData();
  const { persons, events, family, device } = data;
  const isPhone = useMedia('(max-width: 640px)');
  const calRef = useRef<FullCalendar>(null);

  const defaultMode = (): ViewName =>
    device.defaultView === 'month' ? 'dayGridMonth' : device.defaultView === 'week' ? 'timeGridWeek' : device.defaultView === 'day' ? 'timeGridDay' : isPhone ? 'timeGridDay' : 'timeGridWeek';
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [title, setTitle] = useState('');

  // Personen-Filter (pro Gerät gemerkt)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem('fk.hidden') || '[]')));
  useEffect(() => localStorage.setItem('fk.hidden', JSON.stringify([...hidden])), [hidden]);
  const selected = useMemo(() => new Set(persons.map((p) => p.id).filter((id) => !hidden.has(id))), [persons, hidden]);
  const toggle = (id: string) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const solo = (id: string) => setHidden(new Set(persons.map((p) => p.id).filter((x) => x !== id)));

  // Dialoge
  const [draft, setDraft] = useState<(EditDraft & { scope?: Scope; occStart?: string; series?: CalEvent }) | null>(null);
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  const [scopeAsk, setScopeAsk] = useState<{ action: 'edit' | 'move' | 'delete'; resolve: (s: Scope | null) => void } | null>(null);
  const [pinAsk, setPinAsk] = useState<((ok: boolean) => void) | null>(null);
  const unlockedUntil = useRef(0);

  const askScope = (action: 'edit' | 'move' | 'delete') => new Promise<Scope | null>((resolve) => setScopeAsk({ action, resolve }));
  const requirePin = useCallback(() => {
    if (!family.pinHash || Date.now() < unlockedUntil.current) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setPinAsk(() => (ok: boolean) => {
      if (ok) unlockedUntil.current = Date.now() + 5 * 60000;
      setPinAsk(null);
      resolve(ok);
    }));
  }, [family.pinHash]);

  const openSettings = async (tab: SettingsTab) => { if (await requirePin()) setSettings(tab); };

  // Ansicht wechseln
  const changeMode = (m: Mode) => {
    setMode(m);
    if (m !== 'timetable') setTimeout(() => calRef.current?.getApi().changeView(m));
  };
  const api = () => calRef.current?.getApi();

  // Kiosk
  const now = useClock();
  useWakeLock(device.kiosk && device.wakeLock);
  useIdle(device.idleReturnMinutes, device.kiosk, () => {
    setDraft(null); setSettings(null); setScopeAsk(null);
    const m = defaultMode();
    setMode(m);
    setTimeout(() => { api()?.changeView(m); api()?.today(); });
  });
  const night = device.kiosk && device.nightMode && isNight(now, device.nightFrom, device.nightTo);
  const systemDark = useMedia('(prefers-color-scheme: dark)');
  const dark = night || device.theme === 'dark' || (device.theme === 'auto' && systemDark);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('night', night);
    root.classList.toggle('dark', dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1017' : '#f4f5fa');
  }, [night, dark]);
  const hasKids = persons.some((p) => p.hasTimetable);
  // Um Mitternacht auf den neuen Tag springen
  const day = now.toDateString();
  useEffect(() => { if (device.kiosk) api()?.today(); }, [day, device.kiosk]);

  useReminders(events, persons, device);
  const inst = useInstall();

  // Termin anlegen
  const newEvent = (start?: string, end?: string, allDay = false) => {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    const s = start ?? fromNative(now, false);
    const e = end ?? addMinutes(s, 60);
    const solo = selected.size === 1 ? [...selected] : [];
    setDraft({ isNew: true, event: { id: uid(), title: '', start: s, end: e, allDay, personIds: solo, kind: 'event', reminderMinutes: null } });
  };

  // Termin öffnen
  const open = async (eventId: string, occStart: string) => {
    const ev = events.find((e) => e.id === eventId);
    if (!ev) return;
    if (!ev.recurrence) return setDraft({ isNew: false, event: ev });
    const scope = await askScope('edit');
    setScopeAsk(null);
    if (!scope) return;
    const dur = diffMinutes(ev.start, ev.end);
    if (scope === 'all') return setDraft({ isNew: false, event: ev, scope, occStart, series: ev });
    // Vorkommen mit dessen Datum anzeigen
    const occ = { ...ev, start: occStart, end: addMinutes(occStart, dur, ev.allDay) };
    setDraft({ isNew: false, event: occ, scope, occStart, series: ev, singleOccurrence: scope === 'one' });
  };

  const save = (ev: CalEvent) => {
    if (!draft) return;
    if (draft.isNew || !draft.series) {
      data.apply({ put: [ev], del: [] });
    } else {
      const { id: _id, start, end, allDay, exdates: _ex, ...patch } = ev;
      void _id; void _ex;
      if (draft.scope === 'one') delete patch.recurrence;
      const scope = draft.scope ?? 'all';
      // Bei "Alle" zeigt der Dialog die Serie selbst → Bezug ist der Serienstart
      const ref = scope === 'all' ? draft.series.start : draft.occStart!;
      data.apply(applyChange(draft.series, ref, { start, end, allDay, patch }, scope, events, uid));
    }
    setDraft(null);
  };

  const remove = async () => {
    if (!draft) return;
    const ev = draft.series ?? draft.event;
    let scope: Scope = draft.scope ?? 'all';
    if (ev.recurrence && !draft.scope) {
      const s = await askScope('delete');
      setScopeAsk(null);
      if (!s) return;
      scope = s;
    }
    data.apply(applyDelete(ev, draft.occStart ?? ev.start, scope, events));
    setDraft(null);
  };

  const change = async (c: ChangeInfo) => {
    const ev = events.find((e) => e.id === c.eventId);
    if (!ev) return c.revert();
    let scope: Scope = 'all';
    if (ev.recurrence) {
      const s = await askScope('move');
      setScopeAsk(null);
      if (!s) return c.revert();
      scope = s;
    }
    data.apply(applyChange(ev, c.occStart, { start: c.start, end: c.end, allDay: c.allDay }, scope, events, uid));
  };

  const statusIcon = data.store.mode === 'local' ? null : (
    <span className={'sync ' + data.status} title={{ synced: 'Synchronisiert', pending: 'Synchronisiere …', offline: 'Offline', error: 'Sync-Fehler', local: '' }[data.status]}>
      <Icon name={data.status === 'offline' || data.status === 'error' ? 'cloudOff' : 'cloud'} size={16} />
    </span>
  );

  return (
    <div className={'app' + (device.kiosk ? ' kiosk' : '')}>
      <header className="topbar">
        <button className="fab" onClick={() => newEvent()} aria-label="Neuer Termin"><Icon name="plus" size={28} /></button>
        <div className="chips" role="toolbar" aria-label="Personen filtern">
          {persons.map((p) => (
            <button key={p.id} className={'chip' + (selected.has(p.id) ? ' on' : '')} style={{ ['--pc' as string]: p.color }}
              onClick={() => toggle(p.id)} onDoubleClick={() => solo(p.id)} onContextMenu={(e) => { e.preventDefault(); solo(p.id); }}
              aria-pressed={selected.has(p.id)} title={`${p.name} – Doppelklick: nur ${p.name}`}>
              <Avatar person={p} size={isPhone ? 34 : 40} />
              <span className="chip-name">{p.name}</span>
            </button>
          ))}
          {persons.length === 0 && <button className="btn" onClick={() => openSettings('persons')}>Personen anlegen</button>}
        </div>
        <div className="top-right">
          {statusIcon}
          {inst.canPrompt && !inst.installed && (
            <button className="btn small install-btn" onClick={inst.install}><Icon name="download" size={16} /> <span>Installieren</span></button>
          )}
          <button className="icon-btn" onClick={() => openSettings('persons')} aria-label="Profile"><Icon name="users" /></button>
          <button className="icon-btn" onClick={() => openSettings('general')} aria-label="Einstellungen"><Icon name="gear" /></button>
        </div>
      </header>

      <div className="toolbar">
        {mode !== 'timetable' && (
          <div className="nav">
            <button className="icon-btn" onClick={() => api()?.prev()} aria-label="Zurück"><Icon name="left" /></button>
            <button className="btn" onClick={() => api()?.today()}>Heute</button>
            <button className="icon-btn" onClick={() => api()?.next()} aria-label="Weiter"><Icon name="right" /></button>
            <h1 className="range-title">{title}</h1>
          </div>
        )}
        {mode === 'timetable' && <h1 className="range-title">Stundenplan</h1>}
        {mode !== 'timetable' && hasKids && (
          <button className={'school-toggle' + (device.showSchool ? ' on' : '')} onClick={() => data.setDevice({ showSchool: !device.showSchool })}
            aria-pressed={device.showSchool} title="Schulzeiten ein-/ausblenden">
            <span aria-hidden="true">🏫</span><span className="long">Schule</span>
          </button>
        )}
        {device.kiosk && <span className="clock">{now.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}</span>}
        <div className="seg views">
          {VIEW_LABELS.map(([m, label, short]) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => changeMode(m)}>
              <span className="long">{label}</span><span className="short">{short}</span>
            </button>
          ))}
        </div>
      </div>

      <main className="main">
        {mode === 'timetable' ? (
          <TimetableView requirePin={requirePin} />
        ) : (
          <div className="cal-wrap">
            <CalendarView ref={calRef} view={mode} selected={selected} onRange={(t) => setTitle(t)} onOpen={open} onCreate={newEvent} onChange={change} />
          </div>
        )}
      </main>

      {draft && (
        <EventDialog draft={draft} persons={persons} onClose={() => setDraft(null)} onSave={save} onDelete={draft.isNew ? undefined : remove} />
      )}
      {settings && <SettingsDialog tab={settings} onClose={() => setSettings(null)} />}
      {scopeAsk && <ScopeDialog action={scopeAsk.action} onPick={(s) => scopeAsk.resolve(s)} />}
      {pinAsk && family.pinHash && <PinDialog pinHash={family.pinHash} onResult={pinAsk} />}
    </div>
  );
}
