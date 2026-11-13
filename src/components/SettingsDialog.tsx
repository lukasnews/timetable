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
import { buildTimeFirebase, loadCloudConfig, makeJoinLink, newFamilyId, saveCloudConfig, type CloudConfig } from '../data/store';
import { LocalStore } from '../data/localStore';
import { isIOS, useInstall } from '../install';
import { FirebaseStore } from '../data/firebaseStore';

export type SettingsTab = 'persons' | 'device' | 'sync' | 'general';

export function SettingsDialog({ tab: initial, onClose }: { tab: SettingsTab; onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTab>(initial);
  const tabs: [SettingsTab, string, string][] = [
    ['persons', 'Personen', 'users'],
    ['device', 'Dieses Gerät', 'device'],
    ['sync', 'Synchronisation', 'cloud'],
    ['general', 'Allgemein', 'gear'],
  ];
  return (
    <Modal title="Einstellungen" onClose={onClose} wide>
      <nav className="tabs">
        {tabs.map(([k, l, i]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Icon name={i} size={18} /> <span>{l}</span></button>
        ))}
      </nav>
      {tab === 'persons' && <PersonsTab />}
      {tab === 'device' && <DeviceTab />}
      {tab === 'sync' && <SyncTab />}
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

function DeviceTab() {
  const { device, setDevice, persons } = useData();
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const enableReminders = async (v: boolean) => {
    if (v && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const r = await Notification.requestPermission();
      setPerm(r);
      if (r !== 'granted') return;
    }
    setDevice({ reminders: v });
  };
  const inst = useInstall();
  return (
    <div className="settings-section">
      <h3><Icon name="download" size={18} /> App installieren</h3>
      {inst.installed ? (
        <p className="hint">✓ Läuft als installierte App.</p>
      ) : inst.canPrompt ? (
        <button className="btn primary" onClick={inst.install}><Icon name="download" size={18} /> Auf diesem Gerät installieren</button>
      ) : isIOS() ? (
        <p className="hint">In Safari unten auf <b>Teilen</b> (□↑) tippen → <b>„Zum Home-Bildschirm“</b>.</p>
      ) : (
        <p className="hint">Im Browser-Menü (⋮) <b>„App installieren“</b> bzw. <b>„Zum Startbildschirm hinzufügen“</b> wählen.</p>
      )}

      <h3>Ansicht</h3>
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
          <input type="time" value={device.dayStart} onChange={(e) => e.target.value && setDevice({ dayStart: e.target.value })} /></label>
        <label className="field"><span className="label">Tag endet</span>
          <input type="time" value={device.dayEnd} onChange={(e) => e.target.value && setDevice({ dayEnd: e.target.value })} /></label>
      </div>
      <Toggle checked={device.showSchool} onChange={(v) => setDevice({ showSchool: v })} label="Schulzeiten anzeigen" hint="Auch über den 🏫-Schalter in der Leiste" />
      {device.showSchool && <Toggle checked={device.schoolInMonth} onChange={(v) => setDevice({ schoolInMonth: v })} label="… auch in der Monatsansicht" />}

      <h3>Kiosk-Modus (Wand-Tablet)</h3>
      <Toggle checked={device.kiosk} onChange={(v) => setDevice({ kiosk: v })} label="Kiosk-Modus" hint="Springt nach Inaktivität zurück auf heute" />
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
          <button className="btn" onClick={() => document.documentElement.requestFullscreen?.()}><Icon name="expand" size={18} /> Vollbild</button>
        </>
      )}

      <h3>Erinnerungen auf diesem Gerät</h3>
      <Toggle checked={device.reminders} onChange={enableReminders} label="Benachrichtigungen anzeigen"
        hint={perm === 'denied' ? 'Im Browser blockiert – bitte in den Browser-Einstellungen erlauben.' : 'Am Wand-Tablet meist aus, am Handy an. Funktioniert, solange die App geöffnet ist – für zuverlässige Push-Nachrichten ntfy verwenden.'} />
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
  const { store, status, switchStore } = useData();
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
          <p className="hint">Am einfachsten: am anderen Gerät den QR-Code scannen. Alternativ Familien-ID eingeben:</p>
          <div className="row">
            <input value={joinId} onChange={(e) => setJoinId(e.target.value.trim())} placeholder="Familien-ID" />
            <button className="btn" disabled={joinId.length < 10} onClick={() => connect(joinId, false)}>Beitreten</button>
          </div>
          {err && <p className="error">{err}</p>}
        </>
      )}
    </div>
  );
}

function GeneralTab() {
  const { family, saveFamily } = useData();
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
      <h3>Kalender</h3>
      <Toggle checked={family.showHolidays} onChange={(v) => saveFamily({ showHolidays: v })} label="Feiertage Österreich anzeigen" />
      <Toggle checked={family.showSchoolHolidays} onChange={(v) => saveFamily({ showSchoolHolidays: v })} label="Schulferien Oberösterreich anzeigen"
        hint="Schulautonome Tage bitte als eigenen Termin eintragen." />

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
      <p className="hint">Comic-Figuren von <a href="https://www.dicebear.com" target="_blank" rel="noreferrer">DiceBear</a>:</p>
      <ul className="credits">{Object.values(AVATAR_STYLES).map((s) => <li key={s.credit}>{s.credit}</li>)}</ul>
    </div>
  );
}
