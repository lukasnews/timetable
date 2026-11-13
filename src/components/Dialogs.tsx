import { useState } from 'react';
import { Modal } from './ui';
import type { Scope } from '../lib/recurrence';
import { hashPin } from '../lib/pin';

export function ScopeDialog(props: { action: 'edit' | 'move' | 'delete'; onPick: (s: Scope | null) => void }) {
  const title = { edit: 'Serientermin bearbeiten', move: 'Serientermin verschieben', delete: 'Serientermin löschen' }[props.action];
  return (
    <Modal title={title} onClose={() => props.onPick(null)}>
      <p className="lead">Das ist ein wiederkehrender Termin. Was soll {props.action === 'delete' ? 'gelöscht' : 'geändert'} werden?</p>
      <div className="choice-list">
        <button className="btn big" onClick={() => props.onPick('one')}>Nur dieser Termin</button>
        <button className="btn big" onClick={() => props.onPick('following')}>Dieser und alle folgenden</button>
        <button className="btn big" onClick={() => props.onPick('all')}>Alle Termine der Serie</button>
        <button className="btn ghost" onClick={() => props.onPick(null)}>Abbrechen</button>
      </div>
    </Modal>
  );
}

export function ConfirmDialog(props: { text: string; confirm: string; onResult: (ok: boolean) => void }) {
  return (
    <Modal title="Bitte bestätigen" onClose={() => props.onResult(false)}
      footer={<><span className="spacer" /><button className="btn" onClick={() => props.onResult(false)}>Abbrechen</button>
        <button className="btn danger" onClick={() => props.onResult(true)}>{props.confirm}</button></>}>
      <p className="lead">{props.text}</p>
    </Modal>
  );
}

export function PinDialog(props: { pinHash: string; onResult: (ok: boolean) => void }) {
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const press = async (d: string) => {
    const next = (pin + d).slice(0, 8);
    setPin(next);
    setWrong(false);
    if (next.length >= 4 && (await hashPin(next)) === props.pinHash) props.onResult(true);
    else if (next.length === 8) { setWrong(true); setPin(''); }
  };
  const submit = async () => {
    if ((await hashPin(pin)) === props.pinHash) props.onResult(true);
    else { setWrong(true); setPin(''); }
  };
  return (
    <Modal title="PIN eingeben" onClose={() => props.onResult(false)}>
      <div className="pin">
        <div className={'pin-dots' + (wrong ? ' wrong' : '')}>
          {pin.length === 0 ? <span className="hint">{wrong ? 'Falsche PIN' : 'Einstellungen sind geschützt'}</span> : '●'.repeat(pin.length)}
        </div>
        <div className="pin-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map((k) => (
            <button key={k} className="btn big" onClick={() => (k === '⌫' ? setPin(pin.slice(0, -1)) : k === 'OK' ? submit() : press(k))}>{k}</button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
