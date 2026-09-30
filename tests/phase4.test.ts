import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import {
  addTransitStop,
  buildRoad,
  createTransitLine,
  placeDefinition,
  requestLoan,
  setLineVehicles,
  zoneArea,
} from '@/sim/commands';
import { coarseIndex, coarseSizeOf, hashCoarseLayers } from '@/sim/coarse';
import { createBlackoutDisaster } from '@/sim/disasters/blackout';
import { createChemicalSpillDisaster } from '@/sim/disasters/chemicalSpill';
import { createEarthquakeDisaster } from '@/sim/disasters/earthquake';
import { createExplosionDisaster, createIndustrialAccidentDisaster } from '@/sim/disasters/blast';
import { createFireDisaster, createWildfireDisaster, igniteTile } from '@/sim/disasters/fire';
import { createFloodDisaster } from '@/sim/disasters/flood';
import { createGangWarDisaster } from '@/sim/disasters/gangWar';
import { computeIndicators } from '@/sim/disasters/indicators';
import { createPileupDisaster } from '@/sim/disasters/pileup';
import { DisasterRegistry } from '@/sim/disasters/registry';
import { createRiotDisaster } from '@/sim/disasters/riot';
import { typeFactor } from '@/sim/disasters/risk';
import { createStrikeDisaster } from '@/sim/disasters/strike';
import { createTornadoDisaster } from '@/sim/disasters/tornado';
import { createEpidemicDisaster } from '@/sim/disasters/epidemic';
import { hashLayers, index, ROAD, TERRAIN, ZONE } from '@/sim/layers';
import { createDefaultSystems } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { MAP_SIZE } from './support/grid';
import { wireUnderRoads } from './support/power';

/**
 * Akceptační kritéria fáze 4 (§11), která nepokrývají testy jednotlivých úkolů.
 *
 * Jednotlivé mechaniky mají vlastní sady; tahle je o **průřezových tvrzeních** —
 * o tom, že spolu věci drží. Determinismus s katastrofami a linkami, blackout
 * jako zesilovač ostatních pohrom, dozvuk chemické havárie.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Registr se všemi katastrofami, které fáze 4 přinesla. */
function fullRegistry(): DisasterRegistry {
  const registry = new DisasterRegistry();
  registry.register(createFireDisaster());
  registry.register(createWildfireDisaster());
  registry.register(createFloodDisaster());
  registry.register(createTornadoDisaster());
  registry.register(createEarthquakeDisaster());
  registry.register(createExplosionDisaster());
  registry.register(createIndustrialAccidentDisaster());
  registry.register(createPileupDisaster());
  registry.register(createStrikeDisaster());
  registry.register(createRiotDisaster());
  registry.register(createGangWarDisaster());
  registry.register(createBlackoutDisaster());
  registry.register(createEpidemicDisaster());
  registry.register(createChemicalSpillDisaster());
  return registry;
}

describe('kritérium 22 — determinismus s katastrofami a linkami', () => {
  const TICKS = 5000;

  /**
   * Odehraje město se **všemi** katastrofami a linkou MHD a vrátí otisk.
   *
   * Do otisku patří i stav fáze 4: kdyby se hašovaly jen vrstvy, prošel by
   * i běh, ve kterém se katastrofy losují pokaždé jinak — a přesně to má
   * tenhle test chytit.
   */
  async function run(): Promise<string> {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(4242, balance.economy);
    world.economy.funds = 5_000_000;

    for (let x = 10; x < 50; x++) buildRoad(world, x, 30, ROAD.street, balance);
    zoneArea(world, 12, 27, 30, 3, ZONE.residential);
    zoneArea(world, 12, 31, 20, 2, ZONE.commercial);
    zoneArea(world, 34, 31, 12, 2, ZONE.industrial);
    placeDefinition(world, content, 'vanilla:coal_power_plant', 44, 31, balance);
    placeDefinition(world, content, 'vanilla:transit_depot', 10, 31, balance);

    const stops = [16, 40].map((x) => {
      const before = new Set(world.buildings.keys());
      placeDefinition(world, content, 'vanilla:transit_stop', x, 31, balance);
      const id = [...world.buildings.keys()].find((key) => !before.has(key));
      if (id === undefined) throw new Error('zastávka nevznikla');
      return id;
    });
    createTransitLine(world, balance, 'bus');
    const line = world.lines[world.lines.length - 1];
    if (!line) throw new Error('linka nevznikla');
    for (const stop of stops) addTransitStop(world, content, balance, line.id, stop);
    setLineVehicles(world, balance, line.id, 4);
    requestLoan(world, balance, 40000, 24);

    wireUnderRoads(world); // T129: proud vede vedení, ne silnice
    const systems = createDefaultSystems(content, balance, fullRegistry(), content.grants());
    for (let tick = 0; tick < TICKS; tick++) {
      tickWorld(world, systems);
      world.waterSupply.fill(1);
      for (const id of world.buildings.keys()) world.watered.add(id);
    }

    const buildings = [...world.buildings.values()]
      .sort((a, b) => a.id - b.id)
      .map((b) => `${b.id}:${b.definitionId}:${b.x},${b.y}:${b.level}:${b.population}`)
      .join('|');

    const disasters = [
      world.disasters.enabled ? 1 : 0,
      world.disasters.nextId,
      [...world.disasters.lastOccurrence.entries()].sort().map(([k, v]) => `${k}=${v}`).join(','),
      world.disasters.active.map((a) => `${a.kind}@${a.startedAtTick}`).join(','),
      world.disasters.modifiers.length,
      [...world.disasters.offlinePlants].sort().join(','),
      [...world.infection.entries()].sort(([a], [b]) => a - b).map(([c, v]) => `${c}:${v.toFixed(6)}`).join(','),
    ].join(';');

    const finance = [
      world.economy.funds,
      world.economy.creditRating.toFixed(6),
      world.loans.map((l) => `${l.id}:${l.remaining}`).join(','),
      world.bonds.map((b) => `${b.id}:${b.subscribed}`).join(','),
      [...world.grantsAwarded].sort().join(','),
    ].join(';');

    const transit = world.lines
      .map((l) => `${l.id}:${l.mode}:${l.stops.join('+')}:${l.vehicles}:${l.fare}`)
      .join('|');

    return [
      hashLayers(world.layers),
      hashCoarseLayers(world.coarse),
      world.rng.getState(),
      buildings,
      disasters,
      finance,
      transit,
    ].join('/');
  }

  it('dva běhy 5000 tiků se všemi katastrofami dají identické město', { timeout: 300000 }, async () => {
    const a = await run();
    const b = await run();

    expect(a).toBe(b);
    // Kdyby se město nepostavilo ani nic nestalo, porovnávaly by se dvě
    // prázdné mapy a test by prošel vždycky.
    expect(a.length).toBeGreaterThan(400);
  });
});

describe('kritérium 11 — blackout je zesilovač', () => {
  it('vyřazené pokrytí zvedne riziko ostatních katastrof', async () => {
    // Blackout sám nic nezničí. Jeho cena je v tom, že město zůstane bez
    // hasičů a policie — a riziko všeho ostatního tím skokově naroste.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    world.economy.funds = 5_000_000;

    for (let x = 10; x < 40; x++) buildRoad(world, x, 20, ROAD.street, balance);
    expect(placeDefinition(world, content, 'vanilla:coal_power_plant', 34, 21, balance).ok).toBe(
      true,
    );
    expect(placeDefinition(world, content, 'vanilla:fire_station', 14, 21, balance).ok).toBe(true);
    zoneArea(world, 12, 17, 20, 3, ZONE.residential);

    wireUnderRoads(world); // T129: proud vede vedení, ne silnice
    const systems = createDefaultSystems(content, balance);
    for (let tick = 0; tick < 400; tick++) {
      tickWorld(world, systems);
      world.waterSupply.fill(1);
      for (const id of world.buildings.keys()) world.watered.add(id);
    }

    const fire = balance.disasters.types['fire'];
    if (!fire) throw new Error('požár není v katalogu');
    const riskNow = (): number =>
      typeFactor(
        fire,
        computeIndicators(world, content, balance, balance.disasters.indicators),
        balance.disasters.maxRiskMultiplier,
      );

    const covered = world.coverage.get('fire')?.[coarseIndex(14, 21, MAP_SIZE)] ?? 0;
    expect(covered, 'hasiči nepokrývají ani sami sebe').toBeGreaterThan(0);
    const before = riskNow();

    // Blackout: elektrárna dolů. Hasičárna zhasne a přestane pokrývat (T53).
    for (const [id, building] of world.buildings) {
      if (content.get(building.definitionId)?.power?.production) {
        world.disasters.offlinePlants.add(id);
      }
    }
    world.powerNetworkDirty = true;
    for (let tick = 0; tick < 3; tick++) tickWorld(world, systems);

    expect(world.coverage.get('fire')?.[coarseIndex(14, 21, MAP_SIZE)] ?? 0).toBe(0);
    expect(riskNow(), 'riziko požáru po blackoutu nevzrostlo').toBeGreaterThan(before);
  });
});

describe('kritérium 6 — podfinancovaní hasiči hoří déle', () => {
  it('škrt na hasičích měřitelně prodlouží dobu hoření', async () => {
    // Hašení je odčítání od intenzity: `suppressBase + coverage ×
    // suppressPerCoverage`. Financování zmenšuje dosah i sílu pokrytí (§6 fáze
    // 2), takže škrt se musí projevit na tom, jak dlouho to hoří — jinak by byl
    // posuvník financování jen způsob, jak ušetřit bez následků.
    //
    // Měří se **na lese, ne na domě**: hořící dům shoří a oheň skončí s ním,
    // takže by se měřila doba do zřícení, ne účinnost hasičů.
    const content = await vanilla();
    const balance = content.getBalance();

    const burn = (funding: number): { ticks: number; coverage: number; burnt: number } => {
      const world = createWorld(1, balance.economy);
      world.economy.funds = 5_000_000;
      for (let x = 10; x < 30; x++) buildRoad(world, x, 20, ROAD.street, balance);
      expect(placeDefinition(world, content, 'vanilla:coal_power_plant', 24, 21, balance).ok).toBe(
        true,
      );
      // **Tři** zbrojnice, ne jedna: požár se musí odehrát celý uvnitř jejich
      // dosahu. Jediná stanice pokryje ohnisko, ale ne konec lesa, a měřilo by
      // se pak hlavně to, jak rychle hoří nekryté stromy.
      for (const x of [11, 16, 21]) {
        expect(placeDefinition(world, content, 'vanilla:fire_station', x, 21, balance).ok).toBe(
          true,
        );
      }

      // Les **hned u zbrojnic**, dost velký na to, aby se požár měl kam šířit.
      //
      // Blízkost je od T91 podmínka, ne detail: dosah služeb se tehdy začal
      // číst v dlaždicích místo v buňkách, takže se čtyřikrát zmenšil. Les
      // o šest dlaždic dál měl pokrytí 68 z 255 a suppression z něj byla tak
      // slabá, že požár shořel na palivo stejně rychle jako bez hasičů —
      // změřeno 31 tiků v obou případech. Takhle vychází 41 proti 65.
      //
      // Malý lesík by vyhořel za stejnou dobu bez ohledu na hasiče: skončí, až
      // mu dojde palivo, ne až ho někdo uhasí.
      for (let y = 17; y < 20; y++) {
        for (let x = 11; x < 23; x++) world.layers.terrain[index(x, y, MAP_SIZE)] = TERRAIN.forest;
      }

      world.serviceFunding.set('fire', funding);
      wireUnderRoads(world); // T129: proud vede vedení, ne silnice
      const systems = createDefaultSystems(content, balance);
      for (let tick = 0; tick < 20; tick++) tickWorld(world, systems);

      const tile = index(16, 19, MAP_SIZE);
      const coverage = world.coverage.get('fire')?.[coarseIndex(16, 19, MAP_SIZE)] ?? 0;
      expect(igniteTile(world, content, balance, tile, 200, false)).toBe(true);

      const everBurnt = new Set<number>();
      let ticks = 0;
      while ([...world.fire].some((value) => value !== 0) && ticks < 2000) {
        for (let i = 0; i < world.fire.length; i++) {
          if ((world.fire[i] ?? 0) !== 0) everBurnt.add(i);
        }
        tickWorld(world, systems);
        ticks++;
      }
      return { ticks, coverage, burnt: everBurnt.size };
    };

    const funded = burn(1);
    const starved = burn(0.25);

    // Škrt se musí projevit na pokrytí, jinak by zbytek testu neměřil nic.
    expect(starved.coverage).toBeLessThan(funded.coverage);
    expect(funded.ticks).toBeGreaterThan(0);
    expect(starved.ticks, 'škrt na hasičích dobu hoření neprodloužil').toBeGreaterThan(
      funded.ticks,
    );
    // A shoří toho víc: delší hoření není jen číslo, je to větší spáleniště.
    expect(starved.burnt).toBeGreaterThan(funded.burnt);
  });
});

describe('kritérium 15 — dozvuk chemické havárie', () => {
  it('vodárna nedodává i po skončení úniku', async () => {
    // Skutečná cena havárie přijde až potom. Budovy začnou chátrat dva měsíce
    // po ní, kdy už si na ni nikdo nevzpomene.
    const content = await vanilla();
    const balance = content.getBalance();
    const spill = balance.disasters.chemicalSpill;
    const world = createWorld(1, balance.economy);
    world.economy.funds = 5_000_000;

    // Břeh a vodárna u něj.
    for (let y = 24; y < 34; y++) {
      for (let x = 18; x < 24; x++) world.layers.terrain[index(x, y, MAP_SIZE)] = TERRAIN.water;
    }
    for (let x = 24; x < 48; x++) buildRoad(world, x, 27, ROAD.street, balance);
    expect(placeDefinition(world, content, 'vanilla:water_works', 24, 28, balance).ok).toBe(true);
    expect(placeDefinition(world, content, 'vanilla:coal_power_plant', 32, 28, balance).ok).toBe(
      true,
    );

    wireUnderRoads(world); // T129: proud vede vedení, ne silnice
    const systems = createDefaultSystems(content, balance);
    for (let tick = 0; tick < 30; tick++) tickWorld(world, systems);
    expect([...world.waterSupply].filter((value) => value !== 0).length).toBeGreaterThan(0);

    // Únik skončil — modifikátor ale platí dál.
    const cells = new Set<number>();
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) cells.add(coarseIndex(24 + dx, 28 + dy, MAP_SIZE));
    }
    world.disasters.modifiers.push({
      kind: 'contaminateWater',
      cells: [...cells].sort((a, b) => a - b),
      amount: 1,
      until: world.tick + spill.waterAfterTicks,
      source: 0,
    });
    world.waterNetworkDirty = true;

    for (let tick = 0; tick < 5; tick++) tickWorld(world, systems);
    expect([...world.waterSupply].filter((value) => value !== 0)).toHaveLength(0);

    // Dozvuk je dlouhý: ani po měsíci voda neteče.
    for (let tick = 0; tick < 30; tick++) tickWorld(world, systems);
    expect(spill.waterAfterTicks).toBeGreaterThan(30);
    expect([...world.waterSupply].filter((value) => value !== 0)).toHaveLength(0);
  });
});

describe('kritérium 4 — vypnuté katastrofy zůstanou vypnuté', () => {
  it('přepínač přežije uložení i načtení', async () => {
    // Hráč, který si katastrofy vypnul, je nesmí dostat zpátky tím, že si hru
    // uloží a načte.
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    world.disasters.enabled = false;

    const { serializeSave } = await import('@/save/serialize');
    const { applySaveToWorld, unpackSave } = await import('@/save/deserialize');
    const { migrate } = await import('@/save/migrations');

    const bytes = serializeSave(world, {
      cityName: 'Testov',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      playtimeSeconds: 1,
      sources: [{ id: 'vanilla', version: '0.1.0' }],
    });

    const restored: WorldState = createWorld(1);
    applySaveToWorld(restored, migrate(unpackSave(bytes)));
    expect(restored.disasters.enabled).toBe(false);
  });
});

describe('kritérium 25 — všechen text hráče je v locale souborech', () => {
  /** Syrový text locale souborů. `?raw` obejde `JSON.parse`, o který tu jde. */
  const RAW_LOCALES = import.meta.glob('../content/vanilla/locale/*.json', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>;

  it('žádný locale soubor nemá klíč dvakrát', () => {
    // `JSON.parse` na duplicitní klíč nesáhne — poslední tiše vyhraje. Registr
    // tedy dostane tabulku, ve které chybu není vidět, a překlad se přepíše sám
    // sebou tak dlouho, dokud se někdo netrefí do dvou různých textů. Kontrola
    // musí sáhnout na **syrový text**, ne na rozparsovaný objekt.
    const files = Object.keys(RAW_LOCALES).sort();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const text = RAW_LOCALES[file] ?? '';
      const seen = new Set<string>();
      const duplicates: string[] = [];
      for (const match of text.matchAll(/^\s*"([^"]+)"\s*:/gm)) {
        const key = match[1] ?? '';
        if (seen.has(key)) duplicates.push(key);
        seen.add(key);
      }
      expect(duplicates, file).toEqual([]);
    }
  });

  it('každá registrovaná katastrofa má vlastní ikonu', async () => {
    // Roletka katastrof pojmenovává ikonu druhem pohromy, takže nová katastrofa
    // bez obrázku by v ní byla prázdné místo. Do T60 nesly všechny tutéž ikonu
    // a rozlišit je šlo jen textem.
    const content = await vanilla();
    const icons = content.getIcons();

    for (const kind of fullRegistry().kinds()) {
      expect(icons[kind], `katastrofa ${kind}`).toBeDefined();
    }
  });

  it('každá registrovaná katastrofa má jméno v obou jazycích', async () => {
    // Jména pohrom se skládají za běhu (`ui.disaster.${kind}`), takže kontrola
    // literálních klíčů v i18n testech je minout. Bez tohohle testu se dá přidat
    // katastrofa, která se hráči ohlásí syrovým klíčem — a pozná se to až v HUD.
    const content = await vanilla();
    const registry = fullRegistry();

    for (const kind of registry.kinds()) {
      for (const language of ['cs', 'en']) {
        const table = content.getLocaleTable(language);
        expect(table[`ui.disaster.${kind}`], `${language}: ${kind}`).toBeTruthy();
      }
    }
  });
});

describe('kritérium 1 — všechny čtyři velikosti', () => {
  it('každá se vygeneruje, uloží i načte', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const { MAP_SIZES } = await import('@/sim/layers');
    const { serializeSave } = await import('@/save/serialize');
    const { applySaveToWorld, unpackSave } = await import('@/save/deserialize');
    const { migrate } = await import('@/save/migrations');

    expect(MAP_SIZES).toHaveLength(4);

    for (const size of MAP_SIZES) {
      const world = createWorld(7, balance.economy, size);
      expect(world.size, `velikost ${size}`).toBe(size);
      expect(world.layers.terrain.length).toBe(size * size);
      expect(world.coarse.crime.length).toBe(coarseSizeOf(size) ** 2);

      buildRoad(world, 10, 10, ROAD.street, balance);
      world.fire[index(11, 10, size)] = 100;

      const bytes = serializeSave(world, {
        cityName: `Mapa ${size}`,
        createdAt: '2026-01-01T00:00:00.000Z',
        modifiedAt: '2026-01-01T00:00:00.000Z',
        playtimeSeconds: 1,
        sources: [{ id: 'vanilla', version: '0.1.0' }],
      });

      const restored = createWorld(1);
      applySaveToWorld(restored, migrate(unpackSave(bytes)));

      expect(restored.size, `načtená velikost ${size}`).toBe(size);
      expect(restored.layers.road[index(10, 10, size)]).toBe(ROAD.street);
      expect(restored.fire[index(11, 10, size)], `oheň na mapě ${size}`).toBe(100);
    }
  });
});
