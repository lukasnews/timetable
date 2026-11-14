import { useMemo, useState } from 'react';
import type { CalEvent, Person } from '../types';
import { Avatar, Icon, Modal } from './ui';
import { expand, type Occurrence } from '../lib/recurrence';
import { addDays, todayLocal } from '../lib/dates';

const norm = (s: string) => s.toLocaleLowerCase('de').normalize('NFD').replace(/[̀-ͯ]/g, '');

function fmt(o: Occurrence): string {
  const d = new Date(o.start.slice(0, 10) + 'T12:00:00');
  const date = d.toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  return o.event.allDay ? date : `${date}, ${o.start.slice(11)}`;
}

/** Suche in Titel, Ort, Notizen und Personennamen. Serien erscheinen einmal (nächstes Vorkommen). */
export function SearchDialog(props: { events: CalEvent[]; persons: Person[]; onPick: (date: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const today = todayLocal();

  const results = useMemo(() => {
    const terms = norm(q.trim()).split(/\s+/).filter(Boolean);
    if (!terms.length) return { upcoming: [], past: [] };
    const nameOf = new Map(props.persons.map((p) => [p.id, norm(p.name)]));
    const hits = props.events.filter((e) => {
      const hay = norm([e.title, e.location, e.notes, ...e.personIds.map((id) => nameOf.get(id) ?? '')].filter(Boolean).join(' '));
      return terms.every((t) => hay.includes(t));
    });
    const occ = expand(hits, addDays(today, -730), addDays(today, 730));
    const firstFuture = new Map<string, Occurrence>();
    const lastPast = new Map<string, Occurrence>();
    for (const o of occ) {
      const key = o.event.seriesId ? o.event.id : o.event.id;
      if (o.end.slice(0, 10) >= today) {
        const cur = firstFuture.get(key);
        if (!cur || o.start < cur.start) firstFuture.set(key, o);
      } else {
        const cur = lastPast.get(key);
        if (!cur || o.start > cur.start) lastPast.set(key, o);
      }
    }
    const upcoming = [...firstFuture.values()].sort((a, b) => a.start.localeCompare(b.start)).slice(0, 40);
    const past = [...lastPast.entries()].filter(([k]) => !firstFuture.has(k)).map(([, o]) => o)
      .sort((a, b) => b.start.localeCompare(a.start)).slice(0, 20);
    return { upcoming, past };
  }, [q, props.events, props.persons, today]);

  const row = (o: Occurrence) => {
    const ps = o.event.personIds.map((id) => props.persons.find((p) => p.id === id)).filter(Boolean) as Person[];
    return (
      <li key={o.event.id + o.occStart}>
        <button className="search-row" onClick={() => props.onPick(o.start.slice(0, 10))}>
          <span className="sr-avatars">{ps.slice(0, 3).map((p) => <Avatar key={p.id} person={p} size={26} />)}</span>
          <span className="sr-text">
            <strong>{o.event.kind === 'birthday' ? '🎂 ' : ''}{o.event.title}</strong>
            <small>{fmt(o)}{o.recurring ? ' · Serie' : ''}{o.event.location ? ` · 📍 ${o.event.location}` : ''}</small>
          </span>
        </button>
      </li>
    );
  };

  const none = q.trim() && !results.upcoming.length && !results.past.length;
  return (
    <Modal title="Suchen" onClose={props.onClose} wide>
      <div className="search-box">
        <Icon name="search" size={20} />
        <input autoFocus type="search" placeholder="Titel, Ort, Notiz oder Name …" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
      </div>
      {none && <p className="hint">Nichts gefunden.</p>}
      {results.upcoming.length > 0 && (<><h3 className="search-h">Demnächst</h3><ul className="search-list">{results.upcoming.map(row)}</ul></>)}
      {results.past.length > 0 && (<><h3 className="search-h">Vergangen</h3><ul className="search-list">{results.past.map(row)}</ul></>)}
      {!q.trim() && <p className="hint">Tipp: Mehrere Wörter grenzen ein, z. B. „Zahnarzt Mama“.</p>}
    </Modal>
  );
}
