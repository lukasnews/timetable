/**
 * Umzug auf die eigene Domain.
 * Browser-Speicher gehört immer zu einer Adresse – damit Tablet und Handys nach dem Wechsel nicht
 * neu verbunden werden müssen, springt die alte Adresse (github.io) zur neuen und nimmt die
 * Familien-Verbindung, Geräte-Einstellungen und den Personen-Filter im Link mit.
 */
import { loadCloudConfig, readJoinLink } from './data/store';

export const NEW_ORIGIN = 'https://timetable.chaoten.online';

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
const unb64 = (s: string) => decodeURIComponent(escape(atob(s)));

/** Auf der alten Adresse: prüfen, ob die neue erreichbar ist, und dann umziehen */
export function migrateIfNeeded() {
  if (!location.hostname.endsWith('github.io')) return;
  const go = async () => {
    // Erreichbarkeit über das App-Icon prüfen (Bilder sind von Zugriffsregeln anderer Adressen nicht betroffen)
    const ok = await new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth === 192);
      img.onerror = () => resolve(false);
      img.src = `${NEW_ORIGIN}/icon-192.png?v=${Date.now()}`;
      setTimeout(() => resolve(false), 15000);
    });
    if (!ok) return; // neue Adresse noch nicht eingerichtet
    const parts: string[] = [];
    const cloud = readJoinLink() ?? loadCloudConfig();
    if (cloud) parts.push('join=' + b64(JSON.stringify({ familyId: cloud.familyId })));
    const dev = { device: localStorage.getItem('fk.device'), hidden: localStorage.getItem('fk.hidden') };
    parts.push('dev=' + b64(JSON.stringify(dev)));
    location.replace(NEW_ORIGIN + '/#' + parts.join('&'));
  };
  go();
}

/** Auf der neuen Adresse: mitgebrachte Geräte-Einstellungen übernehmen (vor dem Start der App) */
export function importDeviceSettings() {
  const m = location.hash.match(/dev=([^&]+)/);
  if (!m) return;
  try {
    const dev = JSON.parse(unb64(m[1])) as { device: string | null; hidden: string | null };
    if (dev.device && !localStorage.getItem('fk.device')) localStorage.setItem('fk.device', dev.device);
    if (dev.hidden && !localStorage.getItem('fk.hidden')) localStorage.setItem('fk.hidden', dev.hidden);
  } catch {
    /* ignorieren */
  }
  // Beispiel-Familie nicht anlegen, das Gerät tritt gleich dem echten Kalender bei
  localStorage.setItem('fk.seeded', '1');
  history.replaceState(null, '', location.pathname + location.hash.replace(/&?dev=[^&]+/, ''));
}
