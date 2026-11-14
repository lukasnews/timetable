import { useEffect, useState } from 'react';
import type { Person } from '../types';
import { featuresFor } from '../lib/avatars';
import { Avatar, Icon } from './ui';

/** Baukasten: einzelne Merkmale der Comic-Figur gezielt wählen */
export function AvatarBuilder({ person, onChange }: { person: Person; onChange: (opts: Record<string, string | null> | undefined) => void }) {
  const features = featuresFor(person.avatar.style);
  const [active, setActive] = useState(features[0]?.key);
  useEffect(() => { if (!features.some((f) => f.key === active)) setActive(features[0]?.key); }, [person.avatar.style]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!features.length) {
    return <p className="hint">Für diesen Stil gibt es keinen Baukasten – Abenteurer, Avataaars und Grinser lassen sich anpassen.</p>;
  }
  const f = features.find((x) => x.key === active) ?? features[0];
  const opts = person.avatar.opts ?? {};
  const cur = f.key in opts ? opts[f.key] : undefined;
  const pick = (v: string | null | undefined) => {
    const next = { ...opts };
    if (v === undefined) delete next[f.key];
    else next[f.key] = v;
    onChange(Object.keys(next).length ? next : undefined);
  };
  const preview = (v: string | null) => ({ ...person, avatar: { ...person.avatar, opts: { ...opts, [f.key]: v } } });

  return (
    <div className="builder">
      <div className="builder-tabs">
        {features.map((x) => (
          <button key={x.key} type="button" className={'chip-tab' + (x.key === f.key ? ' on' : '') + (x.key in opts ? ' set' : '')} onClick={() => setActive(x.key)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className={'builder-grid' + (f.type === 'color' ? ' colors-grid' : '')}>
        <button type="button" className={'builder-opt auto' + (cur === undefined ? ' on' : '')} onClick={() => pick(undefined)} title="Zufällig (vom Würfel)">
          <Icon name="dice" size={20} /><small>Zufall</small>
        </button>
        {f.prob && (
          <button type="button" className={'builder-opt' + (cur === null ? ' on' : '')} onClick={() => pick(null)} title="Keine">
            {f.type === 'variant' ? <Avatar person={preview(null)} size={52} /> : null}<small>Keine</small>
          </button>
        )}
        {f.values.map((v) =>
          f.type === 'color' ? (
            <button key={v} type="button" className={'builder-color' + (cur === v ? ' on' : '')} style={{ background: '#' + v }} onClick={() => pick(v)} aria-label={'#' + v} />
          ) : (
            <button key={v} type="button" className={'builder-opt' + (cur === v ? ' on' : '')} onClick={() => pick(v)}>
              <Avatar person={preview(v)} size={52} />
            </button>
          ),
        )}
      </div>
      {person.avatar.opts && (
        <button type="button" className="btn small" onClick={() => onChange(undefined)}>Alle Anpassungen zurücksetzen</button>
      )}
    </div>
  );
}
