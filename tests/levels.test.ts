import { describe, expect, it } from 'vitest';
import type { Balance } from '@/content/balance';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { buildRoad, bulldoze, zoneArea } from '@/sim/commands';
import { coarseIndex } from '@/sim/coarse';
import { index, ZONE } from '@/sim/layers';
import {
  definitionsFor,
  pickDefinition,
  seedDefinitions,
  tryUpgrade,
} from '@/sim/levels';
import {
  createCrimeSystem,
  createGrowthSystem,
  createHealthSystem,
  createLevelSystem,
} from '@/sim/systems';
import { downgradeGrace } from '@/sim/systems/levels';
import { computeBudget } from '@/sim/systems/economy';
import { createWorld, tickWorld } from '@/sim/world';
import type { Building, WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { MAP_SIZE, COARSE_CELLS } from './support/grid';

/**
 * Žebříček definic pro testy. Kód nesmí znát žádnou konkrétní budovu (P5),
 * takže si tady stavím vlastní obsah — stejně jako to dělá vanilla v JSONu.
 */
function definition(
  id: string,
  category: string,
  footprint: [number, number],
  level: number,
  capacity: number,
): Definition {
  return {
    id: `test:${id}`,
    type: 'building',
    category,
    name: `building.${id}.name`,
    description: `building.${id}.desc`,
    footprint,
    level,
    construction: { cost: 100, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
    economy: { upkeep: 1 },
    ...(category === 'residential' ? { population: { capacity } } : { jobs: { capacity } }),
    graphics: { color: '#8fb4dd', heightLevels: level },
  };
}

const HOUSE = definition('house', 'residential', [1, 1], 1, 8);
const HOUSE_L2 = definition('house_l2', 'residential', [1, 1], 2, 14);
const ROW = definition('row', 'residential', [2, 1], 1, 16);
const ROW_L2 = definition('row_l2', 'residential', [2, 1], 2, 28);
const BLOCK = definition('block', 'residential', [2, 2], 1, 32);
const SHOP = definition('shop', 'commercial', [1, 1], 1, 6);

const TOWER = definition('tower', 'residential', [2, 2], 3, 64);

const LADDER = [HOUSE, HOUSE_L2, ROW, ROW_L2, BLOCK, TOWER, SHOP];

function catalogueOf(...definitions: Definition[]): BuildingCatalogue {
  return {
    get: (id) => definitions.find((d) => d.id === id),
    byCategory: (category) => definitions.filter((d) => d.category === category),
  };
}

/** Svět s obytnou zónou 10×10 a silnicí nahoře, připravený na povyšování. */
function zonedWorld(): WorldState {
  const world = createWorld(1);
  for (let x = 4; x <= 16; x++) buildRoad(world, x, 4);
  zoneArea(world, 5, 5, 10, 10, ZONE.residential);
  world.demand.residential = 20;
  return world;
}

/** Cena půdy na hrubé mřížce v okolí dlaždice. */
function setLandValue(
  world: WorldState,
  x: number,
  y: number,
  value: number,
): void {
  world.coarse.landValue[coarseIndex(x, y, MAP_SIZE)] = value;
}

function at(world: WorldState, x: number, y: number): Building | undefined {
  const id = world.layers.buildingId[index(x, y, MAP_SIZE)] ?? 0;
  return world.buildings.get(id);
}

describe('vyhledávání definic (R5)', () => {
  const catalogue = catalogueOf(...LADDER);

  it('najde definici podle trojice kategorie, půdorys, úroveň', () => {
    expect(definitionsFor(catalogue, 'residential', 2, 1, 1)).toEqual([ROW]);
    expect(definitionsFor(catalogue, 'residential', 1, 1, 2)).toEqual([HOUSE_L2]);
  });

  it('chybějící kombinace není chyba, jen nedostupná cesta', () => {
    const world = createWorld(1);
    expect(definitionsFor(catalogue, 'residential', 3, 3, 1)).toEqual([]);
    expect(pickDefinition(world, catalogue, 'residential', 2, 2, 5)).toBeUndefined();
  });

  it('nezaměňuje orientaci půdorysu', () => {
    // 2×1 a 1×2 jsou dvě různé budovy; katalog má jen tu první.
    expect(definitionsFor(catalogue, 'residential', 1, 2, 1)).toEqual([]);
  });

  it('výchozí zástavba je nejmenší půdorys první úrovně', () => {
    expect(seedDefinitions(catalogue, 'residential')).toEqual([HOUSE]);
    expect(seedDefinitions(catalogue, 'commercial')).toEqual([SHOP]);
    expect(seedDefinitions(catalogue, 'industrial')).toEqual([]);
  });
});

describe('povýšení', () => {
  it('rozšíří se do volné parcely dřív, než vyroste o patro', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, HOUSE, 6, 6);

    expect(tryUpgrade(world, catalogueOf(...LADDER), building)).toBe(true);

    // Šířka má přednost před výškou: z domu je řadovka, ne patrový dům.
    expect(building.definitionId).toBe(ROW.id);
    expect(building.level).toBe(1);
    expect(at(world, 7, 6)?.id).toBe(building.id);
  });

  it('směr +x má přednost před ostatními', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, HOUSE, 6, 6);

    tryUpgrade(world, catalogueOf(...LADDER), building);

    expect(building.x).toBe(6); // roh se neposunul, budova rostla doprava
    expect(at(world, 5, 6)).toBeUndefined();
  });

  it('pohltí souseda s nižší úrovní (R1)', () => {
    const world = zonedWorld();
    const upper = placeBuilding(world, HOUSE_L2, 6, 6);
    const lower = placeBuilding(world, HOUSE, 7, 6);

    expect(tryUpgrade(world, catalogueOf(...LADDER), upper)).toBe(true);

    expect(upper.definitionId).toBe(ROW_L2.id);
    expect(world.buildings.has(lower.id)).toBe(false);
    expect(at(world, 7, 6)?.id).toBe(upper.id);
  });

  it('souseda stejné úrovně nepohltí — obejde ho do jiného směru', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, HOUSE, 6, 6);
    const peer = placeBuilding(world, HOUSE, 7, 6);

    tryUpgrade(world, catalogueOf(...LADDER), building);

    // Vpravo stojí rovnocenný soused, takže se budova rozšíří doleva.
    expect(world.buildings.has(peer.id)).toBe(true);
    expect(building.x).toBe(5);
    expect(at(world, 5, 6)?.id).toBe(building.id);
  });

  it('nepohltí budovu jiné kategorie', () => {
    const world = zonedWorld();
    // Obchod je nižší úrovně, ale patří jinam než obytný žebříček.
    const building = placeBuilding(world, HOUSE_L2, 6, 6);
    placeBuilding(world, SHOP, 7, 6);

    tryUpgrade(world, catalogueOf(...LADDER), building);

    expect(building.x).toBe(5); // uhnul doleva
    expect(at(world, 7, 6)?.definitionId).toBe(SHOP.id);
  });

  it('nepřeteče do jiné zóny ani na silnici', () => {
    const world = zonedWorld();
    // Parcela na okraji zóny: kolem dokola je nezónovaná tráva, nahoře silnice.
    zoneArea(world, 5, 5, 10, 10, ZONE.none);
    zoneArea(world, 6, 6, 1, 1, ZONE.residential);
    const building = placeBuilding(world, HOUSE, 6, 6);

    // Katalog bez vyššího patra, aby test měřil jen rozšiřování.
    expect(tryUpgrade(world, catalogueOf(HOUSE, ROW, BLOCK), building)).toBe(false);
    expect(building.definitionId).toBe(HOUSE.id);
  });

  it('sevřená parcela vyroste do výšky místo do šířky', () => {
    const world = zonedWorld();
    zoneArea(world, 5, 5, 10, 10, ZONE.none);
    zoneArea(world, 6, 6, 1, 1, ZONE.residential);
    const building = placeBuilding(world, HOUSE, 6, 6);

    expect(tryUpgrade(world, catalogueOf(...LADDER), building)).toBe(true);
    expect(building.definitionId).toBe(HOUSE_L2.id);
  });

  it('bez místa na rozšíření vyroste o patro', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, HOUSE, 6, 6);
    // Obklopit rovnocennými sousedy — širší půdorys je tím vyloučený.
    placeBuilding(world, HOUSE, 5, 6);
    placeBuilding(world, HOUSE, 7, 6);
    placeBuilding(world, HOUSE, 6, 5);
    placeBuilding(world, HOUSE, 6, 7);

    expect(tryUpgrade(world, catalogueOf(...LADDER), building)).toBe(true);
    expect(building.definitionId).toBe(HOUSE_L2.id);
    expect(building.level).toBe(2);
  });

  it('bez další definice se neděje nic', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, HOUSE, 6, 6);

    // Katalog zná jen výchozí dům — žádná cesta výš ani do šířky.
    expect(tryUpgrade(world, catalogueOf(HOUSE), building)).toBe(false);
    expect(building.definitionId).toBe(HOUSE.id);
  });

  it('kapacitu určuje nová definice, nesčítá se', () => {
    const world = zonedWorld();
    const upper = placeBuilding(world, HOUSE_L2, 6, 6);
    placeBuilding(world, HOUSE, 7, 6);
    expect(upper.population + 8).not.toBe(ROW_L2.population?.capacity);

    tryUpgrade(world, catalogueOf(...LADDER), upper);

    expect(upper.population).toBe(ROW_L2.population?.capacity);
  });

  it('entita si drží identitu i datum stavby', () => {
    const world = zonedWorld();
    world.tick = 100;
    const building = placeBuilding(world, HOUSE, 6, 6);
    const { id } = building;

    world.tick = 400;
    tryUpgrade(world, catalogueOf(...LADDER), building);

    expect(building.id).toBe(id);
    expect(building.builtAtTick).toBe(100); // pro město je to pořád ten samý dům
    expect(building.levelChangedAtTick).toBe(400);
  });

  it('po pohlcení nezůstane ve vrstvě otisk staré budovy', () => {
    const world = zonedWorld();
    const upper = placeBuilding(world, HOUSE_L2, 6, 6);
    const lower = placeBuilding(world, HOUSE, 7, 6);

    tryUpgrade(world, catalogueOf(...LADDER), upper);

    for (const tile of world.layers.buildingId) {
      expect(tile).not.toBe(lower.id);
    }
  });
});

describe('systém úrovní', () => {
  const catalogue = catalogueOf(...LADDER);
  const balance = VANILLA_BALANCE;
  const levels = createLevelSystem(catalogue, balance);

  /**
   * Odtiká tolik, aby po vypršení cooldownu systém úrovní ještě proběhl.
   * Čerstvě postavená budova má cooldown od chvíle, kdy vznikla.
   */
  function run(world: WorldState): void {
    const ticks = balance.levels.cooldown + levels.interval * 2;
    for (let i = 0; i < ticks; i++) tickWorld(world, [levels]);
  }

  it('bez dost drahé půdy budova nepovýší', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, HOUSE, 6, 6);
    // I s úlevou za poptávku, kterou `zonedWorld` nastavuje, je to málo.
    setLandValue(world, 6, 6, (balance.levels.thresholds[2] ?? 0) - balance.levels.demandRelief - 1);

    run(world);

    expect(building.definitionId).toBe(HOUSE.id);
  });

  it('nad prahem povýší', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, HOUSE, 6, 6);
    setLandValue(world, 6, 6, balance.levels.thresholds[2] ?? 0);

    run(world);

    expect(building.definitionId).toBe(ROW.id);
  });

  it('vysoká poptávka sníží práh povýšení', () => {
    const { thresholds, demandRelief } = balance.levels;
    // Pod prahem, ale v dosahu úlevy při plné poptávce.
    const landValue = (thresholds[2] ?? 0) - Math.round(demandRelief / 2);

    const pressed = zonedWorld();
    pressed.demand.residential = balance.demand.limit;
    const pressedBuilding = placeBuilding(pressed, HOUSE, 6, 6);
    setLandValue(pressed, 6, 6, landValue);
    run(pressed);
    expect(pressedBuilding.definitionId).toBe(ROW.id);

    const calm = zonedWorld();
    calm.demand.residential = 1; // poptávka je, ale žádný tlak
    const calmBuilding = placeBuilding(calm, HOUSE, 6, 6);
    setLandValue(calm, 6, 6, landValue);
    run(calm);
    expect(calmBuilding.definitionId).toBe(HOUSE.id);
  });

  it('budova povýšená díky poptávce hned zase nespadne', () => {
    // Regrese: úleva se odečítala jen od horního prahu, takže se pásmo mezi
    // prahy převrátilo — dům povýšil při 65 a hned spadl pod 75. Na uloženém
    // městě autora takhle kmitalo devět domů donekonečna.
    const world = zonedWorld();
    world.demand.residential = balance.demand.limit;
    const building = placeBuilding(world, HOUSE, 6, 6);
    setLandValue(world, 6, 6, (balance.levels.thresholds[2] ?? 0) - balance.levels.demandRelief);

    run(world);
    expect(building.definitionId).toBe(ROW.id);
    const level = building.level;

    // A dál už se nic měnit nemá, ani po několika dalších vyhodnoceních.
    for (let i = 0; i < balance.levels.cooldown * 4; i++) tickWorld(world, [levels]);
    expect(building.level).toBe(level);
    expect(building.definitionId).not.toBe(HOUSE.id);
  });

  it('opuštění nezávisí na šířce hystereze', () => {
    // Regrese: opuštění vycházelo ze spodního prahu úrovně 1, který je nula
    // mínus hystereze. Rozšíření hystereze na 35 tím zrušilo opuštění úplně,
    // protože penalizace za zanedbanost je 25. Pod první úrovní se hystereze
    // ani úleva neuplatňují — s ruinou není co kmitat.
    const wide: Balance = {
      ...balance,
      levels: { ...balance.levels, hysteresis: 200, demandRelief: 200 },
    };
    const world = zonedWorld();
    world.tick = balance.levels.decayAge + 1;
    const building = placeBuilding(world, HOUSE, 6, 6);
    building.builtAtTick = 0;

    const system = createLevelSystem(catalogue, wide);
    // Lhůta z důvěry (T108) — domek ji má nejkratší, ale i tak delší než pět
    // vyhodnocení, se kterými test počítal, dokud byla lhůta pevná trojka.
    const evaluations = downgradeGrace(wide, HOUSE) + 1;
    for (let i = 0; i < wide.levels.cooldown + system.interval * evaluations; i++) {
      tickWorld(world, [system]);
    }

    expect(building.abandoned).toBe(true);
  });

  it('propadlá čtvrť klesne i při plné poptávce', () => {
    const world = zonedWorld();
    world.demand.residential = balance.demand.limit;
    const building = placeBuilding(world, HOUSE_L2, 6, 6);
    // Pod spodním prahem i s celou úlevou — takovou čtvrť poptávka nezachrání.
    setLandValue(
      world,
      6,
      6,
      Math.max(
        0,
        (balance.levels.thresholds[2] ?? 0) -
          balance.levels.hysteresis -
          balance.levels.demandRelief -
          1,
      ),
    );

    const evaluations = downgradeGrace(balance, HOUSE_L2) + 1;
    for (let i = 0; i < balance.levels.cooldown + levels.interval * evaluations; i++) {
      tickWorld(world, [levels]);
    }

    expect(building.definitionId).toBe(HOUSE.id);
  });

  it('bez poptávky se nerozšiřuje ani na drahé půdě', () => {
    const world = zonedWorld();
    world.demand.residential = 0;
    const building = placeBuilding(world, HOUSE, 6, 6);
    setLandValue(world, 6, 6, 255);

    run(world);

    expect(building.definitionId).toBe(HOUSE.id);
  });

  it('cooldown drží budovu na místě, dokud neuběhne', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, HOUSE, 6, 6);
    setLandValue(world, 6, 6, 255);

    run(world);
    const afterFirst = building.definitionId;
    expect(afterFirst).toBe(ROW.id);

    // Hned po povýšení má cooldown zabránit dalšímu kroku.
    for (let i = 0; i < levels.interval; i++) tickWorld(world, [levels]);
    expect(building.definitionId).toBe(afterFirst);

    // Po cooldownu se rozšíří znovu — z řadovky je blok.
    for (let i = 0; i < balance.levels.cooldown; i++) tickWorld(world, [levels]);
    expect(building.definitionId).toBe(BLOCK.id);
  });

  it('nesahá na budovy mimo zónové kategorie', () => {
    const world = zonedWorld();
    const service = definition('depot', 'utility', [1, 1], 1, 0);
    const bigger = definition('depot_big', 'utility', [2, 1], 1, 0);
    const building = placeBuilding(world, service, 6, 6);
    setLandValue(world, 6, 6, 255);

    const utilities = createLevelSystem(catalogueOf(service, bigger), balance);
    for (let i = 0; i < utilities.interval * 2; i++) tickWorld(world, [utilities]);

    expect(building.definitionId).toBe(service.id);
  });
});

describe('snížení a opuštění', () => {
  const catalogue = catalogueOf(...LADDER);
  const balance = VANILLA_BALANCE;
  const levels = createLevelSystem(catalogue, balance);

  /**
   * Cena půdy, při které budova dané úrovně padá pod práh i s hysterezí
   * a celou úlevou za poptávku — tedy bez ohledu na to, jak moc se zrovna
   * chce stavět.
   */
  function belowFloor(level: number): number {
    const { thresholds, hysteresis, demandRelief } = balance.levels;
    return Math.max(0, (thresholds[level] ?? 0) - hysteresis - demandRelief - 1);
  }

  /**
   * Odtiká cooldown a k tomu tolik vyhodnocení, kolik lhůta vyžaduje.
   *
   * Lhůta se počítá **z definice**, ne z jednoho čísla v balancu: od T108 roste
   * s plochou půdorysu, takže věž ji má delší než domek.
   */
  function run(world: WorldState, definition: Definition, extra = 1): void {
    const evaluations = downgradeGrace(balance, definition) + extra;
    const ticks = balance.levels.cooldown + levels.interval * evaluations;
    for (let i = 0; i < ticks; i++) tickWorld(world, [levels]);
  }

  it('jeden výkyv budovu neshodí, teprve celá lhůta', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, HOUSE_L2, 6, 6);
    setLandValue(world, 6, 6, belowFloor(2));

    // O dvě vyhodnocení míň, než kolik lhůta vyžaduje.
    run(world, HOUSE_L2, -2);
    expect(building.definitionId).toBe(HOUSE_L2.id);

    run(world, HOUSE_L2);
    expect(building.definitionId).toBe(HOUSE.id);
    expect(building.level).toBe(1);
  });

  /**
   * Setrvačnost podle velikosti (T108).
   *
   * Autor si vyžádal, aby „malý domek zchátral pětkrát rychleji než největší
   * budova". Test hlídá **poměr**, ne konkrétní čísla: ta jsou v balancu a
   * mají se dát ladit bez přepisování testu.
   */
  it('větší budova drží pod prahem déle než malá', () => {
    const small = downgradeGrace(balance, HOUSE_L2);
    const big = downgradeGrace(balance, TOWER);
    expect(big).toBeGreaterThan(small);

    const world = zonedWorld();
    const house = placeBuilding(world, HOUSE_L2, 6, 6);
    const tower = placeBuilding(world, TOWER, 10, 10);
    // Pod spodním prahem obou: domek je úroveň 2, věž 3, takže stačí ta nižší.
    setLandValue(world, 6, 6, belowFloor(2));
    setLandValue(world, 10, 10, belowFloor(2));

    // Přesně na lhůtu domku: ten spadne, věž ještě drží.
    run(world, HOUSE_L2);
    expect(house.definitionId, 'domek už klesl').toBe(HOUSE.id);
    expect(tower.definitionId, 'věž ještě drží').toBe(TOWER.id);
  });

  it('hystereze drží budovu těsně pod prahem', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, HOUSE_L2, 6, 6);
    // Pod prahem úrovně 2, ale ne o víc než hystereze.
    setLandValue(world, 6, 6, (balance.levels.thresholds[2] ?? 0) - 1);

    run(world, HOUSE_L2);

    expect(building.definitionId).toBe(HOUSE_L2.id);
  });

  it('bez definice pro stejný půdorys se budova scvrkne a uvolní parcely', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, TOWER, 6, 6);
    setLandValue(world, 6, 6, belowFloor(3));

    run(world, TOWER);

    // Pro 2×2 na úrovni 2 definice není, takže zbyde největší, co se vejde.
    expect(building.definitionId).toBe(ROW_L2.id);
    expect(at(world, 6, 6)?.id).toBe(building.id);
    expect(at(world, 7, 6)?.id).toBe(building.id);
    // Uvolněné dlaždice zůstanou prázdné, ale pořád zónované.
    expect(at(world, 6, 7)).toBeUndefined();
    expect(world.layers.zone[index(6, 7, MAP_SIZE)]).toBe(ZONE.residential);
  });

  it('pod úrovní 1 budova zůstane stát jako ruina', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, HOUSE, 6, 6);
    setLandValue(world, 6, 6, belowFloor(1));
    // Práh úrovně 1 je nula, takže sama o sobě cena půdy dům nesloží.
    // Ruinu z něj udělá až zanedbanost: starý dům v neobsloužené buňce.
    world.tick = balance.levels.decayAge + 1;

    run(world, HOUSE);

    expect(building.abandoned).toBe(true);
    expect(building.population).toBe(0);
    expect(building.jobs).toBe(0);
    // Stojí dál — hráč ji musí zbourat.
    expect(world.buildings.has(building.id)).toBe(true);
    expect(at(world, 6, 6)?.id).toBe(building.id);
  });

  it('ruina se dál nepovyšuje ani nesnižuje', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, HOUSE, 6, 6);
    building.abandoned = true;
    setLandValue(world, 6, 6, 255);

    run(world, HOUSE);

    expect(building.definitionId).toBe(HOUSE.id);
    expect(building.abandoned).toBe(true);
  });

  it('rostoucí soused ruinu nepohltí — uklidit ji musí hráč', () => {
    const world = zonedWorld();
    const upper = placeBuilding(world, HOUSE_L2, 6, 6);
    const ruin = placeBuilding(world, HOUSE, 7, 6);
    ruin.abandoned = true;

    tryUpgrade(world, catalogue, upper);

    expect(world.buildings.has(ruin.id)).toBe(true);
    expect(upper.x).toBe(5); // uhnul doleva
  });

  it('zbourat ruinu jde', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, HOUSE, 6, 6);
    building.abandoned = true;

    expect(bulldoze(world, 6, 6).ok).toBe(true);
    expect(world.buildings.has(building.id)).toBe(false);
  });

  it('stará budova v neobsloužené buňce chátrá, mladá ne', () => {
    const landValue = (balance.levels.thresholds[2] ?? 0) - balance.levels.hysteresis + 1;

    const young = zonedWorld();
    const youngBuilding = placeBuilding(young, HOUSE_L2, 6, 6);
    setLandValue(young, 6, 6, landValue);
    run(young, HOUSE_L2);
    expect(youngBuilding.definitionId).toBe(HOUSE_L2.id);

    const old = zonedWorld();
    old.tick = balance.levels.decayAge + 1;
    const oldBuilding = placeBuilding(old, HOUSE_L2, 6, 6);
    oldBuilding.builtAtTick = 0; // stojí od začátku hry
    setLandValue(old, 6, 6, landValue);
    run(old, HOUSE_L2);

    // Stejná cena půdy, jiný osud: penalizace za zanedbanost ji stlačí pod práh.
    expect(oldBuilding.definitionId).toBe(HOUSE.id);
  });

  it('obsloužená čtvrť nechátrá, ani když je stará', () => {
    const world = zonedWorld();
    world.tick = balance.levels.decayAge + 1;
    const building = placeBuilding(world, HOUSE_L2, 6, 6);
    building.builtAtTick = 0;
    setLandValue(world, 6, 6, (balance.levels.thresholds[2] ?? 0) - balance.levels.hysteresis + 1);

    // Plné pokrytí jediné třídy, kterou město má.
    world.coverage.set('police', new Uint8Array(COARSE_CELLS).fill(255));

    run(world, HOUSE_L2);

    expect(building.definitionId).toBe(HOUSE_L2.id);
  });
});

describe('důsledky opuštění', () => {
  const catalogue = catalogueOf(...LADDER);
  const balance = VANILLA_BALANCE;

  it('ruina nedaní a nestojí údržbu', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, HOUSE, 6, 6);
    building.powered = true;

    const before = computeBudget(world, catalogue, balance);
    expect(before.income).toBeGreaterThan(0);

    // Populace se schválně nenuluje: rozpočet musí ruinu vynechat sám o sobě,
    // ne jen proto, že v ní náhodou nikdo nebydlí.
    building.abandoned = true;
    const after = computeBudget(world, catalogue, balance);

    expect(after.income).toBe(0);
    // Ve výdajích zbydou jen silnice — ruina sama nestojí nic.
    expect(after.expenses).toBe(after.roads.upkeep);
    expect(after.lines[0]?.upkeepCount).toBe(0);
  });

  it('ruina zvedá kriminalitu', () => {
    const clean = zonedWorld();
    const dirty = zonedWorld();
    const ruin = placeBuilding(dirty, HOUSE, 6, 6);
    ruin.abandoned = true;

    const crime = createCrimeSystem(balance);
    for (let i = 0; i < crime.interval * 4; i++) {
      tickWorld(clean, [crime]);
      tickWorld(dirty, [crime]);
    }

    const cell = coarseIndex(6, 6, MAP_SIZE);
    expect(dirty.coarse.crime[cell] ?? 0).toBeGreaterThan(
      clean.coarse.crime[cell] ?? 0,
    );
  });

  it('do ruiny se nikdo nenastěhuje zpátky', () => {
    const world = zonedWorld();
    const building = placeBuilding(world, HOUSE, 6, 6);
    building.abandoned = true;
    building.population = 0;
    world.coverage.set('health', new Uint8Array(COARSE_CELLS).fill(255));

    const health = createHealthSystem(catalogue, balance);
    for (let i = 0; i < health.interval * 4; i++) tickWorld(world, [health]);

    expect(building.population).toBe(0);
  });
});

describe('vanilla žebříček (§13 krok 5)', () => {
  it('dům v drahé čtvrti vyroste na úroveň 3 a pohltí sousedy', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    const balance = content.getBalance();

    const world = zonedWorld();
    const house = content.get('vanilla:residential_small');
    expect(house).toBeDefined();
    if (!house) return;

    const building = placeBuilding(world, house, 6, 6);

    // Cena půdy nastavená ručně: tenhle test zkoumá žebříček, ne difuzi.
    // Systém ceny půdy proto neběží a hodnota vydrží.
    setLandValue(world, 6, 6, 255);
    const levels = createLevelSystem(content, balance);
    const run = (rounds: number) => {
      for (let tick = 0; tick < balance.levels.cooldown * rounds; tick++) {
        tickWorld(world, [levels]);
      }
    };

    // Nejdřív sám: z domku je řadovka a z ní dvoupatrová řada.
    run(3);
    expect(content.get(building.definitionId)?.footprint).toEqual([2, 1]);
    expect(building.level).toBe(2);

    // Teď přistaví soused první úrovně přesně tam, kam se chce rozrůst.
    const younger = [placeBuilding(world, house, 6, 7), placeBuilding(world, house, 7, 7)];
    run(4);

    // Pohltil je a stojí nejmíň na čtyřech parcelách (§13 krok 5). Od doplnění
    // žebříčku na pět úrovní se rozrůstá dál, takže se tu neověřuje přesný
    // půdorys, ale to, co ten krok znamená: sousedi zmizeli a dům je větší.
    const footprint = content.get(building.definitionId)?.footprint ?? [1, 1];
    expect(footprint[0] * footprint[1]).toBeGreaterThanOrEqual(4);
    expect(building.level).toBeGreaterThanOrEqual(3);
    for (const neighbour of younger) {
      expect(world.buildings.has(neighbour.id)).toBe(false);
    }
    expect(world.buildings.size).toBe(1);
    expect(building.population).toBeGreaterThan((house.population?.capacity ?? 0) * 4);

    // A na špičkové parcele dojde až na konec žebříčku (§8 fáze 2: úrovně 1–5).
    for (let x = 4; x < 12; x++) {
      for (let y = 4; y < 12; y++) setLandValue(world, x, y, 255);
    }
    run(20);
    expect(building.level).toBe(5);
    const top = content.get(building.definitionId);
    expect(top?.footprint).toEqual([3, 3]);
  });
});

describe('růst staví jen výchozí zástavbu', () => {
  it('na volné parcele nevyroste nic z vyšších pater žebříčku', () => {
    const world = zonedWorld();
    const growth = createGrowthSystem(catalogueOf(...LADDER), VANILLA_BALANCE);

    for (let tick = 0; tick < 200; tick++) tickWorld(world, [growth]);

    expect(world.buildings.size).toBeGreaterThan(0);
    for (const building of world.buildings.values()) {
      expect(building.definitionId).toBe(HOUSE.id);
    }
  });
});
