import type { AvatarSpec } from '../types';

/** Comic-Stile von DiceBear (Lizenzen siehe Einstellungen → Info) */
export const AVATAR_STYLES = {
  adventurer: { label: 'Abenteurer', credit: 'Adventurer – Lisa Wischofsky (CC BY 4.0)' },
  bigSmile: { label: 'Grinser', credit: 'Big Smile – Ashley Seo (CC BY 4.0)' },
  toonHead: { label: 'Toon', credit: 'Toon Head – Johan Melin (CC BY 4.0)' },
  avataaars: { label: 'Avataaars', credit: 'Avataaars – Pablo Stanley (frei nutzbar)' },
  micah: { label: 'Micah', credit: 'Micah – Micah Lanier (CC BY 4.0)' },
  lorelei: { label: 'Lorelei', credit: 'Lorelei – Lisa Wischofsky (CC0)' },
  openPeeps: { label: 'Peeps', credit: 'Open Peeps – Pablo Stanley (CC0)' },
  funEmoji: { label: 'Emoji', credit: 'Fun Emoji – Davis Uche (CC BY 4.0)' },
  bottts: { label: 'Roboter', credit: 'Bottts – Pablo Stanley (frei nutzbar)' },
} as const;

/* ---------------- Nachladen der Stile ---------------- */

type StyleModule = typeof import('./avatarStyles');
let mod: StyleModule | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
let version = 0;

/** Stile laden (einmal); danach zeichnen sich alle Figuren neu */
export function loadAvatarStyles(): Promise<void> {
  if (!loading) {
    loading = import('./avatarStyles').then((m) => {
      mod = m;
      cache.clear();
      version++;
      listeners.forEach((f) => f());
    }).catch((e) => { loading = null; console.error('Figuren laden', e); });
  }
  return loading;
}
export const avatarsVersion = () => version;
export function onAvatarsReady(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }

/** Platzhalter, bis die Stile geladen sind: Kreis in der Farbe der Person */
function placeholder(bg?: string): string {
  const fill = bg ?? '#d9dce8';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="${fill}"/></svg>`);
}

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
  if (!mod) { loadAvatarStyles(); return []; }
  const schema = ((mod.STYLE_MODULES as Record<string, unknown>)[style] as any)?.schema?.properties ?? {};
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

export function avatarUri(spec: AvatarSpec | undefined, bg?: string): string {
  // ältere/importierte Personen ohne Figur: neutrale Standardfigur statt Absturz
  spec = spec ?? { style: 'adventurer', seed: 'person' };
  const key = `${spec.style}|${spec.seed}|${bg ?? ''}|${spec.opts ? JSON.stringify(spec.opts) : ''}`;
  if (!mod) { loadAvatarStyles(); return placeholder(bg); }
  let uri = cache.get(key);
  if (!uri) {
    const styles = mod.STYLE_MODULES as Record<string, unknown>;
    const style = styles[spec.style] ?? styles.adventurer;
    const opts: Record<string, unknown> = { seed: spec.seed, radius: 50, ...featureOptions(spec) };
    if (bg) opts.backgroundColor = [bg.replace('#', '')];
    uri = mod.createAvatar(style as any, opts).toDataUri();
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
