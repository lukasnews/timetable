import { useEffect, useRef, useState } from 'react';
import type { QuickLink } from '../types';
import { uid } from '../lib/dates';
import { Icon } from './ui';

/** Link öffnen: Web-Adressen in neuem Tab/externem Browser, App-Links (z. B. intent:, whatsapp:) direkt */
export function openLink(url: string) {
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) window.open(u, '_blank', 'noopener');
  else window.location.href = u;
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
            <button key={l.id} role="menuitem" className="ql-item" onClick={() => { setOpen(false); openLink(l.url); }}>
              <span className="ql-icon">{l.icon || '🔗'}</span> {l.label}
            </button>
          ))}
        </div>
      )}
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
          <label className="ql-bday"><input type="checkbox" checked={!!l.onBirthday} onChange={(e) => set(l.id, { onBirthday: e.target.checked || undefined })} /> 🎂 auch bei Geburtstagen</label>
          <button className="icon-btn" onClick={() => onChange(links.filter((x) => x.id !== l.id))} aria-label="Entfernen"><Icon name="trash" size={18} /></button>
        </div>
      ))}
      <button className="btn" onClick={() => onChange([...links, { id: uid(), icon: '🔗', label: '', url: '' }])}><Icon name="plus" size={18} /> Schnellzugriff</button>
    </div>
  );
}
