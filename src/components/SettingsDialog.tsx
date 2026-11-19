import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useData } from '../data/DataContext';
import type { Person } from '../types';
import { Avatar, Icon, Modal, Toggle } from './ui';
import { PersonEditor } from './PersonEditor';
import { ConfirmDialog } from './Dialogs';
import { AVATAR_STYLES, PERSON_COLORS, randomSeed } from '../lib/avatars';
import { uid } from '../lib/dates';
import { hashPin } from '../lib/pin';
import { buildTimeFirebase, loadCloudConfig, makeJoinLink, newFamilyId, parseFamilyInput, saveCloudConfig, type CloudConfig } from '../data/store';
import { LocalStore } from '../data/localStore';
import { isIOS, useInstall } from '../install';
import { FirebaseStore } from '../data/firebaseStore';
import { DataTab } from './DataTab';
import { checkForUpdate } from '../update';
import { DEFAULT_PLACE, searchPlaces, type Place } from '../lib/weather';
import { isNative, nativeNotifyPermission } from '../native';
import { QuickLinksEditor } from './QuickLinks';

const HOURS = Array.from({ length: 25 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

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
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
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

      <h3>Anzeigen</h3>
      <Toggle checked={device.showSchool} onChange={(v) => setDevice({ showSchool: v })} label="🏫 Schulzeiten" hint="Auch über den 🏫-Schalter in der Leiste" />
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
  const { device, setDevice, persons, family, saveFamily } = useData();
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
  return (
    <div className="settings-section">
      <h3><Icon name="bell" size={18} /> Push per ntfy (für alle)</h3>
      <p className="hint">Kommt auch bei geschlossener App. Jede Person bekommt Nachrichten an das <b>ntfy-Topic in ihrem Profil</b>
        {withTopic.length ? ` (eingetragen: ${withTopic.map((p) => p.name).join(', ')})` : ' – noch bei niemandem eingetragen'}.</p>
      <label className="field"><span className="label">Familien-Topic (Termine ohne Person)</span>
        <input value={famTopic} placeholder="leer = an alle Personen mit Topic" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={(e) => setFamTopic(e.target.value)} /></label>
      {famTopic.trim() !== (family.ntfyFamilyTopic ?? '') && <small className="hint">Wird gespeichert …</small>}
      <Toggle checked={!!family.ntfyDaily} onChange={(v) => saveFamily({ ntfyDaily: v ? '06:30' : '' })} label="Tagesübersicht"
        hint="Jeden Morgen die Termine des Tages und was mitzubringen ist" />
      {!!family.ntfyDaily && (
        <label className="field"><span className="label">Uhrzeit der Tagesübersicht</span>
          <input type="time" value={family.ntfyDaily} onChange={(e) => e.target.value && saveFamily({ ntfyDaily: e.target.value })} /></label>
      )}
      <Toggle checked={!!family.ntfyWeekly} onChange={(v) => saveFamily({ ntfyWeekly: v })} label="Wochenübersicht" hint="Sonntag um 18:00: die Termine der kommenden Woche" />
      {!!family.ntfyWeekly && (
        <Toggle checked={family.ntfyWeeklyDrivers !== false} onChange={(v) => saveFamily({ ntfyWeeklyDrivers: v })} label="… mit Fahrdienst"
          hint="„🚗 Fahrdienst diese Woche: Papa: Di 16:00 Schwimmen (Lena) …“ – jede Person bekommt ihre eigenen Fahrten" />
      )}
      <Toggle checked={!!family.ntfyChanges} onChange={(v) => saveFamily({ ntfyChanges: v })} label="Neue und geänderte Termine melden"
        hint="An die betroffenen Personen – nicht an die Person, die geändert hat (siehe „Ich bin“)." />

      <h3>Dieses Gerät</h3>
      <label className="field"><span className="label">Ich bin</span>
        <select value={device.me ?? ''} onChange={(e) => setDevice({ me: e.target.value || undefined })}>
          <option value="">Niemand bestimmtes (z. B. Wand-Tablet)</option>
          {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <Toggle checked={device.reminders} onChange={enableReminders} label={native ? 'Erinnerungen auf diesem Gerät' : 'Benachrichtigungen in der App'}
        hint={perm === 'denied'
          ? (native ? 'Benachrichtigungen sind blockiert – in den Android-Einstellungen bei „Familienkalender“ erlauben.' : 'Im Browser blockiert – bitte in den Browser-Einstellungen erlauben.')
          : native ? 'Kommen pünktlich, auch wenn die App geschlossen ist (für die nächsten 2 Wochen geplant; neue Termine anderer werden beim nächsten Öffnen übernommen).'
          : 'Nur solange die App geöffnet ist. Am Wand-Tablet meist aus.'} />
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
    </div>
  );
}

function SyncTab() {
  const { store, status, switchStore, persons, events } = useData();
  const cloud = loadCloudConfig();
  const [qr, setQr] = useState('');
  const [cfgText, setCfgText] = useState('');
  const [joinId, setJoinId] = useState('');
  const [err, setErr] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [takeLocal, setTakeLocal] = useState(true);
  const buildCfg = buildTimeFirebase();
  const link = cloud ? makeJoinLink(cloud) : '';

  useEffect(() => {
    if (link) QRCode.toDataURL(link, { width: 260, margin: 1 }).then(setQr);
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
      {cloud ? (
        <>
          <h3>Weiteres Gerät verbinden</h3>
          <p className="hint">Diesen QR-Code mit dem Handy scannen oder den Link öffnen. Der Link ist der Schlüssel zum Kalender – nur innerhalb der Familie teilen.</p>
          <div className="qr-box">
            {qr && <img src={qr} alt="QR-Code zum Verbinden" width={220} height={220} />}
            <div className="qr-actions">
              <button className="btn" onClick={() => navigator.clipboard?.writeText(link)}>Link kopieren</button>
              {'share' in navigator && <button className="btn" onClick={() => navigator.share({ title: 'Familienkalender', url: link }).catch(() => {})}>Teilen …</button>}
            </div>
          </div>
          <p className="hint mono">Familien-ID: {cloud.familyId}</p>
          <p className="hint">In diesem Kalender: {persons.length} Person(en), {events.length} Termin(e).</p>
          {persons.length === 0 && (
            <p className="error">Dieser Familienkalender ist leer. Falls auf einem anderen Gerät schon Daten sind: hier „Dieses Gerät trennen“ und danach den QR-Code bzw. Familien-Link des anderen Geräts öffnen.</p>
          )}
          <button className="btn danger" onClick={() => setConfirmLeave(true)}>Dieses Gerät trennen</button>
          {confirmLeave && <ConfirmDialog text="Dieses Gerät von der Cloud trennen? Die Daten bleiben online erhalten; hier wird wieder der lokale Speicher genutzt." confirm="Trennen"
            onResult={(ok) => { setConfirmLeave(false); if (ok) { saveCloudConfig(null); switchStore(); } }} />}
        </>
      ) : (
        <>
          <p>Damit Tablet und Handys denselben Kalender sehen, wird ein kostenloses Firebase-Projekt verwendet (Anleitung in <code>SETUP.md</code>). Offline funktioniert alles weiter, synchronisiert wird automatisch.</p>
          {!buildCfg && (
            <label className="field"><span className="label">Firebase-Konfiguration</span>
              <textarea rows={6} className="mono" value={cfgText} onChange={(e) => setCfgText(e.target.value)}
                placeholder={'{\n  apiKey: "…",\n  authDomain: "…",\n  projectId: "…",\n  appId: "…"\n}'} /></label>
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
      <h3>Feiertage und Ferien</h3>
      <Toggle checked={family.showHolidays} onChange={(v) => saveFamily({ showHolidays: v })} label="Feiertage Österreich anzeigen" />
      <Toggle checked={family.showSchoolHolidays} onChange={(v) => saveFamily({ showSchoolHolidays: v })} label="Schulferien Oberösterreich anzeigen"
        hint="Schulautonome Tage bitte als eigenen Termin eintragen." />

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
