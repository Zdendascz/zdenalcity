import type { Balance } from '@/content/balance';
import type { GrantDefinition } from '@/content/schema';
import type { BuildingCatalogue } from '../catalogue';
import { awardGrants, payLoans, rememberPopulation, serviceBonds } from '../finance';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * Splátky a granty (§8 fáze 4).
 *
 * **Granty se zkoumají každý tik**, protože podmínka „spokojenost nad prahem
 * po celý rok" se počítá v tikách a přerušení ji musí zrušit hned. Je to
 * levné: pár definic a jedno porovnání na každou.
 *
 * **Splátky jednou za měsíc**, hned za rozpočtem — město má nejdřív vybrat
 * daně a pak platit. Opačné pořadí by znamenalo, že se splátka strhne z kasy
 * před příjmem a hráč by přišel o měsíc, který mu vyšel.
 */
const MONTH = 30;
/** Za `economySystem` (offset 0), aby se splácelo z už vybraných daní. */
const PAY_OFFSET = 1;

export function createFinanceSystem(
  catalogue: BuildingCatalogue,
  balance: Balance,
  grants: readonly GrantDefinition[],
): System {
  return {
    name: 'finance',
    interval: 1,
    offset: 0,
    run(world: WorldState) {
      awardGrants(world, catalogue, grants);
      if ((world.tick - PAY_OFFSET) % MONTH !== 0) return;

      payLoans(world, balance);
      // Kupóny a splatnosti se zkoumají taky měsíčně, i když se platí ročně:
      // termín se hlídá porovnáním tiků, ne počítáním měsíců, takže stačí se
      // ptát dost často na to, aby se den splatnosti nepřehlédl.
      serviceBonds(world, balance);
      // Populace pro příští měření růstu. Až **po** všem ostatním: růst se
      // měří mezi uzávěrkami, ne uvnitř jedné.
      rememberPopulation(world);
    },
  };
}
