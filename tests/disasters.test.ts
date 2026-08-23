import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { validateBalance } from '@/content/balance';
import type { Balance, DisasterBalance } from '@/content/balance';
import { buildRoad, placeDefinition, zoneArea } from '@/sim/commands';
import { destroyArea, expireModifiers, isBlocked, strongestModifier } from '@/sim/disasters/effects';
import {
  blockTile,
  crimeFloor,
  happinessPenalty,
  landValuePenalty,
  pollutionBurst,
  populationLoss,
  spikeCrime,
  suppressService,
} from '@/sim/disasters/effects';
import { computeIndicators } from '@/sim/disasters/indicators';
import { DisasterRegistry } from '@/sim/disasters/registry';
import type { Disaster } from '@/sim/disasters/registry';
import {
  computeMetrics,
  concurrentLimit,
  meetsConditions,
  monthlyChance,
  scaleFactor,
  seasonFactor,
  typeFactor,
  TICKS_PER_YEAR,
} from '@/sim/disasters/risk';
import { createDisasterSystem, startDisaster } from '@/sim/disasters/scheduler';
import { coarseCellsOfShape, tilesOf } from '@/sim/disasters/shapes';
import type { Shape } from '@/sim/disasters/shapes';
import { createDefaultSystems } from '@/sim/systems';
import { index, ROAD, TERRAIN, ZONE } from '@/sim/layers';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { MAP_SIZE } from './support/grid';

/**
 * Katastrofy — kostra (T47, §3 fáze 4).
 *
 * Patnáct pohrom má patnáct různých mechanik, ale **kdy** udeří, se počítá
 * jedním vzorcem. Ten je tady ověřený proti číslům z katalogu: kdyby se
 * rozešel, projevilo by se to jako „hoří pořád" nebo „nikdy nic", což se při
 * hraní pozná pozdě a ladit se to nedá.
 *
 * Jednotlivé katastrofy tu ještě nejsou — přidávají je T48 až T54. Testuje se
 * to, co po T47 existuje: model rizika, plánovač, hájení, přepínač, tvary
 * zásahu a společné operace.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

function typeOf(kind: string): DisasterBalance {
  const settings = VANILLA_BALANCE.disasters.types[kind];
  if (!settings) throw new Error(`v balancu chybí katastrofa ${kind}`);
  return settings;
}

/** Ukazatele s pevnými hodnotami — vzorec se testuje bez celého města. */
function fakeIndicators(values: Readonly<Record<string, number>>) {
  return { get: (name: string): number => values[name] ?? 0 };
}

/** Katastrofa na jedno použití: začne, po `length` ticích skončí. */
function testDisaster(kind: string, length = 1, origin: { x: number; y: number } | null = { x: 5, y: 5 }): Disaster {
  return {
    kind,
    pickOrigin: () => origin,
    start: (_context, active) => {
      active.state['ticks'] = 0;
    },
    tick: (_context, active) => {
      active.state['ticks'] = ((active.state['ticks'] as number) ?? 0) + 1;
    },
    isFinished: (_world, active) => ((active.state['ticks'] as number) ?? 0) >= length,
  };
}

describe('katalog katastrof v balancu', () => {
  it('nese všech patnáct pohrom ze zadání', () => {
    const kinds = Object.keys(VANILLA_BALANCE.disasters.types).sort();
    expect(kinds).toEqual(
      [
        'blackout',
        'chemicalSpill',
        'earthquake',
        'epidemic',
        'explosion',
        'fire',
        'flood',
        'gangWar',
        'industrialAccident',
        'landslide',
        'pileup',
        'riot',
        'strike',
        'tornado',
        'wildfire',
      ].sort(),
    );
  });

  it('přírodní katastrofy nemají sčítance rizika', () => {
    // Faktor typu je u nich z definice 1, takže by se váhy nikdy nepřečetly.
    // Kdyby tam byly, čtenář katalogu by si myslel, že na ně má vliv.
    for (const [kind, settings] of Object.entries(VANILLA_BALANCE.disasters.types)) {
      if (!settings.natural) continue;
      expect(settings.risk, kind).toHaveLength(0);
    }
  });

  it('čísla sedí s katalogem tam, kde je zadání jmenuje', () => {
    // Namátkou přes všechny čtyři činitele, ať se pozná přepis číslice.
    expect(typeOf('fire').baseMonthlyChance).toBe(0.02);
    expect(typeOf('fire').cooldownTicks).toBe(10);
    expect(typeOf('earthquake').cooldownTicks).toBe(2160);
    expect(typeOf('blackout').maxMonthlyChance).toBe(0.45);
    expect(typeOf('strike').concurrent.min).toBe(2);
    expect(typeOf('wildfire').season?.inFactor).toBe(2.5);
    expect(VANILLA_BALANCE.disasters.maxRiskMultiplier).toBe(3);
  });

  it('validace odmítne neznámou veličinu', () => {
    // Překlep v `buildigns` by jinak tiše znamenal „škáluj podle nuly", tedy
    // katastrofu, která nikdy nepřijde.
    const raw = rawBalance();
    const fire = disasterType(raw, 'fire');
    (fire['scale'] as Record<string, unknown>)['metric'] = 'buildigns';

    const result = validateBalance(raw);
    expect(result.balance).toBeNull();
    expect(result.issues.some((i) => i.field.includes('scale.metric'))).toBe(true);
  });

  it('validace odmítne hořlavost bez paliva', () => {
    // Obsah dlaždice, který má hořlavost a nemá palivo, by hořel donekonečna:
    // intenzita by rostla, palivo by nikdy nedošlo a budova by nikdy neshořela
    // ani se nezachránila.
    const raw = rawBalance();
    const disasters = raw['disasters'] as Record<string, unknown>;
    const fire = disasters['fire'] as Record<string, unknown>;
    delete (fire['fuel'] as Record<string, unknown>)['forest'];

    const result = validateBalance(raw);
    expect(result.issues.some((i) => i.field === 'disasters.fire.fuel.forest')).toBe(true);
  });

  it('validace odmítne strop pod základem', () => {
    const raw = rawBalance();
    const fire = disasterType(raw, 'fire');
    fire['maxMonthlyChance'] = 0.001;

    const result = validateBalance(raw);
    expect(result.issues.some((i) => i.field.endsWith('maxMonthlyChance'))).toBe(true);
  });
});

describe('vzorec rizika', () => {
  it('měřítko je clamp(offset + tvar(metrika / dělitel))', () => {
    const metrics = computeMetrics(createWorld(1), emptyCatalogue());
    // Prázdné město: nula budov, tedy dolní mez.
    expect(scaleFactor(typeOf('fire').scale, metrics)).toBe(0.5);

    // 200 budov → sqrt(1) = 1; 1800 budov → sqrt(9) = 3, což je zrovna strop.
    expect(scaleFactor(typeOf('fire').scale, { ...metrics, buildings: 200 })).toBeCloseTo(1);
    expect(scaleFactor(typeOf('fire').scale, { ...metrics, buildings: 1800 })).toBeCloseTo(3);
    expect(scaleFactor(typeOf('fire').scale, { ...metrics, buildings: 100000 })).toBe(3);

    // Odmocnina musí být poznat. U 450 budov dá 1,5; bez ní by vyšlo 2,25.
    // Body 200 a 1800 to neodhalí — tam obě křivky náhodou vycházejí stejně
    // (jedna kvůli jedničce, druhá kvůli stropu).
    expect(scaleFactor(typeOf('fire').scale, { ...metrics, buildings: 450 })).toBeCloseTo(1.5);
    // A `linear` se skutečně nemocní: pobřeží 800 dá rovnou dvojku.
    expect(scaleFactor(typeOf('flood').scale, { ...metrics, coastTiles: 800 })).toBeCloseTo(2);
  });

  it('katastrofa bez měřítka se neškáluje', () => {
    // Zemětřesení nepřichází na velké město častěji, jen ho zasáhne hůř.
    const metrics = computeMetrics(createWorld(1), emptyCatalogue());
    expect(scaleFactor(typeOf('earthquake').scale, { ...metrics, buildings: 5000 })).toBe(1);
  });

  it('sezóna platí uvnitř okna a mimo něj ne', () => {
    const wildfire = typeOf('wildfire'); // 150–240
    expect(seasonFactor(wildfire, 150)).toBe(2.5);
    expect(seasonFactor(wildfire, 239)).toBe(2.5);
    expect(seasonFactor(wildfire, 240)).toBe(0.5);
    expect(seasonFactor(wildfire, 0)).toBe(0.5);
    // Rok se opakuje: druhý rok platí totéž co první.
    expect(seasonFactor(wildfire, TICKS_PER_YEAR + 200)).toBe(2.5);
  });

  it('faktor typu je vážený součet oříznutý na tři', () => {
    const fire = typeOf('fire');
    // Čisté město: nic nepřispívá, tedy jednička.
    expect(typeFactor(fire, fakeIndicators({}), 3)).toBe(1);

    // Polovina budov bez hasičů: 1 + 0,5 × 0,9.
    expect(typeFactor(fire, fakeIndicators({ 'uncovered:fire': 0.5 }), 3)).toBeCloseTo(1.45);

    // Všechno na maximu by dalo 1 + 3,15; strop to srazí na tři (R16).
    const worst = fakeIndicators({
      'uncovered:fire': 1,
      crime: 1,
      neglect: 1,
      'underfunded:fire': 1,
      industryShare: 1,
    });
    expect(typeFactor(fire, worst, 3)).toBe(3);
  });

  it('přírodní katastrofa má faktor typu vždycky jedna', () => {
    const worst = fakeIndicators({ crime: 1, neglect: 1, unemployment: 1 });
    expect(typeFactor(typeOf('flood'), worst, 3)).toBe(1);

    // Vanilla je nemá, ale mod by je přidat mohl — a i pak musí platit, že
    // povodeň nezávisí na tom, jak hráč město spravuje. Bez téhle pojistky
    // by stačila jedna váha v cizím obsahu a přírodní katastrofa by přestala
    // být přírodní.
    const withWeights: DisasterBalance = {
      ...typeOf('flood'),
      risk: [{ indicator: 'crime', weight: 2 }],
    };
    expect(typeFactor(withWeights, worst, 3)).toBe(1);
  });

  it('`below` počítá, o kolik ukazatel chybí pod prahem', () => {
    // Blackout: nad čtvrtinou rezervy nepřispívá nic, pod ní roste strmě.
    // Platí vzorec z katalogu `max(0; 0,25 − rezerva) × 24`. Prozaické
    // příklady vedle něj (15 % → 1,24) mu odporují — s koeficientem 24 vyjde
    // 3,4, tedy strop. Řídíme se vzorcem; nesoulad je nahlášený autorovi.
    const blackout = typeOf('blackout');
    expect(typeFactor(blackout, fakeIndicators({ powerReserve: 0.3 }), 3)).toBe(1);
    expect(typeFactor(blackout, fakeIndicators({ powerReserve: 0.25 }), 3)).toBe(1);
    expect(typeFactor(blackout, fakeIndicators({ powerReserve: 0.24 }), 3)).toBeCloseTo(1.24);
    expect(typeFactor(blackout, fakeIndicators({ powerReserve: 0.2 }), 3)).toBeCloseTo(2.2);
    expect(typeFactor(blackout, fakeIndicators({ powerReserve: 0 }), 3)).toBe(3);
  });

  it('výsledná šance je součin, oříznutý stropem typu', () => {
    const metrics = { ...computeMetrics(createWorld(1), emptyCatalogue()), buildings: 200 };
    const fire = typeOf('fire');

    // Základ 0,02 × měřítko 1 × sezóna 1 × faktor 1.
    expect(monthlyChance(fire, metrics, fakeIndicators({}), 0, 3, 3)).toBeCloseTo(0.02);
    // S faktorem 3 by vyšlo 0,06 — pod stropem 0,2, takže projde celé.
    const worst = fakeIndicators({ 'uncovered:fire': 1, crime: 1, neglect: 1 });
    expect(monthlyChance(fire, metrics, worst, 0, 3, 3)).toBeCloseTo(0.06);
    // Velké zanedbané město: 0,02 × 3 × 1 × 3 = 0,18, pořád pod stropem 0,2.
    const huge = { ...metrics, buildings: 100000 };
    expect(monthlyChance(fire, huge, worst, 0, 3, 3)).toBeCloseTo(0.18);

    // Kde se strop projeví: hromadná nehoda má základ 0,05 a strop 0,3.
    const pileup = typeOf('pileup');
    const jammed = fakeIndicators({ congestion: 1, majorRoadShare: 1, 'uncovered:health': 1 });
    expect(monthlyChance(pileup, { ...metrics, roadTiles: 100000 }, jammed, 0, 3, 3)).toBe(0.3);

    // Zastropovaný faktor typu (R16) šanci srazí: 0,02 × 1 × 1 × 1,5.
    expect(monthlyChance(fire, metrics, worst, 0, 3, 1.5)).toBeCloseTo(0.03);
    // A strop nad skutečnou hodnotou s ní nehne.
    expect(monthlyChance(fire, metrics, worst, 0, 3, 99)).toBeCloseTo(0.06);
  });

  it('souběžný limit roste s městem, ale má meze', () => {
    const metrics = computeMetrics(createWorld(1), emptyCatalogue());
    const fire = typeOf('fire');
    expect(concurrentLimit(fire, metrics)).toBe(1);
    expect(concurrentLimit(fire, { ...metrics, buildings: 900 })).toBe(2);
    expect(concurrentLimit(fire, { ...metrics, buildings: 99999 })).toBe(4);
    // Stávka má pevné dva bez ohledu na velikost.
    expect(concurrentLimit(typeOf('strike'), { ...metrics, buildings: 99999 })).toBe(2);
  });

  it('podmínky vzniku se berou z metrik', () => {
    const metrics = computeMetrics(createWorld(1), emptyCatalogue());
    expect(meetsConditions(typeOf('strike'), metrics)).toBe(false);
    expect(meetsConditions(typeOf('strike'), { ...metrics, population: 1800 })).toBe(true);
    // Povodeň bez pobřeží prostě nemá kde vzniknout.
    expect(meetsConditions(typeOf('flood'), metrics)).toBe(false);
    expect(meetsConditions(typeOf('flood'), { ...metrics, coastTiles: 1 })).toBe(true);
  });
});

describe('plánovač', () => {
  it('vypnuté katastrofy neudeří ani za sto let', () => {
    const world = createWorld(1);
    world.disasters.enabled = false;

    const registry = new DisasterRegistry();
    // Jistota, ne pravděpodobnost: kdyby přepínač nefungoval, spustí se hned.
    registry.register(testDisaster('always', 100));
    const system = createDisasterSystem(emptyCatalogue(), certainBalance(), registry);

    for (let tick = 0; tick < 3600; tick++) tickWorld(world, [system]);
    expect(world.disasters.active).toHaveLength(0);
  });

  it('se zapnutými udeří a pak drží hájení', () => {
    const world = createWorld(1);
    const registry = new DisasterRegistry();
    registry.register(testDisaster('always', 1));
    const balance = certainBalance();
    const system = createDisasterSystem(emptyCatalogue(), balance, registry);

    for (let tick = 0; tick < 40; tick++) tickWorld(world, [system]);
    const first = world.disasters.lastOccurrence.get('always');
    expect(first).toBeDefined();

    // Hájení je delší než měsíc, takže druhý hod musí propadnout.
    for (let tick = 0; tick < 60; tick++) tickWorld(world, [system]);
    expect(world.disasters.lastOccurrence.get('always')).toBe(first);
  });

  it('souběžný limit se dodrží', () => {
    const world = createWorld(1);
    const registry = new DisasterRegistry();
    // Dlouhá katastrofa: běží pořád, takže se limit projeví.
    registry.register(testDisaster('always', 100000));
    const balance = certainBalance({ cooldownTicks: 0 });
    const system = createDisasterSystem(emptyCatalogue(), balance, registry);

    for (let tick = 0; tick < 600; tick++) tickWorld(world, [system]);
    expect(world.disasters.active).toHaveLength(1);
  });

  it('nesplněná podmínka vzniku katastrofu zastaví', () => {
    // Stávka chce 1800 obyvatel. Prázdné město ji nesmí dostat ani při
    // jistotě — jinak by hráč hasil nepokoje ve vsi o třech domech.
    const world = createWorld(1);
    const registry = new DisasterRegistry();
    registry.register(testDisaster('always', 1));
    const balance = certainBalance({ require: [{ metric: 'population', min: 1800 }] });
    const system = createDisasterSystem(emptyCatalogue(), balance, registry);

    for (let tick = 0; tick < 200; tick++) tickWorld(world, [system]);
    expect(world.disasters.active).toHaveLength(0);
    expect(world.disasters.lastOccurrence.has('always')).toBe(false);
  });

  it('katastrofa bez místa se nespustí', () => {
    // Povodeň bez pobřeží: `pickOrigin` vrátí null a je to „letos ne",
    // ne pád.
    const world = createWorld(1);
    const registry = new DisasterRegistry();
    registry.register(testDisaster('always', 1, null));
    const system = createDisasterSystem(emptyCatalogue(), certainBalance(), registry);

    for (let tick = 0; tick < 100; tick++) tickWorld(world, [system]);
    expect(world.disasters.active).toHaveLength(0);
    expect(world.disasters.lastOccurrence.has('always')).toBe(false);
  });

  it('menu katastrof nepodléhá hájení ani přepínači', () => {
    const world = createWorld(1);
    world.disasters.enabled = false;
    const registry = new DisasterRegistry();
    registry.register(testDisaster('always', 100));

    const first = startDisaster(world, emptyCatalogue(), VANILLA_BALANCE, registry, 'always', 3, 4);
    expect(first).not.toBeNull();
    expect(first?.x).toBe(3);

    // A hned podruhé, i když hájení běží.
    const second = startDisaster(world, emptyCatalogue(), VANILLA_BALANCE, registry, 'always', 9, 9);
    expect(second).not.toBeNull();
    expect(world.disasters.active).toHaveLength(2);
  });

  it('povodeň a lesní požár se hájí od skončení, ne od vzniku', () => {
    // Obojí trvá dlouho. Hájení od vzniku by znamenalo, že další povodeň smí
    // přijít, zatímco ta první ještě neopadla; katalog to u obou poznamenává.
    const world = createWorld(1);
    const registry = new DisasterRegistry();
    registry.register({ ...testDisaster('always', 3), cooldownFromEnd: true });
    const system = createDisasterSystem(emptyCatalogue(), VANILLA_BALANCE, registry);

    startDisaster(world, emptyCatalogue(), VANILLA_BALANCE, registry, 'always', 4, 4);
    expect(world.disasters.lastOccurrence.has('always')).toBe(false);

    for (let tick = 0; tick < 5; tick++) tickWorld(world, [system]);
    expect(world.disasters.active).toHaveLength(0);
    // Zapsalo se to při skončení (tik 3), ne při vzniku (tik 0).
    expect(world.disasters.lastOccurrence.get('always')).toBe(3);
  });

  it('skončená katastrofa zmizí ze seznamu i se svými postihy', () => {
    const world = createWorld(1);
    const registry = new DisasterRegistry();
    registry.register(testDisaster('always', 2));
    const system = createDisasterSystem(emptyCatalogue(), VANILLA_BALANCE, registry);

    const entry = startDisaster(world, emptyCatalogue(), VANILLA_BALANCE, registry, 'always', 4, 4);
    expect(entry).not.toBeNull();
    happinessPenalty(world, { kind: 'point', x: 4, y: 4 }, 50, 10000, entry?.id ?? 0);
    expect(world.disasters.modifiers).toHaveLength(1);

    for (let tick = 0; tick < 5; tick++) tickWorld(world, [system]);
    expect(world.disasters.active).toHaveLength(0);
    // Postih po ní zůstat nesmí, i když měl vypršet až za deset tisíc tiků.
    expect(world.disasters.modifiers).toHaveLength(0);
  });

  it('neznámý druh ze savu se ukončí, ne zasekne', () => {
    const world = createWorld(1);
    world.disasters.active.push({
      id: 1,
      kind: 'vanilla:neznámá',
      startedAtTick: 0,
      x: 1,
      y: 1,
      state: {},
      finished: false,
    });
    const system = createDisasterSystem(emptyCatalogue(), VANILLA_BALANCE, new DisasterRegistry());

    tickWorld(world, [system]);
    expect(world.disasters.active).toHaveLength(0);
  });

  it('při záporném rozpočtu riziko dál neroste (R16)', () => {
    // Podfinancování → katastrofy → škody → nižší daně → větší podfinancování
    // je kladná zpětná vazba. Strop se zafixuje na tom, kde bylo město naposledy
    // v černých číslech.
    const world = createWorld(1);
    world.economy.lastIncome = 100;
    world.economy.lastExpenses = 10;

    const registry = new DisasterRegistry();
    registry.register(testDisaster('always', 1));
    // Nepřírodní katastrofa s jedním sčítancem: jinak je faktor typu vždycky
    // jedna a strop by neměl kam růst, takže by test neměřil nic.
    const balance = certainBalance({
      baseMonthlyChance: 0,
      maxMonthlyChance: 0,
      natural: false,
      risk: [{ indicator: 'underfunded:fire', weight: 2 }],
    });
    const system = createDisasterSystem(emptyCatalogue(), balance, registry);

    world.serviceFunding.set('fire', 0.75);
    for (let tick = 0; tick < 40; tick++) tickWorld(world, [system]);
    // 1 + 0,25 × 2 = 1,5.
    expect(world.disasters.riskCeiling.get('always')).toBeCloseTo(1.5);

    // Město se propadne do mínusu a služby přestanou být financované úplně.
    world.economy.lastIncome = 10;
    world.economy.lastExpenses = 100;
    world.serviceFunding.set('fire', 0);

    for (let tick = 0; tick < 60; tick++) tickWorld(world, [system]);
    // Bez R16 by strop vyskočil na 3. Takhle zůstal, kde byl.
    expect(world.disasters.riskCeiling.get('always')).toBeCloseTo(1.5);
  });
});

describe('tvary zásahu', () => {
  it('bod je jedna dlaždice a okraj mapy ho ořízne', () => {
    const world = createWorld(1);
    expect(tilesOf(world, { kind: 'point', x: 3, y: 4 })).toEqual([index(3, 4, MAP_SIZE)]);
    expect(tilesOf(world, { kind: 'point', x: -1, y: 4 })).toEqual([]);
  });

  it('kruh měří eukleidovsky, ne po šachovnici', () => {
    const world = createWorld(1);
    const tiles = tilesOf(world, { kind: 'radius', x: 10, y: 10, radius: 1 });
    // Poloměr jedna dá kříž pěti dlaždic, ne čtverec devíti.
    expect(tiles).toHaveLength(5);
    expect(tiles).toContain(index(10, 10, MAP_SIZE));
    expect(tiles).not.toContain(index(11, 11, MAP_SIZE));
  });

  it('pás končí tam, kde končí úsečka', () => {
    // Kdyby se počítala vzdálenost k přímce, tornádo by ničilo i za svým koncem.
    const world = createWorld(1);
    const tiles = tilesOf(world, {
      kind: 'band',
      fromX: 10,
      fromY: 10,
      toX: 20,
      toY: 10,
      width: 0.5,
    });
    expect(tiles).toContain(index(15, 10, MAP_SIZE));
    expect(tiles).toContain(index(20, 10, MAP_SIZE));
    // Dlaždice hned za koncem. Kdyby se měřila vzdálenost k **přímce**, ležela
    // by na ní přesně a tornádo by ničilo i tam, kam nedošlo.
    expect(tiles).not.toContain(index(21, 10, MAP_SIZE));
  });

  it('globální tvar vzorkuje, neprojde všechno', () => {
    const world = createWorld(1, undefined, 64);
    const tiles = tilesOf(world, { kind: 'global', sample: 100 });
    expect(tiles.length).toBeLessThan(64 * 64);
    expect(tiles.length).toBeGreaterThan(0);
  });

  it('dlaždice chodí vzestupně u každého tvaru', () => {
    // Katastrofy z tohohle seznamu losují. Jiné pořadí by při stejném seedu
    // dalo jiné město (P2), a poznalo by se to až rozbitým golden testem.
    const world = createWorld(1);
    const shapes: Shape[] = [
      { kind: 'point', x: 20, y: 20 },
      { kind: 'radius', x: 20, y: 20, radius: 4 },
      { kind: 'band', fromX: 5, fromY: 30, toX: 40, toY: 12, width: 2 },
      { kind: 'global', sample: 37 },
    ];
    for (const shape of shapes) {
      const tiles = tilesOf(world, shape);
      expect(tiles.length, shape.kind).toBeGreaterThan(0);
      for (let i = 1; i < tiles.length; i++) {
        expect((tiles[i] ?? 0) > (tiles[i - 1] ?? 0), `${shape.kind} na indexu ${i}`).toBe(true);
      }
    }
  });

  it('filtr zúží na zónu i na terén', () => {
    const world = createWorld(1);
    zoneArea(world, 10, 10, 3, 3, ZONE.residential);
    const zoned = tilesOf(world, { kind: 'radius', x: 11, y: 11, radius: 5 }, {
      zones: [ZONE.residential],
    });
    expect(zoned).toHaveLength(9);

    world.layers.terrain[index(11, 11, MAP_SIZE)] = TERRAIN.water;
    const dry = tilesOf(world, { kind: 'radius', x: 11, y: 11, radius: 5 }, {
      terrain: [TERRAIN.water],
    });
    expect(dry).toEqual([index(11, 11, MAP_SIZE)]);
  });

  it('buňky hrubé mřížky se neopakují', () => {
    const world = createWorld(1);
    const cells = coarseCellsOfShape(world, { kind: 'radius', x: 20, y: 20, radius: 2 });
    expect(new Set(cells).size).toBe(cells.length);
  });
});

describe('společné operace', () => {
  it('zboří, co ve tvaru stojí', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    world.economy.funds = 1000000;
    // Elektrárna je 4×4 a chce silnici u půdorysu: ten sahá 20–23, ulice pod ním.
    for (let x = 19; x <= 24; x++) buildRoad(world, x, 24, ROAD.street, content.getBalance());
    expect(
      placeDefinition(world, content, 'vanilla:coal_power_plant', 20, 20, content.getBalance()).ok,
    ).toBe(true);
    expect(world.buildings.size).toBe(1);

    const destroyed = destroyArea(world, { kind: 'radius', x: 21, y: 21, radius: 3 });
    expect(destroyed).toBe(1);
    expect(world.buildings.size).toBe(0);
  });

  it('ubere obyvatele, ale dům nechá stát', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    world.economy.funds = 1000000;
    for (let x = 19; x <= 24; x++) buildRoad(world, x, 24, ROAD.street, content.getBalance());
    placeDefinition(world, content, 'vanilla:coal_power_plant', 20, 20, content.getBalance());
    const building = [...world.buildings.values()][0];
    if (!building) throw new Error('budova nevznikla');
    building.population = 100;

    const lost = populationLoss(world, { kind: 'radius', x: 21, y: 21, radius: 3 }, 0.25);
    expect(lost).toBe(25);
    expect(building.population).toBe(75);
    // Epidemie ani havárie domy neboří — prázdný se časem zaplní zpátky.
    expect(world.buildings.size).toBe(1);
  });

  it('výdech znečištění jde rovnou do vrstvy', () => {
    const world = createWorld(1);
    const before = world.coarse.pollution[0] ?? 0;
    pollutionBurst(world, { kind: 'radius', x: 1, y: 1, radius: 1 }, 40);
    expect(world.coarse.pollution[0]).toBe(before + 40);
  });

  it('postihy vyprší samy', () => {
    const world = createWorld(1);
    world.tick = 100;
    suppressService(world, 'fire', { kind: 'point', x: 4, y: 4 }, 0.5, 10);
    expect(world.disasters.modifiers).toHaveLength(1);

    world.tick = 109;
    expireModifiers(world);
    expect(world.disasters.modifiers).toHaveLength(1);

    world.tick = 110;
    expireModifiers(world);
    expect(world.disasters.modifiers).toHaveLength(0);
  });

  it('dva postihy se neskládají, platí ten horší', () => {
    // Dvě stávky ve stejné čtvrti nepotlačí hasiče na čtvrtinu. Skládání by
    // z několika souběžných katastrof udělalo násobek, ze kterého se město
    // nevzpamatuje.
    const world = createWorld(1);
    const cell = coarseCellsOfShape(world, { kind: 'point', x: 4, y: 4 })[0] ?? 0;
    suppressService(world, 'fire', { kind: 'point', x: 4, y: 4 }, 0.5, 10);
    suppressService(world, 'fire', { kind: 'point', x: 4, y: 4 }, 0.25, 10);

    expect(strongestModifier(world, 'suppressService', cell, 1, 'fire')).toBe(0.25);
    // Jiná třída se ho netýká.
    expect(strongestModifier(world, 'suppressService', cell, 1, 'police')).toBe(1);
  });

  it('postih bez buněk platí pro celé město', () => {
    // Blackout ani stávka nemají střed.
    const world = createWorld(1);
    world.disasters.modifiers.push({
      kind: 'happinessPenalty',
      cells: [],
      amount: 30,
      until: world.tick + 10,
      source: 1,
    });
    expect(strongestModifier(world, 'happinessPenalty', 0, 0, undefined, Math.max)).toBe(30);
    expect(strongestModifier(world, 'happinessPenalty', 999, 0, undefined, Math.max)).toBe(30);
  });

  it('zablokovaná dlaždice se pozná', () => {
    const world = createWorld(1);
    const tile = index(30, 30, MAP_SIZE);
    expect(isBlocked(world, tile)).toBe(false);
    blockTile(world, tile, 20);
    expect(isBlocked(world, tile)).toBe(true);
  });
});

describe('postihy se propíšou do systémů', () => {
  it('potlačení služby srazí pokrytí', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    world.economy.funds = 1000000;
    for (let x = 19; x <= 22; x++) buildRoad(world, x, 22, ROAD.street, content.getBalance());
    expect(
      placeDefinition(world, content, 'vanilla:fire_station', 20, 20, content.getBalance()).ok,
    ).toBe(true);

    const systems = createDefaultSystems(content, content.getBalance());
    for (let tick = 0; tick < 5; tick++) tickWorld(world, systems);
    const cell = coarseCellsOfShape(world, { kind: 'point', x: 20, y: 20 })[0] ?? 0;
    const before = world.coverage.get('fire')?.[cell] ?? 0;
    expect(before).toBeGreaterThan(0);

    suppressService(world, 'fire', { kind: 'radius', x: 20, y: 20, radius: 8 }, 0.25, 200);
    for (let tick = 0; tick < 5; tick++) tickWorld(world, systems);

    const after = world.coverage.get('fire')?.[cell] ?? 0;
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(before * 0.25, 0);
  });

  it('dno kriminality se nedá přeplatit policií', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    const systems = createDefaultSystems(content, content.getBalance());
    const cell = coarseCellsOfShape(world, { kind: 'point', x: 20, y: 20 })[0] ?? 0;

    crimeFloor(world, { kind: 'radius', x: 20, y: 20, radius: 4 }, 200, 500);
    for (let tick = 0; tick < 40; tick++) tickWorld(world, systems);

    expect(world.coarse.crime[cell]).toBeGreaterThanOrEqual(200);
  });

  it('přirážka ke kriminalitě zvedne vrstvu', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    const systems = createDefaultSystems(content, content.getBalance());
    const cell = coarseCellsOfShape(world, { kind: 'point', x: 20, y: 20 })[0] ?? 0;

    for (let tick = 0; tick < 40; tick++) tickWorld(world, systems);
    const before = world.coarse.crime[cell] ?? 0;

    spikeCrime(world, { kind: 'radius', x: 20, y: 20, radius: 4 }, 60, 500);
    for (let tick = 0; tick < 20; tick++) tickWorld(world, systems);
    expect(world.coarse.crime[cell] ?? 0).toBeGreaterThan(before);
  });

  it('srážka ceny půdy se projeví', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    const systems = createDefaultSystems(content, content.getBalance());
    const cell = coarseCellsOfShape(world, { kind: 'point', x: 20, y: 20 })[0] ?? 0;

    for (let tick = 0; tick < 60; tick++) tickWorld(world, systems);
    const before = world.coarse.landValue[cell] ?? 0;
    expect(before).toBeGreaterThan(0);

    landValuePenalty(world, { kind: 'radius', x: 20, y: 20, radius: 4 }, 40, 500);
    for (let tick = 0; tick < 60; tick++) tickWorld(world, systems);
    expect(world.coarse.landValue[cell] ?? 0).toBeLessThan(before);
  });

  it('srážka spokojenosti se projeví', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    const systems = createDefaultSystems(content, content.getBalance());
    const cell = coarseCellsOfShape(world, { kind: 'point', x: 20, y: 20 })[0] ?? 0;

    for (let tick = 0; tick < 60; tick++) tickWorld(world, systems);
    const before = world.happiness[cell] ?? 0;

    happinessPenalty(world, { kind: 'radius', x: 20, y: 20, radius: 4 }, 60, 500);
    for (let tick = 0; tick < 60; tick++) tickWorld(world, systems);
    expect(world.happiness[cell] ?? 0).toBeLessThan(before);
  });
});

describe('ukazatele rizika', () => {
  it('jsou v rozsahu 0–1', async () => {
    const content = await vanilla();
    const world = await cityWithProblems(content);
    const indicators = computeIndicators(
      world,
      content,
      content.getBalance(),
      content.getBalance().disasters.indicators,
    );

    for (const name of [
      'crime',
      'crimeMax',
      'pollution',
      'neglect',
      'industryShare',
      'unemployment',
      'unhappiness',
      'taxBurden',
      'congestion',
      'majorRoadShare',
      'density',
      'waterless',
      'powerReserve',
      'singlePlantShare',
      'uncovered:fire',
      'underfunded:fire',
    ]) {
      const value = indicators.get(name);
      expect(value, name).toBeGreaterThanOrEqual(0);
      expect(value, name).toBeLessThanOrEqual(1);
    }
  });

  it('neznámý ukazatel je nula, ne pád', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    const indicators = computeIndicators(
      world,
      content,
      content.getBalance(),
      content.getBalance().disasters.indicators,
    );
    expect(indicators.get('vymyšlený')).toBe(0);
    // Prázdné město nemá koho nekrýt — jednička by tvrdila, že trpí.
    expect(indicators.get('uncovered:neexistuje')).toBe(0);
  });

  it('město bez jediné stanice je nekryté celé', async () => {
    const content = await vanilla();
    const world = await cityWithProblems(content);
    const indicators = computeIndicators(
      world,
      content,
      content.getBalance(),
      content.getBalance().disasters.indicators,
    );
    // Ne kryté celé — to by byla nejnebezpečnější tichá chyba v celém modelu.
    expect(indicators.get('uncovered:fire')).toBe(1);
  });

  it('podfinancování čte skutečné financování', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    world.serviceFunding.set('police', 0.25);
    const indicators = computeIndicators(
      world,
      content,
      content.getBalance(),
      content.getBalance().disasters.indicators,
    );
    expect(indicators.get('underfunded:police')).toBeCloseTo(0.75);
    // Neznámá třída je plně financovaná.
    expect(indicators.get('underfunded:culture')).toBe(0);
  });

  it('metriky počítají, co je na mapě', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    world.economy.funds = 1000000;
    for (let x = 5; x < 15; x++) buildRoad(world, x, 5, ROAD.street, content.getBalance());
    world.layers.terrain[index(30, 30, MAP_SIZE)] = TERRAIN.water;
    world.layers.terrain[index(40, 40, MAP_SIZE)] = TERRAIN.forest;

    const metrics = computeMetrics(world, content);
    expect(metrics.roadTiles).toBe(10);
    expect(metrics.forestTiles).toBe(1);
    // Kolem vody jsou čtyři souše, tedy čtyři pobřežní dlaždice.
    expect(metrics.coastTiles).toBe(4);
    expect(metrics.none).toBe(1);
  });
});

// --- pomocné ---------------------------------------------------------------

/** Katalog bez jediné definice. Plánovač ho nepotřebuje k ničemu jinému. */
function emptyCatalogue(): ContentRegistry {
  return new ContentRegistry();
}

/** Balanc, ve kterém `always` udeří s jistotou. Testy tak nečekají na štěstí. */
function certainBalance(overrides: Partial<DisasterBalance> = {}): Balance {
  return {
    ...VANILLA_BALANCE,
    disasters: {
      ...VANILLA_BALANCE.disasters,
      types: {
        ...VANILLA_BALANCE.disasters.types,
        always: {
          baseMonthlyChance: 1,
          maxMonthlyChance: 1,
          cooldownTicks: 500,
          natural: true,
          concurrent: { metric: 'none', divisor: 1, min: 1, max: 1 },
          require: [],
          risk: [],
          ...overrides,
        },
      },
    },
  };
}

/** Město s pár problémy, ať ukazatele nemají samé nuly. */
async function cityWithProblems(content: ContentRegistry): Promise<WorldState> {
  const world = createWorld(7, content.getBalance().economy);
  world.economy.funds = 1000000;
  for (let x = 10; x < 26; x++) buildRoad(world, x, 12, ROAD.street, content.getBalance());
  zoneArea(world, 10, 9, 16, 3, ZONE.residential);
  zoneArea(world, 10, 13, 16, 3, ZONE.industrial);
  world.waterSupply.fill(1);

  const systems = createDefaultSystems(content, content.getBalance());
  for (let tick = 0; tick < 300; tick++) {
    tickWorld(world, systems);
    world.waterSupply.fill(1);
    for (const id of world.buildings.keys()) world.watered.add(id);
  }
  return world;
}

/** Jedna katastrofa v syrovém balancu, aby se do ní dala zanést chyba. */
function disasterType(raw: Record<string, unknown>, kind: string): Record<string, unknown> {
  const disasters = raw['disasters'] as Record<string, unknown>;
  const types = disasters['types'] as Record<string, unknown>;
  return types[kind] as Record<string, unknown>;
}

/** Syrový balanc z obsahu, aby šly zkoušet chyby ve validaci. */
function rawBalance(): Record<string, unknown> {
  const modules = import.meta.glob('../content/vanilla/balance.json', {
    eager: true,
    import: 'default',
  });
  const raw = Object.values(modules)[0];
  return structuredClone(raw) as Record<string, unknown>;
}
