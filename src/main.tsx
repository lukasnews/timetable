import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './install';
import { importDeviceSettings, migrateIfNeeded } from './migrate';
import { updateState } from './update';
import { DataProvider } from './data/DataContext';
import App from './App';
import { isNative, setupBackButton } from './native';
import './styles.css';

importDeviceSettings();
migrateIfNeeded();
setupBackButton();
// Android-App: kein Browser drumherum (für CSS, z. B. Höhe ohne Browser-Leisten)
if (isNative()) {
  document.documentElement.classList.add('native-app');
  // Druck in der App: keinen Seitenrand freilassen (würde in der App-Hintergrundfarbe gefüllt) – Rand kommt aus dem CSS
  const st = document.createElement('style');
  st.textContent = '@page { size: A4 landscape; margin: 0; }';
  document.head.appendChild(st);
}

// Updates: regelmäßig und beim Zurückkehren in die App nach einer neuen Version suchen.
// Eine neue Version wird erst aktiviert, wenn kein Fenster (Termin, Einstellungen …) offen ist –
// damit keine Eingabe verloren geht.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // erste Installation: kein Neuladen nötig
    updateState.pending = true;
    const reloadWhenIdle = () => {
      if (!updateState.force && document.querySelector('.modal-backdrop')) { setTimeout(reloadWhenIdle, 3000); return; }
      location.reload();
    };
    reloadWhenIdle();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    // Sicherheitsnetz: eine wartende Version zum Aktivieren auffordern
    const nudge = () => reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
    nudge();
    reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', nudge));
    const check = () => { if (navigator.onLine) reg.update().catch(() => {}); };
    setInterval(check, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  }).catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider>
      <App />
    </DataProvider>
  </StrictMode>,
);
