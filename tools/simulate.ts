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

/*
 * Kolik proudu si hráč drží nad spotřebou.
 *
 * Není to opatrnost, je to **pravidlo hry**: riziko blackoutu roste, jakmile
 * rezerva klesne pod čtvrtinu (`powerReserve` v `balance.json`), a blackout je
 * past, ze které se v téhle hře skoro nedá vyhrabat. Kaskáda odpojí elektrárny
 * jednu po druhé; vrací se po jedné a každá vrácená se hned přetíží znovu, tak
 * jde zase dolů. Město mezitím nemá proud, nenapájený dům neplatí daň, příjem
 * je nula — a půjčka se odvozuje od příjmu (T57), takže si ani nepůjčí.
 *
 * Změřeno: hráč, který stavěl elektrárnu, až když chybělo, měl ve čtvrtém roce
 * 111 budov, čtyři větrníky a **všechny čtyři odpojené**. Napájeno nula, příjem
 * nula, a takhle to zůstalo do konce partie.
 */
const POWER_HEADROOM = 0.65;
/** Základní rezerva, aby první zóna měla z čeho růst dřív, než ji někdo připojí. */
const POWER_BASE = 400;

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
  /** Volitelný pozorovatel: dostane svět po každém roce. Slouží ladění. */
  watch?: (world: WorldState, year: number) => void,
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
      if (process.env['DEBUG_DISASTERS'] === '1') {
        process.stdout.write(
          `      rok ${(tick / TICKS_PER_YEAR).toFixed(1)} zacala ${disaster.kind} ` +
            `na ${disaster.x},${disaster.y} (budov ${world.buildings.size})
`,
        );
      }
    }

    const year = tick / TICKS_PER_YEAR;
    if (tick % TICKS_PER_YEAR === 0 && watch) watch(world, Math.round(year));
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
  /** Čerpací stanice: nevyrábí, jen prodlouží dosah sítě od místa, kam voda došla. */
  private readonly pumps: Definition[];

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
    this.pumps = utilities
      .filter((d) => (d.water?.production ?? 0) === 0 && (d.water?.range ?? 0) > 0)
      .sort((a, b) => a.construction.cost - b.construction.cost);
  }

  /**
   * Zbude po utracení **půlroční údržba**?
   *
   * Hráč, který utratí všechno, co vydělá, jednou přijde o daňový příjem —
   * po katastrofě nebo po blackoutu — a od té chvíle už se nezvedne: v mínusu
   * hra zmrazí růst. Změřeno na seedu 2: kasa se šestkrát propadla pod tisíc,
   * po čtyřicátém roce zůstala v mínusu a město se za zbylých šedesát let
   * nedostalo zpátky ani jednou.
   *
   * Elektrárna a vodárna sem nespadají. Ty se nekupují z rezervy, ale kvůli
   * ní: bez proudu a vody město nevybírá daň vůbec.
   */
  private canSpend(cost: number): boolean {
    const reserve = Math.max(2000, this.world.economy.lastExpenses * 6);
    return this.world.economy.funds - cost > reserve;
  }

  decide(): void {
    const funds = this.world.economy.funds;

    this.keepTaxes();
    this.keepFunding();
    if (funds < 0) this.borrow();

    this.clearRubble();
    // Proud má **přednost před vším ostatním**. Dokud ho není dost, nemá smysl
    // stavět služby ani linky: nenapájený dům neplatí daň, takže město platí
    // údržbu ze mzdy, kterou nedostává.
    const powerShort = this.keepPower();
    if (!powerShort) this.trimUpkeep();
    this.keepWater();
    // Zóna bez proudu a vody je vyhozená koruna, takže růst čeká na obojí.
    this.grow();
    // Potrubí **až po zónování**: čerstvě vyznačená parcela bez vody nezaroste
    // a hráč by na ni koukal donekonečna. Jedenáct z pětačtyřiceti parcel
    // takhle leželo s hláškou „chybí voda".
    if (this.hasUtilities()) {
      this.layPipes();
      this.keepWaterReach();
    }
    if (!powerShort) {
      this.keepServices();
      this.keepTransit();
    }
  }

  // --- peníze --------------------------------------------------------------

  private keepTaxes(): void {
    const monthly = this.world.economy.lastIncome - this.world.economy.lastExpenses;
    const wanted = taxTargets(this.strategy, monthly);

    /*
     * Nouzové zvýšení. Když město prodělává a kasa se blíží nule, hráč **vždy**
     * sáhne po daních — i ten, který jinak drží nízké. Bez toho se strategie
     * „nízké daně" nerozhodovala mezi levným a drahým městem, ale mezi
     * bankrotem a bankrotem: v mínusu se ve hře zastaví růst a město už se
     * nezvedne.
     *
     * Základ si každá strategie drží svůj, tohle je jen strop nad ním.
     */
    // Reaguje se **na bilanci, ne až na prázdnou kasu**. Kdo čeká, až mu dojdou
    // peníze, čeká pozdě: mezitím spadne do mínusu, v mínusu se zastaví růst
    // a z toho už se město nevyhrabe.
    if (monthly < 0) {
      for (let i = 0; i < wanted.length; i++) {
        wanted[i] = Math.min(20, (wanted[i] ?? 10) + 5);
      }
    }
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
    // **Bez peněz se neuklízí.** Bourání se platí a odmítnutý příkaz nic
    // neuklidí; do téhle stráže si hráč za partii naklikal 44 596 odmítnutí
    // „nemáš na to", což je čtvrtina všech jeho příkazů.
    if (this.world.economy.funds < 500) return;

    /*
     * Rozpočet roste s tím, kolik je co uklízet. Šest dlaždic za rozhodnutí
     * stačilo na běžný oheň, ale ne na tornádo: po tom leželo **379 dlaždic
     * suti** a hráč je uklízel rychlostí, při které se město za zbylých dvanáct
     * let nezvedlo z devadesáti obyvatel. Suť blokuje parcelu napořád — dokud
     * leží, nevyroste tam nic a čtvrť nevydělává.
     */
    let budget = 6;
    for (const building of this.world.buildings.values()) {
      if (budget <= 0) return;
      if (!building.abandoned) continue;
      if (this.send({ type: 'bulldoze', x: building.x, y: building.y })) budget--;
    }

    // A **suť po katastrofě**. Blokuje parcelu napořád: hra na ní hlásí
    // „hromada suti" a nic tam nevyroste. Po tornádu takhle leželo čtyřiadvacet
    // dlaždic a město se z toho už nezvedlo.
    const size = this.world.size;
    const half = Math.round(size * CENTRE);
    const reach = this.plan.reach;
    budget += 30;
    for (let dy = -reach; dy <= reach && budget > 0; dy++) {
      for (let dx = -reach; dx <= reach && budget > 0; dx++) {
        const x = half + dx;
        const y = half + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        if ((this.world.rubble[index(x, y, size)] ?? 0) === 0) continue;
        // Odečítá se **pokus**, ne úspěch. Dlaždice, na kterou hráč nemá,
        // se odmítne pokaždé stejně a bez tohohle by se o ni zkoušel donekonečna.
        budget--;
        this.send({ type: 'bulldoze', x, y });
      }
    }
  }

  private keepPower(): boolean {
    let produced = 0;
    let needed = 0;
    for (const building of this.world.buildings.values()) {
      const definition = this.content.get(building.definitionId);
      produced += definition?.power?.production ?? 0;
      needed += definition?.power?.consumption ?? 0;
    }

    const target = needed / POWER_HEADROOM + POWER_BASE;
    if (produced >= target) return false;

    /*
     * Staví se **dokud rezerva nesedí**, ne jedna elektrárna za rozhodnutí.
     * Město roste rychleji, než se dřív přidávaly zdroje: se starým pravidlem
     * přibývalo 700 kW za rok, kdežto čtyřicet pět nových domů chtělo přes tři
     * tisíce. Rozdíl dohnal blackout.
     *
     * Nejvýš tři za rozhodnutí, ať se nepostaví elektrárna na každou volnou
     * parcelu, když je zrovna plná kasa.
     */
    for (let built = 0; built < 3 && produced < target; built++) {
      const missing = target - produced;
      // Velká elektrárna je levnější na kilowatt, ale **jedna velká je riziko**:
      // `singlePlantShare` zvedá pravděpodobnost blackoutu podle toho, jak velký
      // podíl sítě visí na jednom zdroji. Proto se bere nejlevnější na kilowatt
      // z těch, které pokryjí chybějící část, a když nic takového není, největší
      // dostupná.
      const affordable = this.powerPlants.filter(
        (d) => this.world.economy.funds >= d.construction.cost * 1.4,
      );
      if (affordable.length === 0) {
        // Na elektrárnu se **půjčuje**. Nenapájený dům neplatí daň, takže
        // město bez rezervy nevydělá na to, co mu chybí, a spirála se utáhne:
        // změřeno ve čtvrtém roce partie — 67 domů, z toho 27 pod proudem,
        // příjem třetinový a na další větrník to nikdy nevyšlo.
        this.borrow();
        return produced < needed;
      }

      /*
       * **Nejmenší, která to pokryje** — ne nejlevnější na kilowatt.
       *
       * Uhelná elektrárna vyjde na korunu za kilowatt (24 000 za 24 000 kW),
       * takže podle ceny za kilowatt vyhraje vždycky. Jenže má půdorys 5×5
       * a vedle prvního kříže o čtrnácti dlaždicích se nemá kam vejít: hráč
       * ji zkoušel postavit každých třicet tiků čtyřicet let a nepostavil ji
       * ani jednou. Město zůstalo bez proudu, bez vody a se sedmi domy.
       *
       * Ke stejné volbě vede i pravidlo hry: `singlePlantShare` zvedá riziko
       * blackoutu podle toho, jak velký podíl sítě visí na jednom zdroji.
       */
      const ordered = [...affordable].sort((a, b) => {
        const ap = a.power?.production ?? 0;
        const bp = b.power?.production ?? 0;
        const aFits = ap >= missing ? 0 : 1;
        const bFits = bp >= missing ? 0 : 1;
        if (aFits !== bFits) return aFits - bFits;
        // Mezi těmi, co chybějící část pokryjí, ta nejmenší; mezi zbytkem
        // naopak ta největší, ať se ke chybějícím kilowattům dojde nejrychleji.
        return aFits === 0 ? ap - bp : bp - ap;
      });

      let placed = 0;
      for (const plant of ordered) {
        if (!this.place(plant)) continue;
        placed = plant.power?.production ?? 0;
        break;
      }
      if (placed === 0) return produced < needed;
      produced += placed;
    }
    return produced < needed;
  }

  /**
   * Když město spadne, musí i **zeštíhlet**.
   *
   * Po zemětřesení zbylo ze 435 domů 180 a za pár měsíců 76. Elektráren ale
   * zůstalo devět a město za ně platilo údržbu dál: příjem 752, výdaje 2778.
   * Kasa se z pěti set tisíc vyprázdnila za pětadvacet let a pak přišel
   * bankrot, který ve hře zmrazí růst — takže město už nikdy nevstalo.
   *
   * Hráč tedy dělá to, co člověk: co je navíc a stojí to, zbourá. Nejmenší
   * elektrárnu první, ať síť neztratí víc, než musí.
   */
  private trimUpkeep(): void {
    if (this.world.economy.lastIncome >= this.world.economy.lastExpenses) return;

    let produced = 0;
    let needed = 0;
    for (const building of this.world.buildings.values()) {
      const definition = this.content.get(building.definitionId);
      produced += definition?.power?.production ?? 0;
      needed += definition?.power?.consumption ?? 0;
    }
    // Rezerva zůstává dvojnásobná; bourá se až to, co je i nad ní.
    const keep = needed / POWER_HEADROOM + POWER_BASE;
    if (produced <= keep * 2) return;

    let smallest: { x: number; y: number; output: number } | null = null;
    for (const building of this.world.buildings.values()) {
      const output = this.content.get(building.definitionId)?.power?.production ?? 0;
      if (output <= 0) continue;
      if (produced - output < keep) continue;
      if (smallest !== null && output >= smallest.output) continue;
      smallest = { x: building.x, y: building.y, output };
    }
    if (!smallest) return;
    this.send({ type: 'bulldoze', x: smallest.x, y: smallest.y });
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

  /**
   * Voda musí i **dotéct**, nejen být vyrobená.
   *
   * Vodárna tlačí vodu jen 24 dlaždic daleko po potrubí. Město roste dál, takže
   * druhá půlka sítě zůstane suchá, i když vodárna běží naplno: změřeno v
   * patnáctém roce — 636 vyznačených parcel, všechny s trubkou, a **jen 182
   * s vodou**. Zbytek chátral a hra na něm celou partii hlásila „chybí voda".
   *
   * Na to je ve hře čerpací stanice: nevyrábí nic, ale jakmile k ní voda
   * dorazí, rozjede z místa, kde stojí, vlastní dosah. Staví se proto **na
   * okraji zavodněné oblasti směrem k suchu**, ne kamkoli — stanice mimo síť
   * je vyhozených 1250.
   */
  private keepWaterReach(): void {
    const pump = this.pumps[0];
    if (!pump) return;
    if (!this.canSpend(pump.construction.cost * 2)) return;
    // Nejvýš jedna za půl roku: síť se po každé musí přepočítat a hráč se
    // podívá, jestli to pomohlo.
    const last = this.plan.tried.get(pump.id) ?? -TICKS_PER_YEAR;
    if (this.world.tick - last < TICKS_PER_YEAR / 2) return;

    const size = this.world.size;
    let dry = 0;
    let sumX = 0;
    let sumY = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const tile = index(x, y, size);
        if ((this.world.layers.zone[tile] ?? ZONE.none) === ZONE.none) continue;
        if ((this.world.waterSupply[tile] ?? 0) !== 0) continue;
        dry++;
        sumX += x;
        sumY += y;
      }
    }
    // Pár suchých parcel na okraji je normální; stanice se staví, až když je
    // sucho celá čtvrť.
    if (dry < 40) return;

    const targetX = Math.round(sumX / dry);
    const targetY = Math.round(sumY / dry);

    // Nejbližší zavodněná dlaždice k těžišti sucha, na které se dá stavět.
    let best: [number, number] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const tile = index(x, y, size);
        if ((this.world.waterSupply[tile] ?? 0) === 0) continue;
        if ((this.world.layers.buildingId[tile] ?? 0) !== 0) continue;
        if ((this.world.rubble[tile] ?? 0) !== 0) continue;
        if (this.world.layers.terrain[tile] === TERRAIN.water) continue;
        const distance = Math.abs(x - targetX) + Math.abs(y - targetY);
        if (distance >= bestDistance) continue;
        best = [x, y];
        bestDistance = distance;
      }
    }
    if (!best) return;

    this.plan.tried.set(pump.id, this.world.tick);
    const [x, y] = best;
    if (this.send({ type: 'place_building', definitionId: pump.id, x, y })) return;
    // Les nebo balvan na dlaždici: hráč je odveze a zkusí to hned znovu.
    this.send({ type: 'bulldoze', x, y });
    this.send({ type: 'place_building', definitionId: pump.id, x, y });
  }

  /** Potrubí pod hlavní osy. Bez vody dům chátrá. */
  private layPipes(): void {
    const size = this.world.size;
    const reach = this.plan.reach + 2;
    const half = Math.round(size * CENTRE);

    /*
     * Potrubí musí být **souvislé od vodárny**, ne rozeseté pod jednotlivými
     * parcelami. Voda teče sítí; osamocená trubka pod domem je díra v zemi.
     *
     * Předtím se kladlo jen pod vyznačené parcely a hra hlásila „chybí voda"
     * na třiadvaceti z devětatřiceti. Páteří je proto **silnice**: ta vede od
     * středu ke všemu, co hráč postavil, včetně vodárny u břehu. Parcely na ni
     * navazují, protože jsou z definice u silnice.
     */
    let budget = 120;
    /*
     * Páteří je **celá silniční síť**, ne jen prstenec kolem středu.
     *
     * Vodárna stojí u břehu, a ten bývá dál, než kam hráč zatím staví. S
     * omezením na dosah se pod ni trubka nepoložila, takže síť pod městem
     * nikam nevedla: hra hlásila „chybí voda" na 578 vyznačených parcelách
     * z 933 a domy chátraly, přestože vodárna vyráběla naplno.
     *
     * Suť se přeskakuje. Pod hromadou se kopat nedá a hráč se na ni dobýval
     * padesát pět tisíckrát za partii — to je víc odmítnutých příkazů než
     * všech ostatních dohromady.
     */
    for (const tile of this.world.roadTiles) {
      if (budget <= 0) break;
      const x = tile % size;
      const y = (tile - x) / size;
      if ((this.world.layers.pipe[tile] ?? 0) !== 0) continue;
      if ((this.world.rubble[tile] ?? 0) !== 0) continue;
      budget--;
      this.send({ type: 'build_pipe', x, y });
    }

    for (let dy = -reach; dy <= reach && budget > 0; dy++) {
      for (let dx = -reach; dx <= reach && budget > 0; dx++) {
        const x = half + dx;
        const y = half + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const tile = index(x, y, size);
        if ((this.world.layers.zone[tile] ?? ZONE.none) === ZONE.none) continue;
        if ((this.world.layers.pipe[tile] ?? 0) !== 0) continue;
        if ((this.world.rubble[tile] ?? 0) !== 0) continue;
        budget--;
        this.send({ type: 'build_pipe', x, y });
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
    /*
     * Prstenec navíc, až když je **z čeho a pro koho**.
     *
     * Práh na kase je odvozený z ceny prstence, ne pevných dvacet tisíc.
     * S pevným prahem město na chudší mapě zamrzlo: seed 1 se v pátém roce
     * dostal na 92 obyvatel, kasa spadla pod dvacet tisíc a už se nad ně
     * nedostala, takže dvacet let stálo na místě, až se rozpadlo. Přitom
     * prstenec o šesti dlaždicích stojí kolem dvou a půl tisíce.
     *
     * Bilance musí být kladná **s rezervou**: nová čtvrť přidá údržbu dřív,
     * než z ní přijde první daň.
     */
    const ringTiles = 8 * (this.plan.reach + 3);
    const ringCost = ringTiles * (this.balance.traffic.roadTypes[0]?.cost ?? 50);
    if (!this.canSpend(ringCost)) return;
    if (this.world.economy.funds < ringCost * 4) return;
    if (this.world.economy.lastIncome <= this.world.economy.lastExpenses * 1.15) return;
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
    if (!this.canSpend(3000)) return;
    // Bez proudu a vody zóna nezaroste, jen se za ni zaplatí. Hráč, který
    // se dívá na rozbor parcely, to vidí taky.
    if (!this.hasUtilities()) return;
    /*
     * A **nevyznačuje se víc, než na co je proud.**
     *
     * Zóna sama skoro nic nestojí, takže se jich dřív vyznačilo sto šedesát
     * devět naráz. Domy vyrostly, spotřebovaly proud, který nebyl — a
     * nenapájený dům neplatí daň. Ve čtvrtém roce tak stálo 67 domů a jen 27
     * jich svítilo; město mělo třetinový příjem a platilo údržbu za všechny.
     */
    let produced = 0;
    let needed = 0;
    for (const building of this.world.buildings.values()) {
      const definition = this.content.get(building.definitionId);
      produced += definition?.power?.production ?? 0;
      needed += definition?.power?.consumption ?? 0;
    }
    if (produced < needed) return;
    const half = Math.round(this.world.size * CENTRE);
    const reach = this.plan.reach;
    const [r, c] = zoneWeights(this.strategy);

    // Bloky se lepí **na silnici**. Zóna uprostřed pole nezaroste — dům chce
    // sousedit s vozovkou — a jen by se za ni zaplatilo.
    const spots = this.besideRoad(reach);
    if (spots.length === 0) return;

    // Po **jedné dlaždici**. Blok 2×2 se skoro vždy otřel o vozovku a pravidlo
    // ho odmítlo, takže město nemělo kde růst.
    //
    // A vyznačuje se **jen to, po čem je poptávka**. Hráč se dívá na sloupečky
    // O/K/P a nedělá obchodní čtvrť do města o dvaceti lidech; hra to i tak
    // odmítne (`noDemand`) a parcela jen leží a stojí peníze. Ze čtyřiceti
    // šesti vyznačených dlaždic jich takhle dvacet čtyři leželo ladem.
    const demand = this.world.demand;
    const wanted: [ZoneType, number][] = [
      [ZONE.residential, demand.residential * r],
      [ZONE.commercial, demand.commercial * c],
      [ZONE.industrial, demand.industrial * (1 - r - c)],
    ];
    const live = wanted.filter(([, weight]) => weight > 0);
    if (live.length === 0) return;
    const sum = live.reduce((total, [, weight]) => total + weight, 0);

    for (const spot of spots.slice(0, 40)) {
      let roll = this.rng.next() * sum;
      let zone = live[0]?.[0] ?? ZONE.residential;
      for (const [candidate, weight] of live) {
        roll -= weight;
        if (roll <= 0) {
          zone = candidate;
          break;
        }
      }
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

        // **Obsazená místa se nenabízejí.** Město po padesáti letech přeroste
        // celý blízký břeh a hráč pak dokola zkouší postavit vodárnu tam, kde
        // stojí dům: 40 368 odmítnutí „obsazeno" za partii, a když vodárnu
        // sebrala katastrofa, nová už nevznikla. Město pak umřelo žízní
        // s třemi a půl miliony v kase.
        let free = true;
        for (let oy = 0; oy < d && free; oy++) {
          for (let ox = 0; ox < w && free; ox++) {
            const tile = index(x + ox, y + oy, this.world.size);
            free =
              (this.world.layers.buildingId[tile] ?? 0) === 0 &&
              (this.world.layers.road[tile] ?? ROAD.none) === ROAD.none &&
              (this.world.rubble[tile] ?? 0) === 0;
          }
        }
        if (!free) continue;

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
    return out.slice(0, 40);
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
        // Do lesa ani na skálu se nezónuje: pravidlo to odmítne a parcela
        // by ležela ladem s hláškou „tady tenhle povrch nedovolí".
        const terrain = this.world.layers.terrain[tile] ?? TERRAIN.grass;
        if (terrain !== TERRAIN.grass && terrain !== TERRAIN.sand) continue;
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
    if (!this.canSpend(0)) return;
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
      if (!this.canSpend(definition.construction.cost)) continue;
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
    // Měsíc, ne rok: elektrárny musí jít stavět rychleji, než roste město.
    // S roční brzdou se do sítě dostávalo 700 kW ročně, kdežto čtyřicet pět
    // domů chtělo přes tři tisíce — nenapájený dům neplatí daň a městu byl
    // příjem nula při dvou stech sedmdesáti obyvatelích.
    // Brzdí se **jen neúspěch**. Co se povedlo, smí se stavět hned zas: město
    // někdy potřebuje dvě elektrárny naráz a čekat s druhou měsíc znamená
    // blackout. Neúspěšný pokus má klid, aby se hráč nedobýval na totéž místo.
    const last = this.plan.tried.get(definition.id) ?? -TICKS_PER_YEAR;
    if (this.world.tick - last < 30) return false;
    this.plan.tried.set(definition.id, this.world.tick);

    const [w, d] = definition.footprint;
    const half = Math.round(this.world.size * CENTRE);
    const reach = Math.max(6, this.plan.reach);

    // Vodárna musí stát u vody. Hráč se podívá na mapu a jde k břehu; náhodné
    // klikání doprostřed města ji nepostaví nikdy — a bez vody město neroste.
    const shore = definition.construction.nearWater === true ? this.shoreSpots(40, w, d) : null;

    // U pobřežní stavby se zkouší jen pár nejbližších míst: ke každému se
    // táhne silnice a ta se platí po dlaždicích.
    const tries = shore ? Math.min(shore.length, 10) : 24;
    for (let attempt = 0; attempt < tries; attempt++) {
      const spot = shore ? shore[attempt] : null;
      if (shore && !spot) return false;
      const free = spot ?? this.rng.pick(this.besideRoad(reach));
      if (!free) return false;
      const [x, y] = free;
      /*
       * K vodárně se musí dostat silnice, jinak ji pravidlo odmítne — a musí
       * skončit **vedle** půdorysu, ne v něm.
       *
       * Do téhle chvíle mířila cesta na roh stavby a zastavila se o dlaždici
       * dřív, jenže ta dlaždice ležela uvnitř půdorysu 3×3. Vodárna se pak
       * nedala postavit vůbec: měřeno na deseti mapách, na šesti z nich
       * nevznikla ani jedna a bez vody se město nehnulo z místa.
       */
      if (spot) {
        const half = Math.round(this.world.size * CENTRE);
        const approach = y > half ? y - 1 : y + d;
        this.roadTo(x, approach);
      }
      if (x < 1 || y < 1 || x + w >= this.world.size || y + d >= this.world.size) continue;
      if (!this.freeAndNearRoad(x, y, w, d)) continue;

      if (this.send({ type: 'place_building', definitionId: definition.id, x, y })) {
        this.plan.tried.delete(definition.id);
        return true;
      }

      // Les, balvany, trosky: hráč je odveze buldozerem a zkusí to znovu.
      // Jen u prvních tří míst — jinak se za partii naklikalo přes milion
      // odmítnutých „tady není co bourat".
      if (attempt < 3) {
        for (let dy = 0; dy < d; dy++) {
          for (let dx = 0; dx < w; dx++) this.send({ type: 'bulldoze', x: x + dx, y: y + dy });
        }
      }
      if (this.send({ type: 'place_building', definitionId: definition.id, x, y })) {
        this.plan.tried.delete(definition.id);
        return true;
      }

      // Nerovná parcela: srovnat a zkusit znovu. Stojí to peníze jako hráče.
      if (!isFlatTile(this.world.cornerHeight, x, y)) {
        this.send({ type: 'level_area', x, y, w, h: d });
        if (this.send({ type: 'place_building', definitionId: definition.id, x, y })) {
          this.plan.tried.delete(definition.id);
          return true;
        }
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
    // **Včetně cílové dlaždice.** Dřív se poslední vynechávala, aby silnice
    // nevedla skrz stavbu — jenže volající pak dostal vozovku o dlaždici dál,
    // než potřeboval, a stavba se odmítla, protože u ní žádná nebyla. Cíl si
    // proto vybírá volající a je to dlaždice **vedle** půdorysu.
    // Kde silnice **už je**, se nestaví. Cesta k břehu se pokládá znovu při
    // každém pokusu a bez téhle podmínky si o ni hráč za partii naklikal
    // 125 410 odmítnutí „silnice už tady je" — dvě třetiny všech jeho příkazů.
    const paved = (x: number, y: number): boolean =>
      (this.world.layers.road[index(x, y, this.world.size)] ?? ROAD.none) !== ROAD.none;

    const stepX = tx >= half ? 1 : -1;
    for (let x = half; x !== tx + stepX; x += stepX) {
      if (this.isLand(x, half) && !paved(x, half)) {
        this.send({ type: 'build_road', x, y: half, roadType: ROAD.street });
      }
    }
    const stepY = ty >= half ? 1 : -1;
    for (let y = half; y !== ty + stepY; y += stepY) {
      if (this.isLand(tx, y) && !paved(tx, y)) {
        this.send({ type: 'build_road', x: tx, y, roadType: ROAD.street });
      }
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
