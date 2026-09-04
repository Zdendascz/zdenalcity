import './style.css';
import { startApp } from '@/render/app';

const mount = document.getElementById('app');
if (!mount) {
  throw new Error('Chybí #app v index.html.');
}

/**
 * Service worker, aby šla hra spustit i bez sítě.
 *
 * Registruje se **až po startu hry**, ne před ním: instalace stahuje skořápku
 * a při prvním spuštění by soupeřila o linku s obsahem, na který hráč čeká.
 *
 * Ve vývoji se **neregistruje vůbec**. Worker si drží keš a při každé úpravě
 * by se muselo hádat, jestli je v prohlížeči nová verze, nebo ta jeho.
 */
function registerServiceWorker(): void {
  if (import.meta.env.DEV) return;
  if (!('serviceWorker' in navigator)) return;
  // Cesta je relativní, protože hra může viset i v podadresáři
  // (`games.zdendas.cz/zdenalcity/`) — viz `base` ve `vite.config.ts`.
  void navigator.serviceWorker.register('./service-worker.js').catch(() => undefined);
}

await startApp(mount);
registerServiceWorker();
