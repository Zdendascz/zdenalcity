/**
 * Simulovaný hráč: odehraje partii a zapíše, co se ve městě dělo.
 *
 *   npx vite build --ssr tools/simulate.ts --outDir tools/.build --logLevel error
 *   node tools/.build/simulate.js --games 40 --years 100 --out data/sim
 *
 * Proč přes `vite build --ssr`: skript sahá do `src/sim/` a potřebuje alias `@`.
 * Stejný postup jako `tools/build-city.ts`.
 *
 * ## Čím hráč smí hýbat
 *
 * **Výhradně přes `SimHost.dispatch`**, tedy tímtéž vstupem, kterým chodí
 * klikání v rozhraní. Simulace tak nemůže udělat nic, co by nemohl udělat
 * člověk: nedosáhne na vnitřnosti světa, neobejde cenu ani pravidlo, a když
 * příkaz neprojde, dozví se to stejným `CommandResult` jako hráč.
 *
 * Jediná výjimka je **čtení**: hráč se dívá na svět tam, kam se dívá i lidský
 * hráč přes HUD a rozbor parcely — kasa, poptávka, spokojenost, pokrytí,
 * proud, obyvatelé. Nic z toho není zásah.
 *
 * ## Stav: hráč ještě neumí město rozjet
 *
 * Kostra běží a měří, ale simulovaný hráč zatím **nepostaví fungující město** —
 * po sto letech má nula obyvatel. Poslední překážka je změřená: vodárna musí
 * stát u vody **a zároveň u silnice**, a hráč k břehu silnici nepřivede, takže
 * `error.needsRoad` (105 odmítnutí za partii). Bez vodárny se nezónuje, protože
 * zóna bez vody jen stojí peníze.
 *
 * Než se tohle dořeší, nemá cenu pouštět velkou dávku: měřila by se neschopnost
 * hráče, ne hra.
 *
 * ## Co to stojí
 *
 * Změřeno: prázdný svět 0,09 ms/tik, sto let = 3,4 s. Skutečné město autora
 * (681 budov) ale tiká 3,8 ms, tedy sto let ≈ 137 s. Deset tisíc partií po sto
 * letech je proto řádově **sto hodin jednovláknově**, na dvanácti jádrech deset
 * až patnáct. Je to úloha na noc, ne na jedno spuštění.
 *
 * ## Co se zapisuje
 *
 * Jeden řádek JSON na partii (`games.jsonl`) plus průběh po pěti letech
 * (`timeline.jsonl`). Surová data, žádné závěry — ty se dělají až nad nimi.
 */
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Balance } from '@/content/balance';
import type { Definition } from '@/content/schema';
import type { Command } from '@/sim/commands';
import { createSimHost } from '@/sim/simHost';
import type { SimHost } from '@/sim/simHost';
import { DisasterRegistry } from '@/sim/disasters/registry';
import { createFireDisaster, createWildfireDisaster } from '@/sim/disasters/fire';
import { createFloodDisaster } from '@/sim/disasters/flood';
import { createTornadoDisaster } from '@/sim/disasters/tornado';
import { createEarthquakeDisaster } from '@/sim/disasters/earthquake';
import { createBlackoutDisaster } from '@/sim/disasters/blackout';
import { createChemicalSpillDisaster } from '@/sim/disasters/chemicalSpill';
import { createEpidemicDisaster } from '@/sim/disasters/epidemic';
import { createGangWarDisaster } from '@/sim/disasters/gangWar';
import { createLandslideDisaster } from '@/sim/disasters/landslide';
import { createPileupDisaster } from '@/sim/disasters/pileup';
import { createRiotDisaster } from '@/sim/disasters/riot';
import { createStrikeDisaster } from '@/sim/disasters/strike';
import { createExplosionDisaster, createIndustrialAccidentDisaster } from '@/sim/disasters/blast';
import { createDefaultSystems } from '@/sim/systems';
import { averageHappiness } from '@/sim/systems/happiness';
import { index, ROAD, TERRAIN, ZONE } from '@/sim/layers';
import type { ZoneType } from '@/sim/layers';
import { isFlatTile } from '@/sim/heights';
import { applyGeneratedMap, generateTerrain } from '@/sim/mapgen';
import { createWorld, tickWorld, totalJobs, totalPopulation } from '@/sim/world';
import type { WorldState } from '@/sim/world';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

/** 1 tik = 1 den, 30 dní = měsíc, 12 měsíců = rok (§5). */
const TICKS_PER_YEAR = 360;

/** Jak často hráč sáhne na město. Člověk nekliká každý den. */
const DECIDE_EVERY = 10;

/** Jak často se zapíše řádek průběhu. Přepíše `--sample`. */
let SAMPLE_YEARS = 5;

// --- strategie -------------------------------------------------------------

/**
 * Osy, ve kterých se hráči liší.
 *
 * Nejsou to náhodné kombinace čísel: každá osa je rozhodnutí, které lidský hráč
 * doopravdy dělá — jak velké město chce, jestli staví služby dopředu nebo až
 * když hoří, čemu dá plochu, jak daní, jestli si půjčuje a jestli řeší MHD.
 */
export interface Strategy {
  /** Jak daleko od centra hráč zastavuje a jak rychle přidává. */
  ambition: 'malé' | 'střední' | 'velké';
  /** Kdy staví služby. */
  services: 'skoupý' | 'vyvážený' | 'štědrý';
  /** Poměr ploch: obytná / obchodní / průmyslová. */
  zoneMix: 'obytný' | 'vyvážený' | 'obchodní' | 'průmyslový';
  /** Daňová politika. */
  taxes: 'nízké' | 'střední' | 'vysoké' | 'reagující';
  /** Jak si obstarává peníze, když nemá. */
  finance: 'bez dluhu' | 'půjčky' | 'dluhopisy';
  /** Kdy a jestli staví MHD. */
  transit: 'žádná' | 'autobusy' | 'kolejová';
  /** Jak drží posuvníky financování služeb. */
  funding: 'škrty' | 'plné';
}

export const AXES: { [K in keyof Strategy]: readonly Strategy[K][] } = {
  ambition: ['malé', 'střední', 'velké'],
  services: ['skoupý', 'vyvážený', 'štědrý'],
  zoneMix: ['obytný', 'vyvážený', 'obchodní', 'průmyslový'],
  taxes: ['nízké', 'střední', 'vysoké', 'reagující'],
  finance: ['bez dluhu', 'půjčky', 'dluhopisy'],
  transit: ['žádná', 'autobusy', 'kolejová'],
  funding: ['škrty', 'plné'],
};

/** Všechny kombinace os. Pořadí je stálé, aby šlo běh zopakovat. */
export function allStrategies(): Strategy[] {
  let out: Record<string, unknown>[] = [{}];
  for (const [axis, values] of Object.entries(AXES)) {
    out = out.flatMap((base) => values.map((value) => ({ ...base, [axis]: value })));
  }
  return out as unknown as Strategy[];
}

// --- náhoda ----------------------------------------------------------------

/**
 * Vlastní generátor, ne `Math.random`: běh musí jít zopakovat ze semínka,
 * jinak se nález nedá ověřit. Simulace je nástroj, ne `sim/`, takže se jí
 * pravidlo P2 netýká — ale reprodukovatelnost chceme stejně.
 */
class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 1;
  }

  next(): number {
    this.state ^= this.state << 13;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    this.state >>>= 0;
    return this.state / 0x100000000;
  }

  int(max: number): number {
    return Math.floor(this.next() * max);
  }

  pick<T>(items: readonly T[]): T | undefined {
    return items[this.int(items.length)];
  }
}

// --- co si hráč o městě pamatuje -------------------------------------------

interface Plan {
  /** Kam až je natažená silniční mříž. */
  reach: number;
  /** Kolik bloků už je vyznačeno. */
  blocks: number;
  /** Id linek MHD, které založil. */
  lines: number[];
  /** Kdy naposledy žádal o půjčku. */
  lastTax: number;
  /** Kdy naposledy zkoušel postavit kterou budovu. Brzda proti zacyklení. */
  tried: Map<string, number>;
}

const CENTRE = 0.5;

/** Kam až hráč staví. Ambice v dlaždicích od středu. */
function ambitionReach(strategy: Strategy): number {
  return { 'malé': 14, 'střední': 26, 'velké': 42 }[strategy.ambition];
}

/** Jaký podíl bloků dostane která zóna. */
function zoneWeights(strategy: Strategy): [number, number, number] {
  switch (strategy.zoneMix) {
    case 'obytný':
      return [0.62, 0.23, 0.15];
    case 'obchodní':
      return [0.42, 0.42, 0.16];
    case 'průmyslový':
      return [0.42, 0.16, 0.42];
    default:
      return [0.5, 0.28, 0.22];
  }
}

/** Daňové sazby, které si hráč drží. */
function taxTargets(strategy: Strategy, balance: number): [number, number, number] {
  switch (strategy.taxes) {
    case 'nízké':
      return [5, 5, 6];
    case 'vysoké':
      return [16, 16, 18];
    case 'reagující':
      // Sazby se posunou podle toho, jestli město vydělává, nebo prodělává.
      return balance < 0 ? [14, 14, 16] : [8, 8, 9];
    default:
      return [10, 10, 11];
  }
}

// --- jedna partie ----------------------------------------------------------

export interface GameResult {
  strategy: Strategy;
  seed: number;
  years: number;
  /** Průběh: každých `SAMPLE_YEARS` let jeden vzorek. */
  timeline: Sample[];
  /** Konečný stav. */
  final: Sample;
  /** Kolik příkazů hráč poslal a kolik jich hra odmítla, po druzích. */
  commands: Record<string, number>;
  rejected: Record<string, number>;
  /** Kolik katastrof kterého druhu proběhlo. */
  disasters: Record<string, number>;
  /** Vteřiny, které partie stála. */
  seconds: number;
  /** Svět na konci. Slouží sondám, do souboru se nezapisuje. */
  world?: WorldState;
}

export interface Sample {
  year: number;
  population: number;
  jobs: number;
  funds: number;
  income: number;
  expenses: number;
  happiness: number;
  buildings: number;
  abandoned: number;
  powered: number;
  powerProduced: number;
  powerNeeded: number;
  waterProduced: number;
  zonedTiles: number;
  roadTiles: number;
  debt: number;
  bonds: number;
  demandR: number;
  demandC: number;
  demandI: number;
  pollution: number;
  crime: number;
  landValue: number;
  coverage: Record<string, number>;
}

function meanOf(values: Uint8Array | undefined): number {
  if (!values || values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return Math.round(sum / values.length);
}

function sample(world: WorldState, content: ContentRegistry, year: number): Sample {
  let abandoned = 0;
  let powered = 0;
  let powerProduced = 0;
  let powerNeeded = 0;
  let waterProduced = 0;
  for (const building of world.buildings.values()) {
    if (building.abandoned) abandoned++;
    if (building.powered) powered++;
    const definition = content.get(building.definitionId);
    powerProduced += definition?.power?.production ?? 0;
    powerNeeded += definition?.power?.consumption ?? 0;
    waterProduced += definition?.water?.production ?? 0;
  }

  let zonedTiles = 0;
  for (const value of world.layers.zone) if (value !== ZONE.none) zonedTiles++;

  const coverage: Record<string, number> = {};
  for (const [serviceClass, field] of world.coverage) {
    coverage[serviceClass] = meanOf(field);
  }

  return {
    year,
    population: totalPopulation(world.buildings),
    jobs: totalJobs(world.buildings),
    funds: Math.round(world.economy.funds),
    income: Math.round(world.economy.lastIncome),
    expenses: Math.round(world.economy.lastExpenses),
    happiness: Math.round(averageHappiness(world)),
    buildings: world.buildings.size,
    abandoned,
    powered,
    powerProduced,
    powerNeeded,
    waterProduced,
    zonedTiles,
    roadTiles: world.roadTiles.size,
    debt: Math.round(world.loans.reduce((sum, loan) => sum + loan.remaining, 0)),
    bonds: Math.round(world.bonds.reduce((sum, bond) => sum + bond.principal, 0)),
    demandR: world.demand.residential,
    demandC: world.demand.commercial,
    demandI: world.demand.industrial,
    pollution: meanOf(world.coarse.pollution),
    crime: meanOf(world.coarse.crime),
    landValue: meanOf(world.coarse.landValue),
    coverage,
  };
}

export function playGame(
  content: ContentRegistry,
  strategy: Strategy,
  seed: number,
  years: number,
): GameResult {
  const started = Date.now();
  const balance = content.getBalance();
  const world = createWorld(seed, balance.economy, 128);
  applyGeneratedMap(world, generateTerrain(seed, balance, world.size));

  const registry = new DisasterRegistry();
  for (const make of [
    createFireDisaster,
    createWildfireDisaster,
    createFloodDisaster,
    createTornadoDisaster,
    createEarthquakeDisaster,
    createExplosionDisaster,
    createIndustrialAccidentDisaster,
    createPileupDisaster,
    createStrikeDisaster,
    createRiotDisaster,
    createGangWarDisaster,
    createBlackoutDisaster,
    createEpidemicDisaster,
    createChemicalSpillDisaster,
    createLandslideDisaster,
  ]) {
    registry.register(make());
  }

  const systems = createDefaultSystems(content, balance, registry);
  // Příkazy jdou přes hosta — tytéž dveře jako klikání v rozhraní. Tikáme ale
  // přímo, protože `step()` je jen přepočet reálného času na tiky a simulace
  // žádný reálný čas nemá.
  const host: SimHost = createSimHost(world, systems, content, balance);

  const rng = new Rng(seed ^ 0x9e3779b9);
  const plan: Plan = { reach: 0, blocks: 0, lines: [], lastTax: -1, tried: new Map() };
  const commands: Record<string, number> = {};
  const rejected: Record<string, number> = {};
  const seen = new Set<number>();
  const disasters: Record<string, number> = {};

  const send = (cmd: Command): boolean => {
    commands[cmd.type] = (commands[cmd.type] ?? 0) + 1;
    const result = host.dispatch(cmd);
    if (!result.ok) {
      const reason = result.reason ?? 'error.unknown';
      rejected[reason] = (rejected[reason] ?? 0) + 1;
    }
    return result.ok;
  };

  const player = new Player(content, balance, world, strategy, rng, plan, send);
  const timeline: Sample[] = [];
  const ticks = years * TICKS_PER_YEAR;

  for (let tick = 0; tick < ticks; tick++) {
    if (tick % DECIDE_EVERY === 0) player.decide();
    tickWorld(world, systems);

    for (const disaster of world.disasters.active) {
      if (seen.has(disaster.id)) continue;
      seen.add(disaster.id);
      disasters[disaster.kind] = (disasters[disaster.kind] ?? 0) + 1;
    }

    const year = tick / TICKS_PER_YEAR;
    if (tick % (SAMPLE_YEARS * TICKS_PER_YEAR) === 0) {
      timeline.push(sample(world, content, Math.round(year)));
    }
  }

  return {
    strategy,
    seed,
    years,
    timeline,
    final: sample(world, content, years),
    commands,
    rejected,
    disasters,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    world,
  };
}

// --- hráč ------------------------------------------------------------------

/**
 * Rozhodování hráče.
 *
 * Pořadí kroků je pořadí, ve kterém by je dělal člověk: nejdřív se podívá, jestli
 * má proud a vodu, pak jestli je kam růst, pak co chybí za služby, a nakonec
 * doladí daně a peníze.
 */
class Player {
  private readonly content: ContentRegistry;
  private readonly balance: Balance;
  private readonly world: WorldState;
  private readonly strategy: Strategy;
  private readonly rng: Rng;
  private readonly plan: Plan;
  private readonly send: (cmd: Command) => boolean;
  private readonly byClass: Map<string, Definition[]>;
  private readonly powerPlants: Definition[];
  private readonly waterWorks: Definition[];

  constructor(
    content: ContentRegistry,
    balance: Balance,
    world: WorldState,
    strategy: Strategy,
    rng: Rng,
    plan: Plan,
    send: (cmd: Command) => boolean,
  ) {
    this.content = content;
    this.balance = balance;
    this.world = world;
    this.strategy = strategy;
    this.rng = rng;
    this.plan = plan;
    this.send = send;

    this.byClass = new Map();
    for (const definition of content.byCategory('service')) {
      const key = definition.service?.class;
      if (key === undefined) continue;
      const list = this.byClass.get(key) ?? [];
      list.push(definition);
      this.byClass.set(key, list);
    }
    for (const list of this.byClass.values()) {
      list.sort((a, b) => a.construction.cost - b.construction.cost);
    }

    const utilities = [...content.byCategory('utility')];
    this.powerPlants = utilities
      .filter((d) => (d.power?.production ?? 0) > 0)
      .sort((a, b) => a.construction.cost - b.construction.cost);
    this.waterWorks = utilities
      .filter((d) => (d.water?.production ?? 0) > 0)
      .sort((a, b) => a.construction.cost - b.construction.cost);
  }

  decide(): void {
    const funds = this.world.economy.funds;

    this.keepTaxes();
    this.keepFunding();
    if (funds < 0) this.borrow();

    this.clearRubble();
    this.keepPower();
    this.keepWater();
    // Zóna bez proudu a vody je vyhozená koruna, takže růst čeká na obojí.
    this.grow();
    // Potrubí po každém zónování: čerstvě vyznačená parcela bez vody nezaroste
    // a hráč by na ni koukal donekonečna. Už položené trubky se jen odmítnou.
    if (this.hasUtilities()) this.layPipes();
    this.keepServices();
    this.keepTransit();
  }

  // --- peníze --------------------------------------------------------------

  private keepTaxes(): void {
    const monthly = this.world.economy.lastIncome - this.world.economy.lastExpenses;
    const wanted = taxTargets(this.strategy, monthly);
    const zones: ZoneType[] = [ZONE.residential, ZONE.commercial, ZONE.industrial];
    const keys = ['residential', 'commercial', 'industrial'] as const;

    zones.forEach((zone, i) => {
      const rate = wanted[i] ?? 10;
      if (this.world.economy.taxRates[keys[i]] === rate) return;
      this.send({ type: 'set_tax_rate', zone, rate });
    });
  }

  private keepFunding(): void {
    // Škrtař šetří na všem, dokud mu město nezačne hořet pod rukama.
    const target = this.strategy.funding === 'škrty' ? 0.6 : 1;
    for (const serviceClass of this.byClass.keys()) {
      const now = this.world.serviceFunding.get(serviceClass) ?? 1;
      if (Math.abs(now - target) < 0.01) continue;
      this.send({ type: 'set_service_funding', serviceClass, funding: target });
    }
  }

  private borrow(): void {
    if (this.strategy.finance === 'bez dluhu') return;
    // Nejvýš jednou za rok. Předtím se o půjčku žádalo při každém rozhodnutí
    // a dvě stě šedesát pět žádostí za dvacet let je klikání, ne strategie.
    if (this.world.tick - this.plan.lastTax < TICKS_PER_YEAR) return;
    this.plan.lastTax = this.world.tick;
    const income = Math.max(1, this.world.economy.lastIncome);

    if (this.strategy.finance === 'půjčky') {
      this.send({ type: 'take_loan', amount: Math.round(income * 8), termMonths: 60 });
      return;
    }
    this.send({
      type: 'issue_bond',
      amount: Math.round(income * 10),
      rate: 6,
      maturityTicks: 10 * TICKS_PER_YEAR,
    });
  }

  // --- údržba --------------------------------------------------------------

  /** Zbořeniny a opuštěné domy pryč — jinak čtvrť shnije. */
  private clearRubble(): void {
    let budget = 3;
    for (const building of this.world.buildings.values()) {
      if (budget <= 0) return;
      if (!building.abandoned) continue;
      if (this.send({ type: 'bulldoze', x: building.x, y: building.y })) budget--;
    }
  }

  private keepPower(): void {
    let produced = 0;
    let needed = 0;
    for (const building of this.world.buildings.values()) {
      const definition = this.content.get(building.definitionId);
      produced += definition?.power?.production ?? 0;
      needed += definition?.power?.consumption ?? 0;
    }
    // Rezerva 100, aby první zóna měla z čeho růst dřív, než ji někdo připojí.
    if (produced >= needed * 1.15 + 100) return;

    for (const plant of this.powerPlants) {
      if (this.world.economy.funds < plant.construction.cost * 1.5) continue;
      if (this.place(plant)) return;
    }
  }

  private keepWater(): void {
    let produced = 0;
    for (const building of this.world.buildings.values()) {
      produced += this.content.get(building.definitionId)?.water?.production ?? 0;
    }
    const needed = this.world.buildings.size * 12;
    if (produced >= needed + 40) return;

    for (const works of this.waterWorks) {
      if (this.world.economy.funds < works.construction.cost * 1.5) continue;
      if (this.place(works)) {
        this.layPipes();
        return;
      }
    }
  }

  /** Potrubí pod hlavní osy. Bez vody dům chátrá. */
  private layPipes(): void {
    const half = Math.round(this.world.size * CENTRE);
    const reach = this.plan.reach;
    // Potrubí **jen pod vyznačené parcely**, ne pod každou volnou dlaždici
    // u silnice. Předtím jich za dvacet let koupil skoro pět tisíc a město
    // na to zbankrotovalo dřív, než se stačilo nastěhovat.
    const size = this.world.size;
    let budget = 60;
    for (let dy = -reach; dy <= reach && budget > 0; dy++) {
      for (let dx = -reach; dx <= reach && budget > 0; dx++) {
        const x = half + dx;
        const y = half + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const tile = index(x, y, size);
        if ((this.world.layers.zone[tile] ?? ZONE.none) === ZONE.none) continue;
        if ((this.world.layers.pipe[tile] ?? 0) !== 0) continue;
        if (this.send({ type: 'build_pipe', x, y })) budget--;
      }
    }
  }

  // --- růst ----------------------------------------------------------------

  /**
   * Přidá kus města: kus silnice a k němu bloky zón.
   *
   * Roste to po prstencích od středu, protože tak staví i člověk — od toho,
   * co už stojí, ne náhodně po mapě.
   */
  private grow(): void {
    // Zónovat se zkouší **pokaždé**: zóna je jediné, co městu vydělává, a bez
    // ní se hráč jen prostaví do mínusu. Přesně to se v prvním běhu stalo.
    this.fillBlocks();

    const half = Math.round(this.world.size * CENTRE);

    // Začátek je **kříž o čtrnácti dlaždicích**, nic víc.
    //
    // Předtím tu stálo sto dlaždic silnice hned v prvním roce a jejich údržba
    // srazila kasu do mínusu dřív, než vyrostl první dům. A v mínusu se
    // ve hře zastaví všechen růst, takže město navždy zamrzlo na čtyřech
    // lidech — ne kvůli hře, ale kvůli tomu, jak hloupě jsem hrál.
    if (this.plan.reach === 0) {
      for (let d = -3; d <= 3; d++) {
        if (this.isLand(half + d, half)) {
          this.send({ type: 'build_road', x: half + d, y: half, roadType: ROAD.street });
        }
        if (this.isLand(half, half + d)) {
          this.send({ type: 'build_road', x: half, y: half + d, roadType: ROAD.street });
        }
      }
      this.plan.reach = 3;
      return;
    }

    const wanted = ambitionReach(this.strategy);
    if (this.plan.reach >= wanted) return;
    // Prstenec navíc, až když je **z čeho a pro koho**: kasa v plusu, měsíční
    // bilance kladná a stávající čtvrť zarostlá.
    if (this.world.economy.funds < 20000) return;
    if (this.world.economy.lastIncome <= this.world.economy.lastExpenses) return;
    // Osm lidí na dlaždici okruhu: dost na to, aby čtvrť žila, a málo na to,
    // aby se město zaseklo na prvním kříži. Se čtyřiceti se nikdy nerozrostlo.
    if (totalPopulation(this.world.buildings) < this.plan.reach * 8) return;

    const reach = this.plan.reach + 3;
    for (let d = -reach; d <= reach; d++) {
      for (const [x, y] of [
        [half + d, half + reach],
        [half + d, half - reach],
        [half + reach, half + d],
        [half - reach, half + d],
      ] as const) {
        if (!this.isLand(x, y)) continue;
        this.send({ type: 'build_road', x, y, roadType: ROAD.street });
      }
    }
    // A spojky ke kříži, jinak by prstenec visel bez napojení.
    for (let d = this.plan.reach; d <= reach; d++) {
      if (this.isLand(half + d, half)) {
        this.send({ type: 'build_road', x: half + d, y: half, roadType: ROAD.street });
      }
      if (this.isLand(half - d, half)) {
        this.send({ type: 'build_road', x: half - d, y: half, roadType: ROAD.street });
      }
      if (this.isLand(half, half + d)) {
        this.send({ type: 'build_road', x: half, y: half + d, roadType: ROAD.street });
      }
      if (this.isLand(half, half - d)) {
        this.send({ type: 'build_road', x: half, y: half - d, roadType: ROAD.street });
      }
    }

    this.plan.reach = reach;
    this.layPipes();
  }

  /** Souš, na které se dá stavět. Voda se přeskakuje, most je zbytečný účet. */
  private isLand(x: number, y: number): boolean {
    if (x < 1 || y < 1 || x >= this.world.size - 1 || y >= this.world.size - 1) return false;
    return this.world.layers.terrain[index(x, y, this.world.size)] !== TERRAIN.water;
  }

  /** Vyznačí pár bloků podle poměru, který si hráč zvolil. */
  private fillBlocks(): void {
    if (this.world.economy.funds < 3000) return;
    // Bez proudu a vody zóna nezaroste, jen se za ni zaplatí. Hráč, který
    // se dívá na rozbor parcely, to vidí taky.
    if (!this.hasUtilities()) return;
    const half = Math.round(this.world.size * CENTRE);
    const reach = this.plan.reach;
    const [r, c] = zoneWeights(this.strategy);

    // Bloky se lepí **na silnici**. Zóna uprostřed pole nezaroste — dům chce
    // sousedit s vozovkou — a jen by se za ni zaplatilo.
    const spots = this.besideRoad(reach);
    if (spots.length === 0) return;

    // Po **jedné dlaždici**. Blok 2×2 se skoro vždy otřel o vozovku a pravidlo
    // ho odmítlo (`error.roadInTheWay`, tři sta odmítnutí za třicet let), takže
    // město nemělo kde růst. Parcela u silnice je stejně to, co dům potřebuje.
    for (const spot of spots.slice(0, 40)) {
      const roll = this.rng.next();
      const zone = roll < r ? ZONE.residential : roll < r + c ? ZONE.commercial : ZONE.industrial;
      if (this.send({ type: 'zone', x: spot[0], y: spot[1], w: 1, h: 1, zone })) {
        this.plan.blocks++;
      }
    }
  }

  /** Stojí ve městě aspoň jedna elektrárna a jedna vodárna? */
  private hasUtilities(): boolean {
    let power = 0;
    let water = 0;
    for (const building of this.world.buildings.values()) {
      const definition = this.content.get(building.definitionId);
      power += definition?.power?.production ?? 0;
      water += definition?.water?.production ?? 0;
    }
    return power > 0 && water > 0;
  }

  // --- služby --------------------------------------------------------------

  /**
   * Doplní službu, které je ve městě nejmíň.
   *
   * Skoupý hráč staví, až když pokrytí spadne hodně nízko, štědrý drží rezervu.
   * Je to jediná osa, kterou lidé v diskusích řeší nejvíc — proto má tři stupně.
   */
  private keepServices(): void {
    // V mínusu se ve hře zastaví růst, takže je horší postavit něco navíc než
    // chvíli počkat. Služby jdou stranou, dokud město nevydělává.
    if (this.world.economy.funds < 8000) return;
    const threshold = { 'skoupý': 25, 'vyvážený': 70, 'štědrý': 120 }[this.strategy.services];
    if (this.world.buildings.size < 6) return;

    let worst: { serviceClass: string; value: number } | null = null;
    for (const serviceClass of this.byClass.keys()) {
      const value = meanOf(this.world.coverage.get(serviceClass));
      if (worst === null || value < worst.value) worst = { serviceClass, value };
    }
    if (!worst || worst.value >= threshold) return;

    const options = this.byClass.get(worst.serviceClass) ?? [];
    for (const definition of options) {
      if (this.world.economy.funds < definition.construction.cost * 2) continue;
      if (this.place(definition)) return;
    }
  }

  // --- MHD -----------------------------------------------------------------

  private keepTransit(): void {
    if (this.strategy.transit === 'žádná') return;
    if (totalPopulation(this.world.buildings) < 400) return;

    const mode = this.strategy.transit === 'autobusy' ? 'bus' : 'tram';
    const stopId = mode === 'bus' ? 'vanilla:transit_stop' : 'vanilla:tram_stop';

    if (this.plan.lines.length === 0) {
      if (!this.send({ type: 'create_line', mode })) return;
      const line = this.world.lines[this.world.lines.length - 1];
      if (!line) return;
      this.plan.lines.push(line.id);
      this.send({ type: 'set_vehicles', lineId: line.id, vehicles: 4 });
      this.send({ type: 'set_fare', lineId: line.id, fare: 6 });
    }

    const lineId = this.plan.lines[0];
    if (lineId === undefined) return;
    const line = this.world.lines.find((candidate) => candidate.id === lineId);
    if (!line || line.stops.length >= 10) return;

    // Zastávka se nejdřív postaví, pak přidá na linku — přesně jako v rozhraní.
    const definition = this.content.get(stopId);
    if (!definition) return;
    const before = new Set(this.world.buildings.keys());
    if (!this.place(definition)) return;
    const created = [...this.world.buildings.keys()].find((id) => !before.has(id));
    if (created === undefined) return;
    this.send({ type: 'add_stop', lineId, buildingId: created });
  }

  // --- kam co postavit -----------------------------------------------------

  /** Souš u vody v dosahu města. Sem patří vodárna a čerpací stanice. */
  private shoreSpots(reach: number, w: number, d: number): [number, number][] {
    const half = Math.round(this.world.size * CENTRE);
    const out: [number, number][] = [];
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x = half + dx;
        const y = half + dy;
        // **Celý půdorys musí být na souši** a aspoň jednou hranou u vody.
        // Vodárna je 3×3; když se hledala jedna dlaždice u břehu, spadly jí
        // do vody dvě třetiny parcely a nepostavila se nikdy.
        let land = true;
        for (let oy = 0; oy < d && land; oy++) {
          for (let ox = 0; ox < w && land; ox++) land = this.isLand(x + ox, y + oy);
        }
        if (!land) continue;

        let touches = false;
        for (let oy = -1; oy <= d && !touches; oy++) {
          for (let ox = -1; ox <= w && !touches; ox++) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= this.world.size || ny >= this.world.size) continue;
            if (this.world.layers.terrain[index(nx, ny, this.world.size)] === TERRAIN.water) {
              touches = true;
            }
          }
        }
        if (touches) out.push([x, y]);
      }
    }
    // Nejbližší břeh první: silnice k němu se platí po dlaždicích.
    out.sort(
      (a, b) =>
        Math.abs(a[0] - half) +
        Math.abs(a[1] - half) -
        (Math.abs(b[0] - half) + Math.abs(b[1] - half)),
    );
    return out.slice(0, 12);
  }

  private besideRoad(reach: number): [number, number][] {
    const half = Math.round(this.world.size * CENTRE);
    const size = this.world.size;
    const out: [number, number][] = [];
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x = half + dx;
        const y = half + dy;
        if (!this.isLand(x, y)) continue;
        const tile = index(x, y, size);
        if ((this.world.layers.road[tile] ?? ROAD.none) !== ROAD.none) continue;
        if ((this.world.layers.buildingId[tile] ?? 0) !== 0) continue;
        // Už vyznačenou parcelu nechat být. Hráč ji předtím při každém
        // rozhodnutí přebarvil na jinou zónu, takže na ní nikdy nic nestihlo
        // vyrůst — dva a půl tisíce zbytečných zásahů za dvacet let.
        if ((this.world.layers.zone[tile] ?? ZONE.none) !== ZONE.none) continue;
        const touches = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(
          ([ox, oy]) =>
            (this.world.layers.road[index(x + ox, y + oy, size)] ?? ROAD.none) !== ROAD.none,
        );
        if (touches) out.push([x, y]);
      }
    }
    return out;
  }

  // --- služby --------------------------------------------------------------

  /**
   * Doplní službu, které je ve městě nejmíň.
   *
   * Skoupý hráč staví, až když pokrytí spadne hodně nízko, štědrý drží rezervu.
   * Je to jediná osa, kterou lidé v diskusích řeší nejvíc — proto má tři stupně.
   */
  private keepServices(): void {
    // V mínusu se ve hře zastaví růst, takže je horší postavit něco navíc než
    // chvíli počkat. Služby jdou stranou, dokud město nevydělává.
    if (this.world.economy.funds < 8000) return;
    const threshold = { 'skoupý': 25, 'vyvážený': 70, 'štědrý': 120 }[this.strategy.services];
    if (this.world.buildings.size < 6) return;

    let worst: { serviceClass: string; value: number } | null = null;
    for (const serviceClass of this.byClass.keys()) {
      const value = meanOf(this.world.coverage.get(serviceClass));
      if (worst === null || value < worst.value) worst = { serviceClass, value };
    }
    if (!worst || worst.value >= threshold) return;

    const options = this.byClass.get(worst.serviceClass) ?? [];
    for (const definition of options) {
      if (this.world.economy.funds < definition.construction.cost * 2) continue;
      if (this.place(definition)) return;
    }
  }

  // --- MHD -----------------------------------------------------------------

  private keepTransit(): void {
    if (this.strategy.transit === 'žádná') return;
    if (totalPopulation(this.world.buildings) < 400) return;

    const mode = this.strategy.transit === 'autobusy' ? 'bus' : 'tram';
    const stopId = mode === 'bus' ? 'vanilla:transit_stop' : 'vanilla:tram_stop';

    if (this.plan.lines.length === 0) {
      if (!this.send({ type: 'create_line', mode })) return;
      const line = this.world.lines[this.world.lines.length - 1];
      if (!line) return;
      this.plan.lines.push(line.id);
      this.send({ type: 'set_vehicles', lineId: line.id, vehicles: 4 });
      this.send({ type: 'set_fare', lineId: line.id, fare: 6 });
    }

    const lineId = this.plan.lines[0];
    if (lineId === undefined) return;
    const line = this.world.lines.find((candidate) => candidate.id === lineId);
    if (!line || line.stops.length >= 10) return;

    // Zastávka se nejdřív postaví, pak přidá na linku — přesně jako v rozhraní.
    const definition = this.content.get(stopId);
    if (!definition) return;
    const before = new Set(this.world.buildings.keys());
    if (!this.place(definition)) return;
    const created = [...this.world.buildings.keys()].find((id) => !before.has(id));
    if (created === undefined) return;
    this.send({ type: 'add_stop', lineId, buildingId: created });
  }

  // --- kam co postavit -----------------------------------------------------

  /**
   * Najde volnou rovnou parcelu u silnice a postaví tam.
   *
   * Hledá se **od středu ven a náhodně**, ne po řádcích: hráč taky nestaví
   * všechno do jednoho rohu. Když se to nepovede, zkusí se srovnat terén —
   * to je taky jen tlačítko, které má člověk k dispozici.
   */
  private place(definition: Definition): boolean {
    // **Nejvýš jeden pokus za rok na budovu.**
    //
    // Předtím se o totéž zkoušelo při každém rozhodnutí, takže se k břehu
    // pořád dokola natahovala tatáž silnice: dva a tři čtvrtě milionu
    // odmítnutých příkazů `error.roadExists` za partii. Hráč mezitím neudělal
    // nic jiného a město nevzniklo.
    const last = this.plan.tried.get(definition.id) ?? -TICKS_PER_YEAR;
    if (this.world.tick - last < TICKS_PER_YEAR) return false;
    this.plan.tried.set(definition.id, this.world.tick);

    const [w, d] = definition.footprint;
    const half = Math.round(this.world.size * CENTRE);
    const reach = Math.max(6, this.plan.reach);

    // Vodárna musí stát u vody. Hráč se podívá na mapu a jde k břehu; náhodné
    // klikání doprostřed města ji nepostaví nikdy — a bez vody město neroste.
    const shore = definition.construction.nearWater === true ? this.shoreSpots(40, w, d) : null;

    // U pobřežní stavby se zkouší jen pár nejbližších míst: ke každému se
    // táhne silnice a ta se platí po dlaždicích.
    const tries = shore ? Math.min(shore.length, 6) : 24;
    for (let attempt = 0; attempt < tries; attempt++) {
      const spot = shore ? shore[attempt] : null;
      if (shore && !spot) return false;
      const free = spot ?? this.rng.pick(this.besideRoad(reach));
      if (!free) return false;
      const [x, y] = free;
      // K vodárně se musí dostat silnice, jinak ji pravidlo odmítne.
      if (spot) this.roadTo(x, y);
      if (x < 1 || y < 1 || x + w >= this.world.size || y + d >= this.world.size) continue;
      if (!this.freeAndNearRoad(x, y, w, d)) continue;

      if (this.send({ type: 'place_building', definitionId: definition.id, x, y })) return true;

      // Les, balvany, trosky: hráč je odveze buldozerem a zkusí to znovu.
      // Jen u prvních tří míst — jinak se za partii naklikalo přes milion
      // odmítnutých „tady není co bourat".
      if (attempt < 3) {
        for (let dy = 0; dy < d; dy++) {
          for (let dx = 0; dx < w; dx++) this.send({ type: 'bulldoze', x: x + dx, y: y + dy });
        }
      }
      if (this.send({ type: 'place_building', definitionId: definition.id, x, y })) return true;

      // Nerovná parcela: srovnat a zkusit znovu. Stojí to peníze jako hráče.
      if (!isFlatTile(this.world.cornerHeight, x, y)) {
        this.send({ type: 'level_area', x, y, w, h: d });
        if (this.send({ type: 'place_building', definitionId: definition.id, x, y })) return true;
      }
    }
    return false;
  }

  /**
   * Přivede silnici k cíli.
   *
   * Lomená cesta ze středu: nejdřív po ose x, pak po ose y. Voda se přeskakuje,
   * takže se cesta u zálivu přeruší — a to je v pořádku, hráč by ji tam taky
   * nevedl. Bez tohohle se **vodárna nedá postavit vůbec**: musí stát u vody
   * a zároveň u silnice, a k břehu žádná nevedla.
   */
  private roadTo(tx: number, ty: number): void {
    const half = Math.round(this.world.size * CENTRE);
    const stepX = tx >= half ? 1 : -1;
    for (let x = half; x !== tx; x += stepX) {
      if (this.isLand(x, half)) this.send({ type: 'build_road', x, y: half, roadType: ROAD.street });
    }
    const stepY = ty >= half ? 1 : -1;
    for (let y = half; y !== ty; y += stepY) {
      if (this.isLand(tx, y)) this.send({ type: 'build_road', x: tx, y, roadType: ROAD.street });
    }
  }

  private freeAndNearRoad(x: number, y: number, w: number, d: number): boolean {
    let road = false;
    for (let dy = -1; dy <= d; dy++) {
      for (let dx = -1; dx <= w; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= this.world.size || ty >= this.world.size) continue;
        const tile = index(tx, ty, this.world.size);
        const inside = dx >= 0 && dy >= 0 && dx < w && dy < d;
        if (inside) {
          if ((this.world.layers.buildingId[tile] ?? 0) !== 0) return false;
          if ((this.world.layers.road[tile] ?? ROAD.none) !== ROAD.none) return false;
          if (this.world.layers.terrain[tile] === TERRAIN.water) return false;
        } else if ((this.world.layers.road[tile] ?? ROAD.none) !== ROAD.none) {
          road = true;
        }
      }
    }
    return road;
  }
}

// --- běh -------------------------------------------------------------------

interface Options {
  games: number;
  years: number;
  runs: number;
  out: string;
  offset: number;
}

function parseArgs(argv: string[]): Options {
  const value = (name: string, fallback: number): number => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? Number(argv[at + 1] ?? fallback) : fallback;
  };
  const text = (name: string, fallback: string): string => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? (argv[at + 1] ?? fallback) : fallback;
  };
  SAMPLE_YEARS = value('sample', SAMPLE_YEARS);
  return {
    games: value('games', 0),
    years: value('years', 100),
    runs: value('runs', 10),
    out: text('out', 'data/sim'),
    offset: value('offset', 0),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const content = new ContentRegistry();
  await content.load(createVanillaSource());

  const strategies = allStrategies();
  const outDir = resolve(ROOT, options.out);
  mkdirSync(outDir, { recursive: true });
  const games = resolve(outDir, `games-${options.offset}.jsonl`);
  writeFileSync(games, '');

  // Partie se řadí strategie po strategii, aby šel běh přerušit a data dávala
  // smysl i z půlky.
  const planned: { strategy: Strategy; seed: number }[] = [];
  for (let run = 0; run < options.runs; run++) {
    for (const strategy of strategies) {
      planned.push({ strategy, seed: (planned.length + 1) * 2654435761 });
    }
  }

  const total = options.games > 0 ? Math.min(options.games, planned.length) : planned.length;
  const started = Date.now();

  // Souběžné běhy si dělí partie po `stride`: každý bere každou N-tou,
  // takže se strategie rozprostřou rovnoměrně.
  for (let i = options.offset; i < total; i += options.stride) {
    const job = planned[i];
    if (!job) break;
    const result = playGame(content, job.strategy, job.seed, options.years);
    // Svět se **nezapisuje**: je to celý stav mapy a v JSONu má přes dva
    // megabajty na partii. Deset tisíc partií by dělalo přes dvacet gigabajtů,
    // ve kterých není nic ke čtení. Slouží jen sondám.
    const row: Record<string, unknown> = { ...result };
    delete row.world;
    appendFileSync(games, `${JSON.stringify(row)}
`);

    const done = Math.floor((i - options.offset) / options.stride) + 1;
    const elapsed = (Date.now() - started) / 1000;
    if (done % 5 === 0 || done === 1) {
      const mine = Math.ceil((total - options.offset) / options.stride);
      const rate = elapsed / done;
      process.stdout.write(
        `  ${done}/${mine}  ${elapsed.toFixed(0)} s  ` +
          `(${rate.toFixed(1)} s/partii, zbývá ${(((mine - done) * rate) / 60).toFixed(0)} min)
`,
      );
    }
  }

  process.stdout.write(`Hotovo, ${games}\n`);
}

// Přímé spuštění, ne import z testu.
if (process.argv[1]?.includes('simulate')) {
  void main();
}
