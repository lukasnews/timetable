import { useState } from 'react';
import { Icon } from './ui';
import { MAX_REMINDERS, reminderLabel } from '../lib/reminderList';

const TIMED = [0, 5, 10, 15, 30, 45, 60, 120, 1440, 2880];
const ALL_DAY = [0, 840, 1440, 2880, 10080];
const UNITS: [number, string][] = [[1, 'Minuten'], [60, 'Stunden'], [1440, 'Tage'], [10080, 'Wochen']];

/** Mehrere Erinnerungen pro Termin: Auswahl als Chips, „＋“ mit Vorschlägen und eigener Zeit */
export function ReminderPicker(props: { value: number[]; allDay: boolean; onChange: (v: number[]) => void }) {
  const { value, allDay } = props;
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [amount, setAmount] = useState('20');
  const [unit, setUnit] = useState(1);
  const sorted = [...value].sort((a, b) => a - b);
  const add = (m: number) => {
    if (!value.includes(m)) props.onChange([...value, m]);
    setOpen(false); setCustom(false);
  };
  const full = value.length >= MAX_REMINDERS;
  const n = Number(amount.replace(',', '.'));
  const customMin = Math.round(n * unit);
  const customOk = Number.isFinite(n) && n > 0 && customMin <= 60 * 1440;
  return (
    <div className="reminder-picker">
      <div className="reminder-chips">
        {sorted.length === 0 && <span className="hint">Keine</span>}
        {sorted.map((m) => (
          <span key={m} className="reminder-chip">
            {reminderLabel(m, allDay)}
            <button type="button" aria-label={`Erinnerung „${reminderLabel(m, allDay)}“ entfernen`} onClick={() => props.onChange(value.filter((x) => x !== m))}>✕</button>
          </span>
        ))}
        {!full && (
          <button type="button" className="btn small" aria-label="Erinnerung hinzufügen" aria-expanded={open} onClick={() => { setOpen(!open); setCustom(false); }}>
            <Icon name="plus" size={16} /> Erinnerung
          </button>
        )}
      </div>
      {open && (
        <div className="reminder-menu" role="group" aria-label="Erinnerung wählen">
          {(allDay ? ALL_DAY : TIMED).filter((m) => !value.includes(m)).map((m) => (
            <button key={m} type="button" className="btn small" onClick={() => add(m)}>{reminderLabel(m, allDay)}</button>
          ))}
          {!custom ? (
            <button type="button" className="btn small" onClick={() => setCustom(true)}><Icon name="plus" size={14} /> Eigene …</button>
          ) : (
            <div className="reminder-custom">
              <input type="number" inputMode="decimal" min={1} aria-label="Wie lange vorher" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
              <select aria-label="Einheit" value={unit} onChange={(e) => setUnit(Number(e.target.value))}>
                {UNITS.map(([f, l]) => <option key={f} value={f}>{l}</option>)}
              </select>
              <span>vorher</span>
              <button type="button" className="btn small primary" disabled={!customOk || value.includes(customMin)} onClick={() => add(customMin)}>Hinzufügen</button>
            </div>
          )}
        </div>
      )}
      {full && <small className="hint">Höchstens {MAX_REMINDERS} Erinnerungen pro Termin.</small>}
    </div>
  );
}
