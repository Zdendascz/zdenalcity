import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { buildRoad, zoneArea } from '@/sim/commands';
import { coarseIndex } from '@/sim/coarse';
import {
  alertTarget,
  explainDemand,
  explainLandValue,
  explainParcel,
  growthBlocker,
  landValueContext,
  worstBlocker,
} from '@/sim/diagnostics';
import { applyCornerChanges, planCornerHeight } from '@/sim/heights';
import { index, ZONE } from '@/sim/layers';
import { createDefaultSystems, createLandValueSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { assumeWatered } from './support/water';
import { COARSE_CELLS } from './support/grid';
import { powerAll } from './support/power';

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Město se službami i špínou, aby měl rozpis co ukazovat. */
async function city(): Promise<{ world: WorldState; content: ContentRegistry }> {
  const content = await vanilla();
  const balance = content.getBalance();
  const world = createWorld(1, balance.economy);

  for (let x = 20; x <= 40; x++) buildRoad(world, x, 30);
  zoneArea(world, 21, 31, 19, 3, ZONE.residential);
  const park = content.get('vanilla:park_small');
  const factory = content.get('vanilla:industrial_small');
  if (park) placeBuilding(world, park, 22, 29);
  if (factory) {
    for (let x = 34; x <= 38; x++) placeBuilding(world, factory, x, 34);
  }

  const systems = createDefaultSystems(content, balance);
  // Testovací město nemá elektrárnu; temná služba od T53 nepokrývá a rozbor
  // ceny půdy je o parku, ne o elektřině.
  for (let tick = 0; tick < 400; tick++) {
    powerAll(world);
    tickWorld(world, systems);
  }
  return { world, content };
}

describe('rozpis ceny půdy', () => {
  it('součet sčítanců je přesně to, kam vrstva míří', async () => {
    // Kdyby si diagnostika počítala vlastní vzorec, ukazovala by hráči něco
    // jiného, než podle čeho se hraje. Proto ho sdílí se systémem — a tenhle
    // test hlídá, že se ta jedna cesta nerozdvojí.
    const { world, content } = await city();
    const balance = content.getBalance();

    const before = new Uint8Array(world.coarse.landValue);
    const targets = new Map<number, number>();
    // Kontext se počítá jednou za běh, ne pro každou buňku — stejně jako
    // v systému. Uvnitř smyčky by z toho byly čtyři průchody mapou krát 1024.
    const context = landValueContext(world, balance);
    for (let cell = 0; cell < COARSE_CELLS; cell++) {
      const explained = explainLandValue(world, balance, cell, context);
      expect(explained.terms.reduce((sum, term) => sum + term.amount, 0)).toBeCloseTo(explained.raw);
      expect(explained.current).toBe(before[cell]);
      targets.set(cell, explained.raw);
    }

    // Vrstva se k rozpisu smí jen blížit, nikdy se od něj vzdálit…
    const system = createLandValueSystem(balance);
    for (let i = 0; i <= system.offset + system.interval; i++) tickWorld(world, [system]);

    for (let cell = 0; cell < COARSE_CELLS; cell++) {
      const target = targets.get(cell) ?? 0;
      const from = before[cell] ?? 0;
      const to = world.coarse.landValue[cell] ?? 0;
      if (to === from) continue;
      expect(Math.sign(to - from), `buňka ${cell}`).toBe(Math.sign(target - from));
    }

    // …a když jí necháme čas, dojde přesně tam, kam rozpis ukazuje.
    for (let i = 0; i < system.interval * 40; i++) tickWorld(world, [system]);
    for (let cell = 0; cell < COARSE_CELLS; cell++) {
      const target = Math.max(0, Math.min(255, targets.get(cell) ?? 0));
      expect(world.coarse.landValue[cell] ?? 0, `buňka ${cell}`).toBeCloseTo(target, -0.5);
    }
  });

  it('pojmenuje, co cenu půdy sráží a co ji zvedá', async () => {
    const { world, content } = await city();
    const cell = coarseIndex(22, 31, world.size); // u parku
    const balance = content.getBalance();
    const explained = explainLandValue(world, balance, cell, landValueContext(world, balance));
    const by = new Map(explained.terms.map((term) => [term.source, term]));

    expect(by.get('base')?.amount).toBe(content.getBalance().landValue.base);
    expect(by.get('parks')?.amount).toBeGreaterThan(0);
    expect(by.get('pollution')?.amount ?? 0).toBeLessThanOrEqual(0);
  });
});

describe('rozbor parcely', () => {
  it('řekne, jak daleko je silnice a jestli tam vůbec něco vyroste', async () => {
    const { world, content } = await city();
    const balance = content.getBalance();

    const nearRoad = explainParcel(world, balance, 25, 31);
    expect(nearRoad.roadDistance).toBe(1);
    expect(nearRoad.roadFactor).toBe(1);

    // Parcela hluboko mimo dosah — tohle je ta odpověď na „proč mi tu nic neroste".
    const far = explainParcel(world, balance, 25, 60);
    expect(far.roadDistance).toBeNull();
    expect(far.roadFactor).toBe(0);
  });

  it('nese zónu, poptávku i práh další úrovně', async () => {
    const { world, content } = await city();
    world.demand.residential = content.getBalance().demand.limit;

    const parcel = explainParcel(world, content.getBalance(), 25, 31);

    expect(parcel.zone).toBe(ZONE.residential);
    expect(parcel.category).toBe('residential');
    expect(parcel.demand).toBe(content.getBalance().demand.limit);
    // Při plné poptávce je práh snížený o celou úlevu (§8).
    expect(parcel.levels.demandRelief).toBe(content.getBalance().levels.demandRelief);
  });

  it('mimo zónu poptávku nevymýšlí', async () => {
    const { world, content } = await city();
    const parcel = explainParcel(world, content.getBalance(), 5, 5);

    expect(parcel.category).toBeNull();
    expect(parcel.demand).toBeNull();
    expect(parcel.levels.demandRelief).toBe(0);
  });

  it('u stojící budovy ukazuje práh její další úrovně', async () => {
    const { world, content } = await city();
    const balance = content.getBalance();
    const house = content.get('vanilla:residential_medium'); // úroveň 2
    expect(house).toBeDefined();
    if (!house) return;

    placeBuilding(world, house, 26, 32);
    const parcel = explainParcel(world, balance, 26, 32);

    expect(parcel.levels.nextThreshold).toBe(balance.levels.thresholds[3]);
  });
});

describe('proč tu nic neroste', () => {
  /**
   * Nejtišší selhání celé hry: zóna u silnice, voda i proud, kasa v plusu —
   * a nevyroste nic, protože je parcela na svahu. Autor to hlásil dvakrát,
   * pokaždé z jiného důvodu, a pokaždé to nešlo nikde přečíst.
   */
  async function parcel(): Promise<{ world: WorldState; content: ContentRegistry }> {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    for (let x = 20; x <= 30; x++) buildRoad(world, x, 30);
    zoneArea(world, 21, 31, 8, 2, ZONE.residential);
    world.demand.residential = content.getBalance().demand.limit;
    assumeWatered(world);
    return { world, content };
  }

  it('na připravené parcele nic nebrání', async () => {
    const { world, content } = await parcel();
    expect(growthBlocker(world, content, content.getBalance(), 25, 31)).toBeNull();
  });

  it('svah překážka není — na tom se stavět smí', async () => {
    // Rozhodnutí autora (T41): dům ze zóny stojí i na kopci, jen se tam staví
    // méně ochotně. Do té doby to byl zákaz a na generované mapě tím byla
    // necelá polovina souše nezastavitelná.
    const { world, content } = await parcel();
    applyCornerChanges(world.cornerHeight, planCornerHeight(world.cornerHeight, 25, 31, 3));

    expect(growthBlocker(world, content, content.getBalance(), 25, 31)).toBeNull();
  });

  it('mělká zóna se hlásí jako mělká, ne jako špatná', async () => {
    // `checkFootprint` vrací `error.wrongZone`, což hráče pošle špatným směrem:
    // zónu vyznačil správně, jen je mělčí, než co se do ní vejde.
    //
    // Ve vanilla obsahu to dnes nenastane — nejmenší budova každé kategorie je
    // 1×1, takže i jednořadá zóna vyroste. (Původní hlášení mluvilo o
    // `industrial_small` s půdorysem 2×2; ten se od té doby zmenšil.) Katalog
    // je ale obsah, ne kód (P5), takže mod s většími budovami na to narazí —
    // proto se tu katalog podstrčí.
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    for (let x = 20; x <= 30; x++) buildRoad(world, x, 30);
    zoneArea(world, 21, 31, 8, 1, ZONE.industrial);
    world.demand.industrial = content.getBalance().demand.limit;
    assumeWatered(world);

    expect(growthBlocker(world, bigSeeds(content), content.getBalance(), 25, 31)).toBe(
      'ui.parcel.blocked.zoneTooSmall',
    );
  });

  it('dost hluboká zóna už nic nehlásí', async () => {
    // Protiklad: tentýž katalog, jen zóna o řadu hlubší.
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    for (let x = 20; x <= 30; x++) buildRoad(world, x, 30);
    zoneArea(world, 21, 31, 8, 2, ZONE.industrial);
    world.demand.industrial = content.getBalance().demand.limit;
    assumeWatered(world);

    expect(growthBlocker(world, bigSeeds(content), content.getBalance(), 25, 31)).toBeNull();
  });

  it('chybějící voda taky', async () => {
    const { world, content } = await parcel();
    world.waterSupply.fill(0);
    world.watered.clear();

    expect(growthBlocker(world, content, content.getBalance(), 25, 31)).toBe('error.needsWater');
  });

  it('mimo zónu, mimo dosah silnice i v bankrotu řekne proč', async () => {
    const { world, content } = await parcel();
    const balance = content.getBalance();

    expect(growthBlocker(world, content, balance, 60, 60)).toBe('ui.parcel.blocked.noZone');
    // Zónovaná parcela daleko od silnice.
    zoneArea(world, 60, 60, 2, 2, ZONE.residential);
    expect(growthBlocker(world, content, balance, 60, 60)).toBe(
      'ui.parcel.blocked.tooFarFromRoad',
    );

    world.economy.funds = -1;
    expect(growthBlocker(world, content, balance, 25, 31)).toBe('ui.parcel.blocked.bankrupt');
  });

  it('na postavené parcele nehlásí nic', async () => {
    const { world, content } = await parcel();
    const house = content.get('vanilla:residential_small');
    if (!house) return;
    placeBuilding(world, house, 25, 31);

    expect(growthBlocker(world, content, content.getBalance(), 25, 31)).toBeNull();
  });
});

describe('která překážka se hlásí', () => {
  it('vyhraje ta, která drží parcely nejblíž hotova', () => {
    // Velká zóna daleko od silnice by přehlasovala pár parcel u vozovky, které
    // skoro staví — a hráč by dostal radu o něčem, co ho netrápí.
    expect(
      worstBlocker([
        'ui.parcel.blocked.tooFarFromRoad',
        'ui.parcel.blocked.tooFarFromRoad',
        'ui.parcel.blocked.tooFarFromRoad',
        'error.notFlat',
      ]),
    ).toBe('error.notFlat');
  });

  it('bankrot přebíjí všechno', () => {
    // Radit „srovnej terén" městu, kterému růst stojí kvůli mínusu, je k ničemu.
    expect(worstBlocker(['error.notFlat', 'ui.parcel.blocked.bankrupt'])).toBe(
      'ui.parcel.blocked.bankrupt',
    );
  });

  it('bez důvodů nehlásí nic', () => {
    expect(worstBlocker([])).toBeNull();
  });
});

/**
 * Katalog, ve kterém je nejmenší průmyslová budova 2×2.
 *
 * Vanilla má dnes všude 1×1, takže mělkou zónu nejde vyzkoušet na ní. Obsah je
 * ale data (P5) a mod s většími budovami je legitimní — tenhle katalog ho
 * zastupuje.
 */
function bigSeeds(content: ContentRegistry): BuildingCatalogue {
  const wide = content
    .byCategory('industrial')
    .filter((definition) => definition.level === 1)
    .map((definition) => ({ ...definition, footprint: [2, 2] as [number, number] }));

  return {
    get: (id) => content.get(id),
    byCategory: (category) => (category === 'industrial' ? wide : content.byCategory(category)),
  };
}

/**
 * Kam kamera skočí, když se ohlásí katastrofa.
 *
 * Zemětřesení má epicentrum kdekoli, i v pustině — otřes se roznese po celé
 * mapě, takže na epicentru není co vidět. Hráč to nahlásil: „notifikace přijde,
 * ale vždy mi to ukáže místo zásahu mimo město."
 */
describe('kam ukázat po katastrofě', () => {
  it('když je u vzniku zástavba, ukáže se vznik', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    const definition = content.get('vanilla:wind_turbine');
    expect(definition).toBeDefined();
    if (!definition) return;
    placeBuilding(world, definition, 40, 40);

    expect(alertTarget(world, 41, 41)).toEqual({ x: 41, y: 41 });
  });

  it('epicentrum v pustině přesměruje na hořící dlaždici', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    const definition = content.get('vanilla:wind_turbine');
    if (!definition) return;
    placeBuilding(world, definition, 40, 40);
    world.fire[index(42, 40, world.size)] = 200;

    // Sto dlaždic daleko není ani dům, ani silnice, ani oheň.
    expect(alertTarget(world, 5, 120)).toEqual({ x: 42, y: 40 });
  });

  it('bez škody a bez zástavby u vzniku ukáže těžiště města', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    const definition = content.get('vanilla:wind_turbine');
    if (!definition) return;
    placeBuilding(world, definition, 40, 40);
    placeBuilding(world, definition, 44, 44);

    expect(alertTarget(world, 5, 120)).toEqual({ x: 42, y: 42 });
  });
});

/**
 * Z čeho vyšly sloupečky O/K/P.
 *
 * Hráč to hlásil takhle: „váhy, co je kdy potřeba, se zdají chaotické."
 * Model je přitom tři řádky a stojí na jediné myšlence — lidé chtějí práci
 * a práce chce lidi. Rozpad se počítá **týmiž vzorci jako poptávka**, takže
 * se s ní nemůže rozejít.
 */
describe('rozpad poptávky', () => {
  it('pojmenuje sčítance a čísla sedí s tím, co ve městě stojí', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);

    const shop = content.get('vanilla:commercial_small');
    expect(shop).toBeDefined();
    if (!shop) return;
    placeBuilding(world, shop, 20, 20);
    const built = [...world.buildings.values()][0];
    expect(built).toBeDefined();
    if (!built) return;
    built.jobs = 30;

    const rows = explainDemand(world, content, balance);
    const commercial = rows.find((row) => row.category === 'commercial');
    expect(commercial).toBeDefined();
    // Obchod bez obyvatel: zákazníci nula, míst třicet, tedy záporná poptávka.
    expect(commercial?.terms.map((term) => term.key)).toEqual([
      'ui.demand.term.shoppers',
      'ui.demand.term.shops',
    ]);
    expect(commercial?.terms[1]?.value).toBe(-30);

    const industrial = rows.find((row) => row.category === 'industrial');
    // Náskok je první sčítanec i tady — rozpad musí ukazovat totéž, z čeho
    // poptávka vyšla, jinak hráči nesedí součet.
    expect(industrial?.terms.map((term) => term.key)).toEqual([
      'ui.demand.term.base',
      'ui.demand.term.workers',
      'ui.demand.term.jobs',
    ]);
    expect(industrial?.terms[0]?.value).toBe(balance.demand.baseIndustrial.start);
    expect(industrial?.terms[2]?.value, 'místa se odčítají').toBe(-30);
  });
});
