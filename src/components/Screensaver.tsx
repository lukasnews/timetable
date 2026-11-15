import { useEffect, useMemo, useState } from 'react';
import type { CalEvent, Person } from '../types';
import { expand } from '../lib/recurrence';
import { addDays, fromNative } from '../lib/dates';
import { displayTitle } from '../lib/categories';
import { weatherIcon, type DayWeather } from '../lib/weather';
import type { Countdown } from '../lib/countdown';
import { Avatar } from './ui';

interface Item { key: string; day: string; time: string; title: string; persons: Person[]; extra: string; color: string }

/** Kommende Termine heute (noch nicht vorbei) und morgen – inkl. Geburtstage aus den Profilen */
export function saverItems(events: CalEvent[], persons: Person[], now: string, max = 6): Item[] {
  const today = now.slice(0, 10);
  const tomorrow = addDays(today, 1);
  const bdays: CalEvent[] = persons.filter((p) => p.birthday).map((p) => ({
    id: 'bday-' + p.id, title: p.name, start: p.birthday!, end: addDays(p.birthday!, 1), allDay: true, personIds: [p.id], kind: 'birthday',
    birthYear: Number(p.birthday!.slice(0, 4)), recurrence: { freq: 'yearly', interval: 1, end: { type: 'never' } },
  }));
  return expand([...events, ...bdays], today, addDays(today, 2))
    .filter((o) => (o.event.allDay ? `${o.end}T00:00` : o.end) > now)
    .map((o) => ({ o, day: o.start.slice(0, 10) < today ? today : o.start.slice(0, 10) }))
    .sort((a, b) => a.day.localeCompare(b.day) || Number(b.o.event.allDay) - Number(a.o.event.allDay) || a.o.start.localeCompare(b.o.start))
    .slice(0, max)
    .map(({ o, day }) => {
      const ev = o.event;
      const ps = persons.filter((p) => ev.personIds.includes(p.id));
      const drivers = persons.filter((p) => ev.driverIds?.includes(p.id)).map((p) => p.name).join(', ');
      const age = ev.kind === 'birthday' && ev.birthYear ? Number(day.slice(0, 4)) - ev.birthYear : 0;
      return {
        key: ev.id + o.occStart,
        day: day === tomorrow ? 'morgen' : 'heute',
        time: ev.allDay ? 'ganzt.' : o.start.slice(11, 16),
        title: ev.kind === 'birthday' ? `🎂 ${ev.title}${age > 0 ? ` wird ${age}` : ''}` : displayTitle(ev),
        persons: ps,
        extra: [ev.bring && `🎒 ${ev.bring}`, drivers && `🚗 ${drivers}`, ev.location && `📍 ${ev.location}`].filter(Boolean).join(' · '),
        color: ps[0]?.color ?? 'var(--family)',
      };
    });
}

export function Screensaver({ variant, events, persons, weather, place, countdowns, onClose }: {
  variant: 'day' | 'night';
  events: CalEvent[];
  persons: Person[];
  weather: Record<string, DayWeather>;
  place?: string;
  countdowns: Countdown[];
  onClose: () => void;
}) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  const nowStr = fromNative(now, false);
  const today = nowStr.slice(0, 10);
  const items = useMemo(() => saverItems(events, persons, nowStr, variant === 'night' ? 1 : 6), [events, persons, nowStr, variant]);
  const time = now.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' });
  const w = weather[today];
  // Bildschirm schonen: Inhalt jede Minute minimal verschieben
  const shift = useMemo(() => { const m = now.getMinutes(); return `translate(${(m % 5) * 3 - 6}px, ${(m % 3) * 3 - 3}px)`; }, [now]);

  // Morgen abgeholt/fällig (z. B. Müll aus dem importierten Kalender)
  const tomorrowChips = useMemo(() => expand(events.filter((e) => e.importSource && e.allDay), addDays(today, 1), addDays(today, 2))
    .slice(0, 2).map((o) => `Morgen: ${displayTitle(o.event)}`), [events, today]);

  if (variant === 'night') {
    const next = items[0];
    return (
      <div className="saver saver-night" onClick={onClose} role="button" aria-label="Bildschirmschoner – antippen zum Schließen">
        <div className="sv-n-inner" style={{ transform: shift }}>
          <div className="sv-n-time">{time}</div>
          <div className="sv-n-date">{date}</div>
          {next && <div className="sv-n-next">{next.day === 'morgen' ? 'Morgen' : 'Heute'} {next.time !== 'ganzt.' && next.time} · {next.title}{next.persons.length ? ` (${next.persons.map((p) => p.name).join(', ')})` : ''}</div>}
        </div>
      </div>
    );
  }

  const heute = items.filter((i) => i.day === 'heute');
  const morgen = items.filter((i) => i.day === 'morgen');
  const row = (i: Item) => (
    <div key={i.key} className="sv-ev" style={{ ['--pc' as string]: i.color }}>
      <div className="sv-ev-time">{i.time}</div>
      <div className="sv-ev-body">
        <div className="sv-ev-title">{i.title}</div>
        {i.extra && <div className="sv-ev-extra">{i.extra}</div>}
      </div>
      <div className="sv-ev-who">{i.persons.slice(0, 3).map((p) => <Avatar key={p.id} person={p} size={44} />)}</div>
    </div>
  );
  return (
    <div className="saver saver-day" onClick={onClose} role="button" aria-label="Bildschirmschoner – antippen zum Schließen">
      <div className="sv-d-left" style={{ transform: shift }}>
        <div>
          <div className="sv-d-time">{time}</div>
          <div className="sv-d-date">{date}</div>
          {w && <div className="sv-d-wx">{weatherIcon(w.code)} {w.max}° / {w.min}°{place ? ` · ${place}` : ''}</div>}
        </div>
        <div className="sv-chips">
          {countdowns.map((c) => <span key={c.title + c.date} className="sv-chip">⏳ <b>{c.days === 1 ? 'Morgen' : `${c.days} Tage`}</b> bis {c.title}</span>)}
          {tomorrowChips.map((t) => <span key={t} className="sv-chip">{t}</span>)}
        </div>
      </div>
      <div className="sv-d-right">
        {heute.length > 0 && <div className="sv-head">Heute noch</div>}
        {heute.map(row)}
        {morgen.length > 0 && <div className="sv-head">Morgen</div>}
        {morgen.map(row)}
        {!items.length && <div className="sv-empty">Heute und morgen stehen keine Termine an. 🌿</div>}
      </div>
      <div className="sv-hint">Antippen zum Öffnen</div>
    </div>
  );
}
