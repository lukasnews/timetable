import type { FirebaseOptions } from 'firebase/app';

export type Collection = 'persons' | 'events' | 'timetables' | 'meta';
export type SyncStatus = 'local' | 'synced' | 'pending' | 'offline' | 'error';

export interface Item {
  id: string;
}

export interface Store {
  readonly mode: 'local' | 'cloud';
  subscribe<T extends Item>(col: Collection, cb: (items: T[]) => void): () => void;
  put<T extends Item>(col: Collection, item: T): void;
  remove(col: Collection, id: string): void;
  onStatus(cb: (s: SyncStatus) => void): () => void;
}

export interface CloudConfig {
  firebase: FirebaseOptions;
  familyId: string;
}

const CLOUD_KEY = 'fk.cloud';

/** Firebase-Konfiguration kann zur Build-Zeit (.env) oder per Einladungslink kommen */
export function buildTimeFirebase(): FirebaseOptions | null {
  const raw = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.warn('VITE_FIREBASE_CONFIG ist kein gültiges JSON');
    return null;
  }
}

export function loadCloudConfig(): CloudConfig | null {
  try {
    const raw = localStorage.getItem(CLOUD_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return null;
}

export function saveCloudConfig(c: CloudConfig | null) {
  if (c) localStorage.setItem(CLOUD_KEY, JSON.stringify(c));
  else localStorage.removeItem(CLOUD_KEY);
}

/** Einladungslink: #join=<base64(JSON)> */
export function makeJoinLink(c: CloudConfig): string {
  const payload: Partial<CloudConfig> = { familyId: c.familyId };
  if (!buildTimeFirebase()) payload.firebase = c.firebase;
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  return `${location.origin}${location.pathname}#join=${b64}`;
}

export function readJoinLink(): CloudConfig | null {
  const m = location.hash.match(/join=([^&]+)/);
  if (!m) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(escape(atob(m[1])))) as Partial<CloudConfig>;
    const firebase = payload.firebase ?? buildTimeFirebase();
    if (!firebase || !payload.familyId) return null;
    return { firebase, familyId: payload.familyId };
  } catch {
    return null;
  }
}

export function newFamilyId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return [...bytes].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}
