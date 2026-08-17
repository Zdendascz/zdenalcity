import { defineConfig } from 'vite';

// Alias musí být absolutní cesta. Zrcadlí `paths` v tsconfig.json —
// když se změní jedno, musí se změnit i druhé.
export default defineConfig({
  resolve: {
    alias: {
      '@': `${import.meta.dirname}/src`,
    },
  },
});
