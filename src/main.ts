import './style.css';
import { startApp } from '@/render/app';

const mount = document.getElementById('app');
if (!mount) {
  throw new Error('Chybí #app v index.html.');
}

/**
 * Service worker, aby šla hra spustit i bez sítě.
 *
 * Registruje se **před `startApp`**, ne za ním. Dřív stálo volání za
 * `await startApp(mount)`, jenže ten dobíhá až se spuštěním města — na
 * rozcestníku se tak worker neregistroval vůbec. Změřeno na produkci: po
 * dvaceti vteřinách na úvodní obrazovce nula registrací, po založení města
 * jedna. Kdo si hru otevřel a město nezaložil, neměl offline kopii.
 *
 * Platí za to tím, že instalace stahuje skořápku souběžně s obsahem, na který
 * hráč čeká. Registrace sama je nelokující (`void` nad příslibem), takže start
 * hry nezdrží; soupeří jen o linku.
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

registerServiceWorker();
await startApp(mount);
