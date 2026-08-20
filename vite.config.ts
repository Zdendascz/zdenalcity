import { defineConfig } from 'vite';

// Alias musí být absolutní cesta. Zrcadlí `paths` v tsconfig.json —
// když se změní jedno, musí se změnit i druhé.
export default defineConfig({
  // Relativní cesty k assetům, ať se build dá pověsit i do podadresáře
  // (`games.zdendas.cz/zdenalcity/`) nebo na itch.io. S výchozím `/` by
  // prohlížeč hledal `/assets/...` v kořeni domény a nenašel nic.
  base: './',
  resolve: {
    alias: {
      '@': `${import.meta.dirname}/src`,
    },
  },
});
