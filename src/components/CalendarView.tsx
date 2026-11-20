import { forwardRef, useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import multiMonthPlugin from '@fullcalendar/multimonth';
import deLocale from '@fullcalendar/core/locales/de';
import type { DateClickArg } from '@fullcalendar/interaction';
import type { DateSelectArg, DatesSetArg, EventClickArg, EventContentArg, EventDropArg, EventMountArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import type { Person } from '../types';
import { useData } from '../data/DataContext';
import { buildEvents, type OccProps } from '../lib/calendarEvents';
import { focusRange, highlightKeys, scrollTimeFor, toSpanBars, visibleSpan } from '../lib/viewLogic';
import { addDays, fromNative } from '../lib/dates';
import { tint } from '../lib/avatars';
import { Avatar } from './ui';
import { useWeather, weatherIcon, weatherText, type DayWeather } from '../lib/weather';

export type ViewName = 'dayGridMonth' | 'timeGridWeek' | 'timeGridThree' | 'timeGridDay' | 'listUpcoming' | 'multiMonthYear' | 'timeGridFocus';

export interface ChangeInfo {
  eventId: string;
  occStart: string;
  start: string;
  end: string;
  allDay: boolean;
  revert: () => void;
}

interface Props {
  view: ViewName;
  selected: Set<string>;
  /** ausgeblendete importierte Kalender (importSource) */
  hiddenSources?: Set<string>;
  onRange: (viewType: string, start: Date, end: Date) => void;
  onOpen: (eventId: string, occStart: string) => void;
  onCreate: (start: string, end: string, allDay: boolean) => void;
  onChange: (c: ChangeInfo) => void;
  /** Klick auf einen Geburtstag aus einem Profil */
  onOpenBirthday?: (personId: string, date: string) => void;
  /** Klick auf einen Tag (Kopf/Zahl) → Tagesansicht */
  onNavDay: (date: Date) => void;
  /** gesperrt: kein Ziehen, kein Anlegen durch Tippen */
  locked: boolean;
  /** Druckansicht: volle Höhe, alle Termine, Tageszeit 6–22 Uhr */
  printing?: boolean;
}

const nowScrollTime = () => scrollTimeFor(new Date());

function stripe(persons: Person[]): string {
  if (persons.length === 0) return 'var(--family)';
  const step = 100 / persons.length;
  return `linear-gradient(180deg, ${persons.map((p, i) => `${p.color} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
}

export const CalendarView = forwardRef<FullCalendar, Props>(function CalendarView(props, ref) {
  const { events, persons, timetables, family, device } = useData();
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const byId = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons]);
  const weather = useWeather(family.weather, device.showWeather);
  const wx = (d: Date): DayWeather | undefined => weather[fromNative(d, true)];

  const isYear = props.view === 'multiMonthYear';
  const allEvents = useMemo(() => {
    if (!range) return [];
    return buildEvents({
      events: props.hiddenSources?.size ? events.filter((e) => !e.importSource || !props.hiddenSources!.has(e.importSource)) : events,
      persons, timetables, selected: props.selected, from: range.from, to: range.to,
      showHolidays: family.showHolidays, showSchoolHolidays: family.showSchoolHolidays, ferienRegion: family.ferienRegion,
      showSchool: device.showSchool && props.view !== 'multiMonthYear' && (props.view !== 'dayGridMonth' || device.schoolInMonth),
      schoolAsStrip: props.view !== 'dayGridMonth',
    });
  }, [events, persons, timetables, props.selected, props.hiddenSources, range, family.showHolidays, family.showSchoolHolidays, family.ferienRegion, props.view, device.schoolInMonth, device.showSchool]);
  // Jahresansicht: nur Ganztägiges (Ferien, Feiertage, Geburtstage, Urlaube …) als Balken – Termine mit Uhrzeit als Punkte am Tag
  // Ferien: im Jahr nur als grüne Einfärbung (die Balken würden sich jede Woche wiederholen)
  const isTimeGrid = props.view.startsWith('timeGrid');
  const fcEvents = useMemo(() => {
    if (isYear) return allEvents.filter((e) => (e.allDay || e.display === 'background') && !(e.display !== 'background' && (e.extendedProps as OccProps | undefined)?.kind === 'ferien'));
    if (!isTimeGrid) return allEvents;
    // Tag/Woche: Termine mit Uhrzeit über mehrere Tage oben in der Ganztags-Zeile als Balken (wie Google/Outlook)
    return toSpanBars(allEvents);
  }, [allEvents, isYear, isTimeGrid]);
  // Ganztags-Zeile nur zeigen, wenn etwas Ganztägiges im Zeitraum liegt (spart Platz)
  const hasAllDay = fcEvents.some((e) => e.allDay && e.display !== 'background');
  // heute: laufende Termine dezent, der nächste beginnende deutlich hervorheben (nur Termine mit Uhrzeit am selben Tag)
  const nowStr = fromNative(new Date(), false);
  const highlight = useMemo(() => highlightKeys(allEvents, nowStr), [allEvents, nowStr.slice(0, 15)]); // eslint-disable-line react-hooks/exhaustive-deps
  const yearDots = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!isYear) return m;
    for (const e of allEvents) {
      if (e.allDay || e.display === 'background' || typeof e.start !== 'string') continue;
      const x = e.extendedProps as OccProps;
      if (x.kind === 'school') continue;
      const d = e.start.slice(0, 10);
      const c = byId.get(x.personIds?.[0] ?? '')?.color ?? 'var(--family)';
      m.set(d, [...(m.get(d) ?? []), c]);
    }
    return m;
  }, [allEvents, isYear, byId]);

  // Sichtbarer Tagesbereich: eingestellt (Drucken: 6–22 Uhr), aber nie kürzer als die Termine im Zeitraum –
  // sonst wäre z. B. ein Termin um 22 Uhr bei „Tag endet 21 Uhr“ unsichtbar. Mehrtägige Termine zählen nicht.
  const span = useMemo(() => visibleSpan(allEvents,
    props.printing && device.dayStart < '06:00' ? '06:00' : device.dayStart,
    props.printing && device.dayEnd > '22:00' ? '22:00' : device.dayEnd), [allEvents, device.dayStart, device.dayEnd, props.printing]);

  // Tage mit Schulzeit (nur dort rechts Platz für die Schul-Streifen freihalten)
  const schoolDays = useMemo(() => new Set(fcEvents.filter((e) => (e.extendedProps as OccProps | undefined)?.kind === 'school' && typeof e.start === 'string')
    .map((e) => (e.start as string).slice(0, 10))), [fcEvents]);
  // Fokus-Woche: heute und die nächsten 2 Tage breiter
  const today = fromNative(new Date(), true);
  const focusDays = new Set([today, addDays(today, 1), addDays(today, 2)]);

  // Platz rechts im Tag für die Schul-Streifen
  const stripCount = device.showSchool && props.view !== 'dayGridMonth'
    ? new Set(fcEvents.filter((e) => (e.extendedProps as OccProps | undefined)?.kind === 'school').map((e) => (e.extendedProps as OccProps).stripIndex)).size
    : 0;

  const onDatesSet = (arg: DatesSetArg) => {
    const from = fromNative(arg.start, true);
    const to = fromNative(arg.end, true);
    setRange((r) => (r && r.from === from && r.to === to ? r : { from, to }));
    props.onRange(arg.view.type, arg.view.currentStart, arg.view.currentEnd);
  };

  const renderContent = (arg: EventContentArg) => {
    const x = arg.event.extendedProps as OccProps;
    if (arg.event.display === 'background') {
      if (x.kind === 'school') {
        const kid = byId.get(x.personIds[0]);
        return (
          <div className="school-strip" title={`${arg.event.title} ${x.timeText}`}>
            {kid && <Avatar person={kid} size={18} />}
            <span className="school-time">{x.timeText}</span>
          </div>
        );
      }
      return null;
    }
    const ps = (x.personIds ?? []).map((id) => byId.get(id)).filter(Boolean) as Person[];
    if (x.kind === 'holiday') return <div className="ev-inner" title={arg.event.title}><span className="ev-title">🇦🇹 {arg.event.title}</span></div>;
    if (x.kind === 'ferien') return <div className="ev-inner" title={arg.event.title}><span className="ev-title">🏖️ {arg.event.title}</span></div>;
    const title =
      x.kind === 'birthday' || x.kind === 'personBirthday'
        ? `${x.kind === 'personBirthday' ? '🎂 ' : ''}${arg.event.title}${x.age !== undefined && x.age > 0 ? ` (${x.age})` : ''}`
        : x.kind === 'school' ? `🏫 ${arg.timeText}` : arg.event.title;
    if (x.spanText) {
      return (
        <div className="ev-inner ev-span">
          {ps.length > 0 && <span className="ev-avatars">{ps.slice(0, 4).map((p) => <Avatar key={p.id} person={p} size={20} />)}</span>}
          <span className="ev-title">{title}</span>
          <span className="ev-span-time">{x.spanText}</span>
        </div>
      );
    }
    const compact = arg.view.type === 'dayGridMonth' || arg.view.type === 'multiMonthYear';
    const isList = arg.view.type.startsWith('list');
    // Tag/Woche: Gesichter – Uhrzeit – Titel (2 Zeilen); kurze Termine verdichten sich per CSS (Container-Abfrage auf die Höhe)
    if (arg.view.type.startsWith('timeGrid') && !arg.event.allDay && x.kind !== 'school') {
      // mehrtägig: in jedem Tagesstück die echte Dauer („Fr 14:15 – So 11:00“) statt nur des sichtbaren Stücks
      const st = arg.event.start, en = arg.event.end;
      let timeText = arg.timeText;
      if (st && en && fromNative(st, true) !== fromNative(new Date(en.getTime() - 1), true)) {
        const wd = (d: Date) => d.toLocaleDateString('de-AT', { weekday: 'short' }).replace('.', '');
        const hm = (d: Date) => d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
        timeText = `${wd(st)} ${hm(st)} – ${wd(en)} ${hm(en)}`;
      }
      return (
        <div className="ev-inner tg">
          {/* mitwandernd: bleibt beim Scrollen oben sichtbar (lange bzw. mehrtägige Termine) */}
          <div className="ev-tg-body">
          <div className="ev-tg-head">
            {ps.length > 0 && <span className="ev-avatars">{ps.slice(0, 4).map((p) => <Avatar key={p.id} person={p} size={24} />)}</span>}
            <span className="ev-time">{timeText}</span>
            {x.recurring && <span className="ev-rec" title="Serie">↻</span>}
          </div>
          <span className="ev-title">{title}</span>
          {x.location && <span className="ev-loc">📍 {x.location}</span>}
          {x.bring && <span className="ev-loc">🎒 {x.bring}</span>}
          {!!x.driverIds?.length && <span className="ev-loc">🚗 {x.driverIds.map((id) => byId.get(id)?.name).filter(Boolean).join(', ')}</span>}
          </div>
        </div>
      );
    }
    return (
      <div className={'ev-inner' + (compact ? ' compact' : '')}>
        {ps.length > 0 && (
          <span className="ev-avatars">
            {ps.slice(0, 4).map((p) => <Avatar key={p.id} person={p} size={compact ? 18 : 22} />)}
          </span>
        )}
        <span className="ev-text">
          {!arg.event.allDay && x.kind !== 'school' && !isList && <span className="ev-time">{arg.timeText}</span>}
          <span className="ev-title">{title}</span>
          {!compact && x.location && <span className="ev-loc">📍 {x.location}</span>}
          {!compact && x.bring && <span className="ev-loc">🎒 {x.bring}</span>}
          {!compact && !!x.driverIds?.length && <span className="ev-loc">🚗 {x.driverIds.map((id) => byId.get(id)?.name).filter(Boolean).join(', ')}</span>}
        </span>
        {x.recurring && !compact && <span className="ev-rec" title="Serie">↻</span>}
      </div>
    );
  };

  const onMount = (arg: EventMountArg) => {
    const x = arg.event.extendedProps as OccProps;
    if (arg.event.display === 'background') {
      if (x.kind === 'school') {
        const kid = byId.get(x.personIds[0]);
        // Position gehört an den Container (Harness), Farbe an den Streifen
        arg.el.parentElement?.style.setProperty('--strip-i', String(x.stripIndex ?? 0));
        if (kid) arg.el.style.setProperty('--pc', kid.color);
      }
      return;
    }
    const ps = (x.personIds ?? []).map((id) => byId.get(id)).filter(Boolean) as Person[];
    arg.el.style.setProperty('--stripe', stripe(ps));
    arg.el.style.setProperty('--evbg', ps.length ? tint(ps[0].color, 0.8) : 'var(--family-bg)');
    arg.el.style.setProperty('--evbg-dark', ps.length ? ps[0].color + '40' : 'var(--family-bg)');
  };

  const toChange = (arg: EventDropArg | EventResizeDoneArg) => {
    const x = arg.event.extendedProps as OccProps;
    if (!x.eventId || !arg.event.start) return arg.revert();
    const allDay = arg.event.allDay;
    let end = arg.event.end;
    if (!end) {
      end = new Date(arg.event.start);
      if (allDay) end.setDate(end.getDate() + 1);
      else end.setHours(end.getHours() + 1);
    }
    props.onChange({
      eventId: x.eventId,
      occStart: x.occStart!,
      start: fromNative(arg.event.start, allDay),
      end: fromNative(end, allDay),
      allDay,
      revert: arg.revert,
    });
  };

  const isPhone = typeof window !== 'undefined' && window.innerWidth < 640;
  // stabil halten: neue Ansichts-Definitionen bei jedem Zeichnen würden FullCalendar zurücksetzen
  const views = useMemo(() => ({
    listUpcoming: { type: 'list', duration: { days: 30 }, displayEventEnd: !isPhone },
    timeGridThree: { type: 'timeGrid', duration: { days: 3 } },
    // Fokus-Woche: 7 Tage ab gestern; heute + 2 Tage breiter (CSS .fk-focus)
    timeGridFocus: { type: 'timeGrid', visibleRange: focusRange, dateIncrement: { days: 7 }, dateAlignment: 'day' },
    multiMonthYear: { type: 'multiMonth', duration: { years: 1 }, multiMonthMaxColumns: 4, multiMonthMinWidth: 230, showNonCurrentDates: false, fixedWeekCount: false, dayMaxEvents: 2, moreLinkText: (n: number) => `+${n}` },
  }), [isPhone]);

  return (
    <div className={'cal-inner' + (device.schoolTimes ? '' : ' strips-slim') + (device.rowHeight && device.rowHeight !== 'normal' ? ' rows-' + device.rowHeight : '')} style={{ ['--strips' as string]: stripCount }}>
    <FullCalendar
      ref={ref}
      plugins={[dayGridPlugin, timeGridPlugin, listPlugin, multiMonthPlugin, interactionPlugin]}
      views={views}
      listDayFormat={{ weekday: 'long', day: 'numeric', month: 'long' }}
      listDaySideFormat={false}
      noEventsContent="Keine Termine in den nächsten 30 Tagen"
      dayCellContent={(arg) => {
        if (arg.view.type === 'multiMonthYear') {
          const dots = yearDots.get(fromNative(arg.date, true)) ?? [];
          return (
            <span className="yc">
              <span className="yc-num">{arg.dayNumberText}</span>
              {dots.length > 0 && <span className="yc-dots" title={`${dots.length} Termin(e)`}>{dots.slice(0, 3).map((c, i) => <i key={i} style={{ background: c }} />)}</span>}
            </span>
          );
        }
        if (arg.view.type !== 'dayGridMonth') return arg.dayNumberText;
        const w = wx(arg.date);
        return (
          <span className="dc">
            {w && <span className="dc-wx" title={`${weatherText(w.code)} ${w.min}°/${w.max}°`}>{weatherIcon(w.code)}</span>}
            <span className="dc-num">{arg.dayNumberText}</span>
          </span>
        );
      }}
      initialView={props.view}
      locale={deLocale}
      firstDay={1}
      weekNumbers={!(isPhone && props.view === 'dayGridMonth') && !isYear}
      weekText="KW"
      weekTextLong="Kalenderwoche"
      headerToolbar={false}
      height={props.printing ? 'auto' : '100%'}
      nowIndicator
      editable={!props.locked && !isYear}
      selectable={!props.locked && !isYear}
      selectMirror
      eventResizableFromStart
      longPressDelay={350}
      eventLongPressDelay={350}
      selectLongPressDelay={500}
      dayMaxEvents={props.printing ? false : isPhone ? 3 : 5}
      moreLinkText={(n) => `+${n} weitere`}
      allDayText="Ganzt."
      slotMinTime={span.min + ':00'}
      slotMaxTime={span.max + ':00'}
      scrollTime={nowScrollTime()}
      // scrollTime greift nicht zuverlässig, wenn die Höhe beim ersten Zeichnen noch 0 ist (Handy/App) – darum nachziehen
      viewDidMount={(arg) => { if (arg.view.type.startsWith('timeGrid')) setTimeout(() => arg.view.calendar.scrollToTime(nowScrollTime()), 150); }}
      slotDuration="00:30:00"
      expandRows={!props.printing}
      allDaySlot={hasAllDay}
      // gleichzeitige Termine nebeneinander statt versetzt übereinander (nichts wird verdeckt)
      slotEventOverlap={false}
      eventClassNames={(arg) => {
        const x = arg.event.extendedProps as OccProps;
        if (!x.eventId) return [];
        const key = `${x.eventId}|${x.occStart}`;
        return key === highlight.next ? ['ev-next'] : highlight.running.has(key) ? ['ev-now'] : [];
      }}
      snapDuration="00:15:00"
      slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
      eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
      dayHeaderFormat={{ weekday: 'short' }}
      dayHeaderContent={(arg) => {
        if (arg.view.type.startsWith('list')) return arg.text;
        if (props.view === 'dayGridMonth' || isYear) return <span className="dh-wd">{arg.date.toLocaleDateString('de-AT', { weekday: 'short' }).replace('.', '')}</span>;
        if (props.view === 'listUpcoming') return arg.text;
        const w = wx(arg.date);
        return (
          <span className={'dh' + (arg.isToday ? ' today' : '')}>
            <span className="dh-wd">{arg.date.toLocaleDateString('de-AT', { weekday: props.view === 'timeGridDay' && !isPhone ? 'long' : 'short' }).replace('.', '')}</span>
            <span className="dh-d">{arg.date.getDate()}</span>
            {w && (
              <span className="dh-wx" title={weatherText(w.code)}>
                {weatherIcon(w.code)} {w.max}°{props.view === 'timeGridDay' && <span className="dh-min"> / {w.min}°</span>}
              </span>
            )}
          </span>
        );
      }}
      events={fcEvents}
      datesSet={onDatesSet}
      eventContent={renderContent}
      eventDidMount={onMount}
      eventOrder={(a: any, b: any) => {
        const rank = (e: any) => ({ holiday: 0, ferien: 1 } as Record<string, number>)[e.extendedProps?.kind] ?? 2;
        return rank(a) - rank(b) || a.start - b.start || b.duration - a.duration || String(a.title).localeCompare(String(b.title));
      }}
      eventClick={(arg: EventClickArg) => {
        const x = arg.event.extendedProps as OccProps;
        if (x.eventId) props.onOpen(x.eventId, x.occStart!);
        else if (x.kind === 'personBirthday' && x.personIds[0] && arg.event.start) props.onOpenBirthday?.(x.personIds[0], fromNative(arg.event.start, true));
      }}
      select={(arg: DateSelectArg) => {
        props.onCreate(fromNative(arg.start, arg.allDay), fromNative(arg.end, arg.allDay), arg.allDay);
        (ref as React.RefObject<FullCalendar>)?.current?.getApi().unselect();
      }}
      eventDrop={toChange}
      eventResize={toChange}
      navLinks
      navLinkDayClick={(date) => props.onNavDay(date)}
      dateClick={(arg: DateClickArg) => { if (isYear) props.onNavDay(arg.date); }}
      dayCellClassNames={(arg) => {
        const d = fromNative(arg.date, true);
        return [schoolDays.has(d) ? 'has-school' : '', focusDays.has(d) ? 'fk-focus' : ''].filter(Boolean);
      }}
      dayHeaderClassNames={(arg) => (focusDays.has(fromNative(arg.date, true)) ? ['fk-focus'] : [])}
    />
    </div>
  );
});
