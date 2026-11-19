import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type FullCalendar from '@fullcalendar/react';
import { flushSync } from 'react-dom';
import { useData } from './data/DataContext';
import { CalendarView, type ChangeInfo, type ViewName } from './components/CalendarView';
import { EventDialog, type EditDraft } from './components/EventDialog';
import { SettingsDialog, type SettingsTab } from './components/SettingsDialog';
import { TimetableView } from './components/TimetableView';
import { SearchDialog } from './components/SearchDialog';
import { EventDetails } from './components/EventDetails';
import { DriverList } from './components/DriverList';
import { Screensaver } from './components/Screensaver';
import { QuickLinksButton } from './components/QuickLinks';
import { useWeather } from './lib/weather';
import { isNative, nativePrint, setSystemBarsHidden, syncNativeReminders, syncWidget } from './native';
import { PinDialog, ScopeDialog } from './components/Dialogs';
import { Avatar, Icon } from './components/ui';
import { applyChange, applyDelete, type Scope } from './lib/recurrence';
import { findConflicts } from './lib/conflicts';
import { addDays, addMinutes, diffMinutes, fromNative, isoWeek, uid, weekdayMo0 } from './lib/dates';
import { staleImports } from './lib/icsSync';
import { isSchoolFree } from './lib/holidays';
import { isKidDayOff } from './lib/calendarEvents';
import { nextCountdowns } from './lib/countdown';
import type { CalEvent } from './types';
import { useInstall } from './install';
import { isNight, slideIn, useClock, useIdle, useMedia, usePullToRefresh, useReminders, useSwipe, useWakeLock } from './hooks';

type Mode = ViewName | 'timetable';

const VIEW_LABELS: [Mode, string, string][] = [
  ['multiMonthYear', 'Jahr', 'J'],
  ['dayGridMonth', 'Monat', 'M'],
  ['timeGridWeek', 'Woche', 'W'],
  ['timeGridFocus', 'Fokus', 'F'],
  ['timeGridThree', '3 Tage', '3'],
  ['timeGridDay', 'Tag', 'T'],
  ['listUpcoming', 'Liste', 'L'],
  ['timetable', 'Stundenplan', '📚'],
];

export default function App() {
  const data = useData();
  const { persons, events, family, device } = data;
  const isPhone = useMedia('(max-width: 640px)');
  const calRef = useRef<FullCalendar>(null);

  const defaultMode = (): ViewName =>
    device.defaultView === 'month' ? 'dayGridMonth' : device.defaultView === 'week' ? 'timeGridWeek' : device.defaultView === 'focus' ? (isPhone ? 'timeGridThree' : 'timeGridFocus') : device.defaultView === 'day' ? 'timeGridDay' : isPhone ? 'timeGridDay' : 'timeGridWeek';
  const [mode, setMode] = useState<Mode>(defaultMode);
  // zuletzt benutzte Kalenderansicht (für die Auswahl, solange der Stundenplan offen ist)
  const [lastCalMode, setLastCalMode] = useState<ViewName>(defaultMode);
  useEffect(() => { if (mode !== 'timetable') setLastCalMode(mode); }, [mode]);
  const [range, setRange] = useState<{ type: string; start: Date; end: Date } | null>(null);
  const dateInput = useRef<HTMLInputElement>(null);

  // Personen-Filter (pro Gerät gemerkt)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem('fk.hidden') || '[]')));
  useEffect(() => localStorage.setItem('fk.hidden', JSON.stringify([...hidden])), [hidden]);
  const selected = useMemo(() => new Set(persons.map((p) => p.id).filter((id) => !hidden.has(id))), [persons, hidden]);
  const toggle = (id: string) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const solo = (id: string) => setHidden(new Set(persons.map((p) => p.id).filter((x) => x !== id)));
  // Abonnierte/importierte Kalender (z. B. Müll) ein-/ausblenden – pro Gerät, in den Einstellungen (optional Knöpfe in der Leiste)
  const sources = device.sourceChips ? family.icsSources ?? [] : [];
  const hiddenSources = useMemo(() => new Set(device.hiddenSources ?? []), [device.hiddenSources]);
  const shownEvents = useMemo(() => hiddenSources.size ? events.filter((e) => !e.importSource || !hiddenSources.has(e.importSource)) : events, [events, hiddenSources]);
  const toggleSource = (name: string) => data.setDevice({ hiddenSources: hiddenSources.has(name) ? [...hiddenSources].filter((x) => x !== name) : [...hiddenSources, name] });

  // Personenleiste: passt sie nicht, zuerst Namen ausblenden, dann seitlich scrollen
  const chipsRef = useRef<HTMLDivElement>(null);
  const [chipsCompact, setChipsCompact] = useState(false);
  const [chipsOverflow, setChipsOverflow] = useState(false);
  useEffect(() => {
    const el = chipsRef.current;
    if (!el) return;
    const check = () => {
      el.classList.remove('compact');
      const full = el.scrollWidth > el.clientWidth + 1;
      if (full) el.classList.add('compact');
      setChipsCompact(full);
      setChipsOverflow(el.scrollWidth > el.clientWidth + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [persons.length]);

  // Dialoge
  const [draft, setDraft] = useState<(EditDraft & { scope?: Scope; occStart?: string; series?: CalEvent }) | null>(null);
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  const [searching, setSearching] = useState(false);
  // Drucken: Ansicht kurz in den Druckmodus schalten (volle Höhe, helle Farben), dann den Druckdialog öffnen
  const [printing, setPrinting] = useState(false);
  const print = () => {
    setSettings(null);
    setPrinting(true);
    if (isNative()) {
      // Android-App: System-Druckdialog (Vorschau). Er rendert die Seite, solange er offen ist –
      // darum erst zurückschalten, wenn die App wieder im Vordergrund ist bzw. beim nächsten Antippen.
      const done = () => {
        setPrinting(false);
        window.removeEventListener('fk-resume', done);
        window.removeEventListener('pointerdown', done);
      };
      setTimeout(() => {
        api()?.updateSize();
        setTimeout(async () => {
          const ok = await nativePrint('Familienkalender');
          if (!ok) {
            done();
            alert('Zum Drucken bitte die neueste Version der App installieren (GitHub → Releases bzw. Play Store).');
            return;
          }
          setTimeout(() => {
            window.addEventListener('fk-resume', done);
            window.addEventListener('pointerdown', done);
          }, 800);
        }, 300);
      }, 150);
      return;
    }
    const done = () => { setPrinting(false); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { api()?.updateSize(); setTimeout(() => window.print(), 250); }, 150);
  };
  useEffect(() => { document.documentElement.classList.toggle('printing', printing); }, [printing]);
  // Anzeigegröße pro Gerät (beim Drucken immer 100 %)
  useEffect(() => {
    const f = printing ? 1 : Math.min(2, Math.max(0.7, device.uiScale || 1));
    const t = applyUiScale(f, () => api()?.updateSize());
    const re = () => applyUiScale(f, () => api()?.updateSize());
    window.addEventListener('orientationchange', re);
    return () => { clearTimeout(t); window.removeEventListener('orientationchange', re); };
  }, [device.uiScale, printing]); // eslint-disable-line react-hooks/exhaustive-deps
  // Auch über das Browser-Menü („Drucken“, „Als PDF speichern“) die Druckansicht verwenden:
  // beforeprint läuft synchron vor dem Druck – Klasse sofort setzen und React sofort neu zeichnen lassen.
  useEffect(() => {
    const before = () => {
      document.documentElement.classList.add('printing');
      flushSync(() => { setSettings(null); setPrinting(true); });
      api()?.updateSize();
    };
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [detail, setDetail] = useState<{ eventId: string; occStart: string } | null>(null);
  // Liste: alle Termine oder nur Fahrdienste (nach Fahrer gruppiert)
  const [driverMode, setDriverMode] = useState(() => { try { return localStorage.getItem('fk.driverList') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('fk.driverList', driverMode ? '1' : '0'); } catch { /* egal */ } }, [driverMode]);
  const hasDrivers = useMemo(() => events.some((e) => e.driverIds?.length), [events]);
  const showDrivers = mode === 'listUpcoming' && driverMode && hasDrivers;
  // „Rückgängig“-Leiste nach Löschen/Verschieben
  const [undo, setUndo] = useState<{ text: string; m: import('./lib/recurrence').Mutation } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);
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
  const calWrap = useRef<HTMLDivElement>(null);
  const go = (dir: 1 | -1) => {
    const a = api();
    if (mode === 'timeGridFocus' && a) {
      // Fokus-Woche: genau 7 Tage weiter/zurück (FullCalendar würde auf den Wochenbeginn ausrichten)
      const d = a.getDate(); d.setDate(d.getDate() + 7 * dir); a.gotoDate(d);
    } else if (dir > 0) a?.next(); else a?.prev();
    slideIn(calWrap.current?.querySelector('.fc-view-harness'), dir);
  };
  useSwipe(calWrap, () => go(1), () => go(-1), mode !== 'timetable');

  // Kiosk
  const now = useClock();
  useWakeLock(device.kiosk && device.wakeLock);
  useIdle(device.idleReturnMinutes, device.kiosk, () => {
    setDraft(null); setSettings(null); setScopeAsk(null); setDetail(null); setSearching(false);
    data.setDevice({ locked: true });
    setHidden(new Set()); // wieder alle Personen zeigen
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
    root.classList.toggle('light', !dark);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.removeAttribute('media'); m.setAttribute('content', dark ? '#0e0f15' : '#f4f5fa'); });
  }, [night, dark]);
  const hasKids = persons.some((p) => p.hasTimetable);
  const countdowns = useMemo(() => nextCountdowns(events, fromNative(now, true), family.showSchoolHolidays && hasKids, isPhone ? 1 : 2),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, now.toDateString(), family.showSchoolHolidays, hasKids, isPhone]);

  // Countdown in der Leiste: „bis …“ nur, wenn der Platz reicht; sonst nur „39 Tage“ (Antippen zeigt den Text)
  const cdRef = useRef<HTMLSpanElement>(null);
  const [cdShort, setCdShort] = useState(false);
  const [cdBubble, setCdBubble] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const el = cdRef.current;
    if (!el) return;
    const check = () => {
      el.classList.remove('short');
      const tooBig = [...el.querySelectorAll<HTMLElement>('.countdown')].some((c) => c.offsetParent && c.scrollWidth > c.clientWidth + 1)
        || el.scrollWidth > el.clientWidth + 1;
      if (tooBig) el.classList.add('short');
      setCdShort(tooBig);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [countdowns, device.showCountdown]);
  useEffect(() => {
    if (!cdBubble) return;
    const t = setTimeout(() => setCdBubble(null), 3000);
    return () => clearTimeout(t);
  }, [cdBubble]);

  // Bildschirmschoner: tagsüber Uhr + nächste Termine, nachts gedimmte Uhr – nach X Minuten ohne Berührung
  const saverWeather = useWeather(family.weather, device.showWeather && device.saverDay);
  const [saverOn, setSaverOn] = useState<false | 'idle' | 'preview'>(false);
  const nightNow = isNight(now, device.nightFrom, device.nightTo);
  const saverVariant: 'day' | 'night' | null = nightNow ? (device.saverNight ? 'night' : null) : (device.saverDay ? 'day' : null);
  useIdle(device.saverMinutes || 5, device.saverDay || device.saverNight, () => {
    if (!document.querySelector('.modal-backdrop')) setSaverOn('idle');
  });
  useEffect(() => {
    const preview = () => setSaverOn('preview');
    window.addEventListener('fk-saver', preview);
    return () => window.removeEventListener('fk-saver', preview);
  }, []);
  // Wer ist heute abwesend? (für die Personen-Chips)
  const absentToday = useMemo(() => {
    const t = fromNative(now, true);
    const out = new Map<string, string>();
    for (const e of events) if (e.absent && e.start <= t && t < e.end) for (const id of e.personIds) out.set(id, e.title);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, now.toDateString()]);
  // Um Mitternacht auf den neuen Tag springen
  const day = now.toDateString();
  useEffect(() => { if (device.kiosk) api()?.today(); }, [day, device.kiosk]);

  useReminders(events, persons, device);
  // Android-App im Kiosk-Modus: Status- und Navigationsleiste ausblenden (Wischen vom Rand holt sie kurz zurück)
  useEffect(() => {
    if (!isNative()) return;
    const apply = () => setSystemBarsHidden(device.kiosk).catch(() => {});
    apply();
    if (!device.kiosk) return;
    // nach dem Hereinwischen wieder ausblenden und beim Zurückkehren in die App
    const t = setInterval(apply, 20_000);
    window.addEventListener('fk-resume', apply);
    return () => { clearInterval(t); window.removeEventListener('fk-resume', apply); };
  }, [device.kiosk]);

  // Browser / installierte Web-App im Kiosk-Modus: Vollbild (blendet Adress-, Status- und Navigationsleiste aus).
  // Browser erlauben Vollbild nur nach einer Berührung – darum beim nächsten Antippen (und nach dem Verlassen wieder).
  useEffect(() => {
    if (isNative() || !document.fullscreenEnabled) return;
    if (!device.kiosk) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      return;
    }
    const enter = () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    };
    window.addEventListener('pointerup', enter);
    return () => window.removeEventListener('pointerup', enter);
  }, [device.kiosk]);

  // Android-App: Erinnerungen am Gerät vorausplanen (auch bei geschlossener App)
  const [nativeTick, setNativeTick] = useState(0);
  useEffect(() => {
    if (!isNative()) return;
    const bump = () => setNativeTick((n) => n + 1);
    window.addEventListener('fk-resume', bump);
    const t = setInterval(bump, 60 * 60_000);
    return () => { window.removeEventListener('fk-resume', bump); clearInterval(t); };
  }, []);
  useEffect(() => {
    if (!isNative()) return;
    const t = setTimeout(() => {
      syncNativeReminders(events, persons, device).catch((e) => console.error('Erinnerungen planen', e));
      syncWidget(events, persons).catch((e) => console.error('Widget', e));
    }, 2000);
    return () => clearTimeout(t);
  }, [events, persons, device.reminders, device.reminderPersons, nativeTick]); // eslint-disable-line react-hooks/exhaustive-deps
  // Kiosk: nachts um 3 Uhr einmal neu laden (frische Version, kein Speicherstau)
  useEffect(() => {
    if (!device.kiosk) return;
    const check = () => {
      const d = new Date();
      const today = fromNative(d, false).slice(0, 10);
      if (d.getHours() !== 3 || d.getMinutes() > 20 || document.querySelector('.modal-backdrop')) return;
      try { if (localStorage.getItem('fk.nightReload') === today) return; localStorage.setItem('fk.nightReload', today); } catch { return; }
      location.reload();
    };
    const t = setInterval(check, 5 * 60_000);
    return () => clearInterval(t);
  }, [device.kiosk]);
  // Alte importierte Termine (z. B. Müllkalender) nach einem Jahr aufräumen – einmal am Tag
  useEffect(() => {
    if (!events.length) return;
    const today = fromNative(new Date(), false).slice(0, 10);
    try { if (localStorage.getItem('fk.cleanup') === today) return; localStorage.setItem('fk.cleanup', today); } catch { return; }
    staleImports(events, today).forEach((id) => data.store.remove('events', id));
  }, [events]); // eslint-disable-line react-hooks/exhaustive-deps
  const inst = useInstall();
  // App / installierte Web-App: nach unten ziehen lädt neu (holt auch eine neue Version)
  usePullToRefresh((isNative() || inst.installed) && !device.kiosk, () => location.reload());

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
  const open = async (eventId: string, occStart: string, force = false) => {
    const ev = events.find((e) => e.id === eventId);
    if (!ev) return;
    if (device.locked && !force) return setDetail({ eventId, occStart });
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
    setUndo({ text: `„${ev.title}“ gelöscht`, m: data.apply(applyDelete(ev, draft.occStart ?? ev.start, scope, events)) });
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
    setUndo({ text: `„${ev.title}“ geändert`, m: data.apply(applyChange(ev, c.occStart, { start: c.start, end: c.end, allDay: c.allDay }, scope, events, uid)) });
  };

  const toggleLock = async () => {
    if (device.locked && device.lockNeedsPin && !(await requirePin())) return;
    data.setDevice({ locked: !device.locked });
  };
  const editFromDetail = async () => {
    if (!detail) return;
    // Geburtstag aus dem Profil: dort bearbeiten
    if (detail.eventId.startsWith('pbday-')) { setDetail(null); openSettings('persons'); return; }
    if (device.lockNeedsPin && !(await requirePin())) return;
    const d = detail;
    setDetail(null);
    open(d.eventId, d.occStart, true);
  };
  const detailEvent: CalEvent | undefined = detail ? events.find((e) => e.id === detail.eventId) ?? profileBirthdayEvent(detail.eventId, persons) : undefined;

  const statusIcon = data.store.mode === 'local' ? null : (
    <span className={'sync ' + data.status} title={{ synced: 'Synchronisiert', pending: 'Synchronisiere …', offline: 'Offline', error: 'Sync-Fehler', local: '' }[data.status]}>
      <Icon name={data.status === 'offline' || data.status === 'error' ? 'cloudOff' : 'cloud'} size={16} />
      {(data.status === 'offline' || data.status === 'error') && <span className="sync-text">{data.status === 'offline' ? 'Offline' : 'Fehler'}</span>}
    </span>
  );

  return (
    <div className={'app' + (device.kiosk ? ' kiosk' : '') + (mode === 'timetable' ? ' mode-timetable' : '')}>
      <header className="topbar">
        <button className="fab" onClick={() => newEvent()} aria-label="Neuer Termin"><Icon name="plus" size={28} /></button>
        <div className={'chips' + (chipsCompact ? ' compact' : '') + (chipsOverflow ? ' overflow' : '')} ref={chipsRef} role="toolbar" aria-label="Personen filtern">
          {persons.map((p) => (
            <button key={p.id} className={'chip' + (selected.has(p.id) ? ' on' : '')} style={{ ['--pc' as string]: p.color }}
              onClick={() => toggle(p.id)} onDoubleClick={() => solo(p.id)} onContextMenu={(e) => { e.preventDefault(); solo(p.id); }}
              aria-pressed={selected.has(p.id)} title={`${p.name} – Doppelklick: nur ${p.name}`}>
              <Avatar person={p} size={isPhone ? 34 : 40} />
              <span className="chip-name">{p.name}</span>
              {absentToday.has(p.id) && <span className="chip-absent" title={`Abwesend: ${absentToday.get(p.id)}`}>🧳</span>}
            </button>
          ))}
          {sources.map((src) => {
            const on = !hiddenSources.has(src.name);
            return (
              <button key={src.id} className={'chip chip-src' + (on ? ' on' : '')} onClick={() => toggleSource(src.name)}
                aria-pressed={on} title={`Kalender „${src.name}“ ${on ? 'ausblenden' : 'einblenden'}`}>
                <span className="chip-src-icon" style={{ width: isPhone ? 34 : 40, height: isPhone ? 34 : 40 }}>{/müll|abfall|abfuhr|mist/i.test(src.name) ? '🗑️' : '📅'}</span>
                <span className="chip-name">{src.name}</span>
              </button>
            );
          })}
          {persons.length === 0 && <button className="btn" onClick={() => openSettings('persons')}>Personen anlegen</button>}
        </div>
        <div className="top-right">
          {statusIcon}
          {inst.canPrompt && !inst.installed && (
            <button className="btn small install-btn" onClick={inst.install}><Icon name="download" size={16} /> <span>Installieren</span></button>
          )}
          <QuickLinksButton links={(family.quickLinks ?? []).filter((l) => l.label && (l.url || l.androidPackage))} />
          <button className="icon-btn" onClick={() => setSearching(true)} aria-label="Suchen"><Icon name="search" /></button>
          <button className="icon-btn hide-phone" onClick={print} aria-label="Drucken"><Icon name="print" /></button>
          <button className="icon-btn hide-phone" onClick={() => openSettings('persons')} aria-label="Profile"><Icon name="users" /></button>
          <button className="icon-btn" onClick={() => openSettings('general')} aria-label="Einstellungen"><Icon name="gear" /></button>
        </div>
      </header>

      <div className="toolbar">
        {mode !== 'timetable' && (
          <div className="nav">
            <button className="icon-btn" onClick={() => go(-1)} aria-label="Zurück"><Icon name="left" /></button>
            <button className="btn" onClick={() => api()?.today()}>Heute</button>
            <button className="icon-btn" onClick={() => go(1)} aria-label="Weiter"><Icon name="right" /></button>
            <button className="range-title" onClick={() => { const el = dateInput.current; if (!el) return; try { el.showPicker(); } catch { el.click(); } }}
              title="Datum wählen">
              <RangeTitle range={range} compact={isPhone} />
            </button>
            <input ref={dateInput} type="date" className="date-jump" tabIndex={-1} aria-hidden="true"
              value={range ? fromNative(range.start, true) : ''}
              onChange={(e) => e.target.value && api()?.gotoDate(e.target.value)} />
          </div>
        )}
        {mode === 'timetable' && <h1 className="range-title">Stundenplan</h1>}
        {mode !== 'timetable' && hasKids && (
          <button className={'school-toggle' + (device.showSchool ? ' on' : '')} onClick={() => data.setDevice({ showSchool: !device.showSchool })}
            aria-pressed={device.showSchool} title="Schulzeiten ein-/ausblenden">
            <span aria-hidden="true">🏫</span><span className="long">Schule</span>
          </button>
        )}
        {mode !== 'timetable' && (
          <button className={'lock-toggle' + (device.locked ? '' : ' on')} onClick={toggleLock} aria-pressed={!device.locked}
            title={device.locked ? 'Gesperrt – tippen zum Bearbeiten' : 'Bearbeiten aktiv – tippen zum Sperren'}>
            <Icon name={device.locked ? 'lock' : 'edit'} size={18} /><span className="long">{device.locked ? 'Gesperrt' : 'Bearbeiten'}</span>
          </button>
        )}
        {device.showCountdown && countdowns.length > 0 && (
          <span className={'countdowns' + (cdShort ? ' short' : '')} ref={cdRef}>
            {countdowns.map((c) => (
              <span key={c.title + c.date} className="countdown" title={`bis ${c.title} (${c.date.split('-').reverse().join('.')})`}
                onClick={(e) => {
                  if (!cdShort) return;
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setCdBubble({ text: `⏳ ${c.days === 1 ? 'Morgen' : `${c.days} Tage`} bis ${c.title}`, x: r.left, y: r.bottom + 6 });
                }}>⏳ <b>{c.days === 1 ? 'Morgen' : `${c.days} Tage`}</b> <span className="cd-title">bis {c.title}</span></span>
            ))}
          </span>
        )}
        {device.kiosk && <span className="clock">{now.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}</span>}
        {/* mittlere Breiten (Tablet hochkant, kleines Tablet): eine Auswahl statt sechs Knöpfen */}
        {mode === 'timetable' ? (
          /* im Stundenplan geteilt: Name = zurück zur letzten Ansicht, Pfeil = andere Ansicht wählen */
          <span className="view-select view-split">
            <button type="button" className="vs-back" onClick={() => changeMode(lastCalMode)}>{VIEW_LABELS.find(([m]) => m === lastCalMode)?.[1] ?? 'Kalender'}</button>
            <label className="vs-arrow" aria-label="Andere Ansicht wählen">
              <select value="" onChange={(e) => e.target.value && changeMode(e.target.value as Mode)}>
                <option value="" disabled hidden>Ansicht</option>
                {VIEW_LABELS.filter(([m]) => m !== 'timeGridThree' && m !== 'timetable').map(([m, label]) => <option key={m} value={m}>{label}</option>)}
              </select>
            </label>
          </span>
        ) : (
          <label className="view-select">
            <span className="sr-only">Ansicht</span>
            <select value={mode} onChange={(e) => changeMode(e.target.value as Mode)}>
              {VIEW_LABELS.filter(([m]) => m !== 'timeGridThree' && m !== 'timetable').map(([m, label]) => <option key={m} value={m}>{label}</option>)}
            </select>
          </label>
        )}
        {persons.some((p) => p.hasTimetable) && (
          <button className={'tt-btn' + (mode === 'timetable' ? ' on' : '')} onClick={() => changeMode('timetable')} aria-label="Stundenplan">
            📚 <span className="long">Stundenplan</span>
          </button>
        )}
        <div className="seg views">
          {VIEW_LABELS.map(([m, label, short]) => (
            <button key={m} className={(mode === m ? 'on' : '') + (m === 'timeGridThree' ? ' only-phone' : m === 'multiMonthYear' || m === 'timeGridFocus' ? ' hide-phone' : '')} onClick={() => changeMode(m)}>
              <span className="long">{label}</span><span className="short">{short}</span>
            </button>
          ))}
        </div>
      </div>

      <main className="main">
        {mode === 'timetable' ? (
          <TimetableView requirePin={requirePin} printing={printing} onPrint={print}
            onOpenEvent={(id, occ) => setDetail({ eventId: id, occStart: occ })}
            onAddTest={(kidId, l) => {
              // nächster Schultag mit diesem Wochentag (heute zählt, wenn die Stunde noch nicht vorbei ist)
              const now = new Date();
              let d = fromNative(now, true);
              for (let i = 0; i < 14; i++) {
                if (weekdayMo0(d) === l.weekday && !isSchoolFree(d) && !isKidDayOff(data.timetables.find((t) => t.id === kidId), d) && (i > 0 || fromNative(now, false).slice(11) < l.start)) break;
                d = addDays(d, 1);
              }
              const start = `${d}T${l.start}`;
              setDraft({ isNew: true, event: { id: uid(), title: `Schularbeit ${l.subject}`.trim(), start, end: `${d}T${l.end}`, allDay: false,
                personIds: [kidId], kind: 'event', category: 'test', reminderMinutes: 2880 } });
            }} />
        ) : (
          <div className={'cal-wrap' + (showDrivers ? ' drivers' : '')} ref={calWrap}>
            <h1 className="print-title">{showDrivers ? 'Fahrdienst' : 'Familienkalender'} · <RangeTitle range={range} /></h1>
            {mode === 'listUpcoming' && hasDrivers && (
              <div className="list-filter seg" role="group" aria-label="Liste filtern">
                <button className={!driverMode ? 'on' : ''} onClick={() => setDriverMode(false)}>Alle Termine</button>
                <button className={driverMode ? 'on' : ''} onClick={() => setDriverMode(true)}>🚗 Fahrdienst</button>
              </div>
            )}
            {showDrivers && range && (
              <DriverList events={events} persons={persons} selected={selected} from={fromNative(range.start, true)} to={fromNative(range.end, true)}
                onOpen={(id, occ) => open(id, occ)} />
            )}
            <div className="cal-inner">
            <CalendarView ref={calRef} view={mode} onOpenBirthday={(pid, date) => setDetail({ eventId: 'pbday-' + pid, occStart: date })} selected={selected} hiddenSources={hiddenSources} onRange={(type, start, end) => setRange({ type, start, end })} onOpen={open} onCreate={newEvent} onChange={change} locked={device.locked} printing={printing} onNavDay={(d) => { setMode('timeGridDay'); setTimeout(() => api()?.changeView('timeGridDay', d)); }} />
            </div>
          </div>
        )}
      </main>

      {draft && (
        <EventDialog draft={draft} persons={persons} events={events} templates={data.templates} onSaveTemplates={data.saveTemplates} onClose={() => setDraft(null)} onSave={save} onDelete={draft.isNew ? undefined : remove} />
      )}
      {detail && detailEvent && (
        <EventDetails event={detailEvent} persons={persons} start={detail.occStart}
          end={addMinutes(detail.occStart, diffMinutes(detailEvent.start, detailEvent.end), detailEvent.allDay)}
          conflicts={findConflicts({ ...detailEvent, start: detail.occStart, end: addMinutes(detail.occStart, diffMinutes(detailEvent.start, detailEvent.end), detailEvent.allDay),
            ...(detailEvent.recurrence ? { seriesId: detailEvent.id, originalStart: detail.occStart, id: detailEvent.id + '#occ' } : {}) }, events, persons)}
          quickLinks={detailEvent.kind === 'birthday' ? (family.quickLinks ?? []).filter((l) => l.onBirthday && l.label && (l.url || l.androidPackage)) : []}
          onClose={() => setDetail(null)} onEdit={editFromDetail} />
      )}
      {searching && (
        <SearchDialog events={events} persons={persons} onClose={() => setSearching(false)}
          onPick={(date, eventId, occStart) => {
            setSearching(false); setMode('timeGridDay');
            setTimeout(() => api()?.changeView('timeGridDay', date));
            setDetail({ eventId, occStart });
          }} />
      )}
      {settings && <SettingsDialog tab={settings} onClose={() => setSettings(null)} onPrint={print} />}
      {undo && (
        <div className="toast" role="status">
          <span>{undo.text}</span>
          <button className="btn small" onClick={() => { data.apply(undo.m); setUndo(null); }}>Rückgängig</button>
        </div>
      )}
      {saverOn && (saverOn === 'idle' ? saverVariant : saverVariant ?? saverPreview(device)) && (
        <Screensaver variant={(saverOn === 'idle' ? saverVariant : saverVariant ?? saverPreview(device))!} events={shownEvents} persons={persons} weather={saverWeather}
          place={family.weather?.name} countdowns={device.showCountdown ? countdowns : []} onClose={() => setSaverOn(false)} />
      )}
      {cdBubble && <div className="cd-bubble" style={{ left: Math.min(cdBubble.x, window.innerWidth - 260), top: cdBubble.y }}>{cdBubble.text}</div>}
      {scopeAsk && <ScopeDialog action={scopeAsk.action} onPick={(s) => scopeAsk.resolve(s)} />}
      {pinAsk && family.pinHash && <PinDialog pinHash={family.pinHash} onResult={pinAsk} />}
    </div>
  );
}

/**
 * Anzeigegröße über den Viewport: das Gerät verhält sich wie ein kleineres –
 * Leisten und Layout passen sich von selbst an. Am Computer gilt der Browser-Zoom (Strg +).
 */
const BASE_VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover';
function applyUiScale(f: number, done: () => void): number {
  const root = document.documentElement;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const useZoom = (z: number) => { root.style.setProperty('--z', String(z)); root.style.zoom = z === 1 ? '' : String(z); root.classList.toggle('zoomed', z !== 1); };
  useZoom(1);
  if (f === 1 || !meta) { if (meta) meta.content = BASE_VIEWPORT; return window.setTimeout(done, 50); }
  const target = Math.round(screen.width / f);
  meta.content = `width=${target}, initial-scale=${f}, viewport-fit=cover`;
  return window.setTimeout(() => {
    // Viewport nicht übernommen (Computer-Browser, ältere App-Version): normale Größe lassen –
    // CSS-Zoom verträgt sich nicht mit den Kalender-Berechnungen
    if (Math.abs(window.innerWidth - target) > 40) meta.content = BASE_VIEWPORT;
    done();
  }, 350);
}

/** Geburtstag aus einem Profil als (nur lesbarer) Termin für die Detailansicht */
function profileBirthdayEvent(id: string, persons: import('./types').Person[]): CalEvent | undefined {
  if (!id.startsWith('pbday-')) return undefined;
  const p = persons.find((x) => x.id === id.slice(6));
  if (!p?.birthday) return undefined;
  return { id, title: p.name, start: p.birthday, end: addDays(p.birthday, 1), allDay: true, personIds: [p.id], kind: 'birthday',
    birthYear: Number(p.birthday.slice(0, 4)), recurrence: { freq: 'yearly', interval: 1, end: { type: 'never' } } };
}

/** Vorschau aus den Einstellungen, auch wenn gerade die andere Tageszeit ist */
const saverPreview = (d: { saverDay: boolean; saverNight: boolean }): 'day' | 'night' | null => (d.saverDay ? 'day' : d.saverNight ? 'night' : null);

/** Gut lesbarer Titel: „Freitag, 13. November“ · „KW 46 · 9.–15. November“ · „November 2026“ */
function RangeTitle({ range, compact }: { range: { type: string; start: Date; end: Date } | null; compact?: boolean }) {
  if (!range) return null;
  const { type, start } = range;
  const end = new Date(range.end.getTime() - 86400000);
  const now = new Date();
  const yearSuffix = (d: Date) => (d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '');
  const month = (d: Date) => d.toLocaleDateString('de-AT', { month: compact ? 'short' : 'long' });
  if (type === 'timeGridDay') {
    const isToday = start.toDateString() === now.toDateString();
    const wd = start.toLocaleDateString('de-AT', { weekday: compact ? 'short' : 'long' });
    return (
      <>
        <span className="rt-main">{wd}, {start.getDate()}. {month(start)}{yearSuffix(start)}</span>
        {isToday && <span className="rt-badge">Heute</span>}
      </>
    );
  }
  if (type === 'timeGridWeek') {
    const span = start.getMonth() === end.getMonth()
      ? `${start.getDate()}.–${end.getDate()}. ${month(end)}`
      : `${start.getDate()}. ${month(start).replace('.', '').slice(0, 3)} – ${end.getDate()}. ${month(end).replace('.', '').slice(0, 3)}`;
    return (
      <>
        <span className="rt-kw">KW {isoWeek(fromNative(start, true))}</span>
        <span className="rt-main">{span}{yearSuffix(end)}</span>
      </>
    );
  }
  if (type === 'multiMonthYear') return <span className="rt-main">{start.getFullYear()}</span>;
  if (type === 'listUpcoming' || type === 'timeGridThree' || type === 'timeGridFocus') {
    const f = (d: Date) => `${d.getDate()}. ${d.toLocaleDateString('de-AT', { month: 'short' })}`;
    return <span className="rt-main">{f(start)} – {f(end)}</span>;
  }
  return <span className="rt-main">{start.toLocaleDateString('de-AT', { month: 'long' })} {start.getFullYear()}</span>;
}
