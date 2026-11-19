/**
 * Aus der geheimen Familien-ID abgeleitete Werte (Browser, Worker und Node – Web Crypto).
 * Die Ableitung ist eine Einwegfunktion: aus dem Präfix lässt sich die Familien-ID nicht zurückrechnen.
 */
const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

const b32 = (bytes: Uint8Array, n: number) => [...bytes].slice(0, n).map((b) => ALPHA[b % 32]).join('');

/** Präfix für ntfy-Topics dieser Familie (≈ 60 Bit, nicht erratbar), z. B. „fk-x7k2m9qa3b2c“ */
export async function topicPrefix(familyId: string): Promise<string> {
  return 'fk-' + b32(await sha256('ntfy-topic:' + familyId), 12);
}

/** Schlüssel des Eintrags im Verzeichnis des Erinnerungsdienstes */
export async function registryKey(familyId: string): Promise<string> {
  return [...(await sha256('registry:' + familyId))].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Vorschlag für ein sicheres Topic, z. B. „fk-x7k2m9qa3b2c-mama“ */
export function suggestTopic(prefix: string, name: string): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
  return slug ? `${prefix}-${slug}` : prefix;
}

/** Ist das Topic für diese Familie zulässig? (beginnt mit dem Präfix der Familie) */
export const topicAllowed = (topic: string, prefix: string) => topic === prefix || topic.startsWith(prefix + '-');
