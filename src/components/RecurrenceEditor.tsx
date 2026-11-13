import type { Freq, Recurrence } from '../types';
import { describe, nthOfMonth } from '../lib/recurrence';
import { ORDINALS, WEEKDAYS, WEEKDAYS_SHORT, addDays, weekdayMo0 } from '../lib/dates';

const UNITS: Record<Freq, [string, string]> = {
  daily: ['Tag', 'Tage'],
  weekly: ['Woche', 'Wochen'],
  monthly: ['Monat', 'Monate'],
  yearly: ['Jahr', 'Jahre'],
};

export function RecurrenceEditor({ start, value, onChange }: { start: string; value?: Recurrence; onChange: (r?: Recurrence) => void }) {
  const wd = weekdayMo0(start);
  const day = Number(start.slice(8, 10));
  const nth = nthOfMonth(start);
  const set = (p: Partial<Recurrence>) => onChange({ ...(value as Recurrence), ...p });

  return (
    <div className="recurrence">
      <div className="seg">
        {(['none', 'daily', 'weekly', 'monthly', 'yearly'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={(value?.freq ?? 'none') === f ? 'on' : ''}
            onClick={() =>
              onChange(
                f === 'none'
                  ? undefined
                  : { freq: f, interval: value?.interval ?? 1, byWeekday: f === 'weekly' ? [wd] : undefined, monthlyMode: 'dayOfMonth', end: value?.end ?? { type: 'never' } },
              )
            }
          >
            {{ none: 'Nie', daily: 'Täglich', weekly: 'Wöchentl.', monthly: 'Monatl.', yearly: 'Jährlich' }[f]}
          </button>
        ))}
      </div>

      {value && (
        <>
          <div className="row">
            <span>Alle</span>
            <input type="number" min={1} max={99} className="num" value={value.interval}
              onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })} />
            <span>{UNITS[value.freq][value.interval === 1 ? 0 : 1]}</span>
          </div>

          {value.freq === 'weekly' && (
            <div className="weekdays">
              {WEEKDAYS_SHORT.map((w, i) => {
                const on = (value.byWeekday ?? [wd]).includes(i);
                return (
                  <button key={w} type="button" className={on ? 'on' : ''}
                    onClick={() => {
                      const cur = new Set(value.byWeekday ?? [wd]);
                      if (on) cur.delete(i); else cur.add(i);
                      if (cur.size === 0) cur.add(wd);
                      set({ byWeekday: [...cur].sort() });
                    }}>{w}</button>
                );
              })}
            </div>
          )}

          {(value.freq === 'monthly' || value.freq === 'yearly') && (
            <div className="radio-col">
              <label><input type="radio" checked={value.monthlyMode !== 'nthWeekday'} onChange={() => set({ monthlyMode: 'dayOfMonth' })} /> am {day}.</label>
              <label><input type="radio" checked={value.monthlyMode === 'nthWeekday'} onChange={() => set({ monthlyMode: 'nthWeekday' })} /> am {ORDINALS[nth - 1]} {WEEKDAYS[wd]}</label>
            </div>
          )}

          <div className="radio-col">
            <span className="label">Endet</span>
            <label><input type="radio" checked={value.end.type === 'never'} onChange={() => set({ end: { type: 'never' } })} /> nie</label>
            <label>
              <input type="radio" checked={value.end.type === 'until'} onChange={() => set({ end: { type: 'until', until: addDays(start.slice(0, 10), 90) } })} /> am
              {value.end.type === 'until' && (
                <input type="date" value={value.end.until} onChange={(e) => e.target.value && set({ end: { type: 'until', until: e.target.value } })} />
              )}
            </label>
            <label>
              <input type="radio" checked={value.end.type === 'count'} onChange={() => set({ end: { type: 'count', count: 10 } })} /> nach
              {value.end.type === 'count' && (
                <input type="number" className="num" min={1} value={value.end.count} onChange={(e) => set({ end: { type: 'count', count: Math.max(1, Number(e.target.value) || 1) } })} />
              )}
              Terminen
            </label>
          </div>
          <p className="hint">{describe(start, value)}</p>
        </>
      )}
    </div>
  );
}
