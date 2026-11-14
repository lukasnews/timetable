import { useState } from 'react';
import type { CalEvent, EventTemplate, Person, Recurrence } from '../types';
import { findConflicts } from '../lib/conflicts';
import { Avatar, Icon, Modal, Toggle } from './ui';
import { RecurrenceEditor } from './RecurrenceEditor';
import { addDays, addMinutes, diffMinutes, uid, weekdayMo0 } from '../lib/dates';

export interface EditDraft {
  event: CalEvent;
  /** neu angelegt? */
  isNew: boolean;
  /** Bearbeitung eines Vorkommens einer Serie (scope 'one') – Wiederholung ausblenden */
  singleOccurrence?: boolean;
}

const REMINDERS: [number | null, string][] = [
  [null, 'Keine'],
  [0, 'Zum Beginn'],
  [5, '5 Minuten vorher'],
  [15, '15 Minuten vorher'],
  [30, '30 Minuten vorher'],
  [60, '1 Stunde vorher'],
  [120, '2 Stunden vorher'],
  [840, 'Am Vorabend, 18:00'],
  [1440, '1 Tag vorher'],
  [2880, '2 Tage vorher'],
];

export function EventDialog(props: {
  draft: EditDraft;
  persons: Person[];
  onSave: (e: CalEvent) => void;
  onDelete?: () => void;
  onClose: () => void;
  /** alle Termine (für den Konflikt-Hinweis) */
  events: CalEvent[];
  templates: EventTemplate[];
  onSaveTemplates: (t: EventTemplate[]) => void;
}) {
  const [ev, setEv] = useState<CalEvent>(props.draft.event);
  const [showDriver, setShowDriver] = useState(!!props.draft.event.driverIds?.length);
  const [tplSaved, setTplSaved] = useState(false);
  const set = (p: Partial<CalEvent>) => setEv((e) => ({ ...e, ...p }));

  const date = ev.start.slice(0, 10);
  // Ganztägig: Ende exklusiv gespeichert, inklusiv angezeigt
  const endDate = ev.allDay ? addDays(ev.end, -1) : ev.end.slice(0, 10);
  const startTime = ev.allDay ? '09:00' : ev.start.slice(11, 16);
  const endTime = ev.allDay ? '10:00' : ev.end.slice(11, 16);

  const setStartDate = (d: string) => {
    if (!d) return;
    const dur = diffMinutes(ev.start, ev.end);
    const start = ev.allDay ? d : `${d}T${startTime}`;
    // Wöchentliche Serie: Wochentag wandert mit dem Datum mit (sonst erscheint der Termin nicht am gewählten Tag)
    let recurrence = ev.recurrence;
    if (recurrence?.freq === 'weekly' && recurrence.byWeekday?.length) {
      const oldWd = weekdayMo0(ev.start), newWd = weekdayMo0(start);
      if (oldWd !== newWd) {
        const days = recurrence.byWeekday.length === 1 ? [newWd] : [...new Set([...recurrence.byWeekday.filter((x) => x !== oldWd), newWd])].sort();
        recurrence = { ...recurrence, byWeekday: days };
      }
    }
    set({ start, end: addMinutes(start, dur, ev.allDay), recurrence });
  };
  const setEndDate = (d: string) => {
    if (!d) return;
    if (ev.allDay) set({ end: addDays(d < date ? date : d, 1) });
    else set({ end: `${d}T${endTime}` });
  };
  const setStartTime = (t: string) => {
    if (!t) return;
    const dur = diffMinutes(ev.start, ev.end);
    const start = `${date}T${t}`;
    set({ start, end: addMinutes(start, dur) });
  };
  const setEndTime = (t: string) => t && set({ end: `${endDate}T${t}` });
  const setAllDay = (allDay: boolean) => {
    if (allDay) set({ allDay, start: date, end: addDays(endDate, 1) });
    else set({ allDay, start: `${date}T09:00`, end: `${endDate === date ? date : endDate}T10:00` });
  };

  const togglePerson = (id: string) =>
    set({ personIds: ev.personIds.includes(id) ? ev.personIds.filter((x) => x !== id) : [...ev.personIds, id] });

  const toggleDriver = (id: string) => {
    const cur = ev.driverIds ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    set({ driverIds: next.length ? next : undefined });
  };
  const applyTemplate = (t: EventTemplate) => {
    const d = ev.start.slice(0, 10);
    const start = t.allDay ? d : `${d}T${t.time ?? (ev.allDay ? '09:00' : ev.start.slice(11, 16))}`;
    set({ title: t.title, allDay: t.allDay, start, end: addMinutes(start, t.durationMin, t.allDay), personIds: t.personIds.filter((id) => props.persons.some((p) => p.id === id)),
      driverIds: t.driverIds?.length ? t.driverIds : undefined, location: t.location, reminderMinutes: t.reminderMinutes ?? null });
    setShowDriver(!!t.driverIds?.length);
  };
  const saveAsTemplate = () => {
    const t: EventTemplate = { id: uid(), title: ev.title.trim(), durationMin: diffMinutes(ev.start, ev.end), allDay: ev.allDay, time: ev.allDay ? undefined : ev.start.slice(11, 16),
      personIds: ev.personIds, driverIds: ev.driverIds, location: ev.location || undefined, reminderMinutes: ev.reminderMinutes ?? null };
    props.onSaveTemplates([...props.templates.filter((x) => x.title.toLowerCase() !== t.title.toLowerCase()), t]);
    setTplSaved(true);
  };
  const conflicts = findConflicts(ev, props.events, props.persons, props.draft.event.seriesId ? [] : [props.draft.event.id]);

  const isBirthday = ev.kind === 'birthday';
  const valid = ev.title.trim().length > 0 && ev.end > ev.start;

  const save = () => {
    if (!valid) return;
    props.onSave({ ...ev, title: ev.title.trim() });
  };

  return (
    <Modal
      title={props.draft.isNew ? 'Neuer Termin' : 'Termin bearbeiten'}
      onClose={props.onClose}
      footer={
        <>
          {props.onDelete && (
            <button className="btn danger" onClick={props.onDelete}>
              <Icon name="trash" size={18} /> Löschen
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={props.onClose}>Abbrechen</button>
          <button className="btn primary" disabled={!valid} onClick={save}>Speichern</button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="form">
        <input className="title-input" autoFocus={props.draft.isNew} placeholder={isBirthday ? 'Wer hat Geburtstag?' : 'Titel'}
          value={ev.title} onChange={(e) => set({ title: e.target.value })} />

        {props.draft.isNew && props.templates.length > 0 && (
          <div className="tpl-row" aria-label="Vorlagen">
            {props.templates.map((t) => (
              <button type="button" key={t.id} className="chip-tab" onClick={() => applyTemplate(t)}>{t.title}</button>
            ))}
          </div>
        )}

        <div className="field">
          <span className="label">Für wen?</span>
          <div className="person-pick">
            {props.persons.map((p) => (
              <button type="button" key={p.id} className={'pick' + (ev.personIds.includes(p.id) ? ' on' : '')}
                style={{ ['--pc' as string]: p.color }} onClick={() => togglePerson(p.id)}>
                <Avatar person={p} size={30} /> {p.name}
              </button>
            ))}
            {ev.personIds.length === 0 && <small className="hint">Niemand gewählt = ganze Familie</small>}
          </div>
        </div>

        {!isBirthday && (showDriver ? (
          <div className="field">
            <span className="label">🚗 Fahrdienst (wer bringt / holt)</span>
            <div className="person-pick">
              {props.persons.map((p) => (
                <button type="button" key={p.id} className={'pick' + (ev.driverIds?.includes(p.id) ? ' on' : '')}
                  style={{ ['--pc' as string]: p.color }} onClick={() => toggleDriver(p.id)}>
                  <Avatar person={p} size={26} /> {p.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button type="button" className="btn small link-btn" onClick={() => setShowDriver(true)}>🚗 Fahrdienst hinzufügen</button>
        ))}

        {conflicts.length > 0 && (
          <div className="conflicts" role="alert">
            {conflicts.slice(0, 4).map((c) => (
              <p key={c.person.id + c.title + c.start}>⚠️ <b>{c.person.name}</b> hat gleichzeitig „{c.title}“ ({c.start.slice(11)}–{c.end.slice(11)})</p>
            ))}
          </div>
        )}

        <Toggle checked={isBirthday} label="🎂 Geburtstag" hint="Jährlich, ganztägig, mit Alter"
          onChange={(b) => b
            ? set({ kind: 'birthday', allDay: true, start: date, end: addDays(date, 1), birthYear: ev.birthYear ?? Number(date.slice(0, 4)),
                recurrence: { freq: 'yearly', interval: 1, end: { type: 'never' } } })
            : set({ kind: 'event', birthYear: undefined, recurrence: undefined })} />

        {isBirthday ? (
          <div className="grid2">
            <label className="field"><span className="label">Datum</span>
              <input type="date" value={date} onChange={(e) => e.target.value && set({ start: e.target.value, end: addDays(e.target.value, 1) })} /></label>
            <label className="field"><span className="label">Geburtsjahr</span>
              <input type="number" min={1900} max={2100} value={ev.birthYear ?? ''} onChange={(e) => set({ birthYear: Number(e.target.value) || undefined })} /></label>
          </div>
        ) : (
          <>
            <Toggle checked={ev.allDay} onChange={setAllDay} label="Ganztägig" />
            {ev.allDay && props.persons.some((p) => p.hasTimetable) && (
              <Toggle checked={!!ev.schoolFree} onChange={(v) => set({ schoolFree: v || undefined })} label="🏫 Schulfrei"
                hint="Keine Schulzeit an diesen Tagen – für die gewählten Kinder, ohne Auswahl für alle" />
            )}
            <div className="dt-grid">
              <label className="field"><span className="label">Beginn</span>
                <div className="dt">
                  <input type="date" value={date} onChange={(e) => setStartDate(e.target.value)} />
                  {!ev.allDay && <input type="time" step={300} value={startTime} onChange={(e) => setStartTime(e.target.value)} />}
                </div>
              </label>
              <label className="field"><span className="label">Ende</span>
                <div className="dt">
                  <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} />
                  {!ev.allDay && <input type="time" step={300} value={endTime} onChange={(e) => setEndTime(e.target.value)} />}
                </div>
              </label>
            </div>
            {!valid && ev.title.trim() && <small className="error">Das Ende muss nach dem Beginn liegen.</small>}

            {!props.draft.singleOccurrence && (
              <div className="field">
                <span className="label"><Icon name="repeat" size={16} /> Wiederholen</span>
                <RecurrenceEditor start={ev.start} value={ev.recurrence}
                  onChange={(r?: Recurrence) => set({ recurrence: r, exdates: r ? ev.exdates : undefined })} />
              </div>
            )}
          </>
        )}

        <label className="field"><span className="label"><Icon name="bell" size={16} /> Erinnerung</span>
          <select value={ev.reminderMinutes ?? ''} onChange={(e) => set({ reminderMinutes: e.target.value === '' ? null : Number(e.target.value) })}>
            {REMINDERS.filter(([v]) => ev.allDay ? v === null || v === 0 || v === 840 || v === 1440 || v === 2880 || v === ev.reminderMinutes : v !== 840 || v === ev.reminderMinutes)
              .map(([v, l]) => <option key={l} value={v ?? ''}>{ev.allDay ? ({ 0: 'Am Tag, 08:00', 1440: '1 Tag vorher, 08:00', 2880: '2 Tage vorher, 08:00' } as Record<number, string>)[v as number] ?? l : l}</option>)}
          </select>
        </label>

        {!isBirthday && (
          <label className="field"><span className="label"><Icon name="pin" size={16} /> Ort</span>
            <input value={ev.location ?? ''} onChange={(e) => set({ location: e.target.value })} placeholder="optional" /></label>
        )}
        {!isBirthday && ev.title.trim() && !ev.recurrence && (
          <button type="button" className="btn small link-btn" disabled={tplSaved} onClick={saveAsTemplate}>
            {tplSaved ? '✓ Als Vorlage gespeichert' : '⭐ Als Vorlage speichern'}
          </button>
        )}
        <label className="field"><span className="label">Notizen</span>
          <textarea rows={3} value={ev.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} placeholder="optional" /></label>
      </form>
    </Modal>
  );
}
