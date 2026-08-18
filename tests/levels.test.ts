import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { buildRoad, zoneArea } from '@/sim/commands';
import { coarseIndex } from '@/sim/coarse';
import { index, ZONE } from '@/sim/layers';
import { definitionsFor, pickDefinition, seedDefinitions, tryUpgrade } from '@/sim/levels';
import { createGrowthSystem, createLevelSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { Building, WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';

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

const LADDER = [HOUSE, HOUSE_L2, ROW, ROW_L2, BLOCK, SHOP];

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
function setLandValue(world: WorldState, x: number, y: number, value: number): void {
  world.coarse.landValue[coarseIndex(x, y)] = value;
}

function at(world: WorldState, x: number, y: number): Building | undefined {
  const id = world.layers.buildingId[index(x, y)] ?? 0;
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
    setLandValue(world, 6, 6, (balance.levels.thresholds[2] ?? 0) - 1);

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

    // Pohltil je a stojí na čtyřech parcelách (§13 krok 5).
    expect(content.get(building.definitionId)?.footprint).toEqual([2, 2]);
    expect(building.level).toBe(3);
    for (const neighbour of younger) {
      expect(world.buildings.has(neighbour.id)).toBe(false);
    }
    expect(world.buildings.size).toBe(1);
    expect(building.population).toBeGreaterThan((house.population?.capacity ?? 0) * 4);
  });
});

describe('růst staví jen výchozí zástavbu', () => {
  it('na volné parcele nevyroste nic z vyšších pater žebříčku', () => {
    const world = zonedWorld();
    const growth = createGrowthSystem(catalogueOf(...LADDER));

    for (let tick = 0; tick < 200; tick++) tickWorld(world, [growth]);

    expect(world.buildings.size).toBeGreaterThan(0);
    for (const building of world.buildings.values()) {
      expect(building.definitionId).toBe(HOUSE.id);
    }
  });
});
