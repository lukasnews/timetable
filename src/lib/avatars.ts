import { createAvatar } from '@dicebear/core';
import * as adventurer from '@dicebear/adventurer';
import * as avataaars from '@dicebear/avataaars';
import * as bigSmile from '@dicebear/big-smile';
import * as funEmoji from '@dicebear/fun-emoji';
import * as lorelei from '@dicebear/lorelei';
import * as micah from '@dicebear/micah';
import * as openPeeps from '@dicebear/open-peeps';
import * as toonHead from '@dicebear/toon-head';
import * as bottts from '@dicebear/bottts';
import type { AvatarSpec } from '../types';

/** Comic-Stile von DiceBear (Lizenzen siehe Einstellungen → Info) */
export const AVATAR_STYLES = {
  adventurer: { label: 'Abenteurer', style: adventurer, credit: 'Adventurer – Lisa Wischofsky (CC BY 4.0)' },
  bigSmile: { label: 'Grinser', style: bigSmile, credit: 'Big Smile – Ashley Seo (CC BY 4.0)' },
  toonHead: { label: 'Toon', style: toonHead, credit: 'Toon Head – Johan Melin (CC BY 4.0)' },
  avataaars: { label: 'Avataaars', style: avataaars, credit: 'Avataaars – Pablo Stanley (frei nutzbar)' },
  micah: { label: 'Micah', style: micah, credit: 'Micah – Micah Lanier (CC BY 4.0)' },
  lorelei: { label: 'Lorelei', style: lorelei, credit: 'Lorelei – Lisa Wischofsky (CC0)' },
  openPeeps: { label: 'Peeps', style: openPeeps, credit: 'Open Peeps – Pablo Stanley (CC0)' },
  funEmoji: { label: 'Emoji', style: funEmoji, credit: 'Fun Emoji – Davis Uche (CC BY 4.0)' },
  bottts: { label: 'Roboter', style: bottts, credit: 'Bottts – Pablo Stanley (frei nutzbar)' },
} as const;

export type AvatarStyleKey = keyof typeof AVATAR_STYLES;

const cache = new Map<string, string>();

export function avatarUri(spec: AvatarSpec, bg?: string): string {
  const key = `${spec.style}|${spec.seed}|${bg ?? ''}`;
  let uri = cache.get(key);
  if (!uri) {
    const def = AVATAR_STYLES[spec.style as AvatarStyleKey] ?? AVATAR_STYLES.adventurer;
    const opts: Record<string, unknown> = { seed: spec.seed, radius: 50 };
    if (bg) opts.backgroundColor = [bg.replace('#', '')];
    uri = createAvatar(def.style as any, opts).toDataUri();
    cache.set(key, uri);
  }
  return uri;
}

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const PERSON_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#64748b',
];

/** Hellere Variante einer Farbe für Hintergründe */
export function tint(hex: string, amount = 0.82): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = (c: number) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0');
  return `#${m(r)}${m(g)}${m(b)}`;
}
