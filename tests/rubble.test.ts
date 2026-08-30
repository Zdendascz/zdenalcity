import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { buildPipe, buildRoad, bulldoze, placeDefinition, zoneArea } from '@/sim/commands';
import { checkFootprint } from '@/sim/buildings';
import { explainLandValue, growthBlocker, landValueContext } from '@/sim/diagnostics';
import { createFireSystem, igniteTile } from '@/sim/disasters/fire';
import { clearRubble, hasRubble, rubblePerCell, spawnRubble } from '@/sim/disasters/rubble';
import { coarseCellsOfShape } from '@/sim/disasters/shapes';
import { index, ROAD, TERRAIN, ZONE } from '@/sim/layers';
import { createDefaultSystems } from '@/sim/systems';
import { createWorld, resizeWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { MAP_SIZE } from './support/grid';

/**
 * Trosky (T50, R15 fáze 4).
 *
 * **Vrstva, ne stav budovy.** Rozdíl je vidět hned: trosky zůstanou i tam, kde
 * žádná budova nestála — po zničené silnici, po prokopaném potrubí. Kdyby byly
 * příznakem budovy, půlka katastrof by po sobě neuklidila nic.
 *
 * Testuje se hlavně to, kvůli čemu vznikly: **blokují stavbu**. Z toho plyne
 * jediná věc, kterou po katastrofě hráč musí zaplatit, a tím pádem i
 * rozhodnutí, kterou čtvrť obnovit dřív. Kdyby se blokování rozpadlo, byly by
 * trosky jen kosmetika.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

function richWorld(content: ContentRegistry): WorldState {
  const world = createWorld(1, content.getBalance().economy);
  world.economy.funds = 1000000;
  return world;
}

describe('vrstva trosek', () => {
  it('vzniká i tam, kde žádná budova nestála', () => {
    // Tohle je celý důvod, proč je to vrstva: po zničené silnici nebo potrubí
    // zbyde suť, a žádná budova, které by mohla patřit.
    const world = createWorld(1);
    const tile = index(20, 20, MAP_SIZE);

    expect(hasRubble(world, tile)).toBe(false);
    spawnRubble(world, tile);
    expect(hasRubble(world, tile)).toBe(true);
    expect(world.buildings.size).toBe(0);

    clearRubble(world, tile);
    expect(hasRubble(world, tile)).toBe(false);
  });

  it('opakované zasypání nic nemění', () => {
    const world = createWorld(1);
    const tile = index(20, 20, MAP_SIZE);
    spawnRubble(world, tile);
    spawnRubble(world, tile);
    expect(world.rubble[tile]).toBe(1);
  });

  it('přestavba světa na jinou velikost trosky zahodí', () => {
    const world = createWorld(1, undefined, 128);
    spawnRubble(world, index(20, 20, 128));
    resizeWorld(world, 192);
    expect(world.rubble.length).toBe(192 * 192);
    expect(world.rubble.some((value) => value !== 0)).toBe(false);
  });

  it('počítá se po buňkách hrubé mřížky', () => {
    const world = createWorld(1);
    spawnRubble(world, index(20, 20, MAP_SIZE));
    spawnRubble(world, index(21, 20, MAP_SIZE));
    spawnRubble(world, index(60, 60, MAP_SIZE));

    const counts = rubblePerCell(world);
    const near = coarseCellsOfShape(world, { kind: 'point', x: 20, y: 20 })[0] ?? 0;
    const far = coarseCellsOfShape(world, { kind: 'point', x: 60, y: 60 })[0] ?? 0;

    expect(counts[near]).toBe(2);
    expect(counts[far]).toBe(1);
  });
});

describe('trosky blokují stavbu', () => {
  it('budova se na ně nepostaví', async () => {
    const content = await vanilla();
    const world = richWorld(content);
    const balance = content.getBalance();
    for (let x = 19; x <= 22; x++) buildRoad(world, x, 22, ROAD.street, balance);

    const before = placeDefinition(world, content, 'vanilla:park_small', 20, 20, balance);
    expect(before.ok).toBe(true);
    bulldoze(world, 20, 20, balance);

    spawnRubble(world, index(20, 20, MAP_SIZE));
    const after = placeDefinition(world, content, 'vanilla:park_small', 20, 20, balance);
    expect(after.ok).toBe(false);
    expect(after.ok ? '' : after.reason).toBe('error.rubbleInTheWay');
  });

  it('překážejí i části většího půdorysu', async () => {
    // Suť na jednom rohu zastaví celou stavbu — jinak by hráč postavil továrnu
    // přes hromadu trosek a ty by pod ní zůstaly navěky.
    const content = await vanilla();
    const world = richWorld(content);
    const definition = content.get('vanilla:coal_power_plant');
    if (!definition) throw new Error('chybí definice elektrárny');

    spawnRubble(world, index(23, 23, MAP_SIZE));
    const result = checkFootprint(world, definition, 20, 20, { skipRoadCheck: true });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toBe('error.rubbleInTheWay');
  });

  it('silnice přes ně nevede', async () => {
    // Právě proto není rozbitá čtvrť po tornádu jen kulisa: přerušená silnice
    // se nedá obnovit, dokud se neuklidí.
    const content = await vanilla();
    const world = richWorld(content);
    spawnRubble(world, index(30, 30, MAP_SIZE));

    const result = buildRoad(world, 30, 30, ROAD.street, content.getBalance());
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toBe('error.rubbleInTheWay');
  });

  it('potrubí taky ne', async () => {
    const content = await vanilla();
    const world = richWorld(content);
    spawnRubble(world, index(31, 31, MAP_SIZE));

    const result = buildPipe(world, 31, 31, content.getBalance());
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toBe('error.rubbleInTheWay');
  });

  it('zóna na nich nevyroste a panel řekne proč', async () => {
    const content = await vanilla();
    const world = richWorld(content);
    const balance = content.getBalance();
    for (let x = 10; x < 20; x++) buildRoad(world, x, 11, ROAD.street, balance);
    zoneArea(world, 10, 10, 10, 1, ZONE.residential);
    world.demand.residential = 100;

    const clean = growthBlocker(world, content, balance, 12, 10);
    spawnRubble(world, index(12, 10, MAP_SIZE));
    const blocked = growthBlocker(world, content, balance, 12, 10);

    expect(clean).not.toBe('error.rubbleInTheWay');
    // Hra musí říct, co je špatně. Bez toho hráč vidí prázdnou parcelu
    // uprostřed zóny a nemá jak zjistit, že mu tam leží hromada suti.
    expect(blocked).toBe('error.rubbleInTheWay');
  });

  it('trosky se hlásí dřív než vzdálenost od silnice', async () => {
    // Parcela může být zároveň daleko od silnice **a** zavalená. Rada „je to
    // daleko od silnice" by hráče poslala stavět cestu tam, kde stejně nic
    // nevyroste; hromada suti je konkrétní věc, se kterou umí něco udělat.
    const content = await vanilla();
    const world = richWorld(content);
    const balance = content.getBalance();

    // Zóna daleko od jakékoli silnice.
    zoneArea(world, 60, 60, 4, 4, ZONE.residential);
    world.demand.residential = 100;

    const farOnly = growthBlocker(world, content, balance, 61, 61);
    expect(farOnly).toBe('ui.parcel.blocked.tooFarFromRoad');

    spawnRubble(world, index(61, 61, MAP_SIZE));
    expect(growthBlocker(world, content, balance, 61, 61)).toBe('error.rubbleInTheWay');
  });
});

describe('úklid trosek', () => {
  it('buldozer je odstraní a stojí to peníze', async () => {
    const content = await vanilla();
    const world = richWorld(content);
    const balance = content.getBalance();
    const tile = index(40, 40, MAP_SIZE);
    spawnRubble(world, tile);

    const before = world.economy.funds;
    const result = bulldoze(world, 40, 40, balance);

    expect(result.ok).toBe(true);
    expect(hasRubble(world, tile)).toBe(false);
    expect(before - world.economy.funds).toBe(balance.disasters.rubble.clearCost);
  });

  it('bez peněz se uklidit nedá', async () => {
    const content = await vanilla();
    const world = richWorld(content);
    const balance = content.getBalance();
    const tile = index(41, 41, MAP_SIZE);
    spawnRubble(world, tile);
    world.economy.funds = 0;

    const result = bulldoze(world, 41, 41, balance);
    expect(result.ok).toBe(false);
    expect(hasRubble(world, tile)).toBe(true);
  });

  it('suť na zónované parcele zmizí prvním kliknutím', async () => {
    // Po vyhořelém domě zůstane zóna i suť. Kdyby buldozer mazal zónu dřív,
    // hráč by na hromadu klikl, ona by tam pořád byla — a nepozorovaně by
    // přišel o zónu. Nahlásilo se to při hraní, ne testem.
    const content = await vanilla();
    const world = richWorld(content);
    const balance = content.getBalance();
    zoneArea(world, 50, 50, 1, 1, ZONE.residential);
    const tile = index(50, 50, MAP_SIZE);
    spawnRubble(world, tile);

    expect(bulldoze(world, 50, 50, balance).ok).toBe(true);
    expect(hasRubble(world, tile)).toBe(false);
    // Zóna zůstala: hráč o ni nepřišel jen tím, že uklidil.
    expect(world.layers.zone[tile]).toBe(ZONE.residential);
  });

  it('nejdřív zmizí to, co na nich stojí', async () => {
    // Buldozer boura odshora. Kdyby trosky přebily silnici, hráč by ji nemohl
    // odstranit, dokud pod ní nezmizí suť — což je pořadí naruby.
    const content = await vanilla();
    const world = richWorld(content);
    const balance = content.getBalance();
    buildRoad(world, 45, 45, ROAD.street, balance);
    const tile = index(45, 45, MAP_SIZE);
    spawnRubble(world, tile);

    bulldoze(world, 45, 45, balance);
    expect(world.layers.road[tile]).toBe(ROAD.none);
    expect(hasRubble(world, tile)).toBe(true);

    bulldoze(world, 45, 45, balance);
    expect(hasRubble(world, tile)).toBe(false);
  });
});

describe('trosky ubližují čtvrti', () => {
  it('zvedají kriminalitu', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const cell = 0;

    const clean = createWorld(1, balance.economy);
    const wrecked = createWorld(1, balance.economy);
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) spawnRubble(wrecked, index(x, y, MAP_SIZE));
    }

    const systems = createDefaultSystems(content, balance);
    for (let tick = 0; tick < 60; tick++) {
      tickWorld(clean, systems);
      tickWorld(wrecked, systems);
    }

    expect(wrecked.coarse.crime[cell] ?? 0).toBeGreaterThan(clean.coarse.crime[cell] ?? 0);
  });

  it('srážejí cenu půdy vlastním sčítancem, ne oklikou přes kriminalitu', async () => {
    // Přes město měřit nestačí: trosky zvedají kriminalitu a ta cenu půdy
    // srazí taky, takže by test prošel, i kdyby vlastní sčítanec chyběl.
    // Hráč ho ale v rozpisu parcely potřebuje vidět — jinak neví, co s tím.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) spawnRubble(world, index(x, y, MAP_SIZE));
    }

    const context = landValueContext(world, balance);
    expect(context.rubble[0]).toBe(16);

    const withRubble = explainLandValue(world, balance, 0, context);
    const term = withRubble.terms.find((entry) => entry.source === 'rubble');
    expect(term).toBeDefined();
    expect(term?.amount ?? 0).toBeLessThan(0);
    expect(term?.input).toBe(16);

    // A bez trosek žádný takový sčítanec není.
    world.rubble.fill(0);
    const clean = explainLandValue(world, balance, 0, landValueContext(world, balance));
    expect(clean.terms.some((entry) => entry.source === 'rubble')).toBe(false);
    expect(clean.raw).toBeGreaterThan(withRubble.raw);
  });

  it('srážka je zastropovaná — plná buňka nesrazí víc než šestnáct dlaždic', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) spawnRubble(world, index(x, y, MAP_SIZE));
    }

    const term = explainLandValue(world, balance, 0, landValueContext(world, balance)).terms.find(
      (entry) => entry.source === 'rubble',
    );
    expect(term?.amount).toBeCloseTo(-balance.disasters.rubble.landValuePenalty);
  });

  it('úklid čtvrť zase zvedne', async () => {
    // Bez tohohle by byl úklid trosek jen výdaj bez odměny a hráč by neměl
    // důvod ho dělat jinde než tam, kde chce zrovna stavět.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) spawnRubble(world, index(x, y, MAP_SIZE));
    }

    const systems = createDefaultSystems(content, balance);
    for (let tick = 0; tick < 120; tick++) tickWorld(world, systems);
    const dirty = world.coarse.landValue[0] ?? 0;

    world.rubble.fill(0);
    for (let tick = 0; tick < 120; tick++) tickWorld(world, systems);

    expect(world.coarse.landValue[0] ?? 0).toBeGreaterThan(dirty);
  });
});

describe('oheň a trosky', () => {
  it('po vyhořelém domě zbudou trosky na celém půdorysu', async () => {
    const content = await vanilla();
    const world = richWorld(content);
    const balance = content.getBalance();

    for (let x = 19; x <= 24; x++) buildRoad(world, x, 24, ROAD.street, balance);
    expect(placeDefinition(world, content, 'vanilla:coal_power_plant', 20, 19, balance).ok).toBe(
      true,
    );

    igniteTile(world, content, balance, index(20, 20, MAP_SIZE), 200, false);
    const systems = [createFireSystem(content, balance)];
    for (let tick = 0; tick < 200; tick++) tickWorld(world, systems);

    expect(world.buildings.size).toBe(0);
    // Elektrárna je 4×4 — suť musí zůstat po celé ploše, ne jen tam, kde hořelo.
    let covered = 0;
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        if (hasRubble(world, index(20 + dx, 20 + dy, MAP_SIZE))) covered++;
      }
    }
    expect(covered).toBe(16);
  });

  it('po vyhořelém lese zbude tráva, ne trosky', async () => {
    const content = await vanilla();
    const world = richWorld(content);
    const balance = content.getBalance();
    const tile = index(50, 50, MAP_SIZE);
    world.layers.terrain[tile] = TERRAIN.forest;

    igniteTile(world, content, balance, tile, 200, true);
    const systems = [createFireSystem(content, balance)];
    for (let tick = 0; tick < 60; tick++) tickWorld(world, systems);

    expect(world.layers.terrain[tile]).toBe(TERRAIN.grass);
    expect(hasRubble(world, tile)).toBe(false);
  });

  it('trosky hoří, ale hůř než cokoli jiného', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const fire = balance.disasters.fire;

    // Suť doutná: nejnižší hořlavost v tabulce hned po parku.
    expect(fire.flammability['rubble']).toBeCloseTo(0.1);
    expect(fire.flammability['rubble'] ?? 1).toBeLessThan(fire.flammability['commercial'] ?? 0);
  });
});
