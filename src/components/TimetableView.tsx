import { useEffect, useState } from 'react';
import { useData } from '../data/DataContext';
import type { FreeDay, Lesson, Timetable } from '../types';
import { Avatar, Icon, Toggle } from './ui';
import { WEEKDAYS, WEEKDAYS_SHORT, addDays, addMinutes, isoWeek, todayLocal, uid, weekdayMo0 } from '../lib/dates';
import { expand } from '../lib/recurrence';
import { tint } from '../lib/avatars';
import { useMedia } from '../hooks';

const empty = (id: string): Timetable => ({ id, lessons: [], showInCalendar: true });

export function TimetableView({ requirePin, printing, onPrint, onAddTest, onOpenEvent }: {
  requirePin: () => Promise<boolean>; printing?: boolean; onPrint?: () => void;
  /** Schularbeit/Test zu einer Stunde eintragen */
  onAddTest?: (kidId: string, lesson: Lesson) => void;
  onOpenEvent?: (eventId: string, occStart: string) => void;
}) {
  const { persons, timetables, saveTimetable, events } = useData();
  const kids = persons.filter((p) => p.hasTimetable);
  const [sel, setSel] = useState(kids[0]?.id);
  const [editing, setEditing] = useState(false);
  const isPhone = useMedia('(max-width: 640px)');
  const wd0 = weekdayMo0(todayLocal());
  const [phoneDay, setPhoneDay] = useState(wd0 > 4 ? 0 : wd0);
  useEffect(() => { if (!kids.some((k) => k.id === sel)) setSel(kids[0]?.id); }, [kids, sel]);

  if (!kids.length) {
    return <div className="empty-state"><p>Noch kein Stundenplan.</p><p className="hint">In den Einstellungen bei einer Person „Hat einen Stundenplan“ aktivieren.</p></div>;
  }
  const kid = kids.find((k) => k.id === sel) ?? kids[0];
  const tt = timetables.find((t) => t.id === kid.id) ?? empty(kid.id);
  const today = todayLocal();
  const todayWd = weekdayMo0(today);
  const currentWeek: 'A' | 'B' | undefined = tt.abWeeks ? ((isoWeek(today) % 2 === 0) === ((tt.evenWeekIs ?? 'A') === 'A') ? 'A' : 'B') : undefined;
  // Kommende Schularbeiten/Tests dieses Kindes (nächste 60 Tage)
  const tests = expand(events.filter((e) => e.category === 'test' && e.personIds.includes(kid.id)), today, addDays(today, 60))
    .sort((a, b) => a.start.localeCompare(b.start));
  // Kommende eigene freie Tage (schulautonom)
  const freeSoon = (tt.freeDays ?? []).filter((f) => (f.end || f.start) >= today && f.start <= addDays(today, 60)).sort((a, b) => a.start.localeCompare(b.start));
  // Im Ausdruck beide Wochen (A/B) zeigen
  const showWeek = printing ? undefined : currentWeek;

  return (
    <div className="timetable" style={{ ['--pc' as string]: kid.color, ['--pcbg' as string]: tint(kid.color, 0.85) }}>
      <h1 className="print-title">Stundenplan {kid.name}</h1>
      <div className="tt-head">
        <div className="seg">
          {kids.map((k) => (
            <button key={k.id} className={k.id === kid.id ? 'on' : ''} onClick={() => setSel(k.id)}>
              <Avatar person={k} size={26} /> {k.name}
            </button>
          ))}
        </div>
        {currentWeek && <span className="tag">Diese Woche: {currentWeek}-Woche</span>}
        <span className="spacer" />
        {!editing && onPrint && <button className="btn hide-phone" onClick={onPrint}><Icon name="print" size={18} /> <span className="long">Drucken</span></button>}
        <button className={'btn' + (editing ? ' primary' : '')} onClick={async () => { if (editing) setEditing(false); else if (await requirePin()) setEditing(true); }}>
          <Icon name="edit" size={18} /> <span className={editing ? '' : 'long'}>{editing ? 'Fertig' : 'Bearbeiten'}</span>
        </button>
      </div>

      {!editing && tests.length > 0 && (
        <div className="tt-tests">
          <strong>📝 Nächste Schularbeiten und Tests</strong>
          <ul>
            {tests.map((o) => (
              <li key={o.event.id + o.occStart}>
                <button className="link" onClick={() => onOpenEvent?.(o.event.id, o.occStart)}>
                  <span className="tt-test-date">{new Date(o.start.slice(0, 10) + 'T12:00:00').toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric' })}</span> {o.event.title}
                  <small className="hint"> · in {Math.round((Date.parse(o.start.slice(0, 10)) - Date.parse(today)) / 86400000)} Tagen</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!editing && !printing && freeSoon.length > 0 && (
        <p className="tt-free">🏖️ Schulfrei: {freeSoon.map((f) => `${fmtFree(f)}${f.label ? ` (${f.label})` : ''}`).join(' · ')}</p>
      )}
      {!editing && !printing && onAddTest && <p className="hint tt-tip">Stunde antippen → Schularbeit oder Test eintragen</p>}

      {editing ? (
        <TimetableEditor tt={tt} onChange={saveTimetable} />
      ) : (
        <>
        {isPhone && !printing && (
          <div className="seg tt-days">
            {WEEKDAYS_SHORT.slice(0, 5).map((d, i) => (
              <button key={d} className={(phoneDay === i ? 'on' : '') + (i === todayWd ? ' is-today' : '')} onClick={() => setPhoneDay(i)}>{d}</button>
            ))}
          </div>
        )}
        <div className={'tt-grid' + (isPhone && !printing ? ' one-day' : '')}>
          {WEEKDAYS.slice(0, 5).map((d, wd) => {
            if (isPhone && !printing && wd !== phoneDay) return null;
            const ls = tt.lessons.filter((l) => l.weekday === wd && (!l.week || !showWeek || l.week === showWeek)).sort((a, b) => a.start.localeCompare(b.start));
            return (
              <div key={d} className={'tt-day' + (wd === todayWd ? ' today' : '')}>
                <h4><span className="long">{d}</span><span className="short">{WEEKDAYS_SHORT[wd]}</span></h4>
                {ls.length === 0 && <p className="hint">frei</p>}
                {ls.map((l) => {
                  const test = tests.find((o) => weekdayMo0(o.start.slice(0, 10)) === wd && o.event.title.toLowerCase().includes(l.subject.toLowerCase()) && !!l.subject);
                  return (
                    <button key={l.id} type="button" className={'tt-lesson' + (test ? ' has-test' : '')} onClick={() => onAddTest?.(kid.id, l)} disabled={!onAddTest}>
                      <span className="tt-time">{l.start}–{l.end}</span>
                      <strong>{l.subject}</strong>
                      {(l.teacher || l.room) && <small>{[l.teacher, l.room].filter(Boolean).join(' · ')}</small>}
                      {l.bring && <small>🎒 {l.bring}</small>}
                      {test && <small className="tt-test-badge">📝 {new Date(test.start.slice(0, 10) + 'T12:00:00').toLocaleDateString('de-AT', { day: 'numeric', month: 'numeric' })}</small>}
                      {l.week && <span className="tag tiny">{l.week}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}

const dm = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric' });
const fmtFree = (f: FreeDay) => (f.end && f.end !== f.start ? `${dm(f.start)} – ${dm(f.end)}` : dm(f.start));

function FreeDaysEditor({ tt, onChange }: { tt: Timetable; onChange: (t: Timetable) => void }) {
  const today = todayLocal();
  const days = tt.freeDays ?? [];
  const setDays = (freeDays: FreeDay[]) => onChange({ ...tt, freeDays: freeDays.length ? freeDays : undefined });
  const setAt = (i: number, p: Partial<FreeDay>) => setDays(days.map((f, j) => {
    if (j !== i) return f;
    const n = { ...f, ...p };
    if (n.end < n.start) n.end = n.start;
    return n;
  }));
  const past = days.filter((f) => (f.end || f.start) < today).length;
  return (
    <div className="tt-free-editor">
      <h4>🏖️ Schulautonome Tage</h4>
      <p className="hint">Freie Tage nur für dieses Kind – an diesen Tagen erscheint keine Schulzeit im Kalender. Ferien und Feiertage kommen automatisch.</p>
      {days.map((f, i) => (f.end || f.start) >= today && (
        <div className="free-row" key={i}>
          <input type="date" value={f.start} onChange={(e) => e.target.value && setAt(i, { start: e.target.value })} aria-label="Von" />
          <span className="hint">bis</span>
          <input type="date" value={f.end} min={f.start} onChange={(e) => e.target.value && setAt(i, { end: e.target.value })} aria-label="Bis" />
          <input value={f.label ?? ''} placeholder="Anlass (optional)" onChange={(e) => setAt(i, { label: e.target.value || undefined })} />
          <button className="icon-btn" onClick={() => setDays(days.filter((_, j) => j !== i))} aria-label="Freien Tag löschen"><Icon name="trash" size={18} /></button>
        </div>
      ))}
      <div className="row">
        <button className="btn" onClick={() => setDays([...days, { start: today, end: today }])}><Icon name="plus" size={18} /> Freier Tag</button>
        {past > 0 && <button className="btn small link-btn" onClick={() => setDays(days.filter((f) => (f.end || f.start) >= today))}>{past} vergangene entfernen</button>}
      </div>
    </div>
  );
}

function TimetableEditor({ tt, onChange }: { tt: Timetable; onChange: (t: Timetable) => void }) {
  const [day, setDay] = useState(0);
  const update = (lessons: Lesson[]) => onChange({ ...tt, lessons });
  const setLesson = (id: string, p: Partial<Lesson>) => update(tt.lessons.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const dayLessons = tt.lessons.filter((l) => l.weekday === day).sort((a, b) => a.start.localeCompare(b.start));
  const add = () => {
    const last = dayLessons[dayLessons.length - 1];
    const start = last ? addMinutes(`2000-01-01T${last.end}`, 5).slice(11) : '07:50';
    update([...tt.lessons, { id: uid(), weekday: day, start, end: addMinutes(`2000-01-01T${start}`, 50).slice(11), subject: '' }]);
  };
  const copyFrom = (from: number) => {
    const src = tt.lessons.filter((l) => l.weekday === from);
    update([...tt.lessons.filter((l) => l.weekday !== day), ...src.map((l) => ({ ...l, id: uid(), weekday: day }))]);
  };

  return (
    <div className="tt-editor">
      <div className="tt-options">
        <Toggle checked={tt.showInCalendar} onChange={(v) => onChange({ ...tt, showInCalendar: v })} label="Schulzeit im Kalender anzeigen" hint="Nur Beginn und Ende, nicht in den Ferien" />
        <Toggle checked={!!tt.abWeeks} onChange={(v) => onChange({ ...tt, abWeeks: v })} label="A/B-Wochen" />
        {tt.abWeeks && (
          <label className="field"><span className="label">Gerade Kalenderwochen sind</span>
            <select value={tt.evenWeekIs ?? 'A'} onChange={(e) => onChange({ ...tt, evenWeekIs: e.target.value as 'A' | 'B' })}>
              <option value="A">A-Woche</option><option value="B">B-Woche</option>
            </select></label>
        )}
      </div>
      <div className="seg">
        {WEEKDAYS_SHORT.slice(0, 5).map((d, i) => (
          <button key={d} className={day === i ? 'on' : ''} onClick={() => setDay(i)}>{d} <small>({tt.lessons.filter((l) => l.weekday === i).length})</small></button>
        ))}
      </div>
      <div className="lesson-list">
        {dayLessons.map((l) => (
          <div className="lesson-row" key={l.id}>
            <input type="time" value={l.start} onChange={(e) => e.target.value && setLesson(l.id, { start: e.target.value })} aria-label="Beginn" />
            <input type="time" value={l.end} onChange={(e) => e.target.value && setLesson(l.id, { end: e.target.value })} aria-label="Ende" />
            <input className="subj" value={l.subject} placeholder="Fach" onChange={(e) => setLesson(l.id, { subject: e.target.value })} />
            <input value={l.teacher ?? ''} placeholder="Lehrer/in" onChange={(e) => setLesson(l.id, { teacher: e.target.value || undefined })} />
            <input value={l.room ?? ''} placeholder="Klasse/Raum" onChange={(e) => setLesson(l.id, { room: e.target.value || undefined })} />
            <input value={l.bring ?? ''} placeholder="🎒 Mitbringen" onChange={(e) => setLesson(l.id, { bring: e.target.value || undefined })} />
            {tt.abWeeks && (
              <select value={l.week ?? ''} onChange={(e) => setLesson(l.id, { week: (e.target.value || undefined) as Lesson['week'] })} aria-label="Woche">
                <option value="">A+B</option><option value="A">A</option><option value="B">B</option>
              </select>
            )}
            <button className="icon-btn" onClick={() => update(tt.lessons.filter((x) => x.id !== l.id))} aria-label="Stunde löschen"><Icon name="trash" size={18} /></button>
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn primary" onClick={add}><Icon name="plus" size={18} /> Stunde</button>
        {day > 0 && <button className="btn" onClick={() => copyFrom(day - 1)}>Wie {WEEKDAYS[day - 1]} (kopieren)</button>}
      </div>
      <FreeDaysEditor tt={tt} onChange={onChange} />
    </div>
  );
}
