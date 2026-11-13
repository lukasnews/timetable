import { useEffect, useState } from 'react';
import { useData } from '../data/DataContext';
import type { Lesson, Timetable } from '../types';
import { Avatar, Icon, Toggle } from './ui';
import { WEEKDAYS, WEEKDAYS_SHORT, addMinutes, isoWeek, todayLocal, uid, weekdayMo0 } from '../lib/dates';
import { tint } from '../lib/avatars';

const empty = (id: string): Timetable => ({ id, lessons: [], showInCalendar: true });

export function TimetableView({ requirePin }: { requirePin: () => Promise<boolean> }) {
  const { persons, timetables, saveTimetable } = useData();
  const kids = persons.filter((p) => p.hasTimetable);
  const [sel, setSel] = useState(kids[0]?.id);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!kids.some((k) => k.id === sel)) setSel(kids[0]?.id); }, [kids, sel]);

  if (!kids.length) {
    return <div className="empty-state"><p>Noch kein Stundenplan.</p><p className="hint">In den Einstellungen bei einer Person „Hat einen Stundenplan“ aktivieren.</p></div>;
  }
  const kid = kids.find((k) => k.id === sel) ?? kids[0];
  const tt = timetables.find((t) => t.id === kid.id) ?? empty(kid.id);
  const today = todayLocal();
  const todayWd = weekdayMo0(today);
  const currentWeek: 'A' | 'B' | undefined = tt.abWeeks ? ((isoWeek(today) % 2 === 0) === ((tt.evenWeekIs ?? 'A') === 'A') ? 'A' : 'B') : undefined;
  const showWeek = currentWeek;

  return (
    <div className="timetable" style={{ ['--pc' as string]: kid.color, ['--pcbg' as string]: tint(kid.color, 0.85) }}>
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
        <button className={'btn' + (editing ? ' primary' : '')} onClick={async () => { if (editing) setEditing(false); else if (await requirePin()) setEditing(true); }}>
          <Icon name="edit" size={18} /> {editing ? 'Fertig' : 'Bearbeiten'}
        </button>
      </div>

      {editing ? (
        <TimetableEditor tt={tt} onChange={saveTimetable} />
      ) : (
        <div className="tt-grid">
          {WEEKDAYS.slice(0, 5).map((d, wd) => {
            const ls = tt.lessons.filter((l) => l.weekday === wd && (!l.week || !showWeek || l.week === showWeek)).sort((a, b) => a.start.localeCompare(b.start));
            return (
              <div key={d} className={'tt-day' + (wd === todayWd ? ' today' : '')}>
                <h4><span className="long">{d}</span><span className="short">{WEEKDAYS_SHORT[wd]}</span></h4>
                {ls.length === 0 && <p className="hint">frei</p>}
                {ls.map((l) => (
                  <div key={l.id} className="tt-lesson">
                    <span className="tt-time">{l.start}–{l.end}</span>
                    <strong>{l.subject}</strong>
                    {(l.teacher || l.room) && <small>{[l.teacher, l.room].filter(Boolean).join(' · ')}</small>}
                    {l.week && <span className="tag tiny">{l.week}</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
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
    </div>
  );
}
