import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './install';
import { importDeviceSettings, migrateIfNeeded } from './migrate';
import { DataProvider } from './data/DataContext';
import App from './App';
import './styles.css';

importDeviceSettings();
migrateIfNeeded();

// Updates: regelmäßig und beim Zurückkehren in die App nach einer neuen Version suchen.
// Eine neue Version wird erst aktiviert, wenn kein Fenster (Termin, Einstellungen …) offen ist –
// damit keine Eingabe verloren geht.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // erste Installation: kein Neuladen nötig
    const reloadWhenIdle = () => {
      if (document.querySelector('.modal-backdrop')) { setTimeout(reloadWhenIdle, 3000); return; }
      location.reload();
    };
    reloadWhenIdle();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
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
