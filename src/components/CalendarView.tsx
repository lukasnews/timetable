import { forwardRef, useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import deLocale from '@fullcalendar/core/locales/de';
import type { DateSelectArg, DatesSetArg, EventClickArg, EventContentArg, EventDropArg, EventMountArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import type { Person } from '../types';
import { useData } from '../data/DataContext';
import { buildEvents, type OccProps } from '../lib/calendarEvents';
import { fromNative } from '../lib/dates';
import { tint } from '../lib/avatars';
import { Avatar } from './ui';
import { useWeather, weatherIcon, weatherText, type DayWeather } from '../lib/weather';

export type ViewName = 'dayGridMonth' | 'timeGridWeek' | 'timeGridThree' | 'timeGridDay' | 'listUpcoming';

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
  onRange: (viewType: string, start: Date, end: Date) => void;
  onOpen: (eventId: string, occStart: string) => void;
  onCreate: (start: string, end: string, allDay: boolean) => void;
  onChange: (c: ChangeInfo) => void;
  /** Klick auf einen Tag (Kopf/Zahl) → Tagesansicht */
  onNavDay: (date: Date) => void;
  /** gesperrt: kein Ziehen, kein Anlegen durch Tippen */
  locked: boolean;
}

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

  const fcEvents = useMemo(() => {
    if (!range) return [];
    return buildEvents({
      events, persons, timetables, selected: props.selected, from: range.from, to: range.to,
      showHolidays: family.showHolidays, showSchoolHolidays: family.showSchoolHolidays,
      showSchool: device.showSchool && (props.view !== 'dayGridMonth' || device.schoolInMonth),
      schoolAsStrip: props.view !== 'dayGridMonth',
    });
  }, [events, persons, timetables, props.selected, range, family.showHolidays, family.showSchoolHolidays, props.view, device.schoolInMonth, device.showSchool]);

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
        ? `🎂 ${arg.event.title}${x.age !== undefined && x.age > 0 ? ` (${x.age})` : ''}`
        : x.kind === 'school' ? `🏫 ${arg.timeText}` : arg.event.title;
    const compact = arg.view.type === 'dayGridMonth';
    const isList = arg.view.type.startsWith('list');
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

  return (
    <div className="cal-inner" style={{ ['--strips' as string]: stripCount }}>
    <FullCalendar
      ref={ref}
      plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
      views={{ listUpcoming: { type: 'list', duration: { days: 30 } }, timeGridThree: { type: 'timeGrid', duration: { days: 3 } } }}
      listDayFormat={{ weekday: 'long', day: 'numeric', month: 'long' }}
      listDaySideFormat={false}
      noEventsContent="Keine Termine in den nächsten 30 Tagen"
      dayCellContent={(arg) => {
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
      weekNumbers={!(isPhone && props.view === 'dayGridMonth')}
      weekText="KW"
      weekTextLong="Kalenderwoche"
      headerToolbar={false}
      height="100%"
      nowIndicator
      editable={!props.locked}
      selectable={!props.locked}
      selectMirror
      eventResizableFromStart
      longPressDelay={350}
      eventLongPressDelay={350}
      selectLongPressDelay={500}
      dayMaxEvents={isPhone ? 2 : 4}
      moreLinkText={(n) => `+${n} weitere`}
      allDayText="Ganzt."
      slotMinTime={device.dayStart + ':00'}
      slotMaxTime={device.dayEnd + ':00'}
      scrollTime={new Date().getHours() > 1 ? `${String(Math.max(0, new Date().getHours() - 1)).padStart(2, '0')}:00:00` : '07:00:00'}
      slotDuration="00:30:00"
      snapDuration="00:15:00"
      slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
      eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
      dayHeaderFormat={{ weekday: 'short' }}
      dayHeaderContent={(arg) => {
        if (arg.view.type.startsWith('list')) return arg.text;
        if (props.view === 'dayGridMonth') return <span className="dh-wd">{arg.date.toLocaleDateString('de-AT', { weekday: 'short' }).replace('.', '')}</span>;
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
        return rank(a) - rank(b);
      }}
      eventClick={(arg: EventClickArg) => {
        const x = arg.event.extendedProps as OccProps;
        if (x.eventId) props.onOpen(x.eventId, x.occStart!);
      }}
      select={(arg: DateSelectArg) => {
        props.onCreate(fromNative(arg.start, arg.allDay), fromNative(arg.end, arg.allDay), arg.allDay);
        (ref as React.RefObject<FullCalendar>)?.current?.getApi().unselect();
      }}
      eventDrop={toChange}
      eventResize={toChange}
      navLinks
      navLinkDayClick={(date) => props.onNavDay(date)}
    />
    </div>
  );
});
