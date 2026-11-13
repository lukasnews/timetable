import { useMemo, useState } from 'react';
import type { Person } from '../types';
import { AVATAR_STYLES, PERSON_COLORS, randomSeed, type AvatarStyleKey } from '../lib/avatars';
import { Avatar, Icon, Modal, Toggle } from './ui';

export function PersonEditor(props: { person: Person; isNew: boolean; onSave: (p: Person) => void; onDelete?: () => void; onClose: () => void }) {
  const [p, setP] = useState<Person>(props.person);
  const [seedBase, setSeedBase] = useState(randomSeed());
  const set = (x: Partial<Person>) => setP((o) => ({ ...o, ...x }));

  const options = useMemo(() => Array.from({ length: 11 }, (_, i) => `${seedBase}-${i}`), [seedBase]);

  return (
    <Modal title={props.isNew ? 'Neue Person' : `Profil: ${props.person.name}`} onClose={props.onClose} wide
      footer={<>
        {props.onDelete && <button className="btn danger" onClick={props.onDelete}><Icon name="trash" size={18} /> Entfernen</button>}
        <span className="spacer" />
        <button className="btn" onClick={props.onClose}>Abbrechen</button>
        <button className="btn primary" disabled={!p.name.trim()} onClick={() => props.onSave({ ...p, name: p.name.trim() })}>Speichern</button>
      </>}>
      <div className="person-editor">
        <div className="pe-preview">
          <Avatar person={p} size={120} ring />
          <input className="title-input center" value={p.name} placeholder="Name" onChange={(e) => set({ name: e.target.value })} autoFocus={props.isNew} />
        </div>

        <div className="field">
          <span className="label">Farbe</span>
          <div className="colors">
            {PERSON_COLORS.map((c) => (
              <button key={c} type="button" className={'color' + (p.color === c ? ' on' : '')} style={{ background: c }} onClick={() => set({ color: c })} aria-label={c} />
            ))}
            <input type="color" value={p.color} onChange={(e) => set({ color: e.target.value })} aria-label="Eigene Farbe" />
          </div>
        </div>

        <div className="field">
          <span className="label">Comic-Stil</span>
          <div className="seg wrap">
            {(Object.keys(AVATAR_STYLES) as AvatarStyleKey[]).map((k) => (
              <button key={k} type="button" className={p.avatar.style === k ? 'on' : ''} onClick={() => set({ avatar: { ...p.avatar, style: k } })}>
                {AVATAR_STYLES[k].label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Figur auswählen
            <button type="button" className="btn small" onClick={() => setSeedBase(randomSeed())}><Icon name="dice" size={16} /> Neue Vorschläge</button>
          </span>
          <div className="avatar-grid">
            {[p.avatar.seed, ...options].map((seed) => (
              <button key={seed} type="button" className={'avatar-opt' + (p.avatar.seed === seed ? ' on' : '')} onClick={() => set({ avatar: { ...p.avatar, seed } })}>
                <Avatar person={{ ...p, avatar: { ...p.avatar, seed } }} size={64} />
              </button>
            ))}
          </div>
        </div>

        <div className="grid2">
          <label className="field"><span className="label">🎂 Geburtstag (optional)</span>
            <input type="date" value={p.birthday ?? ''} onChange={(e) => set({ birthday: e.target.value || undefined })} /></label>
          <label className="field"><span className="label">🔔 ntfy-Topic für Erinnerungen</span>
            <input value={p.ntfyTopic ?? ''} placeholder="z. B. mama" onChange={(e) => set({ ntfyTopic: e.target.value.trim() || undefined })} /></label>
        </div>
        <Toggle checked={!!p.hasTimetable} onChange={(v) => set({ hasTimetable: v })} label="Hat einen Stundenplan" hint="Schulzeiten erscheinen im Kalender" />
      </div>
    </Modal>
  );
}
