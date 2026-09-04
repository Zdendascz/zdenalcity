import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';

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

// Alias musí být absolutní cesta. Zrcadlí `paths` v tsconfig.json —
// když se změní jedno, musí se změnit i druhé.
export default defineConfig({
  // Relativní cesty k assetům, ať se build dá pověsit i do podadresáře
  // (`games.zdendas.cz/zdenalcity/`) nebo na itch.io. S výchozím `/` by
  // prohlížeč hledal `/assets/...` v kořeni domény a nenašel nic.
  base: './',
  define: {
    __BUILD_COMMIT__: JSON.stringify(commit()),
    // Ve vývoji je to čas spuštění `vite`, ne čas buildu. Je to tak správně:
    // ve vývoji žádný build není a datum má říkat, jak staré je to, co běží.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': `${import.meta.dirname}/src`,
    },
  },
});
