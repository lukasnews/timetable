/** Zustand für App-Updates (Service Worker) */
export const updateState = {
  /** Eine neue Version ist aktiv, das Neuladen wartet nur noch auf ein geschlossenes Fenster */
  pending: false,
  /** Vom Knopf „Nach Update suchen“ gesetzt: sofort neu laden, auch wenn ein Fenster offen ist */
  force: false,
};

/** Sucht nach einer neuen Version. Ergebnis: 'reload' (wird neu geladen) oder 'current' (bereits aktuell). */
export async function checkForUpdate(): Promise<'reload' | 'current'> {
  if (updateState.pending) { location.reload(); return 'reload'; }
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return 'current';
  updateState.force = true;
  await reg.update().catch(() => {});
  const sw = reg.installing ?? reg.waiting;
  reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
  if (!sw) { updateState.force = false; return 'current'; }
  // Neue Version gefunden: nach der Aktivierung lädt der controllerchange-Handler neu.
  // Sicherheitsnetz, falls das Ereignis ausbleibt:
  sw.addEventListener('statechange', () => { if (sw.state === 'activated') setTimeout(() => location.reload(), 1500); });
  setTimeout(() => location.reload(), 20000);
  return 'reload';
}
