import type { CalEvent, Person } from '../types';
import { Avatar, Icon, Modal } from './ui';
import { describe } from '../lib/recurrence';
import { addDays } from '../lib/dates';

const REMINDER_TEXT: Record<number, string> = {
  0: 'Zum Beginn', 5: '5 Minuten vorher', 15: '15 Minuten vorher', 30: '30 Minuten vorher', 60: '1 Stunde vorher',
  120: '2 Stunden vorher', 840: 'Am Vorabend, 18:00', 1440: '1 Tag vorher', 2880: '2 Tage vorher',
};

function when(ev: CalEvent, start: string, end: string): string {
  const d = (s: string) => new Date(s.slice(0, 10) + 'T12:00:00').toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' });
  if (ev.allDay) {
    const last = addDays(end, -1);
    return last === start ? `${d(start)}, ganztägig` : `${d(start)} – ${d(last)}`;
  }
  return start.slice(0, 10) === end.slice(0, 10)
    ? `${d(start)}, ${start.slice(11)}–${end.slice(11)} Uhr`
    : `${d(start)} ${start.slice(11)} – ${d(end)} ${end.slice(11)} Uhr`;
}

/** Nur-Lese-Ansicht eines Termins (bei gesperrtem Kalender) */
export function EventDetails(props: { event: CalEvent; start: string; end: string; persons: Person[]; conflicts?: import('../lib/conflicts').Conflict[]; onEdit: () => void; onClose: () => void }) {
  const ev = props.event;
  const ps = ev.personIds.map((id) => props.persons.find((p) => p.id === id)).filter(Boolean) as Person[];
  const age = ev.kind === 'birthday' && ev.birthYear ? Number(props.start.slice(0, 4)) - ev.birthYear : undefined;
  return (
    <Modal title={(ev.kind === 'birthday' ? '🎂 ' : '') + ev.title + (age ? ` (${age})` : '')} onClose={props.onClose}
      footer={<>
        <span className="spacer" />
        <button className="btn" onClick={props.onClose}>Schließen</button>
        <button className="btn primary" onClick={props.onEdit}><Icon name="edit" size={18} /> Bearbeiten</button>
      </>}>
      <div className="details">
        <p className="det-when">{when(ev, props.start, props.end)}</p>
        {(ev.recurrence || ev.seriesId) && <p className="det-row"><Icon name="repeat" size={16} /> {ev.recurrence ? describe(ev.start, ev.recurrence) : 'Geänderter Termin einer Serie'}</p>}
        <div className="det-persons">
          {ps.length ? ps.map((p) => (
            <span key={p.id} className="pick on" style={{ ['--pc' as string]: p.color }}><Avatar person={p} size={26} /> {p.name}</span>
          )) : <span className="hint">Ganze Familie</span>}
        </div>
        {!!ev.driverIds?.length && <p className="det-row">🚗 Fahrdienst: {ev.driverIds.map((id) => props.persons.find((p) => p.id === id)?.name).filter(Boolean).join(', ')}</p>}
        {props.conflicts?.map((c) => (
          <p key={c.person.id + c.title + c.start} className="det-row warn">⚠️ {c.person.name} hat gleichzeitig „{c.title}“ ({c.start.slice(11)}–{c.end.slice(11)})</p>
        ))}
        {ev.location && <p className="det-row"><Icon name="pin" size={16} /> {ev.location}</p>}
        {ev.reminderMinutes != null && <p className="det-row"><Icon name="bell" size={16} /> {REMINDER_TEXT[ev.reminderMinutes] ?? `${ev.reminderMinutes} Minuten vorher`}</p>}
        {ev.notes && <p className="det-notes">{ev.notes}</p>}
        {ev.importSource && <p className="hint">Importiert aus „{ev.importSource}“</p>}
      </div>
    </Modal>
  );
}
