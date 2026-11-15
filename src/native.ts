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
const MAX_SCHEDULED = 60;

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

let lastPlan = '';
/** Geplante Erinnerungen am Gerät auf den aktuellen Stand bringen */
export async function syncNativeReminders(events: CalEvent[], persons: Person[], device: DeviceSettings) {
  if (!isNative()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const plan = device.reminders && (await nativeNotifyPermission(false)) === 'granted'
    ? plannedReminders(events, persons, device, fromNative(new Date(), false)) : [];
  const key = JSON.stringify(plan);
  if (key === lastPlan) return;
  lastPlan = key;
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  if (!plan.length) return;
  await LocalNotifications.schedule({
    notifications: plan.map((n) => ({
      id: n.id, title: n.title, body: n.body, schedule: { at: parseLocal(n.at), allowWhileIdle: true },
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
