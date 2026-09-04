/**
 * Service worker: hra se dá spustit i bez sítě.
 *
 * Strategie je **„nejdřív síť, keš jako záchrana"**, ne obráceně. Hra se ještě
 * mění a keš, která má přednost, by hráči servírovala starou verzi, dokud si
 * neodinstaluje worker. Takhle dostane vždycky to nové, když je připojený,
 * a to poslední stažené, když není.
 *
 * Verze v názvu keše je jediné, co se musí měnit při vydání: stará keš se pak
 * smaže sama.
 */
const CACHE = 'zdenalcity-v1';

/**
 * Co se stáhne dopředu, aby šla hra spustit hned po instalaci.
 *
 * Jen skořápka. Sprity a dlaždice se přidají do keše, jak si o ně hra řekne —
 * je jich přes tři sta a stahovat je při instalaci by znamenalo minutu čekání
 * kvůli něčemu, co si hráč možná nikdy nezobrazí.
 */
const SHELL = ['./', './index.html', './manifest.webmanifest', './brand/favicon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      // Chybějící soubor ve skořápce nesmí zabít instalaci — hra pak běží
      // dál, jen se do keše dostane až za běhu.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Jen GET a jen vlastní původ. Cizí adresy do keše hry nepatří a POST se
  // kešovat nedá.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Do keše jde jen povedená odpověď. Uložit chybu 500 by znamenalo
        // servírovat ji offline napořád.
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached ?? caches.match('./index.html')).then(
          (fallback) => fallback ?? Response.error(),
        ),
      ),
  );
});
