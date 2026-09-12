import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

/**
 * Nastavení testů zvlášť od `vite.config.ts`.
 *
 * Existuje kvůli jediné věci: **vyloučit `.claude/`**. Úkoly na pozadí si tam
 * zakládají pracovní kopie repozitáře, a protože leží uvnitř projektu, vitest
 * v nich našel druhou sadu testů a pouštěl rozdělanou práci jiného sezení.
 * `npm run check` pak padal na věcech, které v repozitáři nejsou.
 *
 * Sloučení, ne vlastní konfigurace: aliasy a `define` musí zůstat tytéž, jaké
 * má hra při sestavení.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      exclude: [...configDefaults.exclude, '.claude/**'],
    },
  }),
);
