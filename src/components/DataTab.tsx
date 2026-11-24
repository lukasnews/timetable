import { useMemo, useRef, useState } from 'react';
import { useData } from '../data/DataContext';
import type { CalEvent, EventTemplate, FamilySettings, IcsSource, Person, Timetable } from '../types';

interface Backup {
  format: 'familienkalender-backup';
  version: number;
  exportedAt: string;
  persons: Person[];
  events: CalEvent[];
  timetables: Timetable[];
  settings?: FamilySettings;
  templates?: EventTemplate[];
}
import { parseICS, toICS, type ImportResult } from '../lib/ics';
import { todayLocal, uid } from '../lib/dates';
import { EVENING_TIMES, SOURCE_REMINDERS, planSync, reminderFor, setSourceReminder, sourceReminderValue } from '../lib/icsSync';
import { loadCloudConfig } from '../data/store';
import { Advanced, Avatar, Icon, Toggle } from './ui';
import { nativeShareFile } from '../native';
import { deviceTimezone } from '../lib/dates';
import { ConfirmDialog } from './Dialogs';

/** Erinnerung einer Quelle: Auswahl + ggf. Uhrzeit am Vorabend */
function ReminderPick({ value, evening, onChange }: { value: string; evening?: string | null; onChange: (value: string, evening?: string) => void }) {
  return (
    <div className="rem-pick">
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Erinnerung">
        {SOURCE_REMINDERS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      {value === 'evening' && (
        <select value={evening || '19:00'} onChange={(e) => onChange('evening', e.target.value)} aria-label="Uhrzeit am Vorabend">
          {EVENING_TIMES.map((t) => <option key={t} value={t}>{t} Uhr</option>)}
        </select>
      )}
    </div>
  );
}

function newFeedToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}

export function DataTab({ onPrint }: { onPrint?: () => void }) {
  const { events, persons, timetables, family, store, apply, templates, saveTemplates, saveFamily, serviceUrl, service, device, setDevice } = useData();
  const hiddenSrc = device.hiddenSources ?? [];
  const [autoList, setAutoList] = useState<{ id: string; exportedAt: string; data: string; persons?: number; events?: number }[] | null>(null);
  const [autoErr, setAutoErr] = useState('');
  const [feedPerson, setFeedPerson] = useState('');
  const [copied, setCopied] = useState(false);
  const backupRef = useRef<HTMLInputElement>(null);
  const [restore, setRestore] = useState<Backup | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState<(ImportResult & { source: string; url?: string }) | null>(null);
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [rem, setRem] = useState<{ value: string; evening?: string }>({ value: 'evening', evening: '19:00' });
  const [futureOnly, setFutureOnly] = useState(true);
  const [auto, setAuto] = useState(true);
  const icsSources = family.icsSources ?? [];
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const sources = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of family.icsSources ?? []) m.set(s.name, 0);
    for (const e of events) if (e.importSource) m.set(e.importSource, (m.get(e.importSource) ?? 0) + 1);
    return [...m.entries()];
  }, [events, family.icsSources]);

  /** Einstellungen einer Quelle (ältere Importe ohne Eintrag: aus den Terminen abgeleitet) */
  const sourceOf = (name: string): IcsSource => {
    const s = icsSources.find((x) => x.name === name);
    if (s) return s;
    const first = events.find((e) => e.importSource === name);
    const r = first?.reminderMinutes ?? null;
    // früher: „Am Vorabend 18:00“ = 840 min vor 08:00
    const evening = first?.allDay && r != null && r > 480 && r < 1920 ? `${String(Math.floor((1920 - r) / 60) % 24).padStart(2, '0')}:${String((1920 - r) % 60).padStart(2, '0')}` : null;
    return { id: uid(), name, personIds: first?.personIds ?? [], reminder: evening ? null : r, evening };
  };
  const saveSource = (src: IcsSource) => saveFamily({ icsSources: [...icsSources.filter((x) => x.id !== src.id && x.name !== src.name), src] });
  const changeSourceReminder = (name: string, value: string, evening?: string) => {
    let src = setSourceReminder(sourceOf(name), value);
    if (evening) src = { ...src, evening };
    saveSource(src);
    const put = events.filter((e) => e.importSource === name).map((e) => ({ ...e, reminderMinutes: reminderFor(e, src) }))
      .filter((e, i, all) => e.reminderMinutes !== events.find((x) => x.id === all[i].id)?.reminderMinutes);
    if (put.length) apply({ put, del: [] });
  };

  const load = (text: string, fallbackName: string, link?: string) => {
    try {
      const r = parseICS(text, { source: fallbackName, timezone: family.timezone || deviceTimezone() });
      let source = r.calendarName || fallbackName;
      // Gleicher Name, aber anderer Link (z. B. zweiter Gem2Go-Müllkalender): eigener Name, sonst löschen sich die Abos gegenseitig
      if (link) {
        const same = (n: string) => icsSources.find((x) => x.name === n);
        const clash = (n: string) => { const k = same(n); return !!k && !!k.url && k.url !== link; };
        if (clash(source)) {
          let host = '';
          try { host = new URL(link.replace(/^webcal:/i, 'https:')).hostname.replace(/^www\./, ''); } catch { /* egal */ }
          const base = host && !clash(`${source} (${host})`) ? `${source} (${host})` : source;
          let i = 2;
          let name = base;
          while (clash(name)) name = `${base} ${i++}`;
          source = name;
        }
      }
      r.events.forEach((e) => (e.importSource = source));
      setPreview({ ...r, source, url: link });
      // Bekannte Quelle: bisherige Einstellungen übernehmen
      const known = icsSources.find((x) => x.name === source);
      if (known) {
        setPersonIds(known.personIds ?? []);
        setRem({ value: sourceReminderValue(known), evening: known.evening ?? undefined });
        setFutureOnly(known.futureOnly ?? true);
        setAuto(known.auto !== false);
      }
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
    const u = url.trim().replace(/^webcal:\/\//i, 'https://');
    let text: string | null = null;
    let why = '';
    try {
      new URL(u);
      // 1) direkt (klappt nur, wenn der Server es erlaubt), 2) über den eigenen Dienst
      try { const r = await fetch(u); if (r.ok) { const t = await r.text(); if (/BEGIN:VCALENDAR/i.test(t)) text = t; } } catch { /* CORS */ }
      const fid = loadCloudConfig()?.familyId;
      if (text == null && serviceUrl && fid) {
        const r = await fetch(`${serviceUrl}/ics?family=${encodeURIComponent(fid)}&url=${encodeURIComponent(u)}`);
        if (r.ok) text = await r.text(); else why = await r.text();
      }
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
    setBusy(false);
    if (text != null) load(text, new URL(u).hostname, u);
    else setErr(`Der Kalender konnte nicht geladen werden${why ? ` (${why.slice(0, 120)})` : ''}. Bitte den Link prüfen – oder die .ics-Datei herunterladen und mit „Datei wählen“ importieren.`);
  };

  const today = todayLocal();
  const toImport = useMemo(() => {
    if (!preview) return [];
    return preview.events.filter((e) => !futureOnly || e.recurrence || e.end.slice(0, 10) >= today);
  }, [preview, futureOnly, today]);

  const doImport = () => {
    if (!preview) return;
    const old = icsSources.find((x) => x.name === preview.source);
    const link = preview.url ?? old?.url;
    let src: IcsSource = { ...(old ?? { id: uid() }), name: preview.source, personIds, futureOnly, url: link, auto: link ? auto : undefined };
    src = setSourceReminder(src, rem.value);
    if (rem.value === 'evening' && rem.evening) src.evening = rem.evening;
    // Abgleich: neue/geänderte schreiben, künftige Termine derselben Quelle, die fehlen, entfernen
    const plan = planSync(preview.events, events, src, today);
    apply({ put: plan.put, del: plan.del });
    saveSource(src);
    setMsg(`✓ „${preview.source}“: ${plan.total ? `${plan.total} Termin(e)` : 'abonniert, noch keine Termine'}${plan.del.length ? `, ${plan.del.length} veraltete entfernt` : ''}${link && auto && serviceUrl ? ' – wird ab jetzt täglich automatisch aktualisiert' : ''}.`);
    setPreview(null);
  };

  const loadAutoBackups = async () => {
    setAutoErr('');
    try {
      const l = await store.fetchAll<{ id: string; exportedAt: string; data: string; persons?: number; events?: number }>('backups');
      setAutoList(l.sort((a, b) => b.id.localeCompare(a.id)));
    } catch (e) {
      setAutoList([]);
      setAutoErr(/permission/i.test(String(e)) ? 'Zugriff verweigert – die Firestore-Regeln müssen einmal aktualisiert werden (siehe Anleitung).' : 'Konnte nicht geladen werden (offline?).');
    }
  };

  const saveFile = async (file: File) => {
    // Android-App: Teilen-Menü (Speichern in Dateien/Drive, senden …)
    try { if (await nativeShareFile(file)) return; } catch (e) { console.error('Speichern', e); }
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Familienkalender' }); return; } catch { /* abgebrochen → Download */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const exportIcs = () => saveFile(new File([toICS(events.filter((e) => !e.importSource), persons, family.timezone || deviceTimezone())], `familienkalender-${today}.ics`, { type: 'text/calendar' }));

  const exportBackup = () => {
    const backup: Backup = { format: 'familienkalender-backup', version: 1, exportedAt: new Date().toISOString(), persons, events, timetables, settings: family, templates };
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
    // Abo-Link, eigene Adresse und PIN bleiben auf dem aktuellen Stand (eine alte Sicherung soll keinen ungültig gemachten Link zurückbringen)
    if (b.settings) {
      const keepNow = { feedToken: family.feedToken, appDomain: family.appDomain, pinHash: family.pinHash };
      store.put('meta', { ...b.settings, ...keepNow, id: 'settings' });
    }
    if (b.templates) saveTemplates(b.templates);
    setMsg(`✓ Sicherung vom ${new Date(b.exportedAt).toLocaleDateString('de-AT')} wiederhergestellt: ${b.persons.length} Person(en), ${b.events.length} Termin(e).`);
  };

  return (
    <div className="settings-section">
      <h3><Icon name="cloud" size={18} /> Komplett-Sicherung</h3>
      <p className="hint">Alles in einer Datei: Personen mit Figuren, Termine, Stundenpläne und Einstellungen. Zum Aufheben – und zum Wiederherstellen, falls etwas schiefgeht.</p>
      <input ref={backupRef} type="file" accept=".json,application/json" hidden onChange={(e) => { onBackupFile(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="row">
        <button className="btn" onClick={exportBackup}><Icon name="download" size={18} /> Sicherung speichern</button>
        <button className="btn" onClick={() => backupRef.current?.click()}><Icon name="up" size={18} /> Wiederherstellen …</button>
      </div>
      <p className="hint">🔄 <b>Automatisch:</b> {serviceUrl ? <>jede Woche eine Sicherung beim Erinnerungsdienst, 13 Wochen lang aufbewahrt. {service.lastBackup ? `Letzte: ${new Date(service.lastBackup + 'T12:00:00').toLocaleDateString('de-AT')}.` : 'Die erste folgt in den nächsten Stunden.'}</> : 'sobald der Erinnerungsdienst (Cloudflare) eingerichtet ist.'}</p>
      {service.backupError && <p className="error">Automatische Sicherung: {/permission|403/i.test(service.backupError) ? 'Zugriff verweigert – die Firestore-Regeln müssen einmal aktualisiert werden (siehe Anleitung).' : service.backupError} <small className="hint">(neuer Versuch spätestens in einer Stunde)</small></p>}
      {serviceUrl && (autoList == null ? (
        <button className="btn small link-btn" onClick={loadAutoBackups}>Automatische Sicherungen anzeigen …</button>
      ) : (
        <>
          {autoErr && <p className="error">{autoErr}</p>}
          {!autoErr && autoList.length === 0 && <p className="hint">Noch keine automatische Sicherung vorhanden.</p>}
          {autoList.length > 0 && (
            <ul className="source-list">
              {autoList.map((b) => (
                <li key={b.id}>
                  <span><strong>{new Date(b.id + 'T12:00:00').toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' })}</strong> <small className="hint">{b.persons ?? '?'} Personen · {b.events ?? '?'} Termine</small></span>
                  <span className="row nowrap">
                    <button className="btn small" onClick={() => saveFile(new File([b.data], `familienkalender-sicherung-${b.id}.json`, { type: 'application/json' }))} aria-label="Herunterladen"><Icon name="download" size={16} /></button>
                    <button className="btn small" onClick={() => { try { setRestore(JSON.parse(b.data)); } catch { setErr('Sicherung beschädigt.'); } }}>Einspielen</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ))}
      {restore && (
        <ConfirmDialog confirm="Alles ersetzen"
          text={`Sicherung vom ${new Date(restore.exportedAt).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })} einspielen (${restore.persons.length} Personen, ${restore.events.length} Termine)? Der jetzige Stand wird auf allen Geräten vollständig ersetzt.`}
          onResult={(ok) => { if (ok) doRestore(restore); setRestore(null); }} />
      )}

      <h3><Icon name="up" size={18} /> Kalender importieren</h3>
      <p className="hint">Z. B. den Müllkalender eurer Gemeinde: <b>Link</b> zum Kalender einfügen – dann aktualisiert er sich jeden Tag von selbst. Oder eine Kalenderdatei auswählen.</p>
      <details className="tips">
        <summary>Tipps: Wo finde ich den Link?</summary>
        <ul className="hint">
          <li>Auf der Gemeinde-Webseite nach „iCal“, „.ics“ oder „Kalender abonnieren“ suchen und den Link kopieren (lange drücken → Link kopieren).</li>
          <li>Gemeinden mit Gem2Go-Webseite: bei „Abfuhrtermine“ die Straße suchen und die Adresse der Ergebnisseite (…/kalender.aspx?…) einfügen.</li>
          <li>Erneutes Importieren aktualisiert die Termine, statt sie zu verdoppeln.</li>
        </ul>
      </details>
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
          {!preview.events.length && preview.url && <p className="hint">Der Kalender ist gerade noch leer (Google braucht nach Änderungen oft ein paar Stunden). Du kannst ihn trotzdem schon abonnieren – die Termine kommen dann beim täglichen Abgleich von selbst.</p>}
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
          <div className="field"><span className="label"><Icon name="bell" size={16} /> Erinnerung</span>
            <ReminderPick value={rem.value} evening={rem.evening} onChange={(value, evening) => setRem({ value, evening: evening ?? rem.evening })} />
            <small className="hint">Per ntfy an die gewählten Personen bzw. das Familien-Topic – später unter „Importierte Kalender“ änderbar oder abschaltbar.</small>
          </div>
          {preview.url && serviceUrl && (
            <Toggle checked={auto} onChange={setAuto} label="🔄 Täglich automatisch aktualisieren" hint="Der Dienst lädt den Link jeden Morgen neu – Änderungen der Gemeinde kommen von selbst" />
          )}
          <div className="row">
            <button className="btn primary" disabled={!toImport.length && !(preview.url && auto && serviceUrl)} onClick={doImport}>{toImport.length ? 'Importieren' : 'Abonnieren'}</button>
            <button className="btn" onClick={() => setPreview(null)}>Abbrechen</button>
          </div>
        </div>
      )}

      {sources.length > 0 && (
        <>
          <h3>Importierte Kalender</h3>
          <Toggle checked={!!device.sourceChips} onChange={(v) => setDevice({ sourceChips: v })} label="Knöpfe in der oberen Leiste"
            hint="Zum schnellen Ein-/Ausblenden neben den Personen (nur auf diesem Gerät)" />
          <ul className="source-cards">
            {sources.map(([name, n]) => {
              const src = sourceOf(name);
              const st = service.icsStatus?.find((x) => x.id === src.id);
              const isAuto = !!src.url && src.auto !== false && icsSources.some((x) => x.id === src.id);
              return (
                <li key={name} className="source-card">
                  <div className="source-head">
                    <span><strong>{name}</strong> <small className="hint">{n} Termin(e)</small></span>
                    <button className="btn small danger" onClick={() => setConfirmDel(name)} aria-label="Entfernen"><Icon name="trash" size={16} /></button>
                  </div>
                  <div className="source-row">
                    <Toggle checked={!hiddenSrc.includes(name)} onChange={(v) => setDevice({ hiddenSources: v ? hiddenSrc.filter((x) => x !== name) : [...hiddenSrc, name] })}
                      label="👁 Im Kalender anzeigen" hint="Nur auf diesem Gerät – Erinnerungen kommen trotzdem" />
                  </div>
                  <div className="source-row">
                    <span className="label"><Icon name="bell" size={15} /> Erinnerung</span>
                    <ReminderPick value={sourceReminderValue(src)} evening={src.evening} onChange={(v, e) => changeSourceReminder(name, v, e)} />
                  </div>
                  {src.url && icsSources.some((x) => x.id === src.id) && (
                    <div className="source-row">
                      <Toggle checked={src.auto !== false} onChange={(v) => saveSource({ ...src, auto: v, requested: v ? Date.now() : src.requested })} label="🔄 Täglich aktualisieren"
                        hint={!serviceUrl ? 'Braucht den Erinnerungsdienst (Cloudflare)'
                          : st?.error ? `⚠️ ${st.error}`
                          : st ? `Zuletzt ${new Date(st.at).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}${st.changed ? ` · ${st.changed} Änderung(en)` : ''}`
                          : isAuto ? 'Wird in den nächsten Minuten geladen' : undefined} />
                      {isAuto && serviceUrl && (
                        <button className="btn small" disabled={!!src.requested && (!st || src.requested > st.at)} onClick={() => saveSource({ ...src, requested: Date.now() })}>
                          {src.requested && (!st || src.requested > st.at) ? 'Wird geladen …' : 'Jetzt aktualisieren'}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {confirmDel && (
        <ConfirmDialog text={`Alle Termine aus „${confirmDel}“ entfernen? Der Kalender wird dann auch nicht mehr automatisch aktualisiert.`} confirm="Entfernen"
          onResult={(ok) => {
            if (ok) {
              apply({ put: [], del: events.filter((e) => e.importSource === confirmDel).map((e) => e.id) });
              if (icsSources.some((x) => x.name === confirmDel)) saveFamily({ icsSources: icsSources.filter((x) => x.name !== confirmDel) });
            }
            setConfirmDel(null);
          }} />
      )}
      <Advanced title="In anderen Kalendern anzeigen" status={family.feedToken ? 'Abo-Link aktiv' : undefined}
        hint="Für Fortgeschrittene: Abo-Link für Google/Outlook/Apple-Kalender und Export als .ics-Datei">
        <h3><Icon name="repeat" size={18} /> Kalender abonnieren</h3>
      <p className="hint">Ein Link, über den Google-, Outlook- oder Apple-Kalender eure Termine laufend anzeigen (nur lesen). Diese Kalender holen Änderungen selbst ab – meist alle paar Stunden, bei Google bis zu einem Tag.</p>
      {!serviceUrl ? (
        <p className="hint">Der Abo-Link steht bereit, sobald der Erinnerungsdienst (Cloudflare) das nächste Mal eingerichtet wurde.</p>
      ) : !family.feedToken ? (
        <button className="btn" onClick={() => saveFamily({ feedToken: newFeedToken() })}>Abo-Link erstellen</button>
      ) : (() => {
        const link = `${serviceUrl}/cal/${family.feedToken}.ics${feedPerson ? `?p=${feedPerson}` : ''}`;
        return (
          <>
            <label className="field"><span className="label">Welche Termine?</span>
              <select value={feedPerson} onChange={(e) => { setFeedPerson(e.target.value); setCopied(false); }}>
                <option value="">Alle Termine</option>
                {persons.map((p) => <option key={p.id} value={p.id}>Nur {p.name} (+ Familientermine)</option>)}
              </select>
            </label>
            <input readOnly value={link} className="mono" onFocus={(e) => e.target.select()} />
            <div className="row">
              <button className="btn primary" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))}>{copied ? '✓ Kopiert' : 'Link kopieren'}</button>
              <a className="btn" href={link.replace(/^https:/, 'webcal:')}>Im Kalender öffnen</a>
              <button className="btn danger" onClick={() => saveFamily({ feedToken: newFeedToken() })}>Neuen Link erzeugen</button>
            </div>
            <small className="hint">Google Kalender: am Computer „Weitere Kalender → Per URL“. Wer den Link kennt, kann die Termine lesen – „Neuen Link erzeugen“ macht den alten ungültig.</small>
          </>
        );
      })()}

      <h3><Icon name="download" size={18} /> Export</h3>
      <p className="hint">Alle eigenen Termine (ohne importierte) als .ics-Datei, z. B. für Google- oder Outlook-Kalender oder als Sicherung. Geburtstage aus den Profilen sind dabei.</p>
      <button className="btn" onClick={exportIcs}><Icon name="download" size={18} /> Termine exportieren</button>
      </Advanced>

      <h3>⭐ Vorlagen</h3>
      {templates.length === 0 ? (
        <p className="hint">Noch keine. Beim Anlegen eines Termins auf „Als Vorlage speichern“ tippen – danach erscheint sie bei neuen Terminen zum Antippen.</p>
      ) : (
        <ul className="source-list">
          {templates.map((t) => (
            <li key={t.id}>
              <span><strong>{t.title}</strong> <small className="hint">{t.allDay ? 'ganztägig' : `${t.time ?? ''} · ${t.durationMin} min`}{t.personIds.length ? ' · ' + t.personIds.map((id) => persons.find((p) => p.id === id)?.name).filter(Boolean).join(', ') : ''}</small></span>
              <button className="btn small danger" onClick={() => saveTemplates(templates.filter((x) => x.id !== t.id))}><Icon name="trash" size={16} /></button>
            </li>
          ))}
        </ul>
      )}

      {onPrint && (
        <>
          <h3><Icon name="print" size={18} /> Drucken</h3>
          <p className="hint">Druckt die Ansicht, die gerade hinter den Einstellungen offen ist (Monat, Woche, Tag, Liste oder Stundenplan) – auch als PDF speicherbar.</p>
          <button className="btn" onClick={onPrint}><Icon name="print" size={18} /> Aktuelle Ansicht drucken</button>
        </>
      )}

    </div>
  );
}
