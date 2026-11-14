import { useMemo, useRef, useState } from 'react';
import { useData } from '../data/DataContext';
import type { CalEvent, FamilySettings, Person, Timetable } from '../types';

interface Backup {
  format: 'familienkalender-backup';
  version: number;
  exportedAt: string;
  persons: Person[];
  events: CalEvent[];
  timetables: Timetable[];
  settings?: FamilySettings;
}
import { parseICS, toICS, type ImportResult } from '../lib/ics';
import { todayLocal } from '../lib/dates';
import { Avatar, Icon, Toggle } from './ui';
import { ConfirmDialog } from './Dialogs';

const REMINDERS: [number | null, string][] = [
  [null, 'Keine'],
  [-120, 'Am Vorabend, 18:00'],
  [0, 'Am Tag, 08:00 (ganztägig) bzw. zum Beginn'],
  [60, '1 Stunde vorher'],
  [1440, '1 Tag vorher'],
];

export function DataTab() {
  const { events, persons, timetables, family, store, apply } = useData();
  const backupRef = useRef<HTMLInputElement>(null);
  const [restore, setRestore] = useState<Backup | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState<(ImportResult & { source: string }) | null>(null);
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [reminder, setReminder] = useState<number | null>(null);
  const [futureOnly, setFutureOnly] = useState(true);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const sources = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) if (e.importSource) m.set(e.importSource, (m.get(e.importSource) ?? 0) + 1);
    return [...m.entries()];
  }, [events]);

  const load = (text: string, fallbackName: string) => {
    try {
      const r = parseICS(text, { source: fallbackName });
      const source = r.calendarName || fallbackName;
      r.events.forEach((e) => (e.importSource = source));
      setPreview({ ...r, source });
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg('');
    load(await f.text(), f.name.replace(/\.ics$/i, ''));
  };

  const onUrl = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const u = url.trim().replace(/^webcal:\/\//i, 'https://');
      const r = await fetch(u);
      if (!r.ok) throw new Error(`Server antwortet mit ${r.status}`);
      load(await r.text(), new URL(u).hostname);
    } catch {
      setErr('Der Kalender konnte nicht direkt geladen werden – viele Server erlauben das aus dem Browser nicht. ' +
        'Bitte die .ics-Datei herunterladen und oben mit „Datei wählen“ importieren.');
    } finally {
      setBusy(false);
    }
  };

  const today = todayLocal();
  const toImport = useMemo(() => {
    if (!preview) return [];
    return preview.events.filter((e) => !futureOnly || e.recurrence || e.end.slice(0, 10) >= today);
  }, [preview, futureOnly, today]);

  const doImport = () => {
    if (!preview) return;
    const list: CalEvent[] = toImport.map((e) => {
      let rem = reminder;
      // „Am Vorabend 18:00“: ganztägig = 14 h vor 08:00; mit Uhrzeit nicht sinnvoll → 1 Tag vorher
      if (rem === -120) rem = e.allDay ? 840 : 1440;
      return { ...e, personIds, reminderMinutes: rem };
    });
    // Abgleich: künftige Termine derselben Quelle, die in der neuen Datei fehlen, entfernen
    const ids = new Set(list.map((e) => e.id));
    const stale = events.filter((e) => e.importSource === preview.source && !ids.has(e.id) && (e.recurrence || e.end.slice(0, 10) >= today)).map((e) => e.id);
    apply({ put: list, del: stale });
    setMsg(`✓ ${list.length} Termin(e) aus „${preview.source}“ importiert${stale.length ? `, ${stale.length} veraltete entfernt` : ''}.`);
    setPreview(null);
  };

  const saveFile = async (file: File) => {
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Familienkalender' }); return; } catch { /* abgebrochen → Download */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const exportIcs = () => saveFile(new File([toICS(events.filter((e) => !e.importSource), persons)], `familienkalender-${today}.ics`, { type: 'text/calendar' }));

  const exportBackup = () => {
    const backup: Backup = { format: 'familienkalender-backup', version: 1, exportedAt: new Date().toISOString(), persons, events, timetables, settings: family };
    saveFile(new File([JSON.stringify(backup, null, 1)], `familienkalender-sicherung-${today}.json`, { type: 'application/json' }));
  };

  const onBackupFile = async (f: File | undefined) => {
    if (!f) return;
    setErr(''); setMsg('');
    try {
      const b = JSON.parse(await f.text()) as Backup;
      if (b.format !== 'familienkalender-backup' || !Array.isArray(b.persons) || !Array.isArray(b.events)) throw new Error();
      setRestore(b);
    } catch {
      setErr('Das ist keine Sicherungsdatei des Familienkalenders.');
    }
  };

  const doRestore = (b: Backup) => {
    // Alles ersetzen: Einträge, die nicht in der Sicherung sind, werden entfernt
    const keep = { persons: new Set(b.persons.map((x) => x.id)), events: new Set(b.events.map((x) => x.id)), timetables: new Set((b.timetables ?? []).map((x) => x.id)) };
    persons.filter((x) => !keep.persons.has(x.id)).forEach((x) => store.remove('persons', x.id));
    events.filter((x) => !keep.events.has(x.id)).forEach((x) => store.remove('events', x.id));
    timetables.filter((x) => !keep.timetables.has(x.id)).forEach((x) => store.remove('timetables', x.id));
    b.persons.forEach((x) => store.put('persons', x));
    b.events.forEach((x) => store.put('events', x));
    (b.timetables ?? []).forEach((x) => store.put('timetables', x));
    if (b.settings) store.put('meta', { ...b.settings, id: 'settings' });
    setMsg(`✓ Sicherung vom ${new Date(b.exportedAt).toLocaleDateString('de-AT')} wiederhergestellt: ${b.persons.length} Person(en), ${b.events.length} Termin(e).`);
  };

  return (
    <div className="settings-section">
      <h3><Icon name="download" size={18} /> Export</h3>
      <p className="hint">Alle eigenen Termine (ohne importierte) als .ics-Datei, z. B. für Google- oder Outlook-Kalender oder als Sicherung. Geburtstage aus den Profilen sind dabei.</p>
      <button className="btn" onClick={exportIcs}><Icon name="download" size={18} /> Termine exportieren</button>

      <h3><Icon name="cloud" size={18} /> Komplett-Sicherung</h3>
      <p className="hint">Alles in einer Datei: Personen mit Figuren, Termine, Stundenpläne und Einstellungen. Zum Aufheben – und zum Wiederherstellen, falls etwas schiefgeht.</p>
      <input ref={backupRef} type="file" accept=".json,application/json" hidden onChange={(e) => { onBackupFile(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="row">
        <button className="btn" onClick={exportBackup}><Icon name="download" size={18} /> Sicherung speichern</button>
        <button className="btn" onClick={() => backupRef.current?.click()}><Icon name="up" size={18} /> Wiederherstellen …</button>
      </div>
      {restore && (
        <ConfirmDialog confirm="Alles ersetzen"
          text={`Sicherung vom ${new Date(restore.exportedAt).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })} einspielen (${restore.persons.length} Personen, ${restore.events.length} Termine)? Der jetzige Stand wird auf allen Geräten vollständig ersetzt.`}
          onResult={(ok) => { if (ok) doRestore(restore); setRestore(null); }} />
      )}

      <h3><Icon name="up" size={18} /> Import (.ics)</h3>
      <p className="hint">Z. B. den Müllkalender deiner Gemeinde: Auf der Gemeinde-Seite die Abfuhrtermine als <b>.ics</b> (iCal) herunterladen und hier auswählen. Erneutes Importieren aktualisiert die Termine statt sie zu verdoppeln.</p>
      <input ref={fileRef} type="file" accept=".ics,text/calendar" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="row">
        <button className="btn primary" onClick={() => fileRef.current?.click()}><Icon name="plus" size={18} /> Datei wählen</button>
      </div>
      <div className="row">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="oder Link (https:// bzw. webcal://)" inputMode="url" autoCapitalize="none" />
        <button className="btn" disabled={!url.trim() || busy} onClick={onUrl}>{busy ? 'Lade …' : 'Laden'}</button>
      </div>
      {err && <p className="error">{err}</p>}
      {msg && <p className="hint">{msg}</p>}

      {preview && (
        <div className="import-preview">
          <strong>„{preview.source}“</strong>
          <p className="hint">
            {preview.events.length} Termin(e) gefunden{preview.skipped ? `, ${preview.skipped} übersprungen` : ''}.
            {' '}Beispiele: {preview.events.slice(0, 3).map((e) => `${e.title} (${e.start.slice(0, 10).split('-').reverse().join('.')})`).join(', ')}
          </p>
          <Toggle checked={futureOnly} onChange={setFutureOnly} label="Nur zukünftige Termine" hint={`${toImport.length} werden importiert`} />
          <div className="field">
            <span className="label">Für wen?</span>
            <div className="person-pick">
              {persons.map((p) => {
                const on = personIds.includes(p.id);
                return (
                  <button key={p.id} type="button" className={'pick' + (on ? ' on' : '')} style={{ ['--pc' as string]: p.color }}
                    onClick={() => setPersonIds(on ? personIds.filter((x) => x !== p.id) : [...personIds, p.id])}>
                    <Avatar person={p} size={26} /> {p.name}
                  </button>
                );
              })}
            </div>
            <small className="hint">{personIds.length ? '' : 'Niemand gewählt = ganze Familie (z. B. Müll)'}</small>
          </div>
          <label className="field"><span className="label"><Icon name="bell" size={16} /> Erinnerung</span>
            <select value={reminder ?? ''} onChange={(e) => setReminder(e.target.value === '' ? null : Number(e.target.value))}>
              {REMINDERS.map(([v, l]) => <option key={l} value={v ?? ''}>{l}</option>)}
            </select>
          </label>
          <div className="row">
            <button className="btn primary" disabled={!toImport.length} onClick={doImport}>Importieren</button>
            <button className="btn" onClick={() => setPreview(null)}>Abbrechen</button>
          </div>
        </div>
      )}

      {sources.length > 0 && (
        <>
          <h3>Importierte Kalender</h3>
          <ul className="source-list">
            {sources.map(([s, n]) => (
              <li key={s}>
                <span><strong>{s}</strong> <small className="hint">{n} Termin(e)</small></span>
                <button className="btn small danger" onClick={() => setConfirmDel(s)}><Icon name="trash" size={16} /> Entfernen</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {confirmDel && (
        <ConfirmDialog text={`Alle Termine aus „${confirmDel}“ entfernen?`} confirm="Entfernen"
          onResult={(ok) => {
            if (ok) apply({ put: [], del: events.filter((e) => e.importSource === confirmDel).map((e) => e.id) });
            setConfirmDel(null);
          }} />
      )}
    </div>
  );
}
