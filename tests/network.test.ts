import { describe, expect, it } from 'vitest';
import { validateBalance } from '@/content/balance';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { buildPipe, buildRoad, placeDefinition, zoneArea } from '@/sim/commands';
import { coarseIndex, coarseSizeOf } from '@/sim/coarse';
import { createBlackoutDisaster } from '@/sim/disasters/blackout';
import { createChemicalSpillDisaster } from '@/sim/disasters/chemicalSpill';
import { clearInfection, createEpidemicDisaster } from '@/sim/disasters/epidemic';
import { strongestModifier } from '@/sim/disasters/effects';
import { DisasterRegistry } from '@/sim/disasters/registry';
import { createDisasterSystem, startDisaster } from '@/sim/disasters/scheduler';
import { index, ROAD, TERRAIN, ZONE } from '@/sim/layers';
import { createDefaultSystems, createPowerSystem, createServiceSystem } from '@/sim/systems';
import { Rng } from '@/sim/rng';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { MAP_SIZE } from './support/grid';
import { wireUnderRoads } from './support/power';

/**
 * Síťové a zdravotní katastrofy (T53): blackout, epidemie, chemická havárie.
 *
 * Společné mají to, že **nic nerozbijí na mapě** a přesto bolí nejvíc. Blackout
 * zhasne služby a otevře dveře všemu ostatnímu, epidemie bere lidi, havárie
 * otráví půdu a vodu na roky dopředu.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Město s ulicí, zónami, elektrárnou a vodárnou. */
function grid(content: ContentRegistry, plants = 1): WorldState {
  const balance = content.getBalance();
  const world = createWorld(1, balance.economy);
  world.economy.funds = 10000000;

  for (let x = 10; x < 60; x++) buildRoad(world, x, 20, ROAD.street, balance);
  zoneArea(world, 10, 17, 30, 3, ZONE.residential);
  zoneArea(world, 10, 21, 30, 3, ZONE.industrial);

  // Elektrárny na volný kus ulice za zástavbou, ať se netlučou se zónou.
  for (let i = 0; i < plants; i++) {
    const result = placeDefinition(
      world,
      content,
      'vanilla:coal_power_plant',
      42 + i * 5,
      21,
      balance,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
  }

  wireUnderRoads(world); // T129: proud vede vedení, ne silnice
  const systems = createDefaultSystems(content, balance);
  for (let tick = 0; tick < 500; tick++) {
    tickWorld(world, systems);
    world.waterSupply.fill(1);
    for (const id of world.buildings.keys()) world.watered.add(id);
  }
  return world;
}

function registryOf(...disasters: ReturnType<typeof createBlackoutDisaster>[]): DisasterRegistry {
  const registry = new DisasterRegistry();
  for (const disaster of disasters) registry.register(disaster);
  return registry;
}

function setCoverage(world: WorldState, serviceClass: string, value: number): Uint8Array {
  const coarse = coarseSizeOf(MAP_SIZE);
  const layer = new Uint8Array(coarse * coarse).fill(value);
  world.coverage.set(serviceClass, layer);
  return layer;
}

/**
 * Malá elektrárna a hladový dům.
 *
 * Vanilla má jedinou elektrárnu s výkonem 24 000, takže testovací město ji
 * nikdy nepřetíží — a kaskádu blackoutu by nešlo vyzkoušet vůbec. Vlastní
 * definice jsou tady kvůli **poměru**, ne kvůli číslům.
 */
const PLANT: Definition = {
  id: 'test:plant',
  type: 'building',
  category: 'utility',
  name: 'building.plant.name',
  description: 'building.plant.desc',
  footprint: [1, 1],
  level: 1,
  construction: { cost: 0, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
  economy: { upkeep: 0 },
  power: { production: 100 },
  graphics: { color: '#888888', heightLevels: 1 },
};

const BIG_PLANT: Definition = { ...PLANT, id: 'test:bigPlant', power: { production: 300 } };

const EATER: Definition = {
  id: 'test:eater',
  type: 'building',
  category: 'residential',
  name: 'building.eater.name',
  description: 'building.eater.desc',
  footprint: [1, 1],
  level: 1,
  construction: { cost: 0, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
  economy: { upkeep: 0 },
  power: { consumption: 50 },
  graphics: { color: '#cc8844', heightLevels: 1 },
};

const HOUSE: Definition = {
  id: 'test:house',
  type: 'building',
  category: 'residential',
  name: 'building.house.name',
  description: 'building.house.desc',
  footprint: [1, 1],
  level: 1,
  construction: { cost: 0, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
  economy: { upkeep: 0 },
  graphics: { color: '#cc8844', heightLevels: 1 },
};

function catalogueOf(...definitions: Definition[]): BuildingCatalogue {
  return {
    get: (id) => definitions.find((d) => d.id === id),
    byCategory: (category) => definitions.filter((d) => d.category === category),
  };
}

/** Síť s daným počtem elektráren a spotřebičů. Vrací svět a katalog. */
function powerGrid(
  plants: number,
  eaters: number,
): { world: WorldState; catalogue: BuildingCatalogue } {
  const world = createWorld(1);
  for (let i = 0; i < plants; i++) placeBuilding(world, PLANT, 10 + i, 10);
  for (let i = 0; i < eaters; i++) placeBuilding(world, EATER, 10 + i, 12);
  return { world, catalogue: catalogueOf(PLANT, BIG_PLANT, EATER) };
}

describe('temná služba nepokrývá', () => {
  it('hasičárna bez proudu nedosáhne nikam', async () => {
    // Obecné pravidlo, ne zvláštnost blackoutu — a jediný důvod, proč blackout
    // vůbec něco dělá.
    const content = await vanilla();
    const balance = content.getBalance();

    const build = (withPlant: boolean): number => {
      const world = createWorld(1, balance.economy);
      world.economy.funds = 10000000;
      for (let x = 18; x < 40; x++) buildRoad(world, x, 20, ROAD.street, balance);
      expect(placeDefinition(world, content, 'vanilla:fire_station', 20, 21, balance).ok).toBe(true);
      if (withPlant) {
        expect(
          placeDefinition(world, content, 'vanilla:coal_power_plant', 30, 21, balance).ok,
        ).toBe(true);
      }

      wireUnderRoads(world); // T129: proud vede vedení, ne silnice
      const systems = createDefaultSystems(content, balance);
      for (let tick = 0; tick < 30; tick++) tickWorld(world, systems);
      return world.coverage.get('fire')?.[coarseIndex(20, 21, MAP_SIZE)] ?? 0;
    };

    expect(build(true)).toBeGreaterThan(0);
    expect(build(false)).toBe(0);
  });

  it('ztráta proudu přepočítá pokrytí hned, ne až při příští stavbě', async () => {
    // Bez toho by hráč viděl na mapě dosah, který neexistuje — přesně ten druh
    // tiché chyby, po které se hledá hodinu.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = grid(content);
    setCoverage(world, 'fire', 0);

    // Stanice stojí **za zónami** (x 50), ne v nich: zóna se za 500 tiků
    // zastaví a stavba na obsazené parcele by se neodehrála vůbec. Ulice
    // vede až k šedesátce, takže na silnici dosáhne stejně jako uvnitř města.
    expect(placeDefinition(world, content, 'vanilla:fire_station', 50, 21, balance).ok).toBe(true);
    wireUnderRoads(world); // T129: proud vede vedení, ne silnice
    const systems = createDefaultSystems(content, balance);
    for (let tick = 0; tick < 30; tick++) tickWorld(world, systems);
    const before = world.coverage.get('fire')?.[coarseIndex(50, 21, MAP_SIZE)] ?? 0;
    expect(before).toBeGreaterThan(0);

    // Vypni všechny elektrárny.
    for (const [id, building] of world.buildings) {
      if (content.get(building.definitionId)?.power?.production) {
        world.disasters.offlinePlants.add(id);
      }
    }
    world.powerNetworkDirty = true;
    for (let tick = 0; tick < 3; tick++) tickWorld(world, systems);

    expect(world.coverage.get('fire')?.[coarseIndex(50, 21, MAP_SIZE)] ?? 0).toBe(0);
  });

  it('skládka smrdí i po tmě', async () => {
    // Obtěžování není služba: kdo si postaví skládku k domům, neuteče jí tím,
    // že jí vypne proud.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    world.economy.funds = 10000000;
    for (let x = 18; x < 30; x++) buildRoad(world, x, 20, ROAD.street, balance);

    const dump = [...content.getAll('building')].find((d) => d.nuisance);
    if (!dump) throw new Error('žádné obtěžování v obsahu');
    expect(placeDefinition(world, content, dump.id, 20, 21, balance).ok).toBe(true);

    wireUnderRoads(world); // T129: proud vede vedení, ne silnice
    const systems = createDefaultSystems(content, balance);
    for (let tick = 0; tick < 30; tick++) tickWorld(world, systems);

    const nuisanceClass = dump.nuisance?.class ?? '';
    const value = world.coverage.get(nuisanceClass)?.[coarseIndex(20, 21, MAP_SIZE)] ?? 0;
    expect(value).toBeGreaterThan(0);
  });
});

describe('blackout', () => {
  it('odpojí elektrárnu a město zhasne', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = grid(content);
    const litBefore = [...world.buildings.values()].filter((b) => b.powered).length;
    expect(litBefore).toBeGreaterThan(3);

    const registry = registryOf(createBlackoutDisaster());
    const plant = [...world.buildings.entries()].find(
      ([, b]) => content.get(b.definitionId)?.power?.production,
    );
    if (!plant) throw new Error('bez elektrárny');
    const entry = startDisaster(world, content, balance, registry, 'blackout', plant[1].x, plant[1].y);
    if (!entry) throw new Error('blackout nezačal');

    expect(world.disasters.offlinePlants.has(plant[0])).toBe(true);

    // Jen elektřina, ne celé výchozí systémy: jejich plánovač má vlastní
    // registr, ručně spuštěný blackout by v něm neznal a hned by ho ukončil
    // — a při úklidu by elektrárnu zase zapnul.
    for (let tick = 0; tick < 3; tick++) {
      tickWorld(world, [createPowerSystem(content), createServiceSystem(content, content.getBalance())]);
    }
    expect([...world.buildings.values()].filter((b) => b.powered).length).toBeLessThan(litBefore);
  });

  it('při přetížení padne další elektrárna, a pak další', async () => {
    // Kaskáda. Bez ní by výpadek jedné elektrárny byl jen menší kapacita
    // a hráč by se o blackoutu dozvěděl leda z hlášení.
    const content = await vanilla();
    const balance = content.getBalance();
    // Tři elektrárny po 100, spotřeba 250: po výpadku jedné je zatížení 1,25.
    const { world, catalogue } = powerGrid(3, 5);

    const registry = registryOf(createBlackoutDisaster());
    const disaster = createBlackoutDisaster();
    const entry = startDisaster(world, catalogue, balance, registry, 'blackout', 10, 10);
    if (!entry) throw new Error('blackout nezačal');
    expect(world.disasters.offlinePlants.size).toBe(1);

    for (let tick = 0; tick < balance.disasters.blackout.cascadeEvery * 3; tick++) {
      world.tick++;
      disaster.tick({ world, catalogue, balance, x: 10, y: 10 }, entry);
    }

    expect(world.disasters.offlinePlants.size).toBeGreaterThan(1);
  });

  it('kaskáda se zastaví, jakmile zbytek stačí', async () => {
    // Jinak by každý výpadek skončil úplnou tmou a hráč by neměl co zachraňovat.
    const content = await vanilla();
    const balance = content.getBalance();
    // Tři elektrárny po 100, spotřeba 100: po výpadku jedné je zatížení 0,5.
    const { world, catalogue } = powerGrid(3, 2);

    const registry = registryOf(createBlackoutDisaster());
    const disaster = createBlackoutDisaster();
    const entry = startDisaster(world, catalogue, balance, registry, 'blackout', 10, 10);
    if (!entry) throw new Error('blackout nezačal');

    for (let tick = 0; tick < balance.disasters.blackout.cascadeEvery * 2; tick++) {
      world.tick++;
      disaster.tick({ world, catalogue, balance, x: 10, y: 10 }, entry);
    }
    expect(world.disasters.offlinePlants.size).toBe(1);
  });

  it('v pásmu mezi prahy se ani nešíří, ani nezotavuje', async () => {
    // Zatížení 1,0 je nad prahem zotavení a pod prahem přetížení. Kdyby se
    // v něm počítal klid, síť by kmitala: odpojí, hned připojí, hned zas odpojí.
    const content = await vanilla();
    const balance = content.getBalance();
    // Dvě elektrárny po 100, spotřeba 100: po výpadku jedné je zatížení přesně 1.
    const { world, catalogue } = powerGrid(2, 2);

    const registry = registryOf(createBlackoutDisaster());
    const disaster = createBlackoutDisaster();
    const entry = startDisaster(world, catalogue, balance, registry, 'blackout', 10, 10);
    if (!entry) throw new Error('blackout nezačal');

    for (let tick = 0; tick < 60; tick++) {
      world.tick++;
      disaster.tick({ world, catalogue, balance, x: 10, y: 10 }, entry);
    }

    expect(world.disasters.offlinePlants.size).toBe(1);
    expect(disaster.isFinished(world, entry)).toBe(false);
  });

  it('elektrárny se vracejí až po chvíli klidu, ne hned', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const blackout = balance.disasters.blackout;
    const { world, catalogue } = powerGrid(3, 2);

    const registry = registryOf(createBlackoutDisaster());
    const disaster = createBlackoutDisaster();
    const entry = startDisaster(world, catalogue, balance, registry, 'blackout', 10, 10);
    if (!entry) throw new Error('blackout nezačal');

    let returnedAt = -1;
    for (let tick = 1; tick <= 200 && returnedAt < 0; tick++) {
      world.tick++;
      disaster.tick({ world, catalogue, balance, x: 10, y: 10 }, entry);
      if (world.disasters.offlinePlants.size === 0) returnedAt = tick;
    }

    expect(returnedAt).toBeGreaterThanOrEqual(blackout.calmCycles * blackout.cascadeEvery);
    // A vrátí se i v evidenci sítě, ne jen ve stavu katastrofy.
    expect(world.disasters.offlinePlants.size).toBe(0);
    expect(disaster.isFinished(world, entry)).toBe(true);
  });

  it('z úplné tmy se město dostane zpátky, i když spotřeba pořád převyšuje', async () => {
    /*
     * Nález z hraní: autor poslal město, kde blackout běžel **1692 tiků**
     * (skoro pět herních let) a drželo dole 42 elektráren.
     *
     * Kaskáda dojela na dno, po chvíli klidu se vrátila jedna elektrárna — a
     * protože se zatížení počítá proti spotřebě celého města, i toho potmě,
     * hned zase vyšlo nad práh a tatáž elektrárna šla znovu dolů. Zotavení
     * je proto **jednosměrné**: co se jednou začalo vracet, se už neodpojuje.
     */
    const content = await vanilla();
    const balance = content.getBalance();
    // Dvě elektrárny po 100, spotřeba 300: zatížení nespadne pod práh nikdy.
    const { world, catalogue } = powerGrid(2, 6);

    const registry = registryOf(createBlackoutDisaster());
    const disaster = createBlackoutDisaster();
    const entry = startDisaster(world, catalogue, balance, registry, 'blackout', 10, 10);
    if (!entry) throw new Error('blackout nezačal');

    for (let tick = 0; tick < balance.disasters.blackout.maxTicks - 1; tick++) {
      world.tick++;
      disaster.tick({ world, catalogue, balance, x: 10, y: 10 }, entry);
      if (disaster.isFinished(world, entry)) break;
    }

    expect(world.disasters.offlinePlants.size, 'elektrárny se nevrátily').toBe(0);
    expect(disaster.isFinished(world, entry)).toBe(true);
  });

  it('nově postavená elektrárna už do kaskády nespadne', async () => {
    // Tohle byla ta past: hráč přistavěl zdroj, `biggestOnline` si vzal
    // zrovna ten nejnovější a shodil ho taky. Z výpadku pak nevedla cesta
    // ven ani za peníze.
    const content = await vanilla();
    const balance = content.getBalance();
    const { world, catalogue } = powerGrid(2, 6);

    const registry = registryOf(createBlackoutDisaster());
    const disaster = createBlackoutDisaster();
    const entry = startDisaster(world, catalogue, balance, registry, 'blackout', 10, 10);
    if (!entry) throw new Error('blackout nezačal');

    // Nech kaskádu dojet na dno — dvě elektrárny, dva cykly.
    for (let tick = 0; tick < balance.disasters.blackout.cascadeEvery * 2; tick++) {
      world.tick++;
      disaster.tick({ world, catalogue, balance, x: 10, y: 10 }, entry);
    }
    expect(world.disasters.offlinePlants.size).toBe(2);

    const rescue = placeBuilding(world, PLANT, 10, 14);
    expect(rescue).not.toBeNull();
    for (let tick = 0; tick < 20; tick++) {
      world.tick++;
      disaster.tick({ world, catalogue, balance, x: 10, y: 10 }, entry);
      expect(
        rescue === null || !world.disasters.offlinePlants.has(rescue.id),
        'kaskáda shodila i novou elektrárnu',
      ).toBe(true);
    }
  });

  it('strop délky vrátí elektrárny i savu, který ho ve stavu nemá', async () => {
    /*
     * Strop se dřív bral z `active.state`, kam si ho zapsal `start`. Save,
     * který vznikl dřív, než strop existoval, ho tam nemá — a v takové partii
     * se blackout neukončil nikdy. Teď si ho hlídá `tick`, který dostane
     * balanc, takže platí i pro rozehrané město.
     */
    const content = await vanilla();
    const balance = content.getBalance();
    const { world, catalogue } = powerGrid(2, 6);

    const registry = registryOf(createBlackoutDisaster());
    const disaster = createBlackoutDisaster();
    const entry = startDisaster(world, catalogue, balance, registry, 'blackout', 10, 10);
    if (!entry) throw new Error('blackout nezačal');

    // Starý save: ve stavu není ani strop, ani příznak zotavení.
    delete entry.state['maxTicks'];
    delete entry.state['recovering'];
    entry.state['age'] = balance.disasters.blackout.maxTicks - 1;

    world.tick++;
    disaster.tick({ world, catalogue, balance, x: 10, y: 10 }, entry);

    expect(world.disasters.offlinePlants.size).toBe(0);
    expect(disaster.isFinished(world, entry)).toBe(true);
  });

  it('po skončení nezůstane odpojená ani jedna, i když blackout skončí náhle', async () => {
    // Plánovač uklízí. Bez toho by po blackoutu zbyla elektrárna, která nikdy
    // nenaběhne, a hráč by neměl jak zjistit proč.
    const content = await vanilla();
    const balance = content.getBalance();
    const { world, catalogue } = powerGrid(2, 2);

    const registry = registryOf(createBlackoutDisaster());
    const entry = startDisaster(world, catalogue, balance, registry, 'blackout', 10, 10);
    if (!entry) throw new Error('blackout nezačal');
    expect(world.disasters.offlinePlants.size).toBe(1);

    // Konec vynucený zvenčí, jako když hráč katastrofy vypne nebo doběhne save.
    entry.state['offline'] = [];
    const systems = [createDisasterSystem(catalogue, balance, registry)];
    tickWorld(world, systems);

    expect(world.disasters.active).toHaveLength(0);
    expect(world.disasters.offlinePlants.size).toBe(0);
  });

  it('město s jedinou elektrárnou se z blackoutu dostane', async () => {
    // Když padne poslední elektrárna, výroba je nula a zatížení nekonečné.
    // Kdyby se v tom stavu čekalo na pokles zatížení, čekalo by se navždy —
    // a blackout, ze kterého není cesty ven, není katastrofa, ale konec hry.
    const content = await vanilla();
    const balance = content.getBalance();
    const { world, catalogue } = powerGrid(1, 5);

    const registry = registryOf(createBlackoutDisaster());
    const disaster = createBlackoutDisaster();
    const entry = startDisaster(world, catalogue, balance, registry, 'blackout', 10, 10);
    if (!entry) throw new Error('blackout nezačal');
    expect(world.disasters.offlinePlants.size).toBe(1);

    for (let tick = 0; tick < 200 && !disaster.isFinished(world, entry); tick++) {
      world.tick++;
      disaster.tick({ world, catalogue, balance, x: 10, y: 10 }, entry);
    }

    expect(disaster.isFinished(world, entry)).toBe(true);
    expect(world.disasters.offlinePlants.size).toBe(0);
  });

  it('bez elektrárny nemá co vypnout', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    expect(
      createBlackoutDisaster().pickOrigin(world, content, content.getBalance()),
    ).toBeNull();
  });

  it('velká elektrárna vypadne spíš než malá', async () => {
    // Přímý argument pro několik menších místo jedné velké — jediná
    // strukturální obrana proti blackoutu.
    const content = await vanilla();
    const world = createWorld(1);
    placeBuilding(world, BIG_PLANT, 10, 10);
    placeBuilding(world, PLANT, 12, 10);
    const catalogue = catalogueOf(PLANT, BIG_PLANT, EATER);

    const disaster = createBlackoutDisaster();
    let big = 0;
    const draws = 400;
    for (let attempt = 0; attempt < draws; attempt++) {
      const origin = disaster.pickOrigin(world, catalogue, content.getBalance());
      if (origin?.x === 10) big++;
    }

    // Výkon 300 proti 100: tři čtvrtiny losů.
    expect(big / draws).toBeGreaterThan(0.65);
    expect(big / draws).toBeLessThan(0.85);
  });

  it('los přeskočí elektrárnu, která už leží', async () => {
    const content = await vanilla();
    const world = createWorld(1);
    placeBuilding(world, PLANT, 10, 10);
    placeBuilding(world, PLANT, 12, 10);
    const catalogue = catalogueOf(PLANT, EATER);

    const down = [...world.buildings.keys()][0];
    if (down === undefined) throw new Error('bez elektrárny');
    world.disasters.offlinePlants.add(down);

    const disaster = createBlackoutDisaster();
    for (let attempt = 0; attempt < 20; attempt++) {
      const origin = disaster.pickOrigin(world, catalogue, content.getBalance());
      expect(origin, `pokus ${attempt}`).toEqual({ x: 12, y: 10 });
    }
  });

  it('prahy jsou od sebe, jinak by síť kmitala', () => {
    const blackout = VANILLA_BALANCE.disasters.blackout;
    expect(blackout.recoveryRatio).toBeLessThan(blackout.overloadRatio);
  });
});

describe('epidemie', () => {
  it('šíří se do sousedství a bere obyvatele', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = grid(content);
    setCoverage(world, 'health', 0);

    const before = [...world.buildings.values()].reduce((sum, b) => sum + b.population, 0);
    expect(before).toBeGreaterThan(0);

    const registry = registryOf(createEpidemicDisaster());
    const disaster = createEpidemicDisaster();
    const entry = startDisaster(world, content, balance, registry, 'epidemic', 25, 18);
    if (!entry) throw new Error('epidemie nezačala');
    expect(world.infection.size).toBe(1);

    for (let tick = 0; tick < 40; tick++) {
      world.tick++;
      disaster.tick({ world, catalogue: content, balance, x: 25, y: 18 }, entry);
    }

    expect(world.infection.size).toBeGreaterThan(1);
    const after = [...world.buildings.values()].reduce((sum, b) => sum + b.population, 0);
    expect(after).toBeLessThan(before);
    // Ale žádný dům nespadl: epidemie neboří.
    expect([...world.rubble].filter((value) => value !== 0)).toHaveLength(0);
  });

  it('zdravotnictví ji zastaví — a je to jediná, kterou jde potlačit po vzniku', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const registry = registryOf(createEpidemicDisaster());
    const disaster = createEpidemicDisaster();

    const spreadWith = (coverage: number): number => {
      const world = grid(content);
      setCoverage(world, 'health', coverage);
      const entry = startDisaster(world, content, balance, registry, 'epidemic', 25, 18);
      if (!entry) throw new Error('epidemie nezačala');
      for (let tick = 0; tick < 60; tick++) {
        world.tick++;
        disaster.tick({ world, catalogue: content, balance, x: 25, y: 18 }, entry);
      }
      return world.infection.size;
    };

    const neglected = spreadWith(0);
    const covered = spreadWith(255);
    expect(neglected).toBeGreaterThan(0);
    expect(covered).toBe(0);
  });

  it('přeskočí po dopravě přes celé město', async () => {
    // Tohle dělá z nákazy epidemii. Bez skoku by se dala uzavřít pásem parku
    // a hráč by ji řešil geometrií místo služeb.
    //
    // Dva shluky, mezi nimi prázdno: šíření po sousedství přes prázdné buňky
    // neprojde (hustota nula), takže do vzdáleného shluku se nákaza může dostat
    // **jedině skokem**.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);

    for (let i = 0; i < 4; i++) {
      const near = placeBuilding(world, HOUSE, 12 + i, 20);
      const far = placeBuilding(world, HOUSE, 60 + i, 20);
      if (near) near.population = 200;
      if (far) far.population = 200;
    }
    // Provoz mezi nimi, ať má nákaza po čem cestovat.
    for (let x = 10; x < 70; x++) world.trafficLoad[index(x, 20, MAP_SIZE)] = 100;

    const registry = registryOf(createEpidemicDisaster());
    const disaster = createEpidemicDisaster();
    const entry = startDisaster(world, content, balance, registry, 'epidemic', 12, 20);
    if (!entry) throw new Error('epidemie nezačala');

    const farCells = new Set<number>();
    for (let i = 0; i < 4; i++) farCells.add(coarseIndex(60 + i, 20, MAP_SIZE));

    let jumped = false;
    for (let tick = 0; tick < 200 && !jumped; tick++) {
      world.tick++;
      disaster.tick({ world, catalogue: content, balance, x: 12, y: 20 }, entry);
      for (const cell of world.infection.keys()) {
        if (farCells.has(cell)) jumped = true;
      }
    }

    expect(jumped, 'nákaza nikdy nepřeskočila do vzdálené čtvrti').toBe(true);
  });

  it('zdravotnictví brzdí i samotný přenos, nejen růst', async () => {
    // Dvě různé věci: pokrytí jednak srazí nákazu v buňce, jednak zpomalí, jak
    // moc se přelije do sousedů. Bez druhé půlky by nemocnice zabírala až
    // potom, co se čtvrť nakazí.
    //
    // Měří se na sousedovi, který má **plné pokrytí**, zatímco ohnisko nemá
    // žádné. Utlumený přenos souseda nepřekročí jeho vlastní ústup a nákaza se
    // v něm neuchytí; neutlumený ano.
    const content = await vanilla();
    const balance = content.getBalance();
    const registry = registryOf(createEpidemicDisaster());
    const disaster = createEpidemicDisaster();

    const world = createWorld(1, balance.economy);
    for (let i = 0; i < 4; i++) {
      const a = placeBuilding(world, HOUSE, 12 + i, 20);
      const b = placeBuilding(world, HOUSE, 16 + i, 20);
      if (a) a.population = 200;
      if (b) b.population = 200;
    }

    const source = coarseIndex(12, 20, MAP_SIZE);
    const neighbour = coarseIndex(16, 20, MAP_SIZE);
    const coverage = setCoverage(world, 'health', 0);
    coverage[neighbour] = 255;

    const entry = startDisaster(world, content, balance, registry, 'epidemic', 12, 20);
    if (!entry) throw new Error('epidemie nezačala');
    world.infection.set(source, 1);

    world.tick += balance.disasters.epidemic.cycleTicks;
    disaster.tick({ world, catalogue: content, balance, x: 12, y: 20 }, entry);

    expect(world.infection.get(source) ?? 0).toBeGreaterThan(0);
    expect(world.infection.has(neighbour), 'krytý soused se nakazil').toBe(false);
  });

  it('zbytek nákazy pod prahem vyhasne, nedohořívá donekonečna', async () => {
    // Bez prahu by v mapě zůstávaly buňky s nakažeností 0,002, epidemie by
    // formálně nikdy neskončila a hráč by koukal na hlášení, které nezmizí.
    const content = await vanilla();
    const balance = content.getBalance();
    const epidemic = balance.disasters.epidemic;
    // Prázdný svět: žádní sousedé, takže se nic nepřenáší a zůstane jen
    // aritmetika růstu a ústupu.
    const world = createWorld(1, balance.economy);

    const registry = registryOf(createEpidemicDisaster());
    const disaster = createEpidemicDisaster();
    const entry = startDisaster(world, content, balance, registry, 'epidemic', 20, 20);
    if (!entry) throw new Error('epidemie nezačala');

    // Zbytek těsně nad nulou: první cyklus mu přidá růst a ubere ústup, takže
    // skončí kladný, ale pod prahem.
    const cell = coarseIndex(20, 20, MAP_SIZE);
    world.infection.set(cell, epidemic.extinction);

    world.tick += epidemic.cycleTicks;
    disaster.tick({ world, catalogue: content, balance, x: 20, y: 20 }, entry);

    expect(world.infection.size).toBe(0);
  });

  it('přetíží nemocnice v nakažené čtvrti', async () => {
    // Záměrná past: hráč potřebuje rezervu v pokrytí, ne přesně dostačující síť.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = grid(content);
    setCoverage(world, 'health', 200);

    const registry = registryOf(createEpidemicDisaster());
    const disaster = createEpidemicDisaster();
    const entry = startDisaster(world, content, balance, registry, 'epidemic', 20, 18);
    if (!entry) throw new Error('epidemie nezačala');

    world.tick += balance.disasters.epidemic.cycleTicks;
    disaster.tick({ world, catalogue: content, balance, x: 20, y: 18 }, entry);

    const cell = coarseIndex(20, 18, MAP_SIZE);
    const factor = strongestModifier(world, 'suppressService', cell, 1, 'health');
    expect(factor).toBeLessThan(1);
    expect(factor).toBe(balance.disasters.epidemic.overload);
  });

  it('šíří se stejně bez ohledu na pořadí buněk v mapě nákazy', async () => {
    // `Map` si pamatuje pořadí vkládání a to závisí na tom, kudy se nákaza
    // šířila. Po loadu by se stejné město chovalo jinak (P2).
    const content = await vanilla();
    const balance = content.getBalance();
    const registry = registryOf(createEpidemicDisaster());
    const disaster = createEpidemicDisaster();

    const run = (reverse: boolean): string => {
      const world = grid(content);
      setCoverage(world, 'health', 0);
      const entry = startDisaster(world, content, balance, registry, 'epidemic', 20, 18);
      if (!entry) throw new Error('epidemie nezačala');

      // Výrazně různé úrovně: skok po dopravě přidá `úroveň × podíl`, takže
      // na pořadí hodů opravdu záleží.
      const seeded: [number, number][] = [
        [coarseIndex(12, 18, MAP_SIZE), 0.95],
        [coarseIndex(20, 18, MAP_SIZE), 0.5],
        [coarseIndex(28, 18, MAP_SIZE), 0.08],
      ];
      world.infection.clear();
      for (const [cell, level] of reverse ? [...seeded].reverse() : seeded) {
        world.infection.set(cell, level);
      }

      // Provoz **v řadě buněk, kde bydlí lidé** — skok váží zátěží i hustotou,
      // takže provoz v prázdné buňce by se nezapočítal a žádný skok by se
      // nelosoval. Buňka je čtyři dlaždice, obytný pás leží na y 17–19.
      for (let y = 17; y <= 19; y++) {
        for (let x = 10; x < 40; x++) world.trafficLoad[index(x, y, MAP_SIZE)] = 100;
      }

      world.rng = Rng.fromState(99);
      for (let cycle = 0; cycle < 5; cycle++) {
        world.tick += balance.disasters.epidemic.cycleTicks;
        disaster.tick({ world, catalogue: content, balance, x: 20, y: 18 }, entry);
      }

      return [...world.infection.entries()]
        .map(([cell, level]) => `${cell}:${level.toFixed(6)}`)
        .sort()
        .join(',');
    };

    expect(run(true)).toBe(run(false));
  });

  it('po vypršení doby dohasne i bez jediné nemocnice', async () => {
    // Přenos mezi dvěma nakaženými sousedy je řádově silnější než ústup, takže
    // by se shluk donekonečna dokrmoval sám. Hráč bez zdravotnictví by koukal
    // na hlášení, které nezmizí — a to není katastrofa, to je porucha.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = grid(content);
    setCoverage(world, 'health', 0);

    const registry = registryOf(createEpidemicDisaster());
    const disaster = createEpidemicDisaster();
    const entry = startDisaster(world, content, balance, registry, 'epidemic', 20, 18);
    if (!entry) throw new Error('epidemie nezačala');

    // Nechat doběhnout dobu a ještě hodně dlouho po ní.
    const span = entry.state['span'] as number;
    for (let tick = 0; tick < span * 4 && !disaster.isFinished(world, entry); tick++) {
      world.tick++;
      disaster.tick({ world, catalogue: content, balance, x: 20, y: 18 }, entry);
    }

    expect(world.infection.size, 'nákaza se dokrmuje sama').toBe(0);
    expect(disaster.isFinished(world, entry)).toBe(true);
  });

  it('nakaženost se drží řídce, ne jako vrstva přes celou mapu', async () => {
    // Většina města je vždycky nenakažená. Plná vrstva by bylo pole nul
    // o velikosti mapy, kterým se každý cyklus prochází.
    const content = await vanilla();
    const world = grid(content);
    const registry = registryOf(createEpidemicDisaster());
    startDisaster(world, content, content.getBalance(), registry, 'epidemic', 25, 18);

    expect(world.infection.size).toBe(1);
    expect(world.infection.size).toBeLessThan(coarseSizeOf(MAP_SIZE) ** 2);
  });

  it('plné zdravotnictví musí nákazu srazit, jinak by se nedala zastavit ničím', () => {
    const epidemic = VANILLA_BALANCE.disasters.epidemic;
    expect(epidemic.growth).toBeLessThan(epidemic.decay + epidemic.decayPerCoverage);
  });

  it('po skončení po ní nezbude nákaza', async () => {
    const content = await vanilla();
    const world = grid(content);
    world.infection.set(10, 0.5);
    clearInfection(world);
    expect(world.infection.size).toBe(0);
  });

  it('vzniká tam, kde není voda a zdravotnictví', async () => {
    const content = await vanilla();
    const world = grid(content);
    setCoverage(world, 'health', 255);

    // Jedna čtvrť bez vody a bez pokrytí: los tam musí chodit skoro vždycky.
    // Dělicí čára po hranici buňky (4 dlaždice). Uprostřed buňky by v jedné
    // půlce skončily domy z obou a test by měřil vedle.
    const split = 32;
    const dry = [...world.buildings.entries()].filter(
      ([, b]) => b.population > 0 && b.x >= split,
    );
    expect(dry.length).toBeGreaterThan(0);
    for (const [id] of dry) world.watered.delete(id);
    const coverage = world.coverage.get('health');
    if (!coverage) throw new Error('bez pokrytí');
    for (const [, b] of dry) coverage[coarseIndex(b.x, b.y, MAP_SIZE)] = 0;

    const disaster = createEpidemicDisaster();
    let inDry = 0;
    const draws = 200;
    for (let attempt = 0; attempt < draws; attempt++) {
      const origin = disaster.pickOrigin(world, content, content.getBalance());
      if (origin && origin.x >= split) inDry++;
    }
    expect(inDry / draws).toBeGreaterThan(0.8);
  });
});

describe('chemická havárie', () => {
  it('zamoří okolí a nezaloží požár', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = grid(content);
    const factory = [...world.buildings.values()].find(
      (b) => content.get(b.definitionId)?.category === 'industrial',
    );
    if (!factory) throw new Error('žádný průmysl');
    factory.level = 5;

    const before = Math.max(...world.coarse.pollution);
    const registry = registryOf(createChemicalSpillDisaster());
    const disaster = createChemicalSpillDisaster();
    const entry = startDisaster(
      world,
      content,
      balance,
      registry,
      'chemicalSpill',
      factory.x,
      factory.y,
    );
    if (!entry) throw new Error('havárie nezačala');

    for (let tick = 0; tick < 20; tick++) {
      world.tick++;
      disaster.tick({ world, catalogue: content, balance, x: factory.x, y: factory.y }, entry);
    }

    expect(Math.max(...world.coarse.pollution)).toBeGreaterThan(before);
    // Chemikálie nehoří, rozlévá se.
    expect([...world.fire].filter((value) => value !== 0)).toHaveLength(0);
  });

  it('zamořená vodárna nedodává vodu', async () => {
    // Druhá polovina havárie. Budovy začnou chátrat dva měsíce po ní, kdy už
    // si na ni nikdo nevzpomene.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    world.economy.funds = 10000000;

    // `createWorld` dává holou trávu; vodárna potřebuje břeh, tak si ho test
    // vyrobí sám.
    for (let y = 24; y < 34; y++) {
      for (let x = 18; x < 24; x++) world.layers.terrain[index(x, y, MAP_SIZE)] = TERRAIN.water;
    }
    for (let x = 24; x < 44; x++) buildRoad(world, x, 27, ROAD.street, balance);

    const works = placeDefinition(world, content, 'vanilla:water_works', 24, 28, balance);
    expect(works.ok, JSON.stringify(works)).toBe(true);
    expect(
      placeDefinition(world, content, 'vanilla:coal_power_plant', 30, 28, balance).ok,
    ).toBe(true);

    wireUnderRoads(world); // T129: proud vede vedení, ne silnice
    const systems = createDefaultSystems(content, balance);
    for (let tick = 0; tick < 30; tick++) tickWorld(world, systems);
    expect([...world.waterSupply].filter((value) => value !== 0).length).toBeGreaterThan(0);

    // Zamoř buňky, ve kterých vodárna stojí.
    const cells = new Set<number>();
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) cells.add(coarseIndex(24 + dx, 28 + dy, MAP_SIZE));
    }
    world.disasters.modifiers.push({
      kind: 'contaminateWater',
      cells: [...cells].sort((a, b) => a - b),
      amount: 1,
      until: world.tick + 100,
      source: 0,
    });
    world.waterNetworkDirty = true;
    for (let tick = 0; tick < 5; tick++) tickWorld(world, systems);

    expect([...world.waterSupply].filter((value) => value !== 0)).toHaveLength(0);
  });

  it('kontaminuje jen tam, kde je voda', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = grid(content);
    // Vnitrozemí: v okolí továrny žádná vodní dlaždice.
    for (let tile = 0; tile < world.layers.terrain.length; tile++) {
      if (world.layers.terrain[tile] === TERRAIN.water) world.layers.terrain[tile] = TERRAIN.grass;
    }

    const factory = [...world.buildings.values()].find(
      (b) => content.get(b.definitionId)?.category === 'industrial',
    );
    if (!factory) throw new Error('žádný průmysl');
    factory.level = 5;

    const registry = registryOf(createChemicalSpillDisaster());
    const disaster = createChemicalSpillDisaster();
    const entry = startDisaster(
      world,
      content,
      balance,
      registry,
      'chemicalSpill',
      factory.x,
      factory.y,
    );
    if (!entry) throw new Error('havárie nezačala');
    for (let tick = 0; tick < 10; tick++) {
      world.tick++;
      disaster.tick({ world, catalogue: content, balance, x: factory.x, y: factory.y }, entry);
    }

    const contaminated = world.disasters.modifiers.filter((m) => m.kind === 'contaminateWater');
    expect(contaminated).toHaveLength(0);
  });

  it('srazí cenu půdy nadlouho — účet přijde až za rok', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const spill = balance.disasters.chemicalSpill;
    const world = grid(content);
    const factory = [...world.buildings.values()].find(
      (b) => content.get(b.definitionId)?.category === 'industrial',
    );
    if (!factory) throw new Error('žádný průmysl');

    const registry = registryOf(createChemicalSpillDisaster());
    startDisaster(world, content, balance, registry, 'chemicalSpill', factory.x, factory.y);

    const cell = coarseIndex(factory.x, factory.y, MAP_SIZE);
    const penalty = strongestModifier(world, 'landValuePenalty', cell, 0, undefined, Math.max);
    expect(penalty).toBe(spill.landValue);

    const record = world.disasters.modifiers.find((m) => m.kind === 'landValuePenalty');
    // Doznívá roky, ne tiky: rok je 360 tiků.
    expect((record?.until ?? 0) - world.tick).toBeGreaterThanOrEqual(360);
  });

  it('mrak přežije konec úniku — jinak by po havárii nic nezbylo', async () => {
    // Únik trvá čtyřicet tiků, mrak rok. Plánovač po skončení katastrofy uklidí
    // její postihy, takže dozvuk se musí zapsat **bez vlastníka** — jinak by
    // propad ceny půdy zmizel s poslední kapkou a celá pointa havárie by byla
    // pryč: hráč uklidí trosky a je po ní.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = grid(content);
    const factory = [...world.buildings.values()].find(
      (b) => content.get(b.definitionId)?.category === 'industrial',
    );
    if (!factory) throw new Error('žádný průmysl');
    factory.level = 5;

    const registry = new DisasterRegistry();
    registry.register(createChemicalSpillDisaster());
    const entry = startDisaster(
      world,
      content,
      balance,
      registry,
      'chemicalSpill',
      factory.x,
      factory.y,
    );
    if (!entry) throw new Error('havárie nezačala');

    const cell = coarseIndex(factory.x, factory.y, MAP_SIZE);
    expect(strongestModifier(world, 'landValuePenalty', cell, 0, undefined, Math.max))
      .toBeGreaterThan(0);

    // Doběhnout celý únik přes skutečný plánovač, včetně úklidu.
    const systems = [createDisasterSystem(content, balance, registry)];
    for (let tick = 0; tick < (entry.state['span'] as number) + 5; tick++) {
      tickWorld(world, systems);
    }
    expect(world.disasters.active).toHaveLength(0);

    // A propad ceny půdy pořád platí.
    expect(strongestModifier(world, 'landValuePenalty', cell, 0, undefined, Math.max))
      .toBe(balance.disasters.chemicalSpill.landValue);
  });

  it('vybírá staré a nekryté provozy', async () => {
    // `stáří` je jediné místo ve hře, kde na věku budovy záleží samo o sobě —
    // a je to přímý argument pro obnovu starých provozů.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    world.economy.funds = 10000000;
    for (let x = 10; x < 50; x++) buildRoad(world, x, 30, ROAD.street, balance);

    // Průmysl chce vodovod. Test je o vážení, ne o infrastruktuře, tak ať ji má.
    for (let x = 10; x < 50; x++) buildPipe(world, x, 32, balance);
    world.waterSupply.fill(1);

    // Tři provozy postavené ručně: test je o vážení, ne o poptávce po průmyslu.
    for (const x of [12, 24, 36]) {
      const placed = placeDefinition(world, content, 'vanilla:industrial_small', x, 31, balance);
      expect(placed.ok, JSON.stringify(placed)).toBe(true);
    }
    setCoverage(world, 'fire', 0);

    const heavy = [...world.buildings.values()];
    expect(heavy.length).toBe(3);
    for (const building of heavy) {
      building.level = 3;
      building.builtAtTick = world.tick;
    }

    const old = heavy[0];
    if (!old) throw new Error('žádný průmysl');
    old.builtAtTick = world.tick - VANILLA_BALANCE.disasters.chemicalSpill.ageTicks;

    const disaster = createChemicalSpillDisaster();
    let onOld = 0;
    const draws = 600;
    for (let attempt = 0; attempt < draws; attempt++) {
      const origin = disaster.pickOrigin(world, content, balance);
      if (origin?.x === old.x && origin.y === old.y) onOld++;
    }

    // Starý provoz má váhu 1,8 proti 1,0 u nových, tedy podíl 1,8 / 3,8 ≈ 0,47
    // proti 0,26 u každého nového.
    const perOld = onOld / draws;
    const perNew = (1 - perOld) / 2;
    expect(perOld).toBeGreaterThan(perNew * 1.5);
  });

  it('intenzita rychle vyroste a pomalu opadá', async () => {
    // Nesymetrická křivka je záměr: hráč nemá čas zareagovat na začátku, ale má
    // spoustu času dívat se, jak to doznívá.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = grid(content);
    const factory = [...world.buildings.values()].find(
      (b) => content.get(b.definitionId)?.category === 'industrial',
    );
    if (!factory) throw new Error('žádný průmysl');
    factory.level = 5;

    const registry = registryOf(createChemicalSpillDisaster());
    const disaster = createChemicalSpillDisaster();
    const entry = startDisaster(
      world,
      content,
      balance,
      registry,
      'chemicalSpill',
      factory.x,
      factory.y,
    );
    if (!entry) throw new Error('havárie nezačala');
    const span = entry.state['span'] as number;

    const curve: number[] = [];
    for (let tick = 0; tick < span; tick++) {
      world.tick++;
      disaster.tick({ world, catalogue: content, balance, x: factory.x, y: factory.y }, entry);
      curve.push(entry.state['intensity'] as number);
    }

    const peak = Math.max(...curve);
    const peakAt = curve.indexOf(peak);
    expect(peak).toBeGreaterThan(0.9);
    // Vrchol v první čtvrtině, ne uprostřed a ne na konci.
    expect(peakAt).toBeLessThan(span / 2);
    expect(curve[0]).toBeLessThan(peak);
    expect(curve[curve.length - 1]).toBeLessThan(peak);
  });

  it('z malé dílny neunikne nic', async () => {
    // Těžký průmysl je úroveň 3 a výš. Kdyby uniklo z čehokoli, nemělo by smysl
    // oddělovat zrovna ten těžký.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    world.economy.funds = 10000000;
    for (let x = 10; x < 30; x++) buildRoad(world, x, 30, ROAD.street, balance);
    for (let x = 10; x < 30; x++) buildPipe(world, x, 32, balance);
    world.waterSupply.fill(1);

    const placed = placeDefinition(world, content, 'vanilla:industrial_small', 12, 31, balance);
    expect(placed.ok, JSON.stringify(placed)).toBe(true);
    const workshop = [...world.buildings.values()][0];
    if (!workshop) throw new Error('nic nestojí');
    workshop.level = balance.disasters.chemicalSpill.heavyLevel - 1;

    const disaster = createChemicalSpillDisaster();
    expect(disaster.pickOrigin(world, content, balance)).toBeNull();

    // A na těžké úrovni už ano.
    workshop.level = balance.disasters.chemicalSpill.heavyLevel;
    expect(disaster.pickOrigin(world, content, balance)).not.toBeNull();
  });

  it('bez těžkého průmyslu nemá kde uniknout', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    expect(
      createChemicalSpillDisaster().pickOrigin(world, content, content.getBalance()),
    ).toBeNull();
  });
});

describe('validace T53', () => {
  it('odmítne blackout, jehož prahy by kmitaly', () => {
    const raw = rawBalance();
    const disasters = raw['disasters'] as Record<string, unknown>;
    const blackout = disasters['blackout'] as Record<string, unknown>;
    blackout['recoveryRatio'] = blackout['overloadRatio'];

    const result = validateBalance(raw);
    expect(result.balance).toBeNull();
    expect(result.issues.map((issue) => issue.field)).toContain('disasters.blackout');
  });

  it('odmítne epidemii, kterou by nezastavilo ani plné zdravotnictví', () => {
    const raw = rawBalance();
    const disasters = raw['disasters'] as Record<string, unknown>;
    const epidemic = disasters['epidemic'] as Record<string, unknown>;
    epidemic['growth'] = 0.9;

    const result = validateBalance(raw);
    expect(result.balance).toBeNull();
    expect(result.issues.map((issue) => issue.field)).toContain('disasters.epidemic');
  });
});

/** Syrový balanc z obsahu, aby šly zkoušet chyby ve validaci. */
function rawBalance(): Record<string, unknown> {
  const modules = import.meta.glob('../content/vanilla/balance.json', {
    eager: true,
    import: 'default',
  });
  return structuredClone(Object.values(modules)[0]) as Record<string, unknown>;
}
