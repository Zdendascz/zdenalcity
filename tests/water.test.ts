import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { checkFootprint, placeBuilding } from '@/sim/buildings';
import { buildPipe, buildRoad, bulldoze, placeDefinition } from '@/sim/commands';
import { index, ROAD, TERRAIN } from '@/sim/layers';
import { createWaterDecaySystem, createWaterSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

function world(funds = 200000): WorldState {
  const created = createWorld(1, VANILLA_BALANCE.economy);
  created.economy.funds = funds;
  return created;
}

/** Jezero na levém okraji, ať má vodárna z čeho brát. */
function lake(w: WorldState): void {
  for (let y = 0; y < w.size; y++) {
    for (let x = 0; x < 4; x++) w.layers.terrain[index(x, y)] = TERRAIN.water;
  }
}

/** Vodárna u jezera i se silnicí, kterou podle definice potřebuje. */
function waterworks(w: WorldState, content: ContentRegistry, x: number, y: number): boolean {
  for (let dy = -1; dy <= 3; dy++) buildRoad(w, x + 3, y + dy, ROAD.street, VANILLA_BALANCE);
  return placeDefinition(w, content, 'vanilla:water_works', x, y, VANILLA_BALANCE).ok;
}

/** Potrubí od `x0` po `x1` na řádku `y`. */
function pipes(w: WorldState, x0: number, x1: number, y: number): void {
  for (let x = x0; x <= x1; x++) buildPipe(w, x, y, VANILLA_BALANCE);
}

function run(w: WorldState, content: ContentRegistry, ticks: number): void {
  const systems = [
    createWaterSystem(content, VANILLA_BALANCE),
    createWaterDecaySystem(content, VANILLA_BALANCE),
  ];
  for (let tick = 0; tick < ticks; tick++) tickWorld(w, systems);
}

describe('vodovod (§8 fáze 3)', () => {
  it('voda teče potrubím z vodárny', async () => {
    const content = await vanilla();
    const w = world();
    lake(w);

    expect(waterworks(w, content, 4, 20)).toBe(true);
    pipes(w, 7, 20, 20);
    run(w, content, 4);

    expect(w.waterSupply[index(7, 20)]).toBe(1);
    expect(w.waterSupply[index(20, 20)]).toBe(1);
    // Vedle potrubí už voda není — netvoří kaluž, drží se v trubkách.
    expect(w.waterSupply[index(20, 21)]).toBe(0);
  });

  it('budovy vodu nevedou, potrubí musí být pod nimi (§8)', async () => {
    // Tohle je ten rozdíl proti elektřině, kvůli kterému to není kopie.
    const content = await vanilla();
    const w = world();
    lake(w);
    waterworks(w, content, 4, 20);
    pipes(w, 7, 14, 20);

    const house = content.get('vanilla:residential_small');
    expect(house).toBeDefined();
    if (!house) return;

    // Dům přiléhá k potrubí, ale nemá ho pod sebou.
    const built = placeBuilding(w, house, 15, 20);
    run(w, content, 4);
    expect(w.watered.has(built.id)).toBe(false);

    // Jakmile se potrubí protáhne pod něj, voda je.
    buildPipe(w, 15, 20, VANILLA_BALANCE);
    run(w, content, 4);
    expect(w.watered.has(built.id)).toBe(true);
  });

  it('bez vodárny neteče ani nejdelší potrubí', async () => {
    const content = await vanilla();
    const w = world();
    pipes(w, 5, 40, 30);
    run(w, content, 4);

    expect([...w.waterSupply].every((value) => value === 0)).toBe(true);
  });

  it('síť má dosah — za ním voda končí', async () => {
    const content = await vanilla();
    const w = world();
    lake(w);
    waterworks(w, content, 4, 20);

    const range = content.get('vanilla:water_works')?.water?.range ?? 0;
    expect(range).toBeGreaterThan(0);
    pipes(w, 7, 7 + range + 6, 20);
    run(w, content, 4);

    // Poslední dlaždice v dosahu ještě má vodu, ta za koncem už ne.
    expect(w.waterSupply[index(7 + range - 3, 20)]).toBe(1);
    expect(w.waterSupply[index(7 + range + 6, 20)]).toBe(0);
  });

  it('čerpací stanice dosah prodlouží, ale sama vodu nezaloží', async () => {
    const content = await vanilla();
    const range = content.get('vanilla:water_works')?.water?.range ?? 0;

    // Bez vodárny stanice nic nerozjede.
    const alone = world();
    pipes(alone, 5, 40, 30);
    placeDefinition(alone, content, 'vanilla:pump_station', 20, 30, VANILLA_BALANCE);
    run(alone, content, 4);
    expect([...alone.waterSupply].every((value) => value === 0)).toBe(true);

    // S vodárnou na začátku sítě posune konec dál.
    const bez = world();
    lake(bez);
    waterworks(bez, content, 4, 20);
    pipes(bez, 7, 7 + range + 12, 20);
    run(bez, content, 4);

    const s = world();
    lake(s);
    waterworks(s, content, 4, 20);
    pipes(s, 7, 7 + range + 12, 20);
    // Stanice těsně před koncem dosahu, na potrubí.
    expect(placeDefinition(s, content, 'vanilla:pump_station', 7 + range - 2, 20, VANILLA_BALANCE).ok).toBe(true);
    run(s, content, 4);

    const konec = 7 + range + 8;
    expect(bez.waterSupply[index(konec, 20)]).toBe(0);
    expect(s.waterSupply[index(konec, 20)]).toBe(1);
  });

  it('odpojená čerpací stanice vodu nikam nedá', async () => {
    // Mutační test ukázal, že tohle nikdo nehlídal: stanice bez napojení na
    // vodárnu se nesmí stát zdrojem, i když vodárna stojí jinde na mapě.
    const content = await vanilla();
    const w = world();
    lake(w);
    waterworks(w, content, 4, 20);
    pipes(w, 7, 20, 20); // síť u vodárny

    // Ostrůvek potrubí daleko od sítě a na něm stanice.
    pipes(w, 60, 70, 60);
    expect(placeDefinition(w, content, 'vanilla:pump_station', 65, 60, VANILLA_BALANCE).ok).toBe(true);
    run(w, content, 4);

    expect(w.waterSupply[index(20, 20)]).toBe(1); // připojená síť teče
    expect(w.waterSupply[index(65, 60)]).toBe(0); // odpojený ostrůvek ne
    expect(w.waterSupply[index(70, 60)]).toBe(0);
  });

  it('vodárna musí stát u vody', async () => {
    const content = await vanilla();
    const w = world();
    // Silnici má, jezero ne — ať se pozná právě to chybějící pobřeží.
    for (let dy = -1; dy <= 3; dy++) buildRoad(w, 43, 40 + dy, ROAD.street, VANILLA_BALANCE);

    const result = placeDefinition(w, content, 'vanilla:water_works', 40, 40, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.needsShore');
  });

  it('zbourané potrubí síť zase přeruší', async () => {
    const content = await vanilla();
    const w = world();
    lake(w);
    waterworks(w, content, 4, 20);
    pipes(w, 7, 20, 20);
    run(w, content, 4);
    expect(w.waterSupply[index(20, 20)]).toBe(1);

    expect(bulldoze(w, 14, 20, VANILLA_BALANCE).ok).toBe(true);
    run(w, content, 4);

    expect(w.waterSupply[index(12, 20)]).toBe(1); // před přetrženým místem
    expect(w.waterSupply[index(20, 20)]).toBe(0); // za ním už ne
  });

  it('potrubí nejde položit na vodu ani dvakrát', () => {
    const w = world();
    w.layers.terrain[index(10, 10)] = TERRAIN.water;

    expect(buildPipe(w, 10, 10, VANILLA_BALANCE).ok === false).toBe(true);
    expect(buildPipe(w, 11, 10, VANILLA_BALANCE).ok).toBe(true);

    const again = buildPipe(w, 11, 10, VANILLA_BALANCE);
    expect(again.ok === false && again.reason).toBe('error.pipeExists');
  });

  it('potrubí smí ležet pod silnicí i pod budovou — je pod zemí', async () => {
    const content = await vanilla();
    const w = world();
    const house = content.get('vanilla:residential_small');
    if (!house) return;

    placeBuilding(w, house, 30, 30);
    expect(buildPipe(w, 30, 30, VANILLA_BALANCE).ok).toBe(true);
    expect(w.layers.pipe[index(30, 30)]).toBe(1);
  });
});

describe('bez vody se nestaví a chátrá (kritérium 17)', () => {
  it('parcela bez vody stavbu odmítne', async () => {
    const content = await vanilla();
    const w = world();
    const house = content.get('vanilla:residential_small');
    expect(house?.construction.requiresWater).toBe(true);
    if (!house) return;

    const suchá = checkFootprint(w, house, 40, 40, { skipRoadCheck: true });
    expect(suchá.ok).toBe(false);
    expect(suchá.ok === false && suchá.reason).toBe('error.needsWater');
  });

  it('s vodou pod pozemkem se postaví', async () => {
    const content = await vanilla();
    const w = world();
    lake(w);
    waterworks(w, content, 4, 20);
    // Dům musí být **v dosahu** sítě, ne jen na jejím konci.
    pipes(w, 7, 25, 20);
    run(w, content, 4);

    const house = content.get('vanilla:residential_small');
    if (!house) return;
    expect(checkFootprint(w, house, 25, 20, { skipRoadCheck: true }).ok).toBe(true);
  });

  it('dům bez vody ztrácí obyvatele a nakonec zůstane ruina', async () => {
    const content = await vanilla();
    const w = world();
    const house = content.get('vanilla:residential_small');
    if (!house) return;

    const built = placeBuilding(w, house, 40, 40);
    built.population = 6;

    run(w, content, 20 * VANILLA_BALANCE.water.abandonAfter);

    expect(built.population).toBe(0);
    expect(built.abandoned).toBe(true);
  });

  it('dům s vodou nechátrá', async () => {
    const content = await vanilla();
    const w = world();
    lake(w);
    waterworks(w, content, 4, 20);
    pipes(w, 7, 25, 20);

    const house = content.get('vanilla:residential_small');
    if (!house) return;
    const built = placeBuilding(w, house, 25, 20);
    built.population = 6;

    run(w, content, 20 * VANILLA_BALANCE.water.abandonAfter);

    expect(built.population).toBe(6);
    expect(built.abandoned).toBe(false);
  });

  it('elektrárna se bez vodovodu obejde', async () => {
    // Chátrá jen to, co vodu podle definice potřebuje.
    const content = await vanilla();
    const w = world();
    const plant = content.get('vanilla:coal_power_plant');
    expect(plant?.construction.requiresWater).toBeUndefined();
    if (!plant) return;

    const built = placeBuilding(w, plant, 40, 40);
    run(w, content, 20 * VANILLA_BALANCE.water.abandonAfter);

    expect(built.abandoned).toBe(false);
  });
});
