import { useEffect, useRef, useState } from 'react';
import type { QuickLink } from '../types';
import { uid } from '../lib/dates';
import { Icon } from './ui';
import { isNative } from '../native';

/** Link öffnen: Web-Adressen in neuem Tab/externem Browser, App-Links (z. B. whatsapp:) direkt */
export function openUrl(url: string) {
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) window.open(u, '_blank', 'noopener');
  else window.location.href = u;
}

const playUrl = (pkg: string) => `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`;
const isAndroid = () => /android/i.test(navigator.userAgent);

/** Paketname aus Play-Store-Link oder direkter Eingabe (com.beispiel.app) */
export function parsePackage(input: string): string | undefined {
  const t = input.trim();
  if (!t) return undefined;
  const m = t.match(/[?&]id=([A-Za-z0-9_.]+)/);
  const pkg = m ? m[1] : t;
  return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(pkg) ? pkg : undefined;
}

/** Schnellzugriff öffnen: zuerst die Android-App (falls eingetragen), sonst der Link */
export async function openLink(l: Pick<QuickLink, 'url' | 'androidPackage'>) {
  const pkg = l.androidPackage;
  if (pkg && isNative()) {
    try {
      const { AppLauncher } = await import('@capacitor/app-launcher');
      const { value } = await AppLauncher.canOpenUrl({ url: pkg });
      if (value) { await AppLauncher.openUrl({ url: pkg }); return; }
    } catch { /* ältere App-Version ohne Erweiterung */ }
    // nicht installiert (oder App zu alt): Webseite, sonst Play Store
    openUrl(l.url || playUrl(pkg));
    return;
  }
  if (pkg && isAndroid()) {
    // Browser/Web-App auf Android: App starten, sonst Play Store bzw. eingetragener Link
    const fallback = encodeURIComponent(l.url || playUrl(pkg));
    window.location.href = `intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${pkg};S.browser_fallback_url=${fallback};end`;
    return;
  }
  openUrl(l.url || (pkg ? playUrl(pkg) : ''));
}

export const normUrl = (u: string) => {
  const t = u.trim();
  if (!t) return t;
  return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : 'https://' + t;
};

/** Knopf in der Kopfzeile mit Liste der Schnellzugriffe */
export function QuickLinksButton({ links }: { links: QuickLink[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  if (!links.length) return null;
  return (
    <div className="ql-wrap" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label="Schnellzugriff" aria-expanded={open}><Icon name="grid" /></button>
      {open && (
        <div className="ql-menu" role="menu">
          {links.map((l) => (
            <button key={l.id} role="menuitem" className="ql-item" onClick={() => { setOpen(false); openLink(l); }}>
              <span className="ql-icon">{l.icon || '🔗'}</span> {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Eingabe „oder Android-App“: Play-Store-Link oder Paketname */
function AppField({ value, onChange }: { value?: string; onChange: (pkg: string | undefined) => void }) {
  const [text, setText] = useState(value ?? '');
  const pkg = parsePackage(text);
  return (
    <div className="ql-app">
      <input value={text} placeholder="oder Android-App: Play-Store-Link einfügen" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        onChange={(e) => {
          // sofort speichern (nicht erst beim Verlassen – sonst geht es verloren, wenn man gleich schließt)
          setText(e.target.value);
          const p = parsePackage(e.target.value);
          if (p || !e.target.value.trim()) onChange(p);
        }}
        onBlur={() => { if (pkg) setText(pkg); }} />
      {text.trim() && <small className={pkg ? 'hint' : 'error'}>{pkg ? `📱 startet die App ${pkg}` : 'Kein gültiger Play-Store-Link bzw. Paketname'}</small>}
    </div>
  );
}

const ICONS = ['🍽️', '🎁', '🛒', '📝', '📸', '🎵', '🏫', '⚽', '💊', '🔗'];

/** Einstellungen: Schnellzugriffe verwalten */
export function QuickLinksEditor({ links, onChange }: { links: QuickLink[]; onChange: (l: QuickLink[]) => void }) {
  const set = (id: string, p: Partial<QuickLink>) => onChange(links.map((l) => (l.id === id ? { ...l, ...p } : l)));
  return (
    <div className="ql-editor">
      {links.map((l) => (
        <div key={l.id} className="ql-row">
          <select value={l.icon} onChange={(e) => set(l.id, { icon: e.target.value })} aria-label="Symbol">
            {[...new Set([l.icon, ...ICONS])].map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          <input value={l.label} placeholder="Name, z. B. Essensplan" onChange={(e) => set(l.id, { label: e.target.value })} />
          <input value={l.url} placeholder="Link (https://…)" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => set(l.id, { url: e.target.value })} onBlur={(e) => set(l.id, { url: normUrl(e.target.value) })} />
          <AppField value={l.androidPackage} onChange={(androidPackage) => set(l.id, { androidPackage })} />
          <label className="ql-bday"><input type="checkbox" checked={!!l.onBirthday} onChange={(e) => set(l.id, { onBirthday: e.target.checked || undefined })} /> 🎂 auch bei Geburtstagen</label>
          <button className="icon-btn" onClick={() => onChange(links.filter((x) => x.id !== l.id))} aria-label="Entfernen"><Icon name="trash" size={18} /></button>
        </div>
      ))}
      <button className="btn" onClick={() => onChange([...links, { id: uid(), icon: '🔗', label: '', url: '' }])}><Icon name="plus" size={18} /> Schnellzugriff</button>
      <small className="hint">Link <b>oder</b> Android-App reicht. Mit beidem startet am Android-Gerät die App, auf anderen Geräten öffnet sich der Link. Play-Store-Link: in der Play Store App bei der App auf ⋮ bzw. Teilen → Link kopieren.</small>
    </div>
  );
}
