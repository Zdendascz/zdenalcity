import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * Značka sestavení: krátký hash commitu a čas, kdy build vznikl.
 *
 * Vypisuje se na úvodní obrazovce, aby šlo poznat, jestli hráč kouká na verzi
 * z minulého týdne, nebo na rok starou. Ptát se na to jde jinak jen tak, že
 * člověk otevře repozitář — a to hráč neudělá.
 *
 * Hash se bere z gitu **při sestavení**, ne za běhu: hotový build git nemá.
 * Když git chybí (stažený archiv, cizí CI), zůstane pomlčka a datum stačí.
 */
function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '—';
  }
}

/**
 * Doplní do service workeru **verzi sestavení**.
 *
 * Worker leží v `public/`, kam Vite nesahá — `define` se do něj tedy nedostane
 * a jméno keše by zůstalo navždy `zdenalcity-v1`. Produkce to nahlásila: keš se
 * po dvou nasazeních neuklidila a nabalovala sprity ze všech verzí.
 *
 * Ruční číslování by fungovalo jen do prvního zapomenutí; hash commitu se
 * změní vždycky, když se změní kód, a stará keš se pak smaže sama v `activate`.
 */
function stampServiceWorker(version: string): Plugin {
  return {
    name: 'stamp-service-worker',
    // `writeBundle` běží až po tom, co Vite nakopíruje `public/` do `dist/`.
    writeBundle(options) {
      const target = `${options.dir ?? 'dist'}/service-worker.js`;
      try {
        const source = readFileSync(target, 'utf8');
        writeFileSync(target, source.replace(SERVICE_WORKER_VERSION, version), 'utf8');
      } catch {
        // Bez workeru se hra pořád postaví; offline režim je nadstavba.
      }
    },
  };
}

/** Zástupný text v `public/service-worker.js`, který se při buildu nahradí. */
const SERVICE_WORKER_VERSION = '__BUILD_VERSION__';

// Alias musí být absolutní cesta. Zrcadlí `paths` v tsconfig.json —
// když se změní jedno, musí se změnit i druhé.
const BUILD_COMMIT = commit();
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  plugins: [stampServiceWorker(`${BUILD_COMMIT}-${BUILD_TIME.slice(0, 10)}`)],
  // Relativní cesty k assetům, ať se build dá pověsit i do podadresáře
  // (`games.zdendas.cz/zdenalcity/`) nebo na itch.io. S výchozím `/` by
  // prohlížeč hledal `/assets/...` v kořeni domény a nenašel nic.
  base: './',
  build: {
    /*
     * Obrázky obsahu se **nevkládají do JS jako `data:`** (T134).
     *
     * Vite pod 4 kB vkládá, takže díly, podezdívky a ikony skončily v hlavním
     * skriptu jako base64: 168 kB navíc, které se parsují při každém startu
     * a nedají se kešovat zvlášť, i když se obrázky nemění. Jako soubory je
     * prohlížeč stáhne jednou a drží pod otiskem natrvalo; HTTP/2 je pošle
     * po jednom spojení. Ostatní assety se řídí výchozí mezí.
     */
    assetsInlineLimit: (filePath) => (/[\\/]content[\\/]vanilla[\\/]/.test(filePath) ? false : undefined),
  },
  define: {
    __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
    // Ve vývoji je to čas spuštění `vite`, ne čas buildu. Je to tak správně:
    // ve vývoji žádný build není a datum má říkat, jak staré je to, co běží.
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  resolve: {
    alias: {
      '@': `${import.meta.dirname}/src`,
    },
  },
});
