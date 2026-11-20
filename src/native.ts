/**
 * Android-App (Capacitor): Erinnerungen direkt am Gerät und die Zurück-Taste.
 * Im Browser passiert hier nichts.
 */
import { Capacitor } from '@capacitor/core';
import type { CalEvent, DeviceSettings, Person } from './types';
import { expand } from './lib/recurrence';
import { addDays, addMinutes, fromNative, parseLocal } from './lib/dates';
import { displayTitle } from './lib/categories';

export const isNative = () => Capacitor.isNativePlatform();

/** Wie weit im Voraus geplant wird (Android erlaubt nur eine begrenzte Zahl geplanter Alarme) */
const DAYS_AHEAD = 14;
const MAX_SCHEDULED = 80;

const hashId = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000 || 1;
};

export async function nativeNotifyPermission(ask: boolean): Promise<'granted' | 'denied' | 'prompt'> {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  let p = await LocalNotifications.checkPermissions();
  if (p.display !== 'granted' && ask) p = await LocalNotifications.requestPermissions();
  return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt';
}

/** Fällige Erinnerungen der nächsten Tage berechnen (rein, testbar) */
export function plannedReminders(events: CalEvent[], persons: Person[], device: Pick<DeviceSettings, 'reminderPersons'>, now: string) {
  const today = now.slice(0, 10);
  const bdays: CalEvent[] = persons.filter((p) => p.birthday && p.birthdayReminder != null).map((p) => ({
    id: 'bday-' + p.id, title: p.name, start: p.birthday!, end: addDays(p.birthday!, 1), allDay: true, personIds: [], kind: 'birthday',
    birthYear: Number(p.birthday!.slice(0, 4)), reminderMinutes: p.birthdayReminder, recurrence: { freq: 'yearly', interval: 1, end: { type: 'never' } },
  }));
  const sel = device.reminderPersons;
  const out: { id: number; at: string; title: string; body: string }[] = [];
  for (const o of expand([...events.filter((e) => e.reminderMinutes != null), ...bdays], addDays(today, -3), addDays(today, DAYS_AHEAD + 3))) {
    const ev = o.event;
    if (sel.length && (ev.personIds.length || ev.driverIds?.length) && ![...ev.personIds, ...(ev.driverIds ?? [])].some((id) => sel.includes(id))) continue;
    const at = addMinutes(ev.allDay ? `${o.start}T08:00` : o.start, -(ev.reminderMinutes ?? 0));
    if (at <= now || at > `${addDays(today, DAYS_AHEAD)}T23:59`) continue;
    const day = o.start.slice(0, 10);
    const dayText = day === at.slice(0, 10) ? 'Heute' : day === addDays(at.slice(0, 10), 1) ? 'Morgen' : day.split('-').reverse().join('.');
    const names = persons.filter((p) => ev.personIds.includes(p.id)).map((p) => p.name).join(', ');
    const drivers = persons.filter((p) => ev.driverIds?.includes(p.id)).map((p) => p.name).join(', ');
    const age = ev.kind === 'birthday' && ev.birthYear ? Number(day.slice(0, 4)) - ev.birthYear : 0;
    out.push({
      id: hashId(`${ev.id}|${o.occStart}|${ev.reminderMinutes}`),
      at,
      title: ev.kind === 'birthday' ? `🎂 ${ev.title}${age > 0 ? ` wird ${age}` : ''}` : displayTitle(ev),
      body: [`${dayText}, ${ev.allDay ? 'ganztägig' : `${o.start.slice(11)} Uhr`}`, names, drivers && `🚗 ${drivers}`, ev.bring && `🎒 ${ev.bring}`, ev.location && `📍 ${ev.location}`]
        .filter(Boolean).join(' · '),
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at)).slice(0, MAX_SCHEDULED);
}

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const wdOf = (d: string) => WD[new Date(d + 'T12:00:00').getDay()];

/** Tages-/Wochenübersicht als geplante Benachrichtigungen am Gerät (rein, testbar) */
export function plannedDigests(events: CalEvent[], persons: Person[], device: Pick<DeviceSettings, 'reminderPersons' | 'dailyDigest' | 'weeklyDigest'>, now: string) {
  const out: { id: number; at: string; title: string; body: string; largeBody?: string }[] = [];
  const daily = device.dailyDigest && /^\d\d:\d\d$/.test(device.dailyDigest) ? device.dailyDigest : '';
  if (!daily && !device.weeklyDigest) return out;
  const today = now.slice(0, 10);
  const sel = device.reminderPersons;
  const bdays: CalEvent[] = persons.filter((p) => p.birthday).map((p) => ({
    id: 'bday-' + p.id, title: '🎂 ' + p.name, start: p.birthday!, end: addDays(p.birthday!, 1), allDay: true, personIds: [], kind: 'birthday',
    recurrence: { freq: 'yearly', interval: 1, end: { type: 'never' } },
  }));
  const occ = expand([...events, ...bdays], today, addDays(today, DAYS_AHEAD + 8))
    .filter((o) => { const ev = o.event; return !sel.length || !(ev.personIds.length || ev.driverIds?.length) || [...ev.personIds, ...(ev.driverIds ?? [])].some((id) => sel.includes(id)); })
    .sort((a, b) => Number(b.event.allDay) - Number(a.event.allDay) || a.start.localeCompare(b.start));
  const names = (ev: CalEvent) => persons.filter((p) => ev.personIds.includes(p.id)).map((p) => p.name).join(', ');
  const line = (o: (typeof occ)[number], withDay: boolean) => {
    const ev = o.event;
    const day = o.start.slice(0, 10);
    const who = names(ev);
    return `${withDay ? wdOf(day) + ' ' : ''}${ev.allDay ? 'ganztägig' : o.start.slice(11, 16)} ${ev.kind === 'birthday' ? ev.title : displayTitle(ev)}${who ? ` (${who})` : ''}`;
  };
  const onDay = (d: string) => occ.filter((o) => (o.event.allDay ? o.start.slice(0, 10) <= d && o.end.slice(0, 10) > d : o.start.slice(0, 10) === d));
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const d = addDays(today, i);
    if (daily) {
      const at = `${d}T${daily}`;
      const list = onDay(d);
      if (at > now && list.length) {
        const lines = list.map((o) => line(o, false));
        out.push({ id: hashId('digest-d|' + d), at, title: `Heute: ${list.length} ${list.length === 1 ? 'Termin' : 'Termine'}`,
          body: lines.slice(0, 3).join(' · ') + (lines.length > 3 ? ' …' : ''), largeBody: lines.join('\n') });
      }
    }
    if (device.weeklyDigest && new Date(d + 'T12:00:00').getDay() === 0) {
      const at = `${d}T18:00`;
      const week = Array.from({ length: 7 }, (_, k) => addDays(d, k + 1));
      const list = week.flatMap((w) => onDay(w).map((o) => ({ o, w })));
      if (at > now && list.length) {
        const lines = list.map(({ o, w }) => line({ ...o, start: o.event.allDay ? w : o.start }, true));
        out.push({ id: hashId('digest-w|' + d), at, title: `Nächste Woche: ${list.length} ${list.length === 1 ? 'Termin' : 'Termine'}`,
          body: lines.slice(0, 3).join(' · ') + (lines.length > 3 ? ' …' : ''), largeBody: lines.join('\n') });
      }
    }
  }
  return out;
}

let lastPlan = '';
/** Geplante Erinnerungen am Gerät auf den aktuellen Stand bringen */
export async function syncNativeReminders(events: CalEvent[], persons: Person[], device: DeviceSettings) {
  if (!isNative()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const now = fromNative(new Date(), false);
  const wantDigest = !!device.dailyDigest || !!device.weeklyDigest;
  const plan = (device.reminders || wantDigest) && (await nativeNotifyPermission(false)) === 'granted'
    ? [...(device.reminders ? plannedReminders(events, persons, device, now) : []), ...plannedDigests(events, persons, device, now)]
      .sort((a, b) => a.at.localeCompare(b.at)).slice(0, MAX_SCHEDULED) : [];
  const key = JSON.stringify(plan);
  if (key === lastPlan) return;
  lastPlan = key;
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  if (!plan.length) return;
  await LocalNotifications.schedule({
    notifications: plan.map((n) => ({
      id: n.id, title: n.title, body: n.body, ...((n as { largeBody?: string }).largeBody ? { largeBody: (n as { largeBody?: string }).largeBody } : {}), schedule: { at: parseLocal(n.at), allowWhileIdle: true },
      smallIcon: 'ic_stat_notify', iconColor: '#b8611c',
    })),
  });
}

/** Zurück-Taste: offenen Dialog schließen, sonst die App in den Hintergrund */
export async function setupBackButton() {
  if (!isNative()) return;
  const { App } = await import('@capacitor/app');
  App.addListener('backButton', () => {
    if (document.querySelector('.modal-backdrop, .modal')) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    } else {
      App.minimizeApp();
    }
  });
  // Beim Zurückkehren in die App: Erinnerungen neu planen (z. B. nach Änderungen anderer Familienmitglieder)
  App.addListener('resume', () => window.dispatchEvent(new Event('fk-resume')));
}


/* ---------------- Startbildschirm-Widget ---------------- */

interface FamilyWidgetPlugin { update(o: { items: string }): Promise<void> }
let widgetPlugin: FamilyWidgetPlugin | null = null;

/** Nächste Termine für das Widget (rein, testbar) */
export function widgetItems(events: CalEvent[], persons: Person[], now: string, days = 7, max = 12) {
  const today = now.slice(0, 10);
  const bdays: CalEvent[] = persons.filter((p) => p.birthday).map((p) => ({
    id: 'bday-' + p.id, title: p.name, start: p.birthday!, end: addDays(p.birthday!, 1), allDay: true, personIds: [p.id], kind: 'birthday',
    birthYear: Number(p.birthday!.slice(0, 4)), recurrence: { freq: 'yearly', interval: 1, end: { type: 'never' } },
  }));
  return expand([...events, ...bdays], today, addDays(today, days))
    .filter((o) => (o.event.allDay ? `${o.end}T00:00` : o.end) > now)
    .sort((a, b) => {
      const da = a.start.slice(0, 10) < today ? today : a.start.slice(0, 10);
      const db = b.start.slice(0, 10) < today ? today : b.start.slice(0, 10);
      // je Tag: ganztägige zuerst, dann nach Uhrzeit
      return da.localeCompare(db) || Number(b.event.allDay) - Number(a.event.allDay) || a.start.localeCompare(b.start);
    })
    .slice(0, max)
    .map((o) => {
      const ev = o.event;
      const ps = persons.filter((p) => ev.personIds.includes(p.id));
      const age = ev.kind === 'birthday' && ev.birthYear ? Number(o.start.slice(0, 4)) - ev.birthYear : 0;
      return {
        date: o.start.slice(0, 10) < today ? today : o.start.slice(0, 10),
        time: ev.allDay ? '' : o.start.slice(11, 16),
        end: ev.allDay ? `${o.end}T00:00` : o.end,
        title: ev.kind === 'birthday' ? `🎂 ${ev.title}${age > 0 ? ` wird ${age}` : ''}` : displayTitle(ev),
        who: ev.kind === 'birthday' ? '' : ps.map((p) => p.name).join(', '),
        color: ps[0]?.color ?? '#94a3b8',
      };
    });
}

let lastWidget = '';
export async function syncWidget(events: CalEvent[], persons: Person[]) {
  if (!isNative()) return;
  if (!widgetPlugin) {
    const { registerPlugin } = await import('@capacitor/core');
    widgetPlugin = registerPlugin<FamilyWidgetPlugin>('FamilyWidget');
  }
  const items = JSON.stringify(widgetItems(events, persons, fromNative(new Date(), false)));
  if (items === lastWidget) return;
  lastWidget = items;
  await widgetPlugin.update({ items });
}

/* ---------------- Kiosk: Status- und Navigationsleiste ausblenden ---------------- */

export async function setSystemBarsHidden(hidden: boolean) {
  if (!isNative()) return;
  const { SystemBars } = await import('@capacitor/core');
  if (hidden) await SystemBars.hide();
  else await SystemBars.show();
}

/* ---------------- Drucken in der App ---------------- */

interface AppPrintPlugin { print(o: { name: string; landscape?: boolean }): Promise<void> }
let printPlugin: AppPrintPlugin | null = null;

/** Öffnet den Android-Druckdialog mit der aktuellen Seite. false = App zu alt (Plugin fehlt). */
export async function nativePrint(name: string): Promise<boolean> {
  if (!printPlugin) {
    const { registerPlugin } = await import('@capacitor/core');
    printPlugin = registerPlugin<AppPrintPlugin>('AppPrint');
  }
  try {
    await printPlugin.print({ name, landscape: true });
    return true;
  } catch (e) {
    console.warn('Drucken', e);
    return false;
  }
}
