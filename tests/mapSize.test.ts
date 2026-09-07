import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { buildRoad, zoneArea } from '@/sim/commands';
import { coarseCellsOf, coarseIndex, coarseSizeOf, COARSE_FACTOR } from '@/sim/coarse';
import { cornerCellsOf, cornerSideOf, mapSizeOf, relaxHeights } from '@/sim/heights';
import { DEFAULT_MAP_SIZE, index, MAP_SIZES, ROAD, sizeOfLayer, TERRAIN, ZONE } from '@/sim/layers';
import { applyGeneratedMap, generateTerrain } from '@/sim/mapgen';
import { applySaveToWorld, unpackSave } from '@/save/deserialize';
import { serializeSave } from '@/save/serialize';
import { createDefaultSystems } from '@/sim/systems';
import { createWorld, resizeWorld, tickWorld } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';

/**
 * Velikost mapy je od T42 **běhový údaj**, ne konstanta (§2 fáze 4).
 *
 * Zbytek testů pracuje s výchozí velikostí, protože je zajímá něco jiného.
 * Tenhle soubor je ten jediný, který se ptá, jestli hra funguje i jinde než
 * na 128 × 128 — a je tu právě proto, že zadrátovaná konstanta se pozná až
 * tehdy, když ji někdo zkusí změnit.
 *
 * Zkouší se **malá i velká** mapa: malá odhalí chyby v okrajích, velká to,
 * že se někde počítá s 16 384 dlaždicemi.
 */
const SIZES = [64, 128, 192] as const;

const SAVE_OPTIONS = {
  cityName: 'Jinak velké',
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-01T00:00:00.000Z',
  playtimeSeconds: 0,
  sources: [],
};

describe('svět jiné velikosti', () => {
  it.each(SIZES)('alokuje všechny vrstvy podle hrany %i', (size) => {
    const world = createWorld(1, undefined, size);

    expect(world.size).toBe(size);
    expect(world.layers.terrain.length).toBe(size * size);
    expect(world.layers.buildingId.length).toBe(size * size);
    expect(world.trafficLoad.length).toBe(size * size);
    expect(world.waterSupply.length).toBe(size * size);

    expect(world.coarse.pollution.length).toBe(coarseCellsOf(size));
    expect(world.happiness.length).toBe(coarseCellsOf(size));
    expect(world.jobAccessCells.length).toBe(coarseCellsOf(size));

    // Mřížka rohů je o jedna větší než mřížka dlaždic — tenhle vztah musí
    // platit u každé velikosti, jinak se terén na kraji rozpadne.
    expect(world.cornerHeight.length).toBe(cornerCellsOf(size));
    expect(cornerSideOf(world.cornerHeight)).toBe(size + 1);
    expect(mapSizeOf(world.cornerHeight)).toBe(size);
  });

  it('velikost jde odvodit z délky vrstvy', () => {
    for (const size of SIZES) {
      const world = createWorld(1, undefined, size);
      expect(sizeOfLayer(world.layers.terrain)).toBe(size);
    }
  });

  it('hrubá mřížka roste s mapou, dělič zůstává čtyři', () => {
    // Kdyby počet buněk zůstal pevný, byla by difuze na velké mapě
    // šestnáctkrát hrubší a znečištění by se rozlévalo přes celé čtvrti.
    expect(coarseSizeOf(128)).toBe(32);
    expect(coarseSizeOf(512)).toBe(128);
    for (const size of MAP_SIZES) {
      expect(coarseSizeOf(size)).toBe(size / COARSE_FACTOR);
    }
  });

  it.each(SIZES)('mapuje dlaždice na buňky hrubé mřížky i na hraně %i', (size) => {
    const last = size - 1;
    expect(coarseIndex(0, 0, size)).toBe(0);
    expect(coarseIndex(last, last, size)).toBe(coarseCellsOf(size) - 1);
    // Poslední dlaždice nesmí přetéct mimo mřížku — na tom padaly indexy,
    // které si nesly velikost od jinud než z mapy.
    expect(coarseIndex(last, last, size)).toBeLessThan(coarseCellsOf(size));
  });
});

describe('nabídka v dialogu nové hry', () => {
  it('nabízí čtyři velikosti a výchozí je mezi nimi', () => {
    expect([...MAP_SIZES]).toEqual([128, 192, 256, 512]);
    expect(MAP_SIZES).toContain(DEFAULT_MAP_SIZE);
  });

  it.each(MAP_SIZES)('svět o hraně %i se dá založit i vygenerovat', (size) => {
    // Dialog nabízí čtyři tlačítka; tenhle test je jediné místo, kde se
    // ověří, že za každým z nich stojí mapa, která opravdu vznikne.
    // Samotný dialog je DOM a ten se tu netestuje — jsdom není závislost.
    const world = createWorld(3, undefined, size);
    applyGeneratedMap(world, generateTerrain(3, VANILLA_BALANCE, size));

    expect(world.size).toBe(size);
    expect(world.layers.terrain.length).toBe(size * size);
    // Mapa nesmí být samá voda ani samá souš — jinak není co hrát.
    let land = 0;
    for (const value of world.layers.terrain) if (value !== TERRAIN.water) land++;
    const share = land / world.layers.terrain.length;
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.95);
  }, 30000);
});

describe('generátor na jiné velikosti', () => {
  it.each(SIZES)('vygeneruje mapu %i s vodou na nule', (size) => {
    const map = generateTerrain(12345, VANILLA_BALANCE, size);

    expect(map.terrain.length).toBe(size * size);
    expect(map.cornerHeight.length).toBe(cornerCellsOf(size));

    const side = size + 1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (map.terrain[index(x, y, size)] !== TERRAIN.water) continue;
        // Voda musí ležet na hladině, jinak by moře viselo na kopci.
        expect(map.cornerHeight[y * side + x]).toBe(0);
      }
    }
  });

  it('zůstává deterministický i mimo výchozí velikost', () => {
    const a = generateTerrain(777, VANILLA_BALANCE, 192);
    const b = generateTerrain(777, VANILLA_BALANCE, 192);
    expect(a.terrain).toEqual(b.terrain);
    expect(a.cornerHeight).toEqual(b.cornerHeight);
  });

  it('jiná velikost dá jinou mapu, ne tu samou oříznutou', () => {
    // Kdyby se šum vzorkoval v souřadnicích 0–127 bez ohledu na velikost,
    // byla by mapa 192 jen ta stodvacetiosmička s prázdným lemem.
    const small = generateTerrain(999, VANILLA_BALANCE, 128);
    const large = generateTerrain(999, VANILLA_BALANCE, 192);

    let land = 0;
    for (let y = 130; y < 192; y++) {
      for (let x = 130; x < 192; x++) {
        if (large.terrain[index(x, y, 192)] !== TERRAIN.water) land++;
      }
    }
    expect(land).toBeGreaterThan(0);
    expect(large.terrain.length).not.toBe(small.terrain.length);
  });

  it('výškový invariant platí i na velké mapě', () => {
    const { cornerHeight } = generateTerrain(4242, VANILLA_BALANCE, 192);
    // `relaxHeights` nemá co srovnávat, když už je pole v pořádku.
    expect(relaxHeights(Uint8Array.from(cornerHeight))).toBe(1);
  });
});

describe('simulace na jiné velikosti', () => {
  it('město roste i na mapě 192 × 192', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    const balance = content.getBalance();

    const size = 192;
    const world = createWorld(2024, balance.economy, size);
    applyGeneratedMap(world, generateTerrain(2024, balance, size));

    // Staví se u vzdáleného rohu, kam by mapa 128 × 128 nedosáhla — kdyby
    // někde zůstala stará konstanta, tenhle test skončí mimo mřížku.
    const x0 = 150;
    const y0 = 150;
    world.layers.terrain.fill(TERRAIN.grass);
    world.cornerHeight.fill(0);

    for (let x = x0; x < x0 + 12; x++) buildRoad(world, x, y0 + 3, ROAD.street, balance);
    zoneArea(world, x0, y0, 12, 3, ZONE.residential);
    world.waterSupply.fill(1);

    const systems = createDefaultSystems(content, balance);
    for (let i = 0; i < 400; i++) {
      tickWorld(world, systems);
      world.waterSupply.fill(1);
      for (const id of world.buildings.keys()) world.watered.add(id);
    }

    expect(world.buildings.size).toBeGreaterThan(0);
    const cell = coarseIndex(x0, y0, size);
    expect(cell).toBeLessThan(coarseCellsOf(size));
  });
});

/**
 * Kolečko savu se zkouší jen na **skutečných** velikostech.
 *
 * Vrstvy si poradí s jakoukoli hranou — proto je `SIZES` malé a rychlé — jenže
 * od bezpečnostního auditu (N2) save jinou než nabízenou velikost odmítne:
 * `meta.grid.size` jde rovnou do alokace třinácti polí, takže z něj nesmí
 * přijít cokoli. Nejmenší dvě nabízené mapy tu roli zastanou.
 */
const SAVE_SIZES = [128, 192] as const;

describe('save nese velikost mapy', () => {
  it.each(SAVE_SIZES)('projde kolečkem uložit → načíst na hraně %i', (size) => {
    const world = createWorld(7, undefined, size);
    applyGeneratedMap(world, generateTerrain(7, VANILLA_BALANCE, size));

    // Silnice se staví u vzdáleného rohu, aby test sáhl na konec vrstvy.
    // Co tam vygenerátor nasypal, se srovná — jinak by o testu rozhodovalo,
    // jestli na tom seedu vyšla zrovna louka, nebo skála.
    const far = size - 5;
    world.layers.terrain[index(far, far, size)] = TERRAIN.grass;
    world.cornerHeight.fill(0);
    expect(buildRoad(world, far, far, ROAD.street).ok).toBe(true);

    const bytes = serializeSave(world, SAVE_OPTIONS);
    const save = unpackSave(bytes);
    expect(save.meta.grid?.size).toBe(size);

    const loaded = createWorld(0, undefined, size);
    applySaveToWorld(loaded, save);

    expect(loaded.size).toBe(size);
    expect(loaded.layers.road[index(far, far, size)]).toBe(ROAD.street);
    expect(loaded.layers.terrain).toEqual(world.layers.terrain);
    expect(loaded.cornerHeight).toEqual(world.cornerHeight);
  });

  it('načtení většího města přestaví menší svět', () => {
    // Renderer i UI drží živý pohled na tenhle objekt, takže se nesmí vyměnit
    // za nový — musí se přealokovat zevnitř.
    const big = createWorld(11, undefined, 192);
    buildRoad(big, 180, 180, ROAD.street);
    const bytes = serializeSave(big, SAVE_OPTIONS);

    const small = createWorld(0, undefined, 64);
    const view = small; // stejná reference před i po načtení
    applySaveToWorld(small, unpackSave(bytes));

    expect(view.size).toBe(192);
    expect(view.layers.terrain.length).toBe(192 * 192);
    expect(view.layers.road[index(180, 180, 192)]).toBe(ROAD.street);
  });

  it('resizeWorld na stejnou velikost nechá pole být', () => {
    // Přealokovat 512 × 512 pro nic by při každém načtení stálo desítky MB.
    const world = createWorld(1, undefined, DEFAULT_MAP_SIZE);
    const before = world.layers.terrain;
    resizeWorld(world, DEFAULT_MAP_SIZE);
    expect(world.layers.terrain).toBe(before);
  });
});
