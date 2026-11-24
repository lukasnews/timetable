import { withFeb29 } from './lib/birthdays';
import { remindersOf } from './lib/reminderList';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CalEvent, DeviceSettings, Person } from './types';
import { expand } from './lib/recurrence';
import { addDays, addMinutes, fromNative, todayLocal } from './lib/dates';

export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

/** Bildschirm wach halten (Wake Lock API) */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const req = () => navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {});
    req();
    const onVis = () => document.visibilityState === 'visible' && req();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
    };
  }, [enabled]);
}

/** Nach X Minuten ohne Bedienung zurück zu "Heute" */
export function useIdle(minutes: number, enabled: boolean, onIdle: () => void) {
  const cb = useRef(onIdle);
  cb.current = onIdle;
  useEffect(() => {
    if (!enabled) return;
    let t: number;
    const reset = () => {
      clearTimeout(t);
      t = window.setTimeout(() => cb.current(), minutes * 60000);
    };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(t);
      evs.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [minutes, enabled]);
}

/** Aktuelle Zeit, minütlich aktualisiert */
export function useClock(): Date {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function isNight(now: Date, from: string, to: string): boolean {
  const hm = now.toTimeString().slice(0, 5);
  return from <= to ? hm >= from && hm < to : hm >= from || hm < to;
}

/** Lokale Erinnerungen (solange die App offen ist) */
export function useReminders(events: CalEvent[], persons: Person[], device: DeviceSettings) {
  const last = useRef<string>(fromNative(new Date(), false));
  useEffect(() => {
    if (!device.reminders || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const check = async () => {
      const now = fromNative(new Date(), false);
      const since = last.current;
      last.current = now;
      if (since >= now) return;
      const today = todayLocal();
      const bdays: CalEvent[] = persons.filter((p) => p.birthday && p.birthdayReminder != null).map((p) => ({
        id: 'bday-' + p.id, title: '🎂 ' + p.name, start: p.birthday!, end: addDays(p.birthday!, 1), allDay: true, personIds: [],
        reminderMinutes: p.birthdayReminder, recurrence: { freq: 'yearly', interval: 1, end: { type: 'never' } },
      }));
      const withRem = [...events.filter((e) => remindersOf(e).length), ...withFeb29(bdays, today)];
      const lead = Math.ceil(Math.max(0, ...withRem.flatMap((e) => remindersOf(e))) / 1440) + 1;
      const occs = expand(withRem, addDays(today, -1), addDays(today, lead + 1));
      for (const o of occs) {
        const ev = o.event;
        const start = o.event.allDay ? `${o.start}T08:00` : o.start;
        if (!remindersOf(ev).some((m) => { const at = addMinutes(start, -m); return at > since && at <= now; })) continue;
        const sel = device.reminderPersons;
        if (sel.length && (ev.personIds.length || ev.driverIds?.length) && ![...ev.personIds, ...(ev.driverIds ?? [])].some((id) => sel.includes(id))) continue;
        const names = ev.personIds.map((id) => persons.find((p) => p.id === id)?.name).filter(Boolean).join(', ');
        const body = [o.event.allDay ? 'Ganztägig' : `${o.start.slice(11)} Uhr`, names, ev.location].filter(Boolean).join(' · ');
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) reg.showNotification(ev.title, { body, icon: './icon-192.png', tag: ev.id + o.occStart });
        else new Notification(ev.title, { body, icon: './icon-192.png' });
      }
    };
    const t = setInterval(check, 20000);
    return () => clearInterval(t);
  }, [events, persons, device.reminders, device.reminderPersons]);
}

/**
 * Wischen nach links/rechts (nur Touch). Kurze, waagrechte Bewegungen –
 * langes Drücken (Termin verschieben) und senkrechtes Scrollen werden ignoriert.
 */
export function useSwipe(ref: RefObject<HTMLElement | null>, onLeft: () => void, onRight: () => void, enabled = true) {
  const cbs = useRef({ onLeft, onRight });
  cbs.current = { onLeft, onRight };
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let sx = 0, sy = 0, t0 = 0, active = false;
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) { active = false; return; }
      // Nicht beim Ziehen/Größe ändern von Terminen
      if ((e.target as HTMLElement).closest('.fc-event-resizer, .fc-event-dragging, .modal')) { active = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now(); active = true;
    };
    const end = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      if (document.querySelector('.fc-event-dragging, .fc-event-mirror')) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Date.now() - t0 > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) cbs.current.onLeft(); else cbs.current.onRight();
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchend', end, { passive: true });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchend', end);
    };
  }, [ref, enabled]);
}

/** Kurze Schiebe-Animation als Rückmeldung beim Blättern */
export function slideIn(el: Element | null | undefined, dir: 1 | -1) {
  el?.animate?.(
    [{ transform: `translateX(${dir * 40}px)`, opacity: 0.3 }, { transform: 'translateX(0)', opacity: 1 }],
    { duration: 220, easing: 'ease-out' },
  );
}

/**
 * Nach unten ziehen zum Aktualisieren (Android-App / installierte Web-App – dort gibt es das sonst nicht).
 * Startet nur, wenn der berührte Bereich ganz oben ist; nie in offenen Fenstern (Eingaben gingen verloren).
 */
export function usePullToRefresh(enabled: boolean, onRefresh: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const THRESHOLD = 90;
    let startY = 0, startX = 0, pulling = false, dist = 0;
    const ind = document.createElement('div');
    ind.className = 'ptr';
    ind.innerHTML = '<span class="ptr-icon">↻</span>';
    document.body.appendChild(ind);
    const atTop = (el: Element | null) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 0) return false;
      }
      return true;
    };
    const show = (d: number) => {
      const p = Math.min(1, d / THRESHOLD);
      ind.style.transform = `translate(-50%, ${Math.min(d, THRESHOLD * 1.3) - 50}px) rotate(${p * 270}deg)`;
      ind.style.opacity = String(p);
      ind.classList.toggle('ready', d >= THRESHOLD);
    };
    const reset = () => { pulling = false; dist = 0; ind.style.transition = 'transform .2s, opacity .2s'; show(0); setTimeout(() => (ind.style.transition = ''), 220); };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1 || document.querySelector('.modal-backdrop, .fc-event-dragging, .fc-event-mirror')) return;
      if (!atTop(e.target as Element)) return;
      startY = e.touches[0].clientY; startX = e.touches[0].clientX; pulling = true; dist = 0;
    };
    const move = (e: TouchEvent) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY, dx = Math.abs(e.touches[0].clientX - startX);
      if (dy < 0 || dx > Math.abs(dy)) { if (dist === 0) pulling = false; else reset(); return; }
      if (document.querySelector('.fc-event-dragging, .fc-event-mirror')) { reset(); return; }
      dist = dy * 0.55;
      show(dist);
    };
    const end = () => {
      if (!pulling) return;
      if (dist >= THRESHOLD) {
        ind.classList.add('spin');
        setTimeout(onRefresh, 150);
      } else reset();
      pulling = false;
    };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', reset);
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', reset);
      ind.remove();
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
