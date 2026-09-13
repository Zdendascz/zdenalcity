import type { Balance } from '@/content/balance';
import type { GrantDefinition } from '@/content/schema';
import type { BuildingCatalogue } from '../catalogue';
import { awardGrants, payLoans, rememberPopulation, serviceBonds } from '../finance';
import { pushFinanceNotice } from '../world';
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
/** Rok má 360 tiků (§5). Splatnost dluhopisu se hlásí rok dopředu. */
const YEAR = 360;

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
      // Návratové hodnoty se **nezahazují** (T-revize, nálezy 11 a 12). Dřív
      // odsud vedla cesta jen do kasy: grant přitekl mlčky, zmeškaná splátka
      // taky a hráč viděl jenom to, že si příště půjčí dráž. Fronta zpráv
      // vede ven do rozhraní; sim ji sám nečte.
      for (const id of awardGrants(world, catalogue, grants)) {
        const amount = grants.find((grant) => grant.id === id)?.amount ?? 0;
        pushFinanceNotice(world, { kind: 'grant', grantId: id, amount });
      }
      if ((world.tick - PAY_OFFSET) % MONTH !== 0) return;

      const missed = payLoans(world, balance);
      if (missed > 0) pushFinanceNotice(world, { kind: 'missedPayment', count: missed });

      // Splatnost se hlásí **rok dopředu**. Jistina se platí naráz a v rozpočtu
      // je do té doby vidět jen dvanáctina kupónu, takže by hráče srazil skok,
      // o kterém nic netušil. Okno je široké jeden měsíc a tenhle běh je
      // měsíční, takže na každý dluhopis padne právě jednou — bez nového pole
      // v savu, které by si to pamatovalo.
      for (const bond of world.bonds) {
        if (bond.defaulted) continue;
        const warnAt = bond.maturityTick - YEAR;
        if (world.tick >= warnAt && world.tick < warnAt + MONTH) {
          pushFinanceNotice(world, { kind: 'bondDue', years: 1 });
        }
      }

      // Kupóny a splatnosti se zkoumají taky měsíčně, i když se platí ročně:
      // termín se hlídá porovnáním tiků, ne počítáním měsíců, takže stačí se
      // ptát dost často na to, aby se den splatnosti nepřehlédl.
      const bonds = serviceBonds(world, balance);
      if (bonds.missedCoupons > 0) {
        pushFinanceNotice(world, { kind: 'missedCoupon', count: bonds.missedCoupons });
      }
      if (bonds.defaults > 0) {
        pushFinanceNotice(world, { kind: 'bondDefault', count: bonds.defaults });
      }
      // Populace pro příští měření růstu. Až **po** všem ostatním: růst se
      // měří mezi uzávěrkami, ne uvnitř jedné.
      rememberPopulation(world);
    },
  };
}
