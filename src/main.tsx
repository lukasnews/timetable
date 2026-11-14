import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './install';
import { importDeviceSettings, migrateIfNeeded } from './migrate';
import { DataProvider } from './data/DataContext';
import App from './App';
import './styles.css';

importDeviceSettings();
migrateIfNeeded();

// Updates: regelmäßig und beim Zurückkehren in die App nach einer neuen Version suchen.
// Ist eine da, wird sie automatisch aktiviert und die Seite neu geladen.
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    const check = () => { if (navigator.onLine) reg.update().catch(() => {}); };
    setInterval(check, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider>
      <App />
    </DataProvider>
  </StrictMode>,
);
