import type { Balance, DemandBase } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import type { WorldState } from '../world';
import { happinessDemandFactor } from './happiness';
// Délka roku je definovaná jednou, u rizika katastrof; druhá konstanta by se
// s ní dřív nebo později rozešla a kalendář by v každém systému běžel jinak.
import { TICKS_PER_YEAR } from '../disasters/risk';
import type { System } from './index';

/**
 * RCI poptávka.
 *
 * Model je záměrně jednoduchý a stojí na jedné myšlence: **lidé chtějí práci
 * a práce chce lidi.** Z toho vyjde celá smyčka §13 sama.
 *
 * - obytná: kladná, dokud je kam chodit do práce (plus základ, aby vůbec začalo)
 * - průmyslová: kladná, když je víc pracujících než míst (rovněž plus základ)
 * - komerční: kladná, když je víc lidí než obchodů
 *
 * Čísla jsou provizorní balanc, ne výsledek ladění — na to je T10.
 *
 * Od T39 se **kladná** obytná poptávka násobí spokojeností města (§9). Jen
 * kladná: záporná poptávka znamená „bytů je dost“ a to s náladou nesouvisí —
 * kdyby se násobila i ta, nespokojené město by hlásilo menší přebytek, tedy
 * přesný opak toho, co se v něm děje.
 *
 * Základ obytné poptávky **s časem slábne** (T108). Obytná a průmyslová byly
 * zrcadlo — jejich součet byl vždycky ten základ — takže konstantní dvacítka
 * znamenala, že v rovnováze vyjde obytná na dvacet a průmyslová na nulu, ať
 * město dělá cokoli. Startér zůstal, palec na váze zmizel: po pěti letech
 * ubývá bod za rok až na pětku.
 *
 * Zrcadlo přesto zůstávalo křivé: i po vyblednutí základu byla průmyslová
 * poptávka po roce 20 kladná jen v pětině vzorků. Změřeno na 12 000 partiích,
 * a **oprava obsahem to jen zhoršila** — poloviční počet prací na dlaždici
 * (T109) sice kladnou poptávku zdvojnásobil, ale sebral městu práci a tím
 * i obyvatele. Vráceno. Průmysl má od T111 **vlastní náskok**: součet už není
 * konstanta a obě strany můžou být v rovnováze kladné zároveň.
 */

/**
 * Náskok poptávky v daném tiku.
 *
 * Prvních pár let drží na plné hodnotě, aby se město vůbec rozjelo — bez
 * něj je na začátku nula obyvatel, nula prací a tím pádem nulová poptávka
 * po čemkoli. Pak ubývá po `perYear` za rok, dokud nedosedne na podlahu.
 *
 * Exportuje se, protože **totéž musí umět i rozpis poptávky v HUD** (§12):
 * kdyby si ho panel počítal po svém, ukazoval by po první změně pravidel
 * jiné číslo, než podle kterého město roste.
 */
export function demandBase(spec: DemandBase, tick: number): number {
  const { start, holdYears, perYear, floor } = spec;
  const year = Math.floor(tick / TICKS_PER_YEAR);
  const faded = start - Math.max(0, year - holdYears) * perYear;
  return Math.max(floor, Math.min(start, faded));
}

/** Náskok obytné poptávky v daném tiku. */
export function residentialBase(balance: Balance, tick: number): number {
  return demandBase(balance.demand.baseResidential, tick);
}

/** Náskok průmyslové poptávky v daném tiku. */
export function industrialBase(balance: Balance, tick: number): number {
  return demandBase(balance.demand.baseIndustrial, tick);
}

export function createDemandSystem(catalogue: BuildingCatalogue, balance: Balance): System {
  const { workerRatio, commercePerCapita, limit } = balance.demand;
  const clampDemand = (value: number): number =>
    Math.max(-limit, Math.min(limit, Math.round(value)));

  return {
    name: 'demand',
    interval: 4,
    offset: 1,
    run(world: WorldState) {
      let population = 0;
      let jobs = 0;
      let commercialJobs = 0;

      for (const building of world.buildings.values()) {
        // Poptávka počítá s tím, co ve městě stojí, bez ohledu na proud.
        // Kdyby budova bez proudu poptávku nesytila, hráč by na místě jedné
        // nefunkční továrny stavěl další a další.
        population += building.population;
        jobs += building.jobs;
        if (catalogue.get(building.definitionId)?.category === 'commercial') {
          commercialJobs += building.jobs;
        }
      }

      const workers = population * workerRatio;

      const rawResidential = residentialBase(balance, world.tick) + (jobs - workers);
      const happiness = happinessDemandFactor(world, balance);
      world.demand.residential = clampDemand(
        rawResidential > 0 ? rawResidential * happiness : rawResidential,
      );
      world.demand.industrial = clampDemand(industrialBase(balance, world.tick) + (workers - jobs));
      world.demand.commercial = clampDemand(population * commercePerCapita - commercialJobs);
    },
  };
}
