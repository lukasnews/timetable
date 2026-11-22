import { useEffect, useMemo, useState } from 'react';
import { probeService, useData } from '../data/DataContext';
import type { Person } from '../types';
import { Advanced, Avatar, Icon, Modal, Toggle } from './ui';
import { PersonEditor } from './PersonEditor';
import { ConfirmDialog } from './Dialogs';
import { AVATAR_STYLES, PERSON_COLORS, randomSeed } from '../lib/avatars';
import { uid } from '../lib/dates';
import { hashPin } from '../lib/pin';
import { buildTimeFirebase, loadCloudConfig, makeJoinLink, newFamilyId, normalizeDomain, parseFamilyInput, saveCloudConfig, type CloudConfig } from '../data/store';
import { suggestTopic, topicAllowed } from '../lib/familyKey';
import { deviceTimezone } from '../lib/dates';
import { LocalStore } from '../data/localStore';
import { isIOS, useInstall } from '../install';
import { FirebaseStore } from '../data/firebaseStore';
import { DataTab } from './DataTab';
import { checkForUpdate } from '../update';
import { DEFAULT_PLACE, searchPlaces, type Place } from '../lib/weather';
import { canNativeShare, exactAlarmStatus, isNative, nativeNotifyPermission, nativeReminderStatus, nativeShareText, nativeTestNotification, openExactAlarmSetting, pinWidget, widgetCount } from '../native';
import { QuickLinksEditor } from './QuickLinks';
import { FERIEN_REGIONS, regionName, type FerienRegion } from '../lib/holidays';

const HOURS = Array.from({ length: 25 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

/** „2026-11-22 06:30 · …“ → „So., 22.11., 06:30 · …“ */
function fmtInfo(info: string): string {
  const m = info.match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d)(.*)$/);
  if (!m) return info;
  const d = new Date(m[1] + 'T12:00:00').toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric' });
  return `${d}, ${m[2]}${m[3]}`;
}

export type SettingsTab = 'persons' | 'device' | 'notify' | 'sync' | 'data' | 'general';

export function SettingsDialog({ tab: initial, onClose, onPrint }: { tab: SettingsTab; onClose: () => void; onPrint?: () => void }) {
  const [tab, setTab] = useState<SettingsTab>(initial);
  const tabs: [SettingsTab, string, string, string][] = [
    ['persons', 'Personen', 'Personen', 'users'],
    ['general', 'Kalender', 'Kalender', 'gear'],
    ['notify', 'Erinnerungen', 'Erinn.', 'bell'],
    ['device', 'Gerät', 'Gerät', 'device'],
    ['data', 'Daten', 'Daten', 'book'],
    ['sync', 'Sync', 'Sync', 'cloud'],
  ];
  return (
    <Modal title="Einstellungen" onClose={onClose} wide>
      <nav className="tabs">
        {tabs.map(([k, l, short, i]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={(e) => { setTab(k); e.currentTarget.closest('.modal-body')?.scrollTo({ top: 0 }); }}>
            <Icon name={i} size={18} /> <span className="long">{l}</span><span className="short">{short}</span>
          </button>
        ))}
      </nav>
      {tab === 'persons' && <PersonsTab />}
      {tab === 'device' && <DeviceTab onClose={onClose} />}
      {tab === 'sync' && <SyncTab />}
      {tab === 'notify' && <NotifyTab />}
      {tab === 'data' && <DataTab onPrint={onPrint} />}
      {tab === 'general' && <GeneralTab />}
    </Modal>
  );
}

function PersonsTab() {
  const { persons, savePerson, deletePerson } = useData();
  const [edit, setEdit] = useState<{ p: Person; isNew: boolean } | null>(null);
  const [confirmDel, setConfirmDel] = useState<Person | null>(null);
  const move = (i: number, dir: -1 | 1) => {
    const list = [...persons];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((p, idx) => p.order !== idx && savePerson({ ...p, order: idx }));
  };
  const create = () => setEdit({
    isNew: true,
    p: { id: uid(), name: '', color: PERSON_COLORS[persons.length % PERSON_COLORS.length], avatar: { style: 'adventurer', seed: randomSeed() }, order: persons.length },
  });
  return (
    <div className="settings-section">
      <ul className="person-list">
        {persons.map((p, i) => (
          <li key={p.id}>
            <button className="person-row" onClick={() => setEdit({ p, isNew: false })}>
              <Avatar person={p} size={44} ring />
              <span className="pr-name">{p.name}</span>
              <span className="pr-tags">
                {p.hasTimetable && <span className="tag">Stundenplan</span>}
                {p.birthday && <span className="tag">🎂 {p.birthday.split('-').reverse().join('.')}</span>}
              </span>
            </button>
            <span className="pr-move">
              <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Nach oben"><Icon name="up" size={18} /></button>
              <button className="icon-btn" disabled={i === persons.length - 1} onClick={() => move(i, 1)} aria-label="Nach unten"><Icon name="down" size={18} /></button>
            </span>
          </li>
        ))}
      </ul>
      <button className="btn primary" onClick={create}><Icon name="plus" size={18} /> Person hinzufügen</button>
      {edit && (
        <PersonEditor person={edit.p} isNew={edit.isNew} onClose={() => setEdit(null)}
          onSave={(p) => { savePerson(p); setEdit(null); }}
          onDelete={edit.isNew ? undefined : () => setConfirmDel(edit.p)} />
      )}
      {confirmDel && (
        <ConfirmDialog text={`${confirmDel.name} wirklich entfernen? Termine bleiben erhalten, aber ohne diese Person.`} confirm="Entfernen"
          onResult={(ok) => { if (ok) { deletePerson(confirmDel.id); setEdit(null); } setConfirmDel(null); }} />
      )}
    </div>
  );
}

function DeviceTab({ onClose }: { onClose?: () => void }) {
  const { device, setDevice } = useData();
  const inst = useInstall();
  return (
    <div className="settings-section">
      <p className="hint">Diese Einstellungen gelten nur für dieses Gerät.</p>
      <h3>Darstellung</h3>
      <div className="field">
        <span className="label">Anzeigegröße</span>
        <div className="seg">
          {[[0.9, '90 %'], [1, '100 %'], [1.15, '115 %'], [1.3, '130 %'], [1.5, '150 %']].map(([v, l]) => (
            <button key={l} className={Math.abs((device.uiScale || 1) - (v as number)) < 0.01 ? 'on' : ''} onClick={() => setDevice({ uiScale: v as number })}>{l}</button>
          ))}
        </div>
        <small className="hint">Alles größer oder kleiner – nur auf diesem Gerät, z. B. 130 % fürs Wand-Tablet. Wirkt auf Tablet und Handy (in der Android-App ab Version 1.0.7); am Computer stattdessen Strg + bzw. Strg −.</small>
      </div>
      <div className="field">
        <span className="label">Farbschema</span>
        <div className="seg">
          {([['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']] as const).map(([k, l]) => (
            <button key={k} className={device.theme === k ? 'on' : ''} onClick={() => setDevice({ theme: k })}>{l}</button>
          ))}
        </div>
      </div>
      <label className="field"><span className="label">Startansicht</span>
        <select value={device.defaultView} onChange={(e) => setDevice({ defaultView: e.target.value as typeof device.defaultView })}>
          <option value="auto">Automatisch (Tablet: Woche, Handy: Tag)</option>
          <option value="month">Monat</option>
          <option value="week">Woche</option>
          <option value="focus">Fokus-Woche (ab gestern, heute + 2 Tage breiter – Tablet)</option>
          <option value="day">Tag</option>
        </select>
      </label>
      <div className="grid2">
        <label className="field"><span className="label">Tag beginnt</span>
          <select value={device.dayStart} onChange={(e) => setDevice({ dayStart: e.target.value })}>
            {HOURS.filter((h) => h < device.dayEnd).map((h) => <option key={h} value={h}>{h} Uhr</option>)}
          </select></label>
        <label className="field"><span className="label">Tag endet</span>
          <select value={device.dayEnd} onChange={(e) => setDevice({ dayEnd: e.target.value })}>
            {HOURS.filter((h) => h > device.dayStart).map((h) => <option key={h} value={h}>{h} Uhr</option>)}
          </select></label>
      </div>
      <div className="field">
        <span className="label">Stundenhöhe (Tag, Woche, Fokus)</span>
        <div className="seg">
          {([['compact', 'Kompakt'], ['normal', 'Normal'], ['large', 'Groß']] as const).map(([k, l]) => (
            <button key={k} className={(device.rowHeight ?? 'normal') === k ? 'on' : ''} onClick={() => setDevice({ rowHeight: k })}>{l}</button>
          ))}
        </div>
        <small className="hint">Kompakt zeigt etwa doppelt so viele Stunden. Passt der Bereich „Tag beginnt/endet“ ganz auf den Bildschirm, wird er ohne Scrollen eingepasst – z. B. 06–21 Uhr am Wand-Tablet.</small>
      </div>

      <h3>Anzeigen</h3>
      <Toggle checked={device.showSchool} onChange={(v) => setDevice({ showSchool: v })} label="🏫 Schulzeiten" hint="Auch über den 🏫-Schalter in der Leiste" />
      {device.showSchool && (
        <Toggle checked={!!device.schoolTimes} onChange={(v) => setDevice({ schoolTimes: v || undefined })} label="… mit Uhrzeit im Streifen"
          hint="Aus: schmaler Streifen nur mit Farbe und Gesicht – mehr Platz für Termine. Die Zeiten stehen im Stundenplan." />
      )}
      {device.showSchool && <Toggle checked={device.schoolInMonth} onChange={(v) => setDevice({ schoolInMonth: v })} label="… auch in der Monatsansicht" />}
      <Toggle checked={device.showWeather} onChange={(v) => setDevice({ showWeather: v })} label="🌤️ Wetter" hint="Ort unter Kalender → Wetter" />
      <Toggle checked={device.showCountdown} onChange={(v) => setDevice({ showCountdown: v })} label="⏳ Countdown" hint="„Noch 12 Tage bis Weihnachtsferien“ in der Kopfzeile" />

      <h3><Icon name="lock" size={18} /> Bedienung</h3>
      <Toggle checked={device.lockNeedsPin} onChange={(v) => setDevice({ lockNeedsPin: v })} label="Entsperren nur mit PIN"
        hint="Zum Verschieben und Ändern muss die PIN eingegeben werden. Neue Termine über + gehen immer." />

      <h3>Kiosk-Modus (Wand-Tablet)</h3>
      <Toggle checked={device.kiosk} onChange={(v) => setDevice({ kiosk: v })} label="Kiosk-Modus"
        hint={isNative() ? 'Ganzer Bildschirm ohne Status- und Navigationsleiste (vom Rand wischen holt sie kurz zurück); springt nach Inaktivität zurück auf heute und sperrt wieder'
          : 'Vollbild ohne Browser- und Systemleisten (ab dem nächsten Antippen); springt nach Inaktivität zurück auf heute und sperrt wieder'} />
      {device.kiosk && (
        <>
          <Toggle checked={device.wakeLock} onChange={(v) => setDevice({ wakeLock: v })} label="Bildschirm nicht abschalten" />
          <label className="field"><span className="label">Zurück zu „Heute“ nach (Minuten)</span>
            <input type="number" min={1} max={120} value={device.idleReturnMinutes} onChange={(e) => setDevice({ idleReturnMinutes: Math.max(1, Number(e.target.value) || 5) })} /></label>
          <Toggle checked={device.nightMode} onChange={(v) => setDevice({ nightMode: v })} label="Nachtmodus" hint="Dunkel und gedimmt in der Nacht" />
          {device.nightMode && (
            <div className="grid2">
              <label className="field"><span className="label">Von</span><input type="time" value={device.nightFrom} onChange={(e) => setDevice({ nightFrom: e.target.value })} /></label>
              <label className="field"><span className="label">Bis</span><input type="time" value={device.nightTo} onChange={(e) => setDevice({ nightTo: e.target.value })} /></label>
            </div>
          )}
        </>
      )}

      <h3>🌙 Bildschirmschoner</h3>
      <p className="hint">Erscheint, wenn das Gerät eine Weile nicht berührt wurde – Antippen bringt den Kalender zurück. Ideal fürs Wand-Tablet.</p>
      <Toggle checked={device.saverDay} onChange={(v) => setDevice({ saverDay: v })} label="Tagsüber: Uhr und nächste Termine"
        hint="Große Uhr, Datum, Wetter und was heute und morgen ansteht" />
      <Toggle checked={device.saverNight} onChange={(v) => setDevice({ saverNight: v })} label="Nachts: gedimmte Uhr"
        hint="Fast schwarz, blendet nicht – mit dem nächsten Termin" />
      {(device.saverDay || device.saverNight) && (
        <>
          <label className="field"><span className="label">Nach wie vielen Minuten ohne Berührung?</span>
            <select value={device.saverMinutes} onChange={(e) => setDevice({ saverMinutes: Number(e.target.value) })}>
              {[1, 2, 3, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} {m === 1 ? 'Minute' : 'Minuten'}</option>)}
            </select>
          </label>
          <div className="grid2">
            <label className="field"><span className="label">Nacht von</span><input type="time" value={device.nightFrom} onChange={(e) => e.target.value && setDevice({ nightFrom: e.target.value })} /></label>
            <label className="field"><span className="label">bis</span><input type="time" value={device.nightTo} onChange={(e) => e.target.value && setDevice({ nightTo: e.target.value })} /></label>
          </div>
          <small className="hint">{device.saverDay && !device.saverNight ? 'Nachts erscheint kein Bildschirmschoner.' : !device.saverDay && device.saverNight ? 'Tagsüber erscheint kein Bildschirmschoner.' : 'Gleicher Zeitraum wie der Nachtmodus im Kiosk.'}</small>
          <button className="btn" onClick={() => { onClose?.(); setTimeout(() => window.dispatchEvent(new Event('fk-saver')), 200); }}>Vorschau zeigen</button>
          {!device.kiosk && <small className="hint">Tipp: Damit sich der Bildschirm nicht vorher abschaltet, im Kiosk-Modus „Bildschirm nicht abschalten“ aktivieren.</small>}
        </>
      )}

      {!inst.installed && !isNative() && (
        <>
          <h3><Icon name="download" size={18} /> App installieren</h3>
          {inst.canPrompt ? (
            <button className="btn primary" onClick={inst.install}><Icon name="download" size={18} /> Auf diesem Gerät installieren</button>
          ) : isIOS() ? (
            <p className="hint">In Safari unten auf <b>Teilen</b> (□↑) tippen → <b>„Zum Home-Bildschirm“</b>.</p>
          ) : (
            <p className="hint">Im Browser-Menü (⋮) <b>„App installieren“</b> bzw. <b>„Zum Startbildschirm hinzufügen“</b> wählen.</p>
          )}
        </>
      )}
    </div>
  );
}

function NotifyTab() {
  const { device, setDevice, persons, family, saveFamily, service, serviceUrl } = useData();
  const native = isNative();
  const [perm, setPerm] = useState<string>(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  useEffect(() => { if (native) nativeNotifyPermission(false).then(setPerm); }, [native]);
  const enableReminders = async (v: boolean) => {
    if (v && native) {
      const r = await nativeNotifyPermission(true);
      setPerm(r);
      if (r !== 'granted') return;
    } else if (v && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const r = await Notification.requestPermission();
      setPerm(r);
      if (r !== 'granted') return;
    }
    setDevice({ reminders: v });
  };
  const [famTopic, setFamTopic] = useState(family.ntfyFamilyTopic ?? '');
  useEffect(() => {
    const v = famTopic.trim();
    if (v === (family.ntfyFamilyTopic ?? '')) return;
    const t = setTimeout(() => saveFamily({ ntfyFamilyTopic: v || undefined }), 600);
    return () => clearTimeout(t);
  }, [famTopic]); // eslint-disable-line react-hooks/exhaustive-deps
  const withTopic = persons.filter((p) => p.ntfyTopic);
  const ntfyProblem = !!(service.ntfyError || service.blockedTopics);
  const [exact, setExact] = useState<'granted' | 'denied' | 'unknown'>('unknown');
  useEffect(() => {
    if (!native) return;
    const check = () => exactAlarmStatus().then(setExact);
    check();
    window.addEventListener('fk-resume', check);
    return () => window.removeEventListener('fk-resume', check);
  }, [native]);
  const [testMsg, setTestMsg] = useState('');
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof nativeReminderStatus>>>(null);
  useEffect(() => {
    if (!native) return;
    const load = () => nativeReminderStatus().then(setPlan).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [native, device.reminders, device.dailyDigest, device.weeklyDigest]);
  const [widgets, setWidgets] = useState<number | null>(null);
  const [widgetMsg, setWidgetMsg] = useState('');
  useEffect(() => {
    if (!native) return;
    const load = () => widgetCount().then(setWidgets);
    load();
    window.addEventListener('fk-resume', load);
    return () => window.removeEventListener('fk-resume', load);
  }, [native]);
  const [ntfyTest, setNtfyTest] = useState<{ busy?: boolean; error?: string; results?: { topic: string; ok: boolean; error?: string }[] } | null>(null);
  const runNtfyTest = async () => {
    const fid = loadCloudConfig()?.familyId;
    if (!serviceUrl || !fid) { setNtfyTest({ error: 'Nur mit verbundenem Familienkalender möglich.' }); return; }
    setNtfyTest({ busy: true });
    try {
      const r = await fetch(`${serviceUrl}/ntfy-test?family=${encodeURIComponent(fid)}`, { method: 'POST' });
      setNtfyTest(await r.json());
    } catch { setNtfyTest({ error: 'Dienst nicht erreichbar (offline?)' }); }
  };
  return (
    <div className="settings-section">
      <h3>Dieses Gerät</h3>
      <Toggle checked={device.reminders} onChange={enableReminders} label={native ? 'Erinnerungen auf diesem Gerät' : 'Benachrichtigungen in der App'}
        hint={perm === 'denied'
          ? (native ? 'Benachrichtigungen sind blockiert – in den Android-Einstellungen bei „Familienkalender“ erlauben.' : 'Im Browser blockiert – bitte in den Browser-Einstellungen erlauben.')
          : native ? 'Kommen pünktlich, auch wenn die App geschlossen ist (für die nächsten 2 Wochen geplant; neue Termine anderer werden beim nächsten Öffnen übernommen).'
          : 'Nur solange die App geöffnet ist. Am Wand-Tablet meist aus. Für Erinnerungen bei geschlossener App: Android-App installieren.'} />
      {device.reminders && (
        <div className="field">
          <span className="label">Nur für</span>
          <div className="person-pick">
            {persons.map((p) => {
              const on = device.reminderPersons.includes(p.id);
              return (
                <button key={p.id} type="button" className={'pick' + (on ? ' on' : '')} style={{ ['--pc' as string]: p.color }}
                  onClick={() => setDevice({ reminderPersons: on ? device.reminderPersons.filter((x) => x !== p.id) : [...device.reminderPersons, p.id] })}>
                  <Avatar person={p} size={26} /> {p.name}
                </button>
              );
            })}
          </div>
          <small className="hint">{device.reminderPersons.length ? 'Plus Termine für die ganze Familie.' : 'Keine Auswahl = alle Termine.'}</small>
        </div>
      )}
      {native && (device.reminders || device.dailyDigest || device.weeklyDigest) && exact === 'denied' && (
        <div className="field">
          <p className="error">⏰ „Alarme &amp; Erinnerungen“ ist für die App nicht erlaubt – Erinnerungen kommen dann verspätet oder gar nicht.</p>
          <button className="btn small" onClick={() => openExactAlarmSetting().catch(() => {})}>Erlauben …</button>
        </div>
      )}
      {native && (device.reminders || device.dailyDigest || device.weeklyDigest) && (
        <div className="row">
          <button className="btn small" onClick={async () => setTestMsg((await nativeTestNotification()) === 'ok'
            ? '✓ Test geplant – in etwa 1 Minute sollte eine Benachrichtigung kommen (App darf dafür geschlossen sein).'
            : 'Benachrichtigungen sind blockiert – in den Android-Einstellungen bei „Familienkalender“ erlauben.')}>Test-Benachrichtigung in 1 Minute</button>
        </div>
      )}
      {native && plan && (device.reminders || device.dailyDigest || device.weeklyDigest) && (
        <small className="hint">📋 Am Gerät eingeplant: <b>{plan.count}</b>
          {plan.next && <> · nächste: {plan.next.at.toLocaleString('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })} „{plan.next.title}“</>}
          {' '}· Benachrichtigungen: {plan.permission === 'granted' ? 'erlaubt ✓' : <b>nicht erlaubt</b>} · genaue Uhrzeit: {plan.exact === 'granted' ? 'erlaubt ✓' : plan.exact === 'denied' ? <b>nicht erlaubt</b> : '–'}
        </small>
      )}
      {native && plan && plan.list.length > 0 && (
        <details className="tips">
          <summary>Eingeplante anzeigen ({plan.list.length})</summary>
          <ul className="hint">
            {plan.list.slice(0, 40).map((n, i) => (
              <li key={i}><b>{n.at.toLocaleString('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</b> – {n.title}{n.body ? ` · ${n.body.split('\n')[0]}` : ''}</li>
            ))}
          </ul>
          <small className="hint">Erinnerungen, deren Zeitpunkt beim Speichern schon vorbei war, werden nicht eingeplant. Termine anderer kommen beim nächsten Öffnen der App dazu.</small>
        </details>
      )}
      {testMsg && <small className="hint">{testMsg} Kommt nichts: Android-Einstellungen → Apps → Familienkalender → Akku → „Nicht eingeschränkt“.</small>}
      {native && (
        <>
          <Toggle checked={!!device.dailyDigest} onChange={async (v) => { if (v && (await nativeNotifyPermission(true)) !== 'granted') return; setDevice({ dailyDigest: v ? '06:30' : undefined }); }}
            label="Tagesübersicht" hint="Jeden Morgen eine Benachrichtigung mit den Terminen des Tages – nur an Tagen mit Terminen. Wird am Handy vorausgeplant; Termine, die andere eintragen, kommen beim nächsten Öffnen der App dazu." />
          {!!device.dailyDigest && (
            <label className="field"><span className="label">Uhrzeit der Tagesübersicht</span>
              <input type="time" value={device.dailyDigest} onChange={(e) => e.target.value && setDevice({ dailyDigest: e.target.value })} /></label>
          )}
          <Toggle checked={!!device.weeklyDigest} onChange={async (v) => { if (v && (await nativeNotifyPermission(true)) !== 'granted') return; setDevice({ weeklyDigest: v || undefined }); }}
            label="Wochenübersicht" hint="Sonntag um 18:00: die Termine der kommenden Woche" />
          {widgets !== null && (
            <div className="field">
              <span className="label">📅 Widget „Nächste Termine“</span>
              <div className="row">
                <button className="btn small" onClick={async () => setWidgetMsg(await pinWidget()
                  ? 'Bestätige am Startbildschirm „Hinzufügen“.'
                  : 'Dein Startbildschirm kann das nicht automatisch: lange auf eine freie Stelle drücken → Widgets → Familienkalender.')}>
                  Zum Startbildschirm hinzufügen</button>
              </div>
              <small className="hint">{widgetMsg || (widgets > 0 ? `Am Startbildschirm: ${widgets} ✓ – zeigt die nächsten Termine, auch offline.` : 'Zeigt die nächsten Termine direkt am Startbildschirm.')}</small>
            </div>
          )}
        </>
      )}
      <Toggle checked={device.changeHint !== false} onChange={(v) => setDevice({ changeHint: v })} label="Änderungen beim Öffnen zeigen"
        hint="„3 Termine neu oder geändert“ – was andere seit dem letzten Öffnen eingetragen haben" />
      <label className="field"><span className="label">Ich bin</span>
        <select value={device.me ?? ''} onChange={(e) => setDevice({ me: e.target.value || undefined })}>
          <option value="">Niemand bestimmtes (z. B. Wand-Tablet)</option>
          {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <small className="hint">Wer dieses Gerät nutzt – für „eingetragen von …“ und damit man über eigene Änderungen nicht benachrichtigt wird.</small>
      </label>

      <Advanced title={<><Icon name="bell" size={16} /> Push per ntfy</>}
        status={ntfyProblem ? '⚠️ Problem beim Versand – aufklappen' : family.ntfyServer ? `eingerichtet ✓ (${family.ntfyServer.replace(/^https:\/\//, '')})` : 'nicht eingerichtet'}
        warn={ntfyProblem}
        hint="Für Fortgeschrittene: Push auch für Browser/iPhone sowie Tages- und Wochenübersicht. Mit der Android-App nicht nötig.">
        <p className="hint">Kommt auch bei geschlossener App. Jede Person bekommt Nachrichten an das <b>ntfy-Topic in ihrem Profil</b>
          {withTopic.length ? ` (eingetragen: ${withTopic.map((p) => p.name).join(', ')})` : ' – noch bei niemandem eingetragen'}.</p>
        <label className="field"><span className="label">ntfy-Server eurer Familie</span>
          <input defaultValue={family.ntfyServer ?? ''} placeholder="https://ntfy.sh" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onBlur={(e) => { const v = e.target.value.trim().replace(/\/+$/, ''); if (v !== (family.ntfyServer ?? '') && (!v || /^https:\/\//i.test(v))) saveFamily({ ntfyServer: v || undefined }); }} />
          <small className="hint">{family.ntfyServer
            ? 'Hier hin schickt der Dienst eure Push-Nachrichten (muss mit https:// beginnen).'
            : 'Leer = keine ntfy-Nachrichten. Wer sie möchte: z. B. https://ntfy.sh (kostenlos) oder ein eigener ntfy-Server.'}</small>
        </label>
        <label className="field"><span className="label">Zugangsschlüssel</span>
          <input type="password" defaultValue={family.ntfyToken ?? ''} placeholder="tk_…" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (family.ntfyToken ?? '')) saveFamily({ ntfyToken: v || undefined }); }} />
          <small className="hint">Token eines Benutzers auf eurem ntfy-Server, der auf eure Topics schreiben darf (ntfy: Konto → Zugangstoken; bei ntfy.sh dringend empfohlen wegen des Tageslimits). Nur eure Familie sieht ihn.</small>
        </label>
        {service.topicPrefix && (
          <p className="hint">🔒 Eure Topics beginnen mit <b>{service.topicPrefix}-</b> (z. B. <code>{suggestTopic(service.topicPrefix, 'mama')}</code>) – nur so sind sie
            für andere nicht erratbar. In der ntfy-App unter diesem Server abonnieren. Das Präfix nicht weitergeben.</p>
        )}
        {service.blockedTopics && <p className="error">Nicht gesendet an: {service.blockedTopics.join(', ')} – {!family.ntfyServer ? 'kein ntfy-Server eingetragen.' : service.topicPrefix ? `Topic muss mit „${service.topicPrefix}-“ beginnen.` : ''}</p>}
        {service.ntfyError && <p className="error break">Letzter Versandfehler: {
          /429|quota|limit/i.test(service.ntfyError) ? 'Tageslimit des ntfy-Servers erreicht – Zugangsschlüssel eintragen oder anderen Server verwenden.'
          : /ntfy 40[13]/.test(service.ntfyError) ? 'Der ntfy-Server lehnt ab (401/403) – Zugangsschlüssel fehlt, ist falsch oder darf nicht auf dieses Topic schreiben.'
          : service.ntfyError}</p>}
        <div className="row">
          <button className="btn small" disabled={ntfyTest?.busy} onClick={runNtfyTest}>{ntfyTest?.busy ? 'Wird gesendet …' : 'Test-Nachricht senden'}</button>
        </div>
        {ntfyTest && !ntfyTest.busy && (
          ntfyTest.error ? <p className="error">{ntfyTest.error}</p> : (
            <ul className="hint break">
              {(ntfyTest.results ?? []).map((r) => <li key={r.topic}>{r.ok ? '✓' : '✗'} {r.topic}{r.error ? ` – ${/40[13]/.test(r.error) ? 'Zugangsschlüssel abgelehnt (401/403): Schlüssel prüfen bzw. Schreibrecht auf dieses Topic' : r.error}` : ' – gesendet'}</li>)}
            </ul>
          )
        )}
        <label className="field"><span className="label">Familien-Topic (Termine ohne Person)</span>
          <input value={famTopic} placeholder={service.topicPrefix ? suggestTopic(service.topicPrefix, 'familie') : 'leer = an alle Personen mit Topic'} autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => setFamTopic(e.target.value)} /></label>
        {service.topicPrefix && famTopic.trim() && !topicAllowed(famTopic.trim(), service.topicPrefix) && (
          <small className="error">Sollte mit „{service.topicPrefix}-“ beginnen – sonst kommen keine Nachrichten an.</small>
        )}
        {service.topicPrefix && (
          <div className="row">
            {(!famTopic.trim() || !topicAllowed(famTopic.trim(), service.topicPrefix))
              ? <button type="button" className="btn small" onClick={() => setFamTopic(suggestTopic(service.topicPrefix!, 'familie'))}>Sicheres Topic erzeugen</button>
              : <button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(famTopic.trim())}>Topic kopieren</button>}
          </div>
        )}
        {famTopic.trim() !== (family.ntfyFamilyTopic ?? '') && <small className="hint">Wird gespeichert …</small>}
        <Toggle checked={!!family.ntfyDaily} onChange={(v) => saveFamily({ ntfyDaily: v ? '06:30' : '' })} label="Tagesübersicht"
          hint="Jeden Morgen die Termine des Tages und was mitzubringen ist" />
        {!!family.ntfyDaily && (
          <label className="field"><span className="label">Uhrzeit der Tagesübersicht</span>
            <input type="time" value={family.ntfyDaily} onChange={(e) => e.target.value && saveFamily({ ntfyDaily: e.target.value })} /></label>
        )}
        {!!family.ntfyDaily && service.dailyInfo && <small className="hint">Zuletzt: {fmtInfo(service.dailyInfo)}</small>}
        <Toggle checked={!!family.ntfyWeekly} onChange={(v) => saveFamily({ ntfyWeekly: v })} label="Wochenübersicht" hint="Sonntag um 18:00: die Termine der kommenden Woche" />
        {!!family.ntfyWeekly && (
          <Toggle checked={family.ntfyWeeklyDrivers !== false} onChange={(v) => saveFamily({ ntfyWeeklyDrivers: v })} label="… mit Fahrdienst"
            hint="„🚗 Fahrdienst diese Woche: Papa: Di 16:00 Schwimmen (Lena) …“ – jede Person bekommt ihre eigenen Fahrten" />
        )}
        {!!family.ntfyWeekly && service.weeklyInfo && <small className="hint">Zuletzt: {fmtInfo(service.weeklyInfo)}</small>}
        <Toggle checked={!!family.ntfyChanges} onChange={(v) => saveFamily({ ntfyChanges: v })} label="Neue und geänderte Termine melden"
          hint="An die betroffenen Personen – nicht an die Person, die geändert hat (siehe „Ich bin“)." />
      </Advanced>
    </div>
  );
}

function SyncTab() {
  const { store, status, switchStore, persons, events, family, saveFamily } = useData();
  const [domainIn, setDomainIn] = useState(family.appDomain ?? '');
  const [domainMsg, setDomainMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const saveDomain = async () => {
    const raw = domainIn.trim();
    if (!raw) { saveFamily({ appDomain: undefined }); setDomainMsg({ ok: true, text: 'Eigene Adresse entfernt.' }); return; }
    const d = normalizeDomain(raw);
    if (!d) { setDomainMsg({ ok: false, text: 'Das ist keine gültige Domain (Beispiel: kalender.mueller.at).' }); return; }
    setDomainMsg({ ok: true, text: 'Wird geprüft …' });
    if (!(await probeService(`https://${d}/svc`))) {
      setDomainMsg({ ok: false, text: `Unter ${d} läuft die App noch nicht. Die Domain muss einmal angeschlossen werden (DNS-Eintrag + Freischaltung durch den Betreiber), danach erneut prüfen.` });
      return;
    }
    setDomainIn(d);
    saveFamily({ appDomain: d });
    setDomainMsg({ ok: true, text: `✓ Gespeichert. Einladungslinks, QR-Code und Abo-Link verwenden jetzt https://${d}.` });
  };
  const cloud = loadCloudConfig();
  const [qr, setQr] = useState('');
  const [cfgText, setCfgText] = useState('');
  const [joinId, setJoinId] = useState('');
  const [err, setErr] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [wipeStep, setWipeStep] = useState(0);
  const prevCloud = useMemo<CloudConfig | null>(() => { try { return JSON.parse(localStorage.getItem('fk.cloud.prev') || 'null'); } catch { return null; } }, []);
  const wipe = async () => {
    setBusy(true); setErr('');
    try {
      if (!(store instanceof FirebaseStore)) throw new Error('Nicht mit der Cloud verbunden');
      await Promise.race([store.wipe(), new Promise((_, rej) => setTimeout(() => rej(new Error('Zeitüberschreitung – bitte Internetverbindung prüfen')), 60000))]);
      try {
        localStorage.removeItem('fk.registered');
        if (prevCloud?.familyId === cloud?.familyId) localStorage.removeItem('fk.cloud.prev');
      } catch { /* egal */ }
      saveCloudConfig(null);
      location.reload();
    } catch (e) {
      setBusy(false);
      setErr('Löschen fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)));
    }
  };
  const [busy, setBusy] = useState(false);
  const [takeLocal, setTakeLocal] = useState(true);
  const buildCfg = buildTimeFirebase();
  const link = cloud ? makeJoinLink(cloud, family.appDomain) : '';

  useEffect(() => {
    if (link) import('qrcode').then((QR) => QR.default.toDataURL(link, { width: 260, margin: 1 })).then(setQr).catch(() => {});
  }, [link]);

  const firebaseFromInput = () => {
    if (buildCfg) return buildCfg;
    try {
      // Erlaubt das Einfügen des JS-Snippets aus der Firebase-Konsole
      const m = cfgText.match(/\{[\s\S]*\}/);
      const json = (m ? m[0] : cfgText)
        .replace(/(^|\s)\/\/.*$/gm, '$1')
        .replace(/'([^']*)'/g, '"$1"')
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
        .replace(/,\s*}/g, '}');
      const obj = JSON.parse(json);
      if (!obj.apiKey || !obj.projectId) throw new Error();
      return obj;
    } catch {
      setErr('Firebase-Konfiguration nicht erkannt. Bitte das Objekt { apiKey: …, projectId: … } einfügen.');
      return null;
    }
  };

  const connect = async (familyId: string, upload: boolean) => {
    setErr('');
    const firebase = firebaseFromInput();
    if (!firebase) return;
    const cfg: CloudConfig = { firebase, familyId };
    if (upload && store instanceof LocalStore) {
      setBusy(true);
      try {
        const target = new FirebaseStore(cfg);
        const items = (['persons', 'events', 'timetables', 'meta'] as const).flatMap((col) => store.all<{ id: string }>(col).map((item) => ({ col, item })));
        await Promise.race([
          target.upload(items),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Zeitüberschreitung – bitte Internetverbindung prüfen')), 30000)),
        ]);
      } catch (e) {
        setBusy(false);
        setErr('Hochladen fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)));
        return;
      }
    }
    saveCloudConfig(cfg);
    // Neu laden, damit Firebase sauber initialisiert wird
    location.reload();
  };

  const statusText = { local: 'Nur auf diesem Gerät', synced: 'Synchronisiert ✓', pending: 'Wird synchronisiert …', offline: 'Offline – Änderungen werden später hochgeladen', error: 'Fehler – Zugriff verweigert? Regeln prüfen' }[status];

  return (
    <div className="settings-section">
      <p className="status-line"><Icon name={store.mode === 'cloud' ? 'cloud' : 'cloudOff'} size={18} /> {statusText}</p>
      {prevCloud && prevCloud.familyId !== cloud?.familyId && (
        <button className="btn" onClick={() => { if (cloud) localStorage.setItem('fk.cloud.prev', JSON.stringify(cloud)); saveCloudConfig(prevCloud); location.reload(); }}>
          Zurück zum vorherigen Familienkalender</button>
      )}
      {cloud ? (
        <>
          <h3>Weiteres Gerät verbinden</h3>
          <p className="hint">Diesen QR-Code mit dem Handy scannen oder den Link öffnen. Der Link ist der Schlüssel zum Kalender – nur innerhalb der Familie teilen.</p>
          <div className="qr-box">
            {qr && <img src={qr} alt="QR-Code zum Verbinden" width={220} height={220} />}
            <div className="qr-actions">
              <button className="btn" onClick={() => navigator.clipboard?.writeText(link)}>Link kopieren</button>
              {(canNativeShare() || 'share' in navigator) && <button className="btn" onClick={async () => { if (!(await nativeShareText('Familienkalender', 'Unser Familienkalender – Link öffnen zum Verbinden:', link))) navigator.share({ title: 'Familienkalender', url: link }).catch(() => {}); }}>Teilen …</button>}
            </div>
          </div>
          <p className="hint">In diesem Kalender: {persons.length} Person(en), {events.length} Termin(e).</p>
          {persons.length === 0 && (
            <p className="error">Dieser Familienkalender ist leer. Falls auf einem anderen Gerät schon Daten sind: hier „Dieses Gerät trennen“ und danach den QR-Code bzw. Familien-Link des anderen Geräts öffnen.</p>
          )}
          <button className="btn danger" onClick={() => setConfirmLeave(true)}>Dieses Gerät trennen</button>
          {confirmLeave && <ConfirmDialog text="Dieses Gerät von der Cloud trennen? Die Daten bleiben online erhalten; hier wird wieder der lokale Speicher genutzt." confirm="Trennen"
            onResult={(ok) => { setConfirmLeave(false); if (ok) { localStorage.setItem('fk.cloud.prev', JSON.stringify(cloud)); saveCloudConfig(null); switchStore(); } }} />}

          <Advanced title="Erweitert" status={family.appDomain ? `Eigene Adresse: ${family.appDomain}` : undefined}
            hint="Familien-ID, eigene Adresse (Domain), Familienkalender löschen">
            <h3>Familien-ID</h3>
            <p className="hint mono">{cloud.familyId}</p>
            <p className="hint">Steckt auch im Link/QR-Code. Wer sie kennt, sieht euren Kalender – nicht weitergeben.</p>

            <h3>Eigene Adresse (Domain)</h3>
            <p className="hint">Eure Familie unter einer eigenen Domain, z. B. <code>kalender.mueller.at</code>. Im Browser wechselt die App dann automatisch dorthin;
              Einladungslinks, QR-Code und Kalender-Abo verwenden diese Adresse. Die Domain muss vorher einmal angeschlossen werden (DNS-Eintrag + Freischaltung).</p>
            <div className="row">
              <input value={domainIn} onChange={(e) => setDomainIn(e.target.value)} placeholder="kalender.mueller.at" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              <button className="btn" onClick={saveDomain}>{family.appDomain && domainIn.trim() === family.appDomain ? 'Erneut prüfen' : 'Prüfen & speichern'}</button>
            </div>
            {domainMsg && <p className={domainMsg.ok ? 'hint' : 'error'}>{domainMsg.text}</p>}

            <h3>Familienkalender löschen</h3>
            <p className="hint">Löscht alle Personen, Termine, Stundenpläne, Einstellungen und Sicherungen dieses Familienkalenders in der Cloud – auf allen Geräten. Vorher am besten unter „Daten“ eine Sicherung herunterladen.</p>
            <button className="btn danger" disabled={busy} onClick={() => setWipeStep(1)}>{busy ? 'Wird gelöscht …' : 'Familienkalender endgültig löschen'}</button>
            {err && <p className="error">{err}</p>}
          </Advanced>
          {wipeStep === 1 && <ConfirmDialog text="Den gesamten Familienkalender in der Cloud löschen? Alle Geräte der Familie verlieren damit ihre Daten." confirm="Weiter"
            onResult={(ok) => setWipeStep(ok ? 2 : 0)} />}
          {wipeStep === 2 && <ConfirmDialog text="Wirklich endgültig löschen? Das lässt sich nicht rückgängig machen." confirm="Endgültig löschen"
            onResult={(ok) => { setWipeStep(0); if (ok) wipe(); }} />}
        </>
      ) : (
        <>
          <p>Damit Tablet und Handys denselben Kalender sehen, legt ihr einmal einen <b>Familienkalender</b> an (kostenlos) und verbindet weitere Geräte per QR-Code oder Link. Offline funktioniert alles weiter, abgeglichen wird automatisch.</p>
          {!buildCfg && (
            <Advanced title="Eigenes Firebase-Projekt" hint="Nur für selbst betriebene Kopien der App" defaultOpen={!cfgText}>
              <label className="field"><span className="label">Firebase-Konfiguration</span>
                <textarea rows={6} className="mono" value={cfgText} onChange={(e) => setCfgText(e.target.value)}
                  placeholder={'{\n  apiKey: "…",\n  authDomain: "…",\n  projectId: "…",\n  appId: "…"\n}'} /></label>
            </Advanced>
          )}
          <div className="choice-list">
            <Toggle checked={takeLocal} onChange={setTakeLocal} label="Daten dieses Geräts übernehmen"
              hint="Aus = leerer Kalender (ohne die Beispiel-Familie)" />
            <button className="btn primary big" disabled={busy} onClick={() => connect(newFamilyId(), takeLocal)}>
              {busy ? 'Wird hochgeladen …' : 'Neuen Familienkalender anlegen'}
            </button>
          </div>
          <h3>Oder bestehendem Kalender beitreten</h3>
          <p className="hint">Am einfachsten: am anderen Gerät den QR-Code scannen. Alternativ den Familien-Link oder die Familien-ID einfügen:</p>
          <div className="row">
            <input value={joinId} onChange={(e) => setJoinId(e.target.value.trim())} placeholder="Link oder Familien-ID" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            <button className="btn" disabled={!parseFamilyInput(joinId)} onClick={() => { const id = parseFamilyInput(joinId); if (id) connect(id, false); }}>Beitreten</button>
          </div>
          {joinId && !parseFamilyInput(joinId) && <small className="error">Das ist weder ein Familien-Link noch eine Familien-ID.</small>}
          {err && <p className="error">{err}</p>}
        </>
      )}
    </div>
  );
}

/** Liste der Zeitzonen (falls der Browser sie kennt), die aktuelle immer dabei */
function timezoneList(current: string): string[] {
  let all: string[] = [];
  try { all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []; } catch { /* alt */ }
  if (!all.length) all = ['Europe/Vienna', 'Europe/Berlin', 'Europe/Zurich', 'Europe/London', 'Europe/Paris', 'Europe/Rome', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];
  return all.includes(current) ? all : [current, ...all];
}

function GeneralTab() {
  const { family, saveFamily } = useData();
  const [updateMsg, setUpdateMsg] = useState('');
  const checkUpdate = async () => {
    setUpdateMsg('Suche …');
    const r = await checkForUpdate();
    setUpdateMsg(r === 'reload' ? 'Update wird geladen …' : 'Aktuell ✓');
  };
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [msg, setMsg] = useState('');
  const savePin = async () => {
    if (pin1.length < 4 || !/^\d+$/.test(pin1)) return setMsg('Mindestens 4 Ziffern.');
    if (pin1 !== pin2) return setMsg('PINs stimmen nicht überein.');
    saveFamily({ pinHash: await hashPin(pin1) });
    setPin1(''); setPin2(''); setMsg('PIN gespeichert ✓');
  };
  return (
    <div className="settings-section">
      <Advanced title="🌍 Zeitzone" status={family.timezone || deviceTimezone()}
        hint="Für Erinnerungen per ntfy, importierte und exportierte Kalender. Wird automatisch vom Gerät übernommen.">
        <label className="field"><span className="label">Zeitzone der Familie</span>
          <select value={family.timezone || deviceTimezone()} onChange={(e) => saveFamily({ timezone: e.target.value })}>
            {timezoneList(family.timezone || deviceTimezone()).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
          <small className="hint">Dieses Gerät: {deviceTimezone().replace(/_/g, ' ')}. Die Uhrzeiten der Termine selbst bleiben, wie sie eingetragen sind.</small>
        </label>
      </Advanced>

      <h3>Feiertage und Ferien</h3>
      <Toggle checked={family.showHolidays} onChange={(v) => saveFamily({ showHolidays: v })} label="Feiertage Österreich anzeigen" />
      <Toggle checked={family.showSchoolHolidays} onChange={(v) => saveFamily({ showSchoolHolidays: v })} label={`Schulferien ${regionName(family.ferienRegion)} anzeigen`}
        hint="Laut Bildungsministerium; schulautonome Tage und Landespatron bitte als eigenen Termin eintragen." />
      {family.showSchoolHolidays && (
        <label className="field">
          <span className="label">Bundesland für die Schulferien</span>
          <select value={family.ferienRegion ?? 'O'} onChange={(e) => saveFamily({ ferienRegion: e.target.value as FerienRegion })}>
            {FERIEN_REGIONS.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
          </select>
          <small className="hint">Gilt für Ferien im Kalender, den Countdown, die Schulzeiten und die Tagesübersicht.</small>
        </label>
      )}
      <details className="tips">
        <summary>Außerhalb von Österreich?</summary>
        <p className="hint">Die eingebauten Feiertage und Ferien gelten für Österreich. Für andere Länder beides hier ausschalten und
          stattdessen den offiziellen Ferien- bzw. Feiertagskalender eures Landes als Link importieren (⚙️ → Daten → Kalender importieren) –
          z. B. den „Feiertage“-Kalender aus Google Kalender oder einen Schulferien-Kalender als iCal-Link. Er aktualisiert sich dann jeden Tag von selbst.</p>
      </details>

      <WeatherPlace />

      <h3>🔗 Schnellzugriff</h3>
      <p className="hint">Eigene Knöpfe für andere Apps oder Seiten, z. B. Essensplan oder Wunschliste. Sie erscheinen oben rechts unter <Icon name="grid" size={14} /> – bei Bedarf auch in den Details von Geburtstagen.</p>
      <QuickLinksEditor links={family.quickLinks ?? []} onChange={(quickLinks) => saveFamily({ quickLinks })} />

      <h3><Icon name="lock" size={18} /> PIN für Einstellungen</h3>
      <p className="hint">{family.pinHash ? 'Eine PIN ist gesetzt. Termine anlegen geht ohne PIN, Einstellungen und Stundenplan sind geschützt.' : 'Noch keine PIN gesetzt – Einstellungen sind frei zugänglich.'}</p>
      <div className="grid2">
        <input type="password" inputMode="numeric" placeholder="Neue PIN" value={pin1} onChange={(e) => setPin1(e.target.value)} />
        <input type="password" inputMode="numeric" placeholder="Wiederholen" value={pin2} onChange={(e) => setPin2(e.target.value)} />
      </div>
      <div className="row">
        <button className="btn primary" onClick={savePin}>PIN speichern</button>
        {family.pinHash && <button className="btn" onClick={() => { saveFamily({ pinHash: undefined }); setMsg('PIN entfernt'); }}>PIN entfernen</button>}
        {msg && <span className="hint">{msg}</span>}
      </div>

      <h3><Icon name="info" size={18} /> Info</h3>
      <div className="row">
        <span className="hint">Version {__BUILD__} vom {new Date(__BUILD_TIME__).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</span>
        <button className="btn small" onClick={checkUpdate}>{updateMsg || 'Nach Update suchen'}</button>
      </div>
      <p className="hint"><a href="./datenschutz.html" target="_blank" rel="noreferrer">Datenschutzerklärung</a></p>
      <p className="hint">Comic-Figuren von <a href="https://www.dicebear.com" target="_blank" rel="noreferrer">DiceBear</a>:</p>
      <ul className="credits">{Object.values(AVATAR_STYLES).map((s) => <li key={s.credit}>{s.credit}</li>)}</ul>
    </div>
  );
}

function WeatherPlace() {
  const { family, saveFamily } = useData();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(Place & { region?: string })[]>([]);
  const [err, setErr] = useState('');
  const cur = family.weather ?? DEFAULT_PLACE;
  const search = async () => {
    setErr('');
    try {
      const r = await searchPlaces(q.trim());
      setResults(r);
      if (!r.length) setErr('Kein Ort gefunden.');
    } catch {
      setErr('Ortssuche nicht erreichbar – bitte Internetverbindung prüfen.');
    }
  };
  return (
    <>
      <h3>🌤️ Wetter</h3>
      <p className="hint">Ort für die Vorhersage: <b>{cur.name}</b>{family.weather ? '' : ' (Standard)'}. Ein-/ausschalten pro Gerät unter „Gerät“.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (q.trim()) search(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ort suchen, z. B. Wels" />
        <button className="btn" disabled={!q.trim()}>Suchen</button>
      </form>
      {err && <small className="error">{err}</small>}
      {results.length > 0 && (
        <ul className="source-list">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <span><strong>{r.name}</strong> <small className="hint">{r.region}</small></span>
              <button className="btn small" onClick={() => { saveFamily({ weather: { name: r.name, lat: r.lat, lon: r.lon } }); setResults([]); setQ(''); }}>Wählen</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
