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

/* ---------------- Baukasten ---------------- */

export interface FeatureDef {
  key: string;
  label: string;
  type: 'variant' | 'color';
  values: string[];
  /** Wahrscheinlichkeits-Option: erlaubt „keine“ (0) bzw. erzwingt das Merkmal (100) */
  prob?: string;
}

const FEATURES: Partial<Record<AvatarStyleKey, { key: string; label: string; prob?: string }[]>> = {
  adventurer: [
    { key: 'skinColor', label: 'Haut' },
    { key: 'hair', label: 'Frisur', prob: 'hairProbability' },
    { key: 'hairColor', label: 'Haarfarbe' },
    { key: 'eyes', label: 'Augen' },
    { key: 'eyebrows', label: 'Brauen' },
    { key: 'mouth', label: 'Mund' },
    { key: 'glasses', label: 'Brille', prob: 'glassesProbability' },
    { key: 'earrings', label: 'Ohrringe', prob: 'earringsProbability' },
    { key: 'features', label: 'Extras', prob: 'featuresProbability' },
  ],
  avataaars: [
    { key: 'skinColor', label: 'Haut' },
    { key: 'top', label: 'Frisur', prob: 'topProbability' },
    { key: 'hairColor', label: 'Haarfarbe' },
    { key: 'facialHair', label: 'Bart', prob: 'facialHairProbability' },
    { key: 'accessories', label: 'Brille', prob: 'accessoriesProbability' },
    { key: 'eyes', label: 'Augen' },
    { key: 'eyebrows', label: 'Brauen' },
    { key: 'mouth', label: 'Mund' },
    { key: 'clothing', label: 'Kleidung' },
    { key: 'clothesColor', label: 'Kleidungsfarbe' },
  ],
  bigSmile: [
    { key: 'skinColor', label: 'Haut' },
    { key: 'hair', label: 'Frisur' },
    { key: 'hairColor', label: 'Haarfarbe' },
    { key: 'eyes', label: 'Augen' },
    { key: 'mouth', label: 'Mund' },
    { key: 'accessories', label: 'Extras', prob: 'accessoriesProbability' },
  ],
};

/** Einstellbare Merkmale eines Stils (leer = Stil hat keinen Baukasten) */
export function featuresFor(style: string): FeatureDef[] {
  const defs = FEATURES[style as AvatarStyleKey];
  if (!defs) return [];
  const schema = (AVATAR_STYLES[style as AvatarStyleKey].style as any).schema?.properties ?? {};
  return defs.flatMap((d) => {
    const p = schema[d.key];
    if (!p) return [];
    const isColor = d.key.endsWith('Color');
    const values: string[] = isColor ? (p.default ?? []) : (p.items?.enum ?? []);
    if (!values.length) return [];
    return [{ ...d, type: isColor ? 'color' : 'variant', values: isColor ? values : [...values].sort() } as FeatureDef];
  });
}

function featureOptions(spec: AvatarSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!spec.opts) return out;
  const defs = featuresFor(spec.style);
  for (const [k, v] of Object.entries(spec.opts)) {
    const d = defs.find((x) => x.key === k);
    if (!d) continue;
    if (v === null) {
      if (d.prob) out[d.prob] = 0;
    } else {
      out[k] = [v];
      if (d.prob) out[d.prob] = 100;
    }
  }
  // Avataaars: Bart in Haarfarbe
  if (spec.style === 'avataaars' && spec.opts.hairColor && !spec.opts.facialHairColor) out.facialHairColor = [spec.opts.hairColor];
  return out;
}

const cache = new Map<string, string>();

export function avatarUri(spec: AvatarSpec, bg?: string): string {
  const key = `${spec.style}|${spec.seed}|${bg ?? ''}|${spec.opts ? JSON.stringify(spec.opts) : ''}`;
  let uri = cache.get(key);
  if (!uri) {
    const def = AVATAR_STYLES[spec.style as AvatarStyleKey] ?? AVATAR_STYLES.adventurer;
    const opts: Record<string, unknown> = { seed: spec.seed, radius: 50, ...featureOptions(spec) };
    if (bg) opts.backgroundColor = [bg.replace('#', '')];
    uri = createAvatar(def.style as any, opts).toDataUri();
    if (cache.size > 2000) cache.clear();
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
