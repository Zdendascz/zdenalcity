import type { Balance } from '@/content/balance';

/**
 * Financování služeb: co hráč zaplatí a co za to dostane (T113).
 *
 * Do teď byl posuvník jen škrtátko — od nuly do sta procent, lineárně, a nad
 * sto se jít nedalo. Autor si vyžádal opak: „možnost nadfinancování služeb.
 * Pro případ katastrofy nebo něco navýšit financování dané služby."
 *
 * Aby to nebyla jen páka, kterou si bohaté město koupí dokonalé pokrytí,
 * platí nad stem dvě věci naráz:
 *
 * - **Cena roste progresivně.** Zadání je dané poměry: krok ze 100 na 110 %
 *   stojí dvakrát tolik co krok z 90 na 100 %, krok ze 190 na 200 %
 *   dvacetkrát tolik.
 * - **Účinek roste jen polovinou.** Na 110 % pokrývá služba jako 105 %,
 *   na 200 % jako 150 %.
 *
 * Do sta procent se nemění nic: kdo škrtá, škrtá pořád lineárně.
 */

/**
 * Kam až smí financování. Dvojnásobek běžného rozpočtu.
 *
 * Je to **konstanta v kódu**, ne v balancu — stejně jako strop daňové sazby
 * (`MAX_TAX_RATE`). Není to laděné číslo, ale mez, ze které vychází celá
 * křivka ceny: poměr „ze 190 na 200 % dvacetkrát dražší" má smysl jen tehdy,
 * když je 200 % opravdu konec.
 */
export const MAX_FUNDING = 2;

/**
 * Kolikanásobek údržby město zaplatí při daném financování.
 *
 * Do sta procent je to prostě ono číslo. Nad ním se přičítá plocha pod
 * mezní sazbou `1 + sklon × (f − 1)`, tedy `(f − 1) + sklon/2 × (f − 1)²`.
 *
 * Odkud se sklon bere: krok o desetinu nad stem má stát `k`-krát tolik co
 * týž krok pod stem, kde `k` je 2 pro první desetinu a 20 pro desátou.
 * Průměrná sazba na prvním kroku je tedy 2 a na desátém 20, což dá
 * `sklon = (20 − 2) / 0,9 = 20` a počáteční sazbu 1 — mezní cena se v sto
 * procentech **napojí spojitě**, žádný schod.
 */
export function fundingCost(balance: Balance, funding: number): number {
  const level = Math.max(0, funding);
  if (level <= 1) return level;
  const over = level - 1;
  return level + (balance.services.costSlope / 2) * over * over;
}

/**
 * Jaký dosah a jakou sílu služba doopravdy má.
 *
 * Nad stem procent se přebytek počítá jen podílem `effectAbove`: přeplatit
 * hasiče smí pomoct, ale nesmí z jedné zbrojnice udělat dvě.
 */
export function fundingEffect(balance: Balance, funding: number): number {
  const level = Math.max(0, funding);
  if (level <= 1) return level;
  return 1 + (level - 1) * balance.services.effectAbove;
}
