import type { CalEvent, Person } from '../types';
import { expand } from '../lib/recurrence';
import { displayTitle } from '../lib/categories';
import { Avatar } from './ui';

/** Fahrdienste im Zeitraum, nach Fahrer gruppiert */
export function DriverList({ events, persons, selected, from, to, onOpen }: {
  events: CalEvent[]; persons: Person[]; selected: Set<string>; from: string; to: string;
  onOpen: (eventId: string, occStart: string) => void;
}) {
  const occs = expand(events.filter((e) => e.driverIds?.length), from, to).sort((a, b) => a.start.localeCompare(b.start));
  const groups = persons
    .filter((p) => selected.has(p.id))
    .map((p) => ({ p, items: occs.filter((o) => o.event.driverIds!.includes(p.id)) }))
    .filter((g) => g.items.length);
  const day = (d: string) => new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric' });

  if (!groups.length) {
    return <div className="empty-state"><p>🚗 Keine Fahrdienste in diesem Zeitraum.</p><p className="hint">Beim Termin unter „Weitere Angaben“ eintragen, wer bringt oder holt.</p></div>;
  }
  return (
    <div className="driver-list">
      {groups.map(({ p, items }) => (
        <section key={p.id} className="driver-group" style={{ ['--pc' as string]: p.color }}>
          <h3><Avatar person={p} size={30} /> {p.name} <small className="hint">fährt {items.length}×</small></h3>
          <ul>
            {items.map((o) => {
              const kids = persons.filter((x) => o.event.personIds.includes(x.id) && x.id !== p.id);
              return (
                <li key={o.event.id + o.occStart}>
                  <button type="button" onClick={() => onOpen(o.event.id, o.occStart)}>
                    <span className="dl-when">{day(o.start)}{!o.event.allDay && <b> {o.start.slice(11)}</b>}</span>
                    <span className="dl-what"><span>{displayTitle(o.event)}</span>{o.event.location && <small className="hint">📍 {o.event.location}</small>}</span>
                    <span className="dl-who">{kids.map((k) => <Avatar key={k.id} person={k} size={22} />)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
