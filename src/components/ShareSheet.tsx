import { useState } from 'react';
import type { CalEvent, Person } from '../types';
import { Modal } from './ui';
import { shareIcsFile, shareText } from '../lib/share';
import { useData } from '../data/DataContext';
import { canNativeShare, isNative, nativeShareFile, nativeShareText } from '../native';

/** Termin teilen: Teilen-Menü des Geräts, WhatsApp, SMS, E-Mail, Kopieren, Kalender-Datei */
export function ShareSheet({ event, start, end, persons, onClose }: { event: CalEvent; start: string; end: string; persons: Person[]; onClose: () => void }) {
  const text = shareText(event, start, end, persons);
  const [copied, setCopied] = useState(false);
  const nativeShare = canNativeShare();
  const canShare = nativeShare || typeof navigator.share === 'function';
  const { family } = useData();
  const file = () => shareIcsFile(event, start, end, persons, family.timezone);
  const canShareFile = canShare && (() => { try { return navigator.canShare?.({ files: [file()] }) ?? false; } catch { return false; } })();
  const open = (url: string) => { window.location.href = url; };

  const shareSystem = async () => {
    if (await nativeShareText(event.title, text)) { onClose(); return; }
    try { await navigator.share({ title: event.title, text }); onClose(); } catch { /* abgebrochen */ }
  };
  const shareFile = async () => {
    const f = file();
    try { if (await nativeShareFile(f, event.title)) { onClose(); return; } } catch (e) { console.error('Teilen', e); }
    if (canShareFile) {
      try { await navigator.share({ files: [f], title: event.title, text }); onClose(); } catch { /* abgebrochen */ }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f); a.download = f.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    setCopied(true);
  };

  return (
    <Modal title="Termin teilen" onClose={onClose}>
      <pre className="share-preview">{text}</pre>
      <div className="share-list">
        {canShare && <button className="btn primary" onClick={shareSystem}>📤 Teilen …</button>}
        <button className="btn" onClick={() => open(`https://wa.me/?text=${encodeURIComponent(text)}`)}>💬 WhatsApp</button>
        <button className="btn" onClick={() => open(`sms:?body=${encodeURIComponent(text)}`)}>✉️ SMS</button>
        <button className="btn" onClick={() => open(`mailto:?subject=${encodeURIComponent(event.title)}&body=${encodeURIComponent(text)}`)}>📧 E-Mail</button>
        <button className="btn" onClick={copy}>{copied ? '✓ Kopiert' : '📋 Text kopieren'}</button>
        {(!isNative() || nativeShare || canShareFile) && <button className="btn" onClick={shareFile}>📅 Als Kalender-Eintrag (.ics)</button>}
      </div>
      <p className="hint">Der Kalender-Eintrag lässt sich in Google-, Outlook- oder Apple-Kalender übernehmen.</p>
    </Modal>
  );
}
