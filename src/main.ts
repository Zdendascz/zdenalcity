import './style.css';
/*
 * Pixi bez `eval` (T110).
 *
 * Pixi si při startu WebGL rendereru generuje synchronizaci uniformů přes
 * `new Function` a předem si ověří, že to prostředí dovolí. Produkce dostala
 * v T106 hlavičku `Content-Security-Policy: script-src 'self'` a hra tím
 * **přestala jít spustit** — text rozcestníku naběhl, ale žádný canvas,
 * žádný HUD a nula tlačítek v liště. Ve vývoji se to neprojeví, protože
 * `.htaccess` čte až Apache.
 *
 * `pixi.js/unsafe-eval` je oficiální podbalík téhož `pixi.js` (ne nová
 * závislost) a vymění generované funkce za obecné. Importuje se **jako první
 * a jen pro vedlejší účinek**: sám si při načtení přepíše prototypy
 * rendereru, takže musí být načtený dřív, než vznikne `Application`.
 *
 * Cena je o kus pomalejší nahrávání uniformů. Alternativa — dopsat do CSP
 * `'unsafe-eval'` — by zrušila přesně tu ochranu, kvůli které CSP vznikla.
 */
import 'pixi.js/unsafe-eval';
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

/**
 * Zpráva místo prázdné stránky (T134).
 *
 * `startApp` může spadnout dřív, než existují notifikace i překlady: vadný
 * obsah (`content.load`), prohlížeč bez WebGL (`app.init`). Hráč pak dřív
 * viděl černou plochu a nevěděl, jestli se čeká, nebo je konec. Text je
 * natvrdo česky i anglicky — i18n se v tu chvíli nemusela vůbec načíst.
 */
function showStartupError(target: HTMLElement, error: unknown): void {
  console.error('Hra se nespustila:', error);
  const detail = error instanceof Error ? error.message : String(error);
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText =
    'max-width:36rem;margin:15vh auto;padding:1.5rem;font:16px/1.5 system-ui,sans-serif;' +
    'color:#e8eef0;background:#0e2028;border-radius:8px';
  const lines: [string, string][] = [
    ['h1', 'Hru se nepodařilo spustit'],
    ['p', 'Zkuste stránku obnovit. Pokud to nepomůže, použijte jiný prohlížeč nebo zapněte hardwarovou akceleraci (WebGL).'],
    ['h1', 'The game could not start'],
    ['p', 'Try reloading the page. If that does not help, use another browser or enable hardware acceleration (WebGL).'],
  ];
  for (const [tag, text] of lines) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (tag === 'h1') node.style.cssText = 'font-size:1.25rem;margin:0.5rem 0';
    box.appendChild(node);
  }
  const code = document.createElement('pre');
  code.textContent = detail;
  code.style.cssText = 'white-space:pre-wrap;opacity:0.7;font-size:0.8rem';
  box.appendChild(code);
  // Ukazatel načítání visí na `body`, ne v `#app` — jinak by překryl zprávu.
  for (const node of document.querySelectorAll('.preloader')) node.remove();
  target.replaceChildren(box);
}

registerServiceWorker();
try {
  await startApp(mount);
} catch (error) {
  showStartupError(mount, error);
}
