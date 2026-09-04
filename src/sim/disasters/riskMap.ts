import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { coarseCellsOf, coarseIndex, coarseSizeOf, COARSE_FACTOR } from '../coarse';
import { index, ROAD, TERRAIN } from '../layers';
import { NEUTRAL_HAPPINESS } from '../world';
import type { WorldState } from '../world';
import { flammableAt } from './fire';

/**
 * Mapa rizika **nepřírodních** katastrof.
 *
 * Autor to zadal takhle: „co se týká nepřírodních katastrof, tam, kde hrozí
 * s vysokou mírou pravděpodobnosti, může být nějaké to varování". Tohle je ten
 * podklad — hráč pak vidí, kterou čtvrť má hlídat a čím.
 *
 * **Přírodní katastrofy se sem nepočítají schválně.** Zemětřesení, tornádo,
 * povodeň ani sesuv nezáleží na tom, co hráč postavil (sesuv skoro, ale ten je
 * o terénu, ne o službách), takže varování před nimi by neneslo žádnou radu.
 * Riziko má smysl jen tam, kde s ním jde něco udělat.
 *
 * Počítá se **maximum přes druhy, ne součet**. Odpověď na „co mi tady hrozí"
 * je jedna konkrétní věc, kterou má hráč řešit; součet by ve čtvrti se třemi
 * drobnými riziky ukázal poplach a ve čtvrti s jedním vážným klid.
 *
 * Čísla nejsou pravděpodobnosti. Jsou to **tytéž veličiny, podle kterých si
 * plánovač vybírá místo** — kdyby se počítaly jinak, hráč by hlídal jinou čtvrť,
 * než na kterou katastrofa doopravdy padne. Odkazy na zdroj jsou u každého
 * druhu níž.
 */

/** Co v buňce hrozí nejvíc. Prázdné, když nehrozí nic. */
export type RiskKind = 'fire' | 'riot' | 'strike' | 'pileup' | 'industrialAccident' | 'epidemic';

export interface RiskMap {
  /** Riziko 0–255 na buňku hrubé mřížky. */
  readonly values: Uint8Array;
  /** Co v té buňce hrozí nejvíc. `undefined` tam, kde nehrozí nic. */
  readonly kinds: readonly (RiskKind | undefined)[];
}

/**
 * Nad tuhle hodnotu se čtvrť považuje za ohroženou.
 *
 * Změřeno, ne odhadnuto. Na městě autora (7 446 obyvatel, 140 obydlených buněk)
 * vyšlo rozložení takhle: medián 89, horní kvartil 200, devátý decil 213,
 * maximum 227. Sto padesát tedy odděluje zhruba **nejhorší třetinu** — dost na
 * to, aby varování něco znamenalo, a málo na to, aby svítilo všude.
 *
 * Nejčastější hrozbou tam byl požár (87 buněk), pak hromadná nehoda (40).
 */
export const RISK_WARNING = 150;

export function computeRiskMap(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
): RiskMap {
  const cells = coarseCellsOf(world.size);
  const values = new Uint8Array(cells);
  const kinds: (RiskKind | undefined)[] = new Array<RiskKind | undefined>(cells).fill(undefined);

  const fireCoverage = world.coverage.get('fire');
  const policeCoverage = world.coverage.get('police');
  const healthCoverage = world.coverage.get('health');

  const fuel = fuelPerCell(world, catalogue, balance);
  const { heavy, homes, roadLoad, built } = contentPerCell(world, catalogue);

  for (let cell = 0; cell < cells; cell++) {
    // Kde nic nestojí, není co ohrozit. Rozhoduje **zástavba, ne obyvatelé**:
    // čerstvě postavená čtvrť ještě nikoho nemá, a přesto v ní může hořet.
    // První verze se ptala na obyvatele a prázdná novostavba jí vyšla na nulu.
    if (!built[cell]) continue;
    const people = homes[cell] ?? 0;

    const crime = (world.coarse.crime[cell] ?? 0) / 255;
    // Nespokojenost se počítá **od neutrálu dolů**, ne od plné stupnice.
    // Průměrná čtvrť není důvod ke stávce; kdyby byla, hlásila by mapa poplach
    // nad každým městem hned po založení (naměřeno: 63 z 255 všude).
    const unhappy = Math.max(
      0,
      (NEUTRAL - (world.happiness[cell] ?? NEUTRAL)) / NEUTRAL,
    );
    const noFire = 1 - (fireCoverage?.[cell] ?? 0) / 255;
    const noPolice = 1 - (policeCoverage?.[cell] ?? 0) / 255;
    const noHealth = 1 - (healthCoverage?.[cell] ?? 0) / 255;

    let best = 0;
    let bestKind: RiskKind | undefined;
    const consider = (kind: RiskKind, score: number): void => {
      if (score <= best) return;
      best = score;
      bestKind = kind;
    };

    // Požár: `pickBurnable` váží přesně takhle — hořlavost × (1 − hasiči)
    // × (1 + kriminalita × 0,8). Dělí se **maximem z katalogu**, aby výsledek
    // byl „jak blízko nejhoršímu možnému", ne bezrozměrný součin: hořlavost
    // sama nikdy nepřeleze 0,55 a bez normalizace by ani vyhořelá čtvrť
    // nedosáhla na půlku stupnice.
    consider('fire', (fuel[cell] ?? 0) * noFire * ((1 + crime * CRIME_BOOST) / (1 + CRIME_BOOST)));
    // Nepokoje a válka gangů míří na buňku s **nejvyšší kriminalitou**;
    // policie je jediné, čím to jde srazit.
    consider('riot', crime * (0.5 + noPolice * 0.5));
    // Stávka si vybírá nespokojenou čtvrť.
    consider('strike', unhappy * unhappy);
    // Hromadná nehoda vzniká na zatížené silnici a bez zdravotnictví trvá dýl.
    consider('pileup', (roadLoad[cell] ?? 0) * (0.6 + noHealth * 0.4));
    // Průmyslová a chemická havárie potřebují těžký provoz.
    consider('industrialAccident', (heavy[cell] ?? 0) * (0.6 + noFire * 0.4));
    // Epidemie: hustě obydlená čtvrť bez doktorů.
    consider('epidemic', densityScore(people) * noHealth);

    values[cell] = Math.max(0, Math.min(255, Math.round(best * 255)));
    kinds[cell] = values[cell] === 0 ? undefined : bestKind;
  }

  return { values, kinds };
}

/**
 * Hořlavost buňky, 0–1: **nejhořlavější dlaždice v ní**.
 *
 * První verze brala průměr a byla špatně. Požár začíná na **jedné dlaždici** a
 * plánovač si ji váží hořlavostí té dlaždice; průměr přes buňku ho zředil
 * loukou a parkovištěm okolo, takže zastavěná čtvrť bez hasičů vyšla na 0,15
 * místo na poplach. Změřeno na testovacím městě: devět domů podél ulice mělo
 * riziko požáru nižší než holá louka riziko stávky.
 */
function fuelPerCell(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
): Float32Array {
  const ceiling = maxFlammability(balance);
  const coarseSize = coarseSizeOf(world.size);
  const worst = new Float32Array(coarseCellsOf(world.size));

  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const tile = index(x, y, world.size);
      if (world.layers.terrain[tile] === TERRAIN.water) continue;
      const cell = Math.floor(y / COARSE_FACTOR) * coarseSize + Math.floor(x / COARSE_FACTOR);
      const flammability = flammableAt(world, catalogue, balance, tile).flammability / ceiling;
      worst[cell] = Math.min(1, Math.max(worst[cell] ?? 0, flammability));
    }
  }
  return worst;
}

/** Těžký průmysl, obyvatelé a zatížení silnic po buňkách. */
function contentPerCell(
  world: WorldState,
  catalogue: BuildingCatalogue,
): {
  heavy: Float32Array;
  homes: Float32Array;
  roadLoad: Float32Array;
  built: Uint8Array;
} {
  const cells = coarseCellsOf(world.size);
  const heavy = new Float32Array(cells);
  const homes = new Float32Array(cells);
  const roadLoad = new Float32Array(cells);
  const built = new Uint8Array(cells);

  for (const building of world.buildings.values()) {
    if (building.abandoned) continue;
    const cell = coarseIndex(building.x, building.y, world.size);
    built[cell] = 1;
    const definition = catalogue.get(building.definitionId);
    if (!definition) continue;
    // Těžký provoz je totéž, co za něj považuje model rizika: průmysl vyšších
    // úrovní a odpadová infrastruktura.
    if (
      definition.category === 'industrial' &&
      (building.level >= 3 || (definition.waste?.capacity ?? 0) > 0)
    ) {
      heavy[cell] = Math.min(1, (heavy[cell] ?? 0) + 0.34);
    }
    homes[cell] = (homes[cell] ?? 0) + building.population;
  }

  const coarseSize = coarseSizeOf(world.size);
  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const tile = index(x, y, world.size);
      if ((world.layers.road[tile] ?? ROAD.none) === ROAD.none) continue;
      const cell = Math.floor(y / COARSE_FACTOR) * coarseSize + Math.floor(x / COARSE_FACTOR);
      built[cell] = 1;
      // Nejzatíženější silnice v buňce, ne průměr: nehoda se stane na té jedné
      // ucpané křižovatce, ne na klidných ulicích okolo.
      roadLoad[cell] = Math.max(roadLoad[cell] ?? 0, Math.min(1, world.trafficLoad[tile] ?? 0));
    }
  }

  return { heavy, homes, roadLoad, built };
}

/**
 * Spokojenost, pod kterou se čtvrť teprve začíná bouřit.
 *
 * Je to `NEUTRAL_HAPPINESS` ze světa. Kopie tady schválně není — kdyby se
 * hodnoty rozešly, mapa by hlásila jinou náladu, než jakou má město.
 */
const NEUTRAL = NEUTRAL_HAPPINESS;

/** Kolik lidí v buňce už je „hustě". Nad `DENSE_CELL` je to plná jednička. */
function densityScore(population: number): number {
  return Math.min(1, population / DENSE_CELL);
}

/**
 * Obyvatel na buňku 4×4, od kterých se čtvrť počítá za hustou.
 *
 * Šestnáct dlaždic uveze zhruba tolik lidí, když je zastavěná činžáky — a to je
 * ta hustota, u které se epidemie šíří rychleji, než ji stihne jedna ordinace.
 */
const DENSE_CELL = 400;

/**
 * O kolik kriminalita zvyšuje šanci na požár. Je to **totéž číslo, jaké má
 * `pickBurnable`** — kdyby se rozešla, mapa by hlídala jinou čtvrť, než na
 * kterou požár doopravdy padne.
 */
const CRIME_BOOST = 0.8;

/**
 * Nejvyšší hořlavost, jakou obsah zná. Slouží jako měřítko: `fuel / tohle` je
 * „jak hořlavá je tahle buňka proti nejhoršímu, co ve hře existuje".
 *
 * Počítá se **z dat, ne z konstanty** (P5) — mod, který přidá hořlavější
 * materiál, tím posune stupnici, místo aby přetekl přes její konec.
 */
function maxFlammability(balance: Balance): number {
  const fire = balance.disasters.fire;
  let best = 0;
  for (const value of Object.values(fire.flammability)) best = Math.max(best, value);
  for (const entry of Object.values(fire.byClass)) best = Math.max(best, entry.flammability);
  return best === 0 ? 1 : best;
}
