/**
 * Postaví velké ukázkové město Zdenalcity podle **současných pravidel**
 * a uloží ho jako save.
 *
 *   npx vite build --ssr tools/build-city.ts --outDir tools/.build --logLevel error
 *   node tools/.build/build-city.js
 *
 * Proměnné prostředí:
 *   CITY_TICKS=90000   kolik tiků se nechá město růst (asi dvě a půl minuty)
 *   CITY_PREVIEW=1     jen rozvrh (ASCII mapa), bez simulace a bez savu
 *   CITY_DUMP=soubor   po simulaci zapíše ASCII mapu stavu elektřiny
 *
 * Změřeno při 90 000 ticích (art/city/showcase.txt): 80 719 obyvatel,
 * 4 401 budov, RCI se proudem i vodou 100 %, opuštěných 0, úzkých hrdel 0.
 *
 * Proč přes `vite build --ssr`: skript sahá do `src/sim/` a potřebuje alias
 * `@`. Node sám TypeScript s aliasy nespustí a `vite-node` v projektu není.
 *
 * Sáhne to **jen na simulaci**, ne na renderer — takže tu neplatí P1 obráceně:
 * nástroj smí do simulace, simulace nesmí ven.
 *
 * Výstup: `art/city/showcase.city` (zip jako z hry, otevře se přes „Otevřít ze
 * souboru") a `showcase.b64` (tentýž save v base64 pro `__citybuilder.load`).
 * Na konci se save **načte zpátky skutečnou cestou hry** (`verifySave`,
 * `migrate`, `applySaveToWorld`) a porovná se, jestli sedí.
 *
 * ## Rozvrh
 *
 * Město se **nestaví náhodně**, ale po čtvrtích, jak by ho stavěl hráč:
 * obdélníky na mapě seedu 3407 vybrané podle terénu (souš, skála, jezera).
 * Každá čtvrť má svůj druh a rozteč ulic:
 *
 * - centrum mezi dvěma jezery: obchod a věže, nábřeží s parky,
 * - občanská čtvrť pod skalním „hradním vrchem": univerzita, divadlo, muzeum,
 *   nemocnice,
 * - panelová sídliště na severozápadě, severovýchodě, jihu, jihovýchodě
 *   a za jezerem na východě (hráz a mosty),
 * - předměstí na jihu (úzké bloky),
 * - průmysl na severu za vrchem a na jihovýchodě,
 * - elektrárny mimo město: uhlí, plyn a větrníky na severu, jádro na břehu
 *   jezera na západě (za dálnicí) a na východě.
 *
 * ## Elektřina podle T129–T137
 *
 * Silnice nevede nic, blok zón vede sám. Proto:
 * - **vysoké napětí** jde od elektráren k rozvodnám. Rozvodny stojí po
 *   dvojicích (2 × 100 000 = přesně jedna linka 200 000) a každá dvojice má
 *   vlastní linku ke svému areálu; areály spojují příčky;
 * - **nízké napětí** přemosťuje ulice: vedení přes vozovku mezi dvěma bloky
 *   ob dlaždici. Souběžné přípojky se sčítají (maximální tok);
 * - výroba se hlídá **po areálech**, ne celoměstsky, a za běhu se přistavuje.
 * Voda: potrubí pod každou silnicí na souši (blok vede vodu sám, potrubí jen
 * spojuje bloky), vodárny na břehu každé souše, kam město sahá.
 *
 * Za běhu dělá nástroj to, co by dělal hráč: přistavuje elektrárny,
 * čistírny, spalovny a vodárny, přidává vozy MHD (jízdné nula) a ulice,
 * na které se nevejdou auta, rozšíří na třídy. Daně 5 %, kasa se dorovnává.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Balance } from '@/content/balance';
import { applySaveToWorld } from '@/save/deserialize';
import { migrate } from '@/save/migrations';
import { unpackSave } from '@/save/deserialize';
import { serializeSave } from '@/save/serialize';
import { verifySave } from '@/save/verify';
import {
  addTransitStop,
  buildPipe,
  buildRoad,
  buildWire,
  bulldoze,
  demolishRuins,
  placeDefinition,
  plantTrees,
  setLineFare,
  setLineVehicles,
  setTaxRate,
  zoneArea,
} from '@/sim/commands';
import { coarseIndex } from '@/sim/coarse';
import { cityUtilities, coarseCongestion } from '@/sim/diagnostics';
import { averageHappiness } from '@/sim/systems/happiness';
import { index, ROAD, TERRAIN, WIRE, ZONE } from '@/sim/layers';
import type { ZoneType } from '@/sim/layers';
import { applyGeneratedMap, balanceWithMap, generateTerrain } from '@/sim/mapgen';
import { createDefaultSystems } from '@/sim/systems';
import { createLine } from '@/sim/transit';
import { createWorld, rebuildTileIndex, tickWorld, totalJobs, totalPopulation } from '@/sim/world';
import type { WorldState } from '@/sim/world';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Hrana mapy: 256 je velké město, 512 by se simulovalo hodiny. */
const SIZE = 256;

/**
 * Seed mapy. Souš mezi dvěma jezery, uprostřed skalní vrch, na severu řeka
 * a za jezerem písečná kosa, po které vede hráz na východ.
 */
const SEED = 3407;

/**
 * Krajina jako z dialogu nové hry: výchozí podíl vody, kopce do šesti pater.
 * Na deseti patrech (výchozí) je zastavitelná rovina o čtvrtinu menší
 * a sídliště by stála na podezdívkách.
 */
const MAP_CHOICE = { seaLevel: 0.28, maxHeight: 6 };

const TICKS = Number(process.env.CITY_TICKS ?? 90_000);
const PREVIEW = process.env.CITY_PREVIEW === '1';

/** Peníze. Ukázkové město se nemá zaseknout na rozpočtu, dorovnávají se. */
const FUNDS = 80_000_000;

type Kind = 'core' | 'civic' | 'estate' | 'suburb' | 'industry' | 'utility' | 'park';

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface District extends Rect {
  name: string;
  kind: Kind;
  /** Rozteč ulic. Nula = ulice se tu nekladou (jen třídy). */
  pitchX: number;
  pitchY: number;
  /** Kolik dvojic rozvoden (2 × 100 000) čtvrť dostane. */
  pairs?: number;
  /** Ze kterého areálu energetiky vedou linky k jejím rozvodnám. */
  park?: string;
}

/**
 * Čtvrti. Souřadnice jsou dlaždice (x doprava, y dolů), obdélníky včetně
 * okrajů. Pořadí rozhoduje, když se překrývají: první vyhrává.
 */
const DISTRICTS: District[] = [
  // Hradní vrch: skála uprostřed města, zůstane jako je, kolem parky.
  { name: 'vrch', kind: 'park', x0: 121, y0: 46, x1: 135, y1: 74, pitchX: 0, pitchY: 0 },
  // Centrum mezi západním jezerem a jezerem L2.
  { name: 'centrum', kind: 'core', x0: 100, y0: 75, x1: 160, y1: 101, pitchX: 7, pitchY: 7, pairs: 4, park: 'zapad' },
  // Občanská čtvrť po obou stranách vrchu.
  { name: 'obcanska-zapad', kind: 'civic', x0: 98, y0: 60, x1: 120, y1: 74, pitchX: 7, pitchY: 7 },
  { name: 'obcanska-vychod', kind: 'civic', x0: 136, y0: 46, x1: 160, y1: 74, pitchX: 7, pitchY: 7 },
  // Panelové sídliště na severozápadě.
  { name: 'sidliste-sever', kind: 'estate', x0: 46, y0: 36, x1: 120, y1: 59, pitchX: 7, pitchY: 7, pairs: 3, park: 'zapad' },
  // Průmysl za vrchem na severu, přes říčku od sídliště.
  { name: 'prumysl-sever', kind: 'industry', x0: 123, y0: 12, x1: 160, y1: 45, pitchX: 7, pitchY: 7, pairs: 1, park: 'sever' },
  // Sídliště na severním břehu jezera, za dálnicí.
  { name: 'sidliste-severovychod', kind: 'estate', x0: 166, y0: 22, x1: 200, y1: 45, pitchX: 7, pitchY: 7, pairs: 2, park: 'sever' },
  // Sídliště na jihovýchodě mezi lesem a jezerem.
  { name: 'sidliste-jihovychod', kind: 'estate', x0: 149, y0: 126, x1: 176, y1: 152, pitchX: 7, pitchY: 7, pairs: 1, park: 'vychod' },
  // Sídliště jih, mezi západním jezerem a lesem.
  { name: 'sidliste-jih', kind: 'estate', x0: 112, y0: 102, x1: 146, y1: 122, pitchX: 7, pitchY: 7, pairs: 2, park: 'zapad' },
  // Zahradní předměstí na jihu: úzké bloky, malé domy.
  { name: 'predmesti', kind: 'suburb', x0: 84, y0: 123, x1: 148, y1: 150, pitchX: 14, pitchY: 5, pairs: 3, park: 'zapad' },
  // Za jezerem na východě: druhé sídliště, sem vede hráz.
  { name: 'sidliste-vychod', kind: 'estate', x0: 186, y0: 66, x1: 222, y1: 100, pitchX: 7, pitchY: 7, pairs: 2, park: 'vychod' },
  // Jihovýchod: lehký průmysl a sklady u jezera.
  { name: 'prumysl-jih', kind: 'industry', x0: 172, y0: 101, x1: 208, y1: 136, pitchX: 7, pitchY: 7, pairs: 1, park: 'vychod' },
  // Energetika a skládky: uhlí a plyn na severu, jádro u vody na západě
  // a na východě. Bez uliční sítě: mřížka prázdných cest přes louku vypadala
  // jako rozparcelované pole; ke každé stavbě se dotáhne přístupová cesta.
  { name: 'energetika-sever', kind: 'utility', x0: 146, y0: 2, x1: 200, y1: 21, pitchX: 0, pitchY: 0 },
  { name: 'energetika-zapad', kind: 'utility', x0: 8, y0: 96, x1: 58, y1: 156, pitchX: 0, pitchY: 0 },
  { name: 'energetika-vychod', kind: 'utility', x0: 224, y0: 100, x1: 254, y1: 140, pitchX: 0, pitchY: 0 },
];

/** Rozteč tříd (a mřížka, ke které se ulice zarovnávají). */
const AVENUE = 28;
/** Počátek mřížky: třída `x = 136` a `y = 80` jde středem centra. */
const OX = 136;
const OY = 80;

/** Nejdelší most, který se smí postavit na třídě. */
const MAX_BRIDGE = 40;

/**
 * Silnice mimo mřížku: hráz, dálnice, spojky. `[typ, x0, y0, x1, y1]`,
 * vždy vodorovně nebo svisle. Mosty se staví, kde vede přes vodu.
 */
const CONNECTORS: [number, number, number, number, number][] = [
  // Hráz po písečné kose z centra na východ.
  [ROAD.avenue, 157, 66, 192, 66],
  // Dálnice: severní obchvat od elektráren a průmyslu k sídlišti.
  [ROAD.highway, 58, 31, 200, 31],
  // Dálnice z centra na jih k průmyslu.
  [ROAD.highway, 164, 31, 164, 66],
  [ROAD.highway, 161, 101, 208, 101],
  [ROAD.highway, 161, 66, 161, 101],
  // Dálnice na západ k elektrárnám za jezerem.
  [ROAD.highway, 12, 136, 86, 136],
];

// --------------------------------------------------------------------------

function rng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

function districtAt(x: number, y: number): District | undefined {
  return DISTRICTS.find((d) => inRect(d, x, y));
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

class Builder {
  readonly world: WorldState;
  readonly content: ContentRegistry;
  readonly balance: Balance;
  readonly size: number;
  /** Dlaždice vyhrazené pro vedení vysokého napětí — nezónují se. */
  readonly reserved: Uint8Array;
  /** Nábřeží: pruh u vody v obytných čtvrtích, místo zón parky. */
  readonly shore: Uint8Array;
  readonly random = rng(SEED);
  readonly log: string[] = [];

  constructor(world: WorldState, content: ContentRegistry, balance: Balance) {
    this.world = world;
    this.content = content;
    this.balance = balance;
    this.size = world.size;
    this.reserved = new Uint8Array(this.size * this.size);
    this.shore = new Uint8Array(this.size * this.size);
  }

  t(x: number, y: number): number {
    return index(x, y, this.size);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  terrain(x: number, y: number): number {
    if (!this.inside(x, y)) return TERRAIN.water;
    return this.world.layers.terrain[this.t(x, y)] ?? TERRAIN.water;
  }

  water(x: number, y: number): boolean {
    return this.terrain(x, y) === TERRAIN.water;
  }

  road(x: number, y: number): number {
    if (!this.inside(x, y)) return ROAD.none;
    return this.world.layers.road[this.t(x, y)] ?? ROAD.none;
  }

  building(x: number, y: number): number {
    if (!this.inside(x, y)) return 0;
    return this.world.layers.buildingId[this.t(x, y)] ?? 0;
  }

  // ---------------------------------------------------------------- silnice

  /**
   * Položí úsek silnice po přímce. Přes vodu staví most, jen když `bridge`
   * a voda po přímce končí souší do `MAX_BRIDGE` dlaždic — jinak se úsek
   * nad vodou přeskočí.
   */
  lay(type: number, x0: number, y0: number, x1: number, y1: number, bridge: boolean, only?: (x: number, y: number) => boolean): number {
    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    const length = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    let laid = 0;
    for (let step = 0; step <= length; step++) {
      const x = x0 + dx * step;
      const y = y0 + dy * step;
      if (!this.inside(x, y) || x < 1 || y < 1 || x > this.size - 2 || y > this.size - 2) continue;
      if (only && !only(x, y)) continue;
      if (this.water(x, y)) {
        if (!bridge) continue;
        // Kolik vody je před námi a jestli za ní je souš.
        let run = 0;
        while (run <= MAX_BRIDGE && step + run <= length && this.water(x + dx * run, y + dy * run)) run++;
        const landAhead = step + run <= length && run <= MAX_BRIDGE;
        const fromBank = this.road(x - dx, y - dy) !== ROAD.none;
        if (!landAhead || !fromBank) {
          step += run - 1;
          continue;
        }
        for (let k = 0; k < run; k++) {
          const bx = x + dx * k;
          const by = y + dy * k;
          if (this.road(bx, by) >= type) continue;
          if (buildRoad(this.world, bx, by, type, this.balance).ok) laid++;
        }
        step += run - 1;
        continue;
      }
      if (this.road(x, y) >= type) continue;
      if (this.building(x, y) !== 0) continue;
      if (buildRoad(this.world, x, y, type, this.balance).ok) laid++;
    }
    return laid;
  }

  /** Třídy po mřížce a ulice po čtvrtích. */
  layNetwork(): void {
    let avenues = 0;
    let streets = 0;
    const roadsHere = (d: District | undefined): boolean => d !== undefined && d.kind !== 'park' && d.kind !== 'utility';

    // Ulice napřed, třídy přes ně: třída přestaví ulici na místě (vylepšení
    // na místě jde, snížení ne).
    for (const d of DISTRICTS) {
      if (d.pitchX === 0) continue;
      const only = (x: number, y: number): boolean => districtAt(x, y) === d;
      // Ulice těsně vedle třídy (dvě souběžné vozovky) se vynechá: mezi nimi
      // by nezbyla parcela a přes dvojitou vozovku nevede ani přípojka.
      const nearAvenue = (offset: number): boolean => {
        const m = mod(offset, AVENUE);
        return m !== 0 && (m <= 2 || m >= AVENUE - 2);
      };
      for (let x = d.x0; x <= d.x1; x++) {
        if (mod(x - OX, d.pitchX) !== 0 || nearAvenue(x - OX)) continue;
        streets += this.lay(this.streetType(d, x - OX), x, d.y0, x, d.y1, false, only);
      }
      for (let y = d.y0; y <= d.y1; y++) {
        if (mod(y - OY, d.pitchY) !== 0 || nearAvenue(y - OY)) continue;
        streets += this.lay(this.streetType(d, y - OY), d.x0, y, d.x1, y, false, only);
      }
    }

    // Třídy: přímky mřížky přes všechny čtvrti s ulicemi. Mezi dvěma
    // čtvrtěmi na jedné přímce se staví i přes vodu (most).
    const avenueOk = (x: number, y: number): boolean => roadsHere(districtAt(x, y)) || this.water(x, y);
    for (let x = mod(OX, AVENUE); x < this.size; x += AVENUE) {
      avenues += this.layAvenueLine(x, true, avenueOk);
    }
    for (let y = mod(OY, AVENUE); y < this.size; y += AVENUE) {
      avenues += this.layAvenueLine(y, false, avenueOk);
    }

    let connectors = 0;
    for (const [type, x0, y0, x1, y1] of CONNECTORS) connectors += this.lay(type, x0, y0, x1, y1, true);
    this.log.push(`silnice: ulic ${streets}, tříd ${avenues}, spojek a dálnic ${connectors}`);
  }

  /**
   * Jakou silnici dostane ulice čtvrti. Centrum má samé třídy a sídliště
   * i průmysl třídu ob jednu ulici: na ulici (kapacita 60) se z hustého
   * sídliště nikdo nevejde a kolony srážejí cenu půdy i spokojenost.
   */
  streetType(d: District, offset: number): number {
    if (d.kind === 'core') return ROAD.avenue;
    if ((d.kind === 'estate' || d.kind === 'industry') && mod(offset, 14) === 0) return ROAD.avenue;
    return ROAD.street;
  }

  /**
   * Jedna přímka tříd: staví se v úsecích, kde je čtvrť s ulicemi nebo voda
   * mezi nimi; úsek musí začínat i končit ve čtvrti.
   */
  layAvenueLine(at: number, vertical: boolean, ok: (x: number, y: number) => boolean): number {
    let laid = 0;
    let start = -1;
    const flush = (end: number): void => {
      if (start < 0) return;
      // Ořízni vodu na koncích: most do prázdna nikdo nestaví.
      let a = start;
      let b = end;
      const xy = (k: number): [number, number] => (vertical ? [at, k] : [k, at]);
      while (a <= b && (this.water(...xy(a)) || !districtAt(...xy(a)))) a++;
      while (b >= a && (this.water(...xy(b)) || !districtAt(...xy(b)))) b--;
      if (a < b) {
        const [x0, y0] = xy(a);
        const [x1, y1] = xy(b);
        laid += this.lay(ROAD.avenue, x0, y0, x1, y1, true);
      }
      start = -1;
    };
    for (let k = 0; k < this.size; k++) {
      const [x, y] = vertical ? [at, k] : [k, at];
      if (ok(x, y)) {
        if (start < 0) start = k;
      } else flush(k - 1);
    }
    flush(this.size - 1);
    return laid;
  }

  // ---------------------------------------------------------------- stavby

  /** Zkusí postavit definici na první vhodné místo ze seznamu kandidátů. */
  placeAt(id: string, candidates: Iterable<[number, number]>, accept?: (x: number, y: number) => boolean): { x: number; y: number; id: number } | null {
    const definition = this.content.get(id);
    if (!definition) throw new Error(`neznámá definice ${id}`);
    const [w, h] = definition.footprint;
    for (const [x, y] of candidates) {
      if (x < 1 || y < 1 || x + w > this.size - 1 || y + h > this.size - 1) continue;
      if (accept && !accept(x, y)) continue;
      let clear = true;
      for (let dy = 0; dy < h && clear; dy++) {
        for (let dx = 0; dx < w && clear; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          if (this.water(tx, ty) || this.road(tx, ty) !== ROAD.none || this.building(tx, ty) !== 0) clear = false;
          else if (this.reserved[this.t(tx, ty)] === 1) clear = false;
          else {
            const terrain = this.terrain(tx, ty);
            if (!definition.construction.allowedTerrain.includes(terrain)) {
              // Les, skála a mokřad se pod stavbou vyklidí (buldozer).
              if (terrain === TERRAIN.forest || terrain === TERRAIN.rock || terrain === TERRAIN.marsh) continue;
              clear = false;
            }
          }
        }
      }
      if (!clear) continue;
      // Vyklidit terén až ve chvíli, kdy je místo jinak volné.
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const terrain = this.terrain(x + dx, y + dy);
          if (!definition.construction.allowedTerrain.includes(terrain)) bulldoze(this.world, x + dx, y + dy, this.balance);
        }
      }
      const before = this.world.nextBuildingId;
      const result = placeDefinition(this.world, this.content, id, x, y, this.balance);
      if (result.ok) return { x, y, id: before };
    }
    return null;
  }

  /** Kandidáti seřazení podle vzdálenosti od bodu, v daném obdélníku. */
  *around(cx: number, cy: number, radius: number, within?: Rect): Generator<[number, number]> {
    const out: [number, number, number][] = [];
    for (let y = Math.round(cy - radius); y <= cy + radius; y++) {
      for (let x = Math.round(cx - radius); x <= cx + radius; x++) {
        if (within && !inRect(within, x, y)) continue;
        out.push([x, y, (x - cx) ** 2 + (y - cy) ** 2]);
      }
    }
    out.sort((a, b) => a[2] - b[2]);
    for (const [x, y] of out) yield [x, y];
  }

  /** Náhodně promíchaní kandidáti v obdélníku. */
  *shuffled(r: Rect): Generator<[number, number]> {
    const out: [number, number][] = [];
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) out.push([x, y]);
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    yield* out;
  }

  /** Postaví `count` kusů v obdélníku s odstupem `keep` od sebe navzájem. */
  spread(id: string, count: number, keep: number, r: Rect): { x: number; y: number; id: number }[] {
    const done: { x: number; y: number; id: number }[] = [];
    const far = (x: number, y: number): boolean => done.every((p) => Math.hypot(p.x - x, p.y - y) >= keep);
    for (let n = 0; n < count; n++) {
      const placed = this.placeAt(id, this.shuffled(r), far);
      if (!placed) break;
      done.push(placed);
    }
    this.log.push(`  ${id} v ${rectName(r)}: ${done.length}/${count}`);
    return done;
  }

  /**
   * Stavba na okraji města, i tam, kam zatím silnice nevede: najde místo co
   * nejblíž kotvě (mimo obytné čtvrti) a dotáhne k němu přístupovou cestu.
   * Pro čistírny, spalovny a elektrárny — chtějí břeh a nechtějí sousedy.
   * Čistíren potřebuje velké město přes dvacet, do čtvrtí by se nevešly.
   */
  outskirts(id: string, count: number, anchor: { x: number; y: number }, keep: number, radius = 45, buffer = 3): { x: number; y: number; id: number }[] {
    const definition = this.content.get(id);
    if (!definition) throw new Error(`neznámá definice ${id}`);
    const [w, h] = definition.footprint;
    const shore = definition.construction.nearWater === true;
    const done: { x: number; y: number; id: number }[] = [];
    const others = this.existing((d) => d === id);
    for (const [x, y] of this.around(anchor.x, anchor.y, radius)) {
      if (done.length >= count) break;
      if (x < 2 || y < 2 || x + w > this.size - 2 || y + h > this.size - 2) continue;
      if ([...others, ...done].some((o) => Math.hypot(o.x - x, o.y - y) < keep)) continue;
      if (!this.freeRect(x, y, w, h, buffer)) continue;
      if (shore && !this.rectTouches(x, y, w, h, (tx, ty) => this.water(tx, ty))) continue;
      const laid: number[] = [];
      if (!this.rectTouches(x, y, w, h, (tx, ty) => this.road(tx, ty) !== ROAD.none)) {
        const path = this.accessPath(x, y, w, h, 30);
        if (!path) continue;
        for (const tile of path) {
          const tx = tile % this.size;
          const ty = (tile - tx) / this.size;
          if (buildRoad(this.world, tx, ty, ROAD.street, this.balance).ok) laid.push(tile);
        }
      }
      const placed = this.placeAt(id, [[x, y]]);
      if (!placed) {
        for (const tile of laid) {
          const tx = tile % this.size;
          bulldoze(this.world, tx, (tile - tx) / this.size, this.balance);
        }
        continue;
      }
      // Cesta postavená za běhu potřebuje potrubí hned, jinak by budova
      // za ní zůstala suchá.
      for (const tile of laid) {
        const tx = tile % this.size;
        buildPipe(this.world, tx, (tile - tx) / this.size, this.balance);
      }
      done.push(placed);
    }
    this.log.push(`  ${id} u ${anchor.x},${anchor.y}: ${done.length}/${count}`);
    return done;
  }

  /** Obdélník na souši, volný, mimo obytné čtvrti a vyhrazené vedení. */
  freeRect(x: number, y: number, w: number, h: number, buffer = 0): boolean {
    // Odstup od obytných čtvrtí: elektrárna ani čistírna nemá stát lidem
    // pod okny (první pokus postavil jadernou elektrárnu vedle univerzity).
    if (buffer > 0) {
      for (const d of DISTRICTS) {
        if (d.kind === 'utility' || d.kind === 'industry') continue;
        if (x + w - 1 >= d.x0 - buffer && x <= d.x1 + buffer && y + h - 1 >= d.y0 - buffer && y <= d.y1 + buffer) return false;
      }
    }
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        const tile = this.t(tx, ty);
        if (this.water(tx, ty) || this.road(tx, ty) !== ROAD.none || this.building(tx, ty) !== 0) return false;
        if (this.reserved[tile] === 1 || (this.world.layers.zone[tile] ?? 0) !== 0) return false;
        const d = districtAt(tx, ty);
        if (d && d.kind !== 'utility' && d.kind !== 'industry') return false;
      }
    }
    return true;
  }

  rectTouches(x: number, y: number, w: number, h: number, test: (x: number, y: number) => boolean): boolean {
    for (let dx = -1; dx <= w; dx++) {
      if (test(x + dx, y - 1) || test(x + dx, y + h)) return true;
    }
    for (let dy = 0; dy < h; dy++) {
      if (test(x - 1, y + dy) || test(x + w, y + dy)) return true;
    }
    return false;
  }

  /** Nejkratší přístupová cesta od obdélníku k silnici přes volnou souš. */
  accessPath(x: number, y: number, w: number, h: number, limit: number): number[] | null {
    const prev = new Map<number, number>();
    let frontier: number[] = [];
    const inside = (tx: number, ty: number): boolean => tx >= x && tx < x + w && ty >= y && ty < y + h;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const tile = this.t(x + dx, y + dy);
      prev.set(tile, -1);
      frontier.push(tile);
    }
    for (let step = 0; step <= limit && frontier.length > 0; step++) {
      const next: number[] = [];
      for (const tile of frontier) {
        const tx = tile % this.size;
        const ty = (tile - tx) / this.size;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx < 2 || ny < 2 || nx >= this.size - 2 || ny >= this.size - 2) continue;
          const n = this.t(nx, ny);
          if (prev.has(n)) continue;
          if (this.road(nx, ny) !== ROAD.none && !inside(tx, ty)) {
            const path: number[] = [];
            for (let v = tile; v >= 0 && !inside(v % this.size, (v - (v % this.size)) / this.size); v = prev.get(v) ?? -1) path.push(v);
            return path;
          }
          if (this.water(nx, ny) || this.building(nx, ny) !== 0 || this.reserved[n] === 1) continue;
          if ((this.world.layers.zone[n] ?? 0) !== 0 || districtAt(nx, ny)?.kind === 'park') continue;
          prev.set(n, tile);
          next.push(n);
        }
      }
      frontier = next;
    }
    return null;
  }

  /** Budovy dané definice (nebo třídy služby), co už stojí. */
  existing(match: (definitionId: string) => boolean): { x: number; y: number; id: number }[] {
    const out: { x: number; y: number; id: number }[] = [];
    for (const b of this.world.buildings.values()) if (match(b.definitionId)) out.push({ x: b.x, y: b.y, id: b.id });
    return out;
  }

  /**
   * Pokrytí službou po mřížce: kde v okruhu `near` nic té třídy nestojí,
   * postaví se `id` co nejblíž bodu mřížky.
   */
  cover(id: string, serviceClass: string, spacing: number, near: number, kinds: Kind[]): number {
    let placed = 0;
    // Odstup se drží od **téže budovy**, ne od celé třídy: gymnázium má stát,
    // i když je vedle základní škola.
    const same = (definitionId: string): boolean => definitionId === id;
    void serviceClass;
    for (let y = Math.floor(spacing / 2); y < this.size; y += spacing) {
      for (let x = Math.floor(spacing / 2); x < this.size; x += spacing) {
        const d = districtAt(x, y);
        if (!d || !kinds.includes(d.kind)) continue;
        if (this.water(x, y)) continue;
        const others = this.existing(same);
        if (others.some((o) => Math.hypot(o.x - x, o.y - y) < near)) continue;
        const result = this.placeAt(id, this.around(x, y, spacing / 2), (px, py) => {
          const pd = districtAt(px, py);
          return pd !== undefined && kinds.includes(pd.kind) && this.shore[this.t(px, py)] === 0;
        });
        if (result) placed++;
      }
    }
    this.log.push(`  ${id}: ${placed} (po ${spacing})`);
    return placed;
  }

  // -------------------------------------------------------------- terén

  /** Nábřeží: dlaždice do dvou od vody v centru a sídlištích. */
  markShore(): void {
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        if (this.water(x, y)) continue;
        const d = districtAt(x, y);
        if (!d || (d.kind !== 'core' && d.kind !== 'civic' && d.kind !== 'estate')) continue;
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) if (this.water(x + dx, y + dy)) near = true;
        if (near) this.shore[this.t(x, y)] = 1;
      }
    }
  }

  // ------------------------------------------------------------- zóny

  /** Nejbližší silnice v přímém směru do `reach` dlaždic: její typ. */
  nearestRoadType(x: number, y: number, reach: number): number {
    let best: number = ROAD.none;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (let k = 1; k <= reach; k++) {
        const type = this.road(x + dx * k, y + dy * k);
        if (type !== ROAD.none) {
          if (type > best) best = type;
          break;
        }
      }
    }
    return best;
  }

  zoneFor(d: District, x: number, y: number): ZoneType | null {
    const onAvenue = this.nearestRoadType(x, y, 2) >= ROAD.avenue;
    switch (d.kind) {
      case 'core': {
        // Centrum je šachovnice obchodu a obytných věží: kanceláře, obchody
        // a mezi nimi bydlení, ať večer není mrtvé.
        const bx = Math.floor((x - OX) / 7);
        const by = Math.floor((y - OY) / 7);
        return mod(bx + by, 2) === 0 ? ZONE.residential : ZONE.commercial;
      }
      case 'estate':
        // Obchody v přízemí podél tříd (jedna řada), za nimi paneláky.
        return this.nearestRoadType(x, y, 1) >= ROAD.avenue ? ZONE.commercial : ZONE.residential;
      case 'suburb':
        return onAvenue && this.nearestRoadType(x, y, 1) >= ROAD.avenue && mod(x, 9) < 3 ? ZONE.commercial : ZONE.residential;
      case 'industry':
        return ZONE.industrial;
      default:
        return null;
    }
  }

  zoneAll(): void {
    const counts = [0, 0, 0, 0];
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        const tile = this.t(x, y);
        if (this.water(x, y) || this.road(x, y) !== ROAD.none || this.building(x, y) !== 0) continue;
        if (this.reserved[tile] === 1 || this.shore[tile] === 1) continue;
        const d = districtAt(x, y);
        if (!d) continue;
        const zone = this.zoneFor(d, x, y);
        if (zone === null) continue;
        // Jen do dosahu růstu (tři dlaždice od silnice). Dál by zóna stejně
        // nevyrostla a na konci by se musela uklízet.
        if (this.nearestRoadType(x, y, 3) === ROAD.none) continue;
        const terrain = this.terrain(x, y);
        if (terrain === TERRAIN.forest || terrain === TERRAIN.rock || terrain === TERRAIN.marsh) {
          bulldoze(this.world, x, y, this.balance);
        }
        if (zoneArea(this.world, x, y, 1, 1, zone, this.balance).ok) counts[zone]!++;
      }
    }
    this.log.push(`zóny: obytné ${counts[1]}, obchod ${counts[2]}, průmysl ${counts[3]}`);
  }

  // --------------------------------------------------------- elektřina

  /**
   * Cesta vedení vysokého napětí (Dijkstra). Míří na kteroukoli dlaždici
   * z `targets`. Vyhýbá se blokům a budovám, ráda jde po volné zemi.
   */
  routeHigh(from: Set<number>, targets: Set<number>): number[] | null {
    const n = this.size * this.size;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap = new MinHeap();
    for (const s of from) {
      dist[s] = 0;
      heap.push(s, 0);
    }
    const wire = this.world.layers.wire;
    while (heap.size > 0) {
      const [u, du] = heap.pop();
      if (du > dist[u]!) continue;
      if (targets.has(u) && !from.has(u)) {
        const path: number[] = [];
        for (let v = prev[u]!; v >= 0 && !from.has(v); v = prev[v]!) path.push(v);
        return path.reverse();
      }
      const ux = u % this.size;
      const uy = (u - ux) / this.size;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = ux + dx;
        const y = uy + dy;
        if (x < 1 || y < 1 || x >= this.size - 1 || y >= this.size - 1) continue;
        const v = this.t(x, y);
        let cost: number;
        if (targets.has(v)) cost = 1;
        else if (this.building(x, y) !== 0) continue;
        else if ((wire[v] ?? 0) !== WIRE.none) cost = 6;
        else if (this.water(x, y)) cost = 2;
        else if (this.road(x, y) !== ROAD.none) cost = 25; // Ne podél ulic: dlaždice silnice s vysokým napětím nepustí přípojku nízkého.
        else if (districtAt(x, y)?.kind === 'utility' || !districtAt(x, y)) cost = 1;
        else if (districtAt(x, y)?.kind === 'park') cost = 2;
        else cost = 14;
        const alt = du + cost;
        if (alt < dist[v]!) {
          dist[v] = alt;
          prev[v] = u;
          heap.push(v, alt);
        }
      }
    }
    return null;
  }

  footprint(id: number): number[] {
    const b = this.world.buildings.get(id);
    if (!b) return [];
    const d = this.content.get(b.definitionId);
    const [w, h] = d?.footprint ?? [1, 1];
    const out: number[] = [];
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push(this.t(b.x + dx, b.y + dy));
    return out;
  }

  /** Položí vysoké napětí po cestě a vyhradí ji před zónováním. */
  layHigh(path: number[]): void {
    for (const tile of path) {
      const x = tile % this.size;
      const y = (tile - x) / this.size;
      if ((this.world.layers.wire[tile] ?? 0) === WIRE.high) continue;
      buildWire(this.world, x, y, WIRE.high, this.balance);
      this.reserved[tile] = 1;
    }
  }

  /**
   * Nízké napětí přes ulice: dlaždice silnice, která má po obou stranách
   * napříč parcelu (zónu nebo budovu), dostane vedení. Hustě, aby se
   * souběžné přípojky sčítaly a blok neměl jedinou.
   */
  layLowCrossings(): number {
    const { zone, road, buildingId, wire } = this.world.layers;
    const parcel = (x: number, y: number): boolean => {
      if (!this.inside(x, y)) return false;
      const t = this.t(x, y);
      return (road[t] ?? 0) === 0 && !this.water(x, y) && ((zone[t] ?? 0) !== 0 || (buildingId[t] ?? 0) !== 0);
    };
    let laid = 0;
    // Přes vozovku napříč: od parcely přes nejvýš tři dlaždice silnice
    // (dvojitá vozovka, dálnice u ulice) k parcele. Ob dlaždici podél silnice.
    for (const [dx, dy] of [[0, 1], [1, 0]] as const) {
      for (let y = 1; y < this.size - 1; y++) {
        for (let x = 1; x < this.size - 1; x++) {
          if (!parcel(x, y) || this.road(x + dx, y + dy) === ROAD.none) continue;
          // Rozestup podél silnice: silnice napříč dy=1 běží podél x.
          if (mod(dy === 1 ? x : y, 2) !== 0) continue;
          let k = 1;
          while (k <= 3 && this.road(x + dx * k, y + dy * k) !== ROAD.none && !this.water(x + dx * k, y + dy * k)) k++;
          if (k > 3 || !parcel(x + dx * k, y + dy * k)) continue;
          // Napříč, ne podél: dlaždice silnice musí mít silnici do stran
          // (jinak by to byla ulice, která do bloku vede kolmo).
          let across = true;
          for (let j = 1; j < k && across; j++) {
            const sx = x + dx * j;
            const sy = y + dy * j;
            const along = this.road(sx + dy, sy + dx) !== ROAD.none || this.road(sx - dy, sy - dx) !== ROAD.none;
            const t = this.t(sx, sy);
            if (!along || (wire[t] ?? 0) !== 0) across = false;
          }
          if (!across) continue;
          for (let j = 1; j < k; j++) {
            if (buildWire(this.world, x + dx * j, y + dy * j, WIRE.low, this.balance).ok) laid++;
          }
        }
      }
    }
    return laid;
  }

  // ---------------------------------------------------------------- ASCII

  /**
   * Stav elektřiny: P svítí, d tma v připojené (hladové) oblasti, D tma bez
   * připojení, X plný úsek vedení (úzké hrdlo), l/L vedení, = + silnice.
   */
  asciiPower(r: Rect): string {
    const lines: string[] = [];
    const { wire } = this.world.layers;
    for (let y = r.y0; y <= r.y1; y++) {
      let line = `${String(y).padStart(3)} `;
      for (let x = r.x0; x <= r.x1; x++) {
        const t = this.t(x, y);
        let c = this.water(x, y) ? '~' : '.';
        const id = this.building(x, y);
        if (this.world.wireOverloaded[t] === 1) c = 'X';
        else if (id !== 0) {
          const b = this.world.buildings.get(id)!;
          const def = this.content.get(b.definitionId);
          const consumes = (def?.power?.consumption ?? 0) > 0;
          if (def?.power?.transformer) c = 'S';
          else if (def?.power?.production) c = 'E';
          else if (!consumes) c = 'o';
          else if (b.powered) c = 'P';
          else c = this.world.powerStarved[t] === 1 ? 'd' : 'D';
        } else if ((wire[t] ?? 0) === WIRE.high) c = 'L';
        else if ((wire[t] ?? 0) === WIRE.low) c = 'l';
        else if (this.road(x, y) !== ROAD.none) c = '+';
        else if ((this.world.layers.zone[t] ?? 0) !== 0) c = this.world.powerStarved[t] === 1 ? 's' : (this.world.layers.power[t] ? 'z' : 'n');
        line += c;
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  ascii(r: Rect): string {
    const lines: string[] = [];
    const { zone, wire } = this.world.layers;
    for (let y = r.y0; y <= r.y1; y++) {
      let line = `${String(y).padStart(3)} `;
      for (let x = r.x0; x <= r.x1; x++) {
        const t = this.t(x, y);
        let c = '.';
        const terrain = this.terrain(x, y);
        if (terrain === TERRAIN.water) c = '~';
        else if (terrain === TERRAIN.rock) c = '^';
        else if (terrain === TERRAIN.forest) c = 'T';
        const id = this.building(x, y);
        if (id !== 0) {
          const def = this.content.get(this.world.buildings.get(id)?.definitionId ?? '');
          const cat = def?.category;
          c = cat === 'utility' ? (def?.power?.transformer ? 'S' : def?.power?.production ? 'P' : 'U') : cat === 'service' ? 'B' : 'H';
        } else if (this.road(x, y) !== ROAD.none) {
          const type = this.road(x, y);
          c = type === ROAD.highway ? '=' : type === ROAD.avenue ? '#' : '+';
          if ((wire[t] ?? 0) === WIRE.low) c = 'l';
          if ((wire[t] ?? 0) === WIRE.high) c = 'L';
        } else if ((wire[t] ?? 0) === WIRE.high) c = 'h';
        else if ((zone[t] ?? 0) !== 0) c = ['', 'r', 'c', 'i'][zone[t]!]!;
        else if (this.shore[t] === 1) c = ',';
        line += c;
      }
      lines.push(line);
    }
    return lines.join('\n');
  }
}

function rectName(r: Rect): string {
  return 'name' in r ? String((r as District).name) : `${r.x0},${r.y0}-${r.x1},${r.y1}`;
}

/** Binární halda pro Dijkstru. */
class MinHeap {
  private nodes: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.nodes.length;
  }
  push(node: number, key: number): void {
    this.nodes.push(node);
    this.keys.push(key);
    let i = this.nodes.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= this.keys[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.nodes[0]!, this.keys[0]!];
    const lastNode = this.nodes.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = lastNode;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.nodes.length && this.keys[l]! < this.keys[m]!) m = l;
        if (r < this.nodes.length && this.keys[r]! < this.keys[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b]!, this.nodes[a]!];
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
  }
}

function district(name: string): District {
  const d = DISTRICTS.find((item) => item.name === name);
  if (!d) throw new Error(`čtvrť ${name}`);
  return d;
}

// ==========================================================================

async function main(): Promise<void> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  const balance = balanceWithMap(content.getBalance(), MAP_CHOICE);
  const world = createWorld(SEED, balance.economy, SIZE);
  applyGeneratedMap(world, generateTerrain(SEED, balance, SIZE));
  world.map = { seed: SEED, generated: true };
  world.economy.funds = FUNDS;
  // **Bez katastrof.** Sto let simulace by město několikrát zaplavilo
  // a vypálilo; na snímcích má být město, ne povodeň.
  world.disasters.enabled = false;

  const b = new Builder(world, content, balance);
  b.markShore();
  forestHill(b);
  b.layNetwork();
  placeUtilities(b);
  placeServices(b);
  const pairs = placeSubstations(b);
  wireHighVoltage(b, pairs);
  b.zoneAll();
  // Potrubí pod každou silnicí na souši. Blok vede vodu sám (T129), potrubí
  // spojuje bloky přes ulice a vede k vodárnám.
  let pipes = 0;
  for (const tile of world.roadTiles) {
    const x = tile % SIZE;
    const y = (tile - x) / SIZE;
    if (world.layers.terrain[tile] === TERRAIN.water) continue;
    if (buildPipe(world, x, y, balance).ok) pipes++;
  }
  b.log.push(`potrubí: ${pipes}`);
  b.log.push(`nízké napětí přes ulice: ${b.layLowCrossings()}`);
  // Nábřeží: lavičky a malé parky místo zón.
  placePromenade(b);
  rebuildTileIndex(world);

  console.log(b.log.join('\n'));
  b.log.length = 0;

  if (PREVIEW) {
    console.log(b.ascii({ x0: 56, y0: 0, x1: 255, y1: 155 }));
    return;
  }

  // Daně o kousek níž než výchozí: město roste rychleji a je spokojenější.
  for (const zone of [ZONE.residential, ZONE.commercial, ZONE.industrial] as const) setTaxRate(world, zone, 5);

  const systems = createDefaultSystems(content, balance);
  const started = Date.now();
  let transitDone = false;
  for (let tick = 0; tick < TICKS; tick++) {
    tickWorld(world, systems);
    if (world.economy.funds < FUNDS / 2) world.economy.funds = FUNDS;
    if (!transitDone && tick === 1500) {
      setupTransit(b);
      transitDone = true;
      console.log(b.log.join('\n'));
      b.log.length = 0;
    }
    if ((tick + 1) % 2000 === 0) keepUtilitiesAhead(b, tick + 1);
    if ((tick + 1) % 10_000 === 0) {
      console.log(
        `  tik ${tick + 1}: obyvatel ${totalPopulation(world.buildings)}, práce ${totalJobs(world.buildings)}, budov ${world.buildings.size}, ` +
          `poptávka R ${world.demand.residential} C ${world.demand.commercial} I ${world.demand.industrial}, ${Math.round((Date.now() - started) / 1000)} s`,
      );
      if (b.log.length > 0) {
        console.log(b.log.join('\n'));
        b.log.length = 0;
      }
    }
  }

  report(b, `před úklidem (${TICKS} tiků)`);
  if (process.env.CITY_DUMP) writeFileSync(process.env.CITY_DUMP, b.asciiPower({ x0: 56, y0: 0, x1: 255, y1: 155 }), 'utf8');

  // Ruiny, kterých se za sto let pár nasbírá, hráč zbourá — nástroj na to má.
  let ruins = 0;
  for (const building of world.buildings.values()) if (building.abandoned) ruins++;
  if (ruins > 0) demolishRuins(world, 0, 0, SIZE, SIZE, balance);
  // A nechá město pár měsíců dýchat, ať se síť a pokrytí srovnají.
  for (let tick = 0; tick < 600; tick++) tickWorld(world, systems);

  // **Prázdné zóny se uklidí**: plán, na kterém nic nevyrostlo, by přebil
  // město barvou. Jenže prázdná zóna je parcela a vede proud (T129) —
  // holá tráva na jejím místě by blok rozťala a dům za ní by zhasl (měřeno:
  // 99,9 % → 98,4 %). Na proluku proto přijde malý park: je to parcela taky,
  // a sídliště s parčíky v prolukách vypadá živěji než s holou trávou.
  let cleared = 0;
  let pocket = 0;
  for (let tile = 0; tile < world.layers.zone.length; tile++) {
    if ((world.layers.zone[tile] ?? 0) === 0 || (world.layers.buildingId[tile] ?? 0) !== 0) continue;
    const x = tile % SIZE;
    const y = (tile - x) / SIZE;
    zoneArea(world, x, y, 1, 1, ZONE.none, balance);
    cleared++;
    if (placeDefinition(world, content, 'vanilla:park_small', x, y, balance).ok) pocket++;
  }
  b.log.push(`proluky: ${cleared}, z toho parčíků ${pocket}, nové přípojky ${b.layLowCrossings()}`);
  console.log(b.log.join('\n'));
  b.log.length = 0;
  for (let tick = 0; tick < 60; tick++) tickWorld(world, systems);

  const stats = report(b, `po ${TICKS} tikách (zbouráno ruin ${ruins}, uklizeno prázdných zón ${cleared})`);

  const now = new Date().toISOString();
  const bytes = serializeSave(world, {
    cityName: 'Zdenalcity',
    createdAt: now,
    modifiedAt: now,
    playtimeSeconds: Math.round(TICKS / 4),
    sources: content.getLoadedSources(),
  });

  const out = resolve(ROOT, 'art', 'city');
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'showcase.city'), bytes);
  writeFileSync(resolve(out, 'showcase.b64'), Buffer.from(bytes).toString('base64'), 'utf8');
  writeFileSync(resolve(out, 'showcase.txt'), `${stats}\n`, 'utf8');
  console.log(`save ${Math.round(bytes.length / 1024)} kB → art/city/showcase.city`);

  verifyLoad(bytes, world, balance);
}

/**
 * Hradní vrch: skála by ve středu města vypadala jako lom. Vykácená skála se
 * zalesní — městský les, jaký mají Petřín nebo Špilberk.
 */
function forestHill(b: Builder): void {
  let trees = 0;
  for (const d of DISTRICTS) {
    if (d.kind !== 'park') continue;
    for (let y = d.y0; y <= d.y1; y++) {
      for (let x = d.x0; x <= d.x1; x++) {
        if (districtAt(x, y) !== d || b.water(x, y)) continue;
        const terrain = b.terrain(x, y);
        if (terrain === TERRAIN.forest) continue;
        if (terrain === TERRAIN.rock || terrain === TERRAIN.marsh) bulldoze(b.world, x, y, b.balance);
        if (plantTrees(b.world, x, y, b.balance).ok) trees++;
      }
    }
  }
  b.log.push(`vrch: zalesněno ${trees} dlaždic`);
}

// ------------------------------------------------------------- energetika

/**
 * Areály energetiky: kotvy, kolem kterých se staví elektrárny a čistírny.
 * Sever má uhlí, plyn a větrníky; západ a východ jádro na břehu jezera.
 */
const PARKS = [
  { name: 'sever', x: 168, y: 12 },
  { name: 'zapad', x: 34, y: 116 },
  { name: 'vychod', x: 238, y: 118 },
];

type Park = (typeof PARKS)[number];

function nearestPark(x: number, y: number): Park {
  return [...PARKS].sort((p, q) => Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y))[0]!;
}

function placeUtilities(b: Builder): void {
  const [north, west, east] = PARKS as [Park, Park, Park];
  b.log.push('energetika:');
  // Jádro u vody na západě a východě, uhlí a plyn na severu.
  b.outskirts('vanilla:nuclear_power_plant', 4, west, 8);
  b.outskirts('vanilla:nuclear_power_plant', 4, east, 8);
  b.outskirts('vanilla:coal_power_plant', 4, north, 7, 30);
  b.outskirts('vanilla:gas_power_plant', 4, north, 5, 30);
  // Větrníky na pobřeží na konci severního areálu.
  placeWindFarm(b, { x0: 186, y0: 3, x1: 200, y1: 14 });

  // Vodárny: na břehu každé souše, kam město sahá (potrubí přes vodu nevede).
  b.log.push('voda a odpady:');
  for (const name of ['centrum', 'obcanska-zapad', 'sidliste-sever', 'sidliste-jih', 'predmesti', 'sidliste-vychod', 'prumysl-jih', 'prumysl-sever', 'sidliste-severovychod', 'sidliste-jihovychod']) {
    b.spread('vanilla:water_works', 2, 10, district(name));
  }
  // Čistírny: kanalizace je celoměstská kapacita a co nepobere, rozlije se
  // znečištěním po celé mapě. Velké město jich potřebuje přes dvacet.
  b.outskirts('vanilla:water_treatment', 7, { x: 200, y: 126 }, 4);
  b.outskirts('vanilla:water_treatment', 6, west, 4);
  b.outskirts('vanilla:water_treatment', 6, east, 4);
  b.outskirts('vanilla:water_treatment', 5, north, 4);
  b.outskirts('vanilla:water_treatment', 4, { x: 140, y: 30 }, 4);
  b.outskirts('vanilla:incinerator', 5, north, 5);
  b.outskirts('vanilla:incinerator', 4, east, 5);
  b.outskirts('vanilla:incinerator', 4, { x: 196, y: 126 }, 5);
  b.outskirts('vanilla:landfill', 2, east, 6);
}

function placeWindFarm(b: Builder, r: Rect): void {
  // Větrníky v řadách ob dlaždici, mezi nimi vysoké napětí — řada je jedna
  // síť. Stavějí se jen na volné zemi.
  let built = 0;
  for (let y = r.y0; y <= r.y1; y += 4) {
    let last: number | null = null;
    for (let x = r.x0; x <= r.x1; x += 2) {
      const placed = b.placeAt('vanilla:wind_turbine', [[x, y]]);
      if (!placed) {
        last = null;
        continue;
      }
      built++;
      if (last !== null && x - last === 2 && b.building(x - 1, y) === 0 && b.road(x - 1, y) === ROAD.none) {
        b.layHigh([b.t(x - 1, y)]);
      }
      last = x;
    }
  }
  b.log.push(`  větrníků: ${built}`);
}

/**
 * Rozvodny po dvojicích: dvě 2 × 2 vedle sebe unesou 200 000, přesně tolik,
 * co jedna linka vysokého napětí. Stojí v té části čtvrti, která je blíž
 * k elektrárnám, ať linka nemusí přes bloky.
 */
function placeSubstations(b: Builder): number[][] {
  const pairs: number[][] = [];
  for (const d of DISTRICTS) {
    const want = d.pairs ?? 0;
    if (want === 0) continue;
    // Celá čtvrť visí na jednom areálu: buď ho má zapsaný, nebo nejbližším.
    const park = PARKS.find((q) => q.name === d.park) ?? nearestPark((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2);
    districtPark.set(d.name, park.name);
    const spots: [number, number][] = [];
    for (let y = d.y0 + 2; y <= d.y1 - 3; y++) for (let x = d.x0 + 2; x <= d.x1 - 4; x++) spots.push([x, y]);
    // Kde se dvojice vejde: 4 × 2 volné, u silnice, mimo nábřeží.
    const fits = (x: number, y: number): boolean => {
      if (districtAt(x, y) !== d || districtAt(x + 3, y + 1) !== d) return false;
      if (b.shore[b.t(x, y)] === 1 || b.shore[b.t(x + 3, y + 1)] === 1) return false;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          if (b.water(x + dx, y + dy) || b.road(x + dx, y + dy) !== ROAD.none || b.building(x + dx, y + dy) !== 0) return false;
        }
      }
      return b.nearestRoadType(x, y, 1) !== ROAD.none;
    };
    // První dvojice co nejblíž elektrárnám, každá další **co nejdál od již
    // postavených** (vzorkování nejvzdálenějším bodem). Nízké napětí nese
    // proud přes bloky jen přípojkami po 40 000; když stály všechny dvojice
    // u jednoho kraje, druhý konec centra hladověl (měřeno: 90 % domů
    // se proudem, 35 úzkých hrdel).
    const chosen: [number, number][] = [];
    while (chosen.length < want) {
      let best: [number, number] | null = null;
      let bestScore = -Infinity;
      for (const [x, y] of spots) {
        const score =
          chosen.length === 0 ? -Math.hypot(x - park.x, y - park.y) : Math.min(...chosen.map(([cx, cy]) => Math.hypot(cx - x, cy - y)));
        if (score <= bestScore || !fits(x, y)) continue;
        best = [x, y];
        bestScore = score;
      }
      if (!best) break;
      const [x, y] = best;
      chosen.push(best);
      const first = b.placeAt('vanilla:substation', [[x, y]]);
      if (!first) continue;
      const second = b.placeAt('vanilla:substation', [[x + 2, y]]);
      pairs.push(second ? [first.id, second.id] : [first.id]);
    }
  }
  // Čtvrti bez vlastních rozvoden (občanská) bere proud ze sousedů; počítá
  // se k areálu, který je jim nejblíž.
  for (const d of DISTRICTS) {
    if (!districtPark.has(d.name)) districtPark.set(d.name, nearestPark((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2).name);
  }
  b.log.push(`rozvodny: ${pairs.flat().length} ve ${pairs.length} dvojicích`);
  return pairs;
}

/** Ke kterému areálu vedou linky rozvoden dané čtvrti. */
const districtPark = new Map<string, string>();

/** Dlaždice, které jsou se sítí areálu spojené: elektrárny a jejich vedení. */
const parkTiles = new Map<string, Set<number>>();

function touches(b: Builder, own: Iterable<number>, tiles: Set<number>): boolean {
  for (const t of own) {
    const x = t % b.size;
    const y = (t - x) / b.size;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (tiles.has(b.t(x + dx, y + dy))) return true;
  }
  return false;
}

/** Připojí elektrárnu k síti jejího areálu (nejbližší kotvy). */
function joinPark(b: Builder, plantId: number): void {
  const plant = b.world.buildings.get(plantId)!;
  const park = nearestPark(plant.x, plant.y);
  const tiles = parkTiles.get(park.name) ?? new Set<number>();
  parkTiles.set(park.name, tiles);
  const own = new Set(b.footprint(plantId));
  if (tiles.size > 0 && !touches(b, own, tiles)) {
    const path = b.routeHigh(own, tiles);
    if (path) {
      b.layHigh(path);
      for (const t of path) tiles.add(t);
    }
  }
  for (const t of own) tiles.add(t);
  // Vedení mezi větrníky v řadě patří k areálu taky.
  for (const t of own) {
    const x = t % b.size;
    const y = (t - x) / b.size;
    for (const [dx, dy] of [[1, 0], [-1, 0]] as const) {
      const n = b.t(x + dx, y + dy);
      if (b.world.layers.wire[n] === WIRE.high) tiles.add(n);
    }
  }
}

/**
 * Vysoké napětí. Elektrárny jednoho areálu se propojí mezi sebou, areály
 * mezi sebou příčkou, a každá dvojice rozvoden dostane vlastní linku
 * k nejbližšímu areálu — linka unese 200 000 a nedělí se s nikým.
 */
function wireHighVoltage(b: Builder, pairs: number[][]): void {
  const plants = b.existing((id) => (b.content.get(id)?.power?.production ?? 0) > 0);
  // Velké elektrárny napřed, větrníky se připojí k nim.
  plants.sort((p, q) => b.footprint(q.id).length - b.footprint(p.id).length);
  for (const p of plants) joinPark(b, p.id);

  // Příčky mezi areály: výroba se tak sdílí po celém městě. Dvě souběžné,
  // ať příčka sama nebrzdí.
  let ties = 0;
  for (const [a, c] of [['sever', 'zapad'], ['sever', 'vychod'], ['zapad', 'vychod']] as const) {
    const from = parkTiles.get(a);
    const to = parkTiles.get(c);
    if (!from || !to) continue;
    const path = b.routeHigh(from, to);
    if (path) {
      b.layHigh(path);
      ties++;
    }
  }

  let lines = 0;
  for (const pair of pairs) {
    const own = new Set(pair.flatMap((id) => b.footprint(id)));
    const s = b.world.buildings.get(pair[0]!)!;
    const d = districtAt(s.x, s.y);
    const tiles = parkTiles.get((d && districtPark.get(d.name)) ?? nearestPark(s.x, s.y).name);
    if (!tiles) continue;
    const path = b.routeHigh(own, tiles);
    if (path) {
      b.layHigh(path);
      lines++;
    }
  }
  b.log.push(`vysoké napětí: linek k rozvodnám ${lines}, příček mezi areály ${ties}, areálů ${parkTiles.size}`);
}

// --------------------------------------------------------------- služby

function placeServices(b: Builder): void {
  b.log.push('občanská vybavenost:');
  const west = district('obcanska-zapad');
  const east = district('obcanska-vychod');
  // Velké instituce v občanské čtvrti.
  b.spread('vanilla:university', 1, 10, east);
  b.spread('vanilla:hospital', 1, 10, east);
  b.spread('vanilla:theatre', 1, 8, east);
  b.spread('vanilla:museum', 1, 10, west);
  b.spread('vanilla:theatre', 1, 8, west);
  b.spread('vanilla:gallery', 2, 5, west);
  b.spread('vanilla:police_large', 1, 10, west);
  b.spread('vanilla:fire_station_large', 1, 10, east);
  b.spread('vanilla:high_school', 1, 10, west);
  b.spread('vanilla:city_park', 1, 10, west);
  b.spread('vanilla:transit_depot', 1, 10, east);
  b.spread('vanilla:transit_depot', 1, 10, district('sidliste-vychod'));
  b.spread('vanilla:transit_depot', 1, 10, district('sidliste-sever'));
  b.spread('vanilla:prison', 1, 10, district('prumysl-jih'));
  b.spread('vanilla:university', 1, 10, district('sidliste-sever'));
  b.spread('vanilla:hospital', 1, 10, district('sidliste-jih'));
  b.spread('vanilla:hospital', 1, 10, district('sidliste-vychod'));
  b.spread('vanilla:hospital', 1, 10, district('sidliste-sever'));
  b.spread('vanilla:museum', 1, 10, district('centrum'));
  b.spread('vanilla:cinema', 2, 10, district('centrum'));
  b.spread('vanilla:city_park', 1, 10, district('sidliste-sever'));
  b.spread('vanilla:city_park', 1, 10, district('sidliste-vychod'));
  b.spread('vanilla:city_park', 1, 10, district('predmesti'));

  const living: Kind[] = ['core', 'estate', 'suburb', 'civic'];
  const all: Kind[] = ['core', 'estate', 'suburb', 'civic', 'industry'];
  b.log.push('pokrytí:');
  b.cover('vanilla:police_small', 'police', 26, 20, all);
  b.cover('vanilla:fire_station', 'fire', 22, 17, all);
  b.cover('vanilla:clinic', 'health', 22, 17, living);
  b.cover('vanilla:school', 'education', 22, 17, living);
  b.cover('vanilla:high_school', 'education', 30, 22, living);
  b.cover('vanilla:park_large', 'parks', 20, 13, all);
  b.cover('vanilla:plaza', 'parks', 12, 7, ['core']);
  b.cover('vanilla:theatre', 'culture', 24, 12, living);
  b.cover('vanilla:cinema', 'culture', 20, 11, living);
  b.cover('vanilla:gallery', 'culture', 14, 8, ['core', 'estate']);
  b.cover('vanilla:community_centre', 'social', 22, 14, living);
  b.cover('vanilla:retirement_home', 'social', 26, 12, living);
}

function placePromenade(b: Builder): void {
  // Nábřeží: malé parky po třech dlaždicích, mezi nimi tráva. Park nepotřebuje
  // silnici (`requiresRoad: false`).
  let parks = 0;
  for (let y = 1; y < b.size - 1; y++) {
    for (let x = 1; x < b.size - 1; x++) {
      const tile = b.t(x, y);
      if (b.shore[tile] !== 1 || b.water(x, y) || b.road(x, y) !== ROAD.none || b.building(x, y) !== 0) continue;
      if (mod(x + 2 * y, 3) !== 0) continue;
      if (b.placeAt('vanilla:park_small', [[x, y]])) parks++;
    }
  }
  b.log.push(`nábřeží: parků ${parks}`);

  // Občanská čtvrť: co nezabraly instituce, je park. Instituce tak stojí
  // v zeleni a park je parcela, takže k nim vede proud.
  let green = 0;
  for (const d of DISTRICTS) {
    if (d.kind !== 'civic') continue;
    for (let y = d.y0; y <= d.y1; y++) {
      for (let x = d.x0; x <= d.x1; x++) {
        if (districtAt(x, y) !== d || b.water(x, y) || b.road(x, y) !== ROAD.none || b.building(x, y) !== 0) continue;
        if (b.reserved[b.t(x, y)] === 1) continue;
        if (b.placeAt('vanilla:park_small', [[x, y]])) green++;
      }
    }
  }
  b.log.push(`občanská čtvrť: parků ${green}`);
}

// -------------------------------------------------------------- doprava

/**
 * MHD: autobusy po všech čtvrtích, tramvaj centrem, metro mezi čtvrtěmi.
 * Tramvaj a metro chtějí proud už při stavbě zastávky, proto až po pár
 * stovkách tiků, kdy síť stojí.
 */
function setupTransit(b: Builder): void {
  const w = b.world;
  const busStops: { x: number; y: number; id: number }[] = [];
  for (const d of DISTRICTS) {
    if (!['core', 'estate', 'suburb', 'civic', 'industry'].includes(d.kind)) continue;
    const before = busStops.length;
    for (let y = d.y0 + 4; y <= d.y1; y += 12) {
      for (let x = d.x0 + 4; x <= d.x1; x += 12) {
        const placed = b.placeAt('vanilla:transit_stop', b.around(x, y, 5, d), (px, py) => b.nearestRoadType(px, py, 1) !== ROAD.none && b.building(px, py) === 0);
        if (placed) busStops.push(placed);
      }
    }
    // Linky po čtvrtích: zastávky v pořadí hada, nejvýš dvanáct.
    const mine = busStops.slice(before);
    for (let i = 0; i + 1 < mine.length; i += 10) {
      const chunk = mine.slice(i, i + 10);
      if (chunk.length < 2) continue;
      const line = createLine(w, 'bus');
      for (const stop of snake(chunk)) addTransitStop(w, b.content, b.balance, line.id, stop.id);
      setLineVehicles(w, b.balance, line.id, chunk.length * 2);
    }
  }
  b.log.push(`MHD: autobusových zastávek ${busStops.length}`);

  // Tramvaj: dvě trasy centrem po třídách.
  let trams = 0;
  for (const [x0, y0, x1, y1] of [
    [100, 80, 160, 80],
    [108, 40, 108, 140],
  ] as const) {
    const stops: { x: number; y: number; id: number }[] = [];
    const length = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let k = 0; k <= length; k += 7) {
      const x = x0 + Math.sign(x1 - x0) * k;
      const y = y0 + Math.sign(y1 - y0) * k;
      const placed = b.placeAt('vanilla:tram_stop', b.around(x, y, 3));
      if (placed) stops.push(placed);
      if (stops.length >= 12) break;
    }
    if (stops.length >= 2) {
      const line = createLine(w, 'tram');
      for (const stop of stops) addTransitStop(w, b.content, b.balance, line.id, stop.id);
      setLineVehicles(w, b.balance, line.id, stops.length * 2);
      trams += stops.length;
    }
  }
  // Metro: stanice v těžištích čtvrtí, jedna linka napříč městem.
  const metro: { x: number; y: number; id: number }[] = [];
  for (const name of ['sidliste-sever', 'obcanska-zapad', 'centrum', 'sidliste-jih', 'predmesti', 'sidliste-jihovychod', 'prumysl-jih', 'sidliste-vychod', 'obcanska-vychod', 'prumysl-sever', 'sidliste-severovychod']) {
    const d = district(name);
    const placed = b.placeAt('vanilla:metro_station', b.around((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, 10, d));
    if (placed) metro.push(placed);
  }
  if (metro.length >= 2) {
    const line = createLine(w, 'metro');
    for (const stop of metro) addTransitStop(w, b.content, b.balance, line.id, stop.id);
    setLineVehicles(w, b.balance, line.id, metro.length * 2);
  }
  b.log.push(`MHD: tramvajových zastávek ${trams}, stanic metra ${metro.length}, linek ${w.lines.length}`);
}

/** Pořadí zastávek „hadem": po řádcích, každý druhý pozpátku. */
function snake<T extends { x: number; y: number }>(items: T[]): T[] {
  const rows = new Map<number, T[]>();
  for (const item of items) {
    const key = Math.round(item.y / 12);
    rows.set(key, [...(rows.get(key) ?? []), item]);
  }
  return [...rows.entries()]
    .sort((a, c) => a[0] - c[0])
    .flatMap(([, row], i) => row.sort((p, q) => (i % 2 === 0 ? p.x - q.x : q.x - p.x)));
}

// ------------------------------------------------------- průběžná údržba

/**
 * Co by dělal hráč: když spotřeba dohání výrobu nebo odpad přetéká, postaví
 * další elektrárnu, čistírnu, spalovnu, vodárnu. A přidá vozy na linky,
 * které nestíhají.
 */
function keepUtilitiesAhead(b: Builder, tick: number): void {
  const w = b.world;
  let production = 0;
  let consumption = 0;
  for (const building of w.buildings.values()) {
    if (building.abandoned) continue;
    const power = b.content.get(building.definitionId)?.power;
    production += power?.production ?? 0;
    consumption += power?.consumption ?? 0;
  }
  const u = cityUtilities(w, b.content, b.balance);
  const added: string[] = [];
  const [north, west, east] = PARKS as [Park, Park, Park];
  // Elektřina se hlídá **po areálech**, ne celoměstsky: areál napájí své
  // rozvodny vlastními linkami a s ostatními ho spojuje jen příčka (200 000).
  // Přebytek na východě čtvrti na západě nezachrání.
  const supply = new Map<string, number>();
  const demand = new Map<string, number>();
  for (const building of w.buildings.values()) {
    if (building.abandoned) continue;
    const power = b.content.get(building.definitionId)?.power;
    if (!power) continue;
    if ((power.production ?? 0) > 0) {
      const park = nearestPark(building.x, building.y).name;
      supply.set(park, (supply.get(park) ?? 0) + (power.production ?? 0));
    }
    if ((power.consumption ?? 0) > 0) {
      const d = districtAt(building.x, building.y);
      const park = d ? districtPark.get(d.name) : undefined;
      if (park) demand.set(park, (demand.get(park) ?? 0) + (power.consumption ?? 0));
    }
  }
  for (const park of PARKS) {
    for (let n = 0; n < 3 && (demand.get(park.name) ?? 0) > (supply.get(park.name) ?? 0) * 0.9; n++) {
      let plant = b.outskirts('vanilla:nuclear_power_plant', 1, park, 8, 45, 4)[0];
      plant ??= b.outskirts('vanilla:coal_power_plant', 1, park, 6, 40)[0];
      let host = park;
      // Areál je plný: elektrárna jde do sousedního a k tomuhle se přidá
      // další souběžná příčka, ať proud projde (příčka unese 200 000).
      if (!plant) {
        for (const other of [...PARKS].filter((q) => q !== park).sort((q, r) => Math.hypot(q.x - park.x, q.y - park.y) - Math.hypot(r.x - park.x, r.y - park.y))) {
          plant = b.outskirts('vanilla:nuclear_power_plant', 1, other, 8, 45, 4)[0];
          if (plant) {
            host = other;
            break;
          }
        }
        if (!plant) break;
      }
      joinPark(b, plant.id);
      if (host !== park) {
        const path = b.routeHigh(parkTiles.get(park.name)!, parkTiles.get(host.name)!);
        if (path) b.layHigh(path);
      }
      const made = b.world.buildings.get(plant.id)!.definitionId;
      supply.set(park.name, (supply.get(park.name) ?? 0) + (b.content.get(made)?.power?.production ?? 0));
      added.push(`${made.replace('vanilla:', '')} (${host.name}${host !== park ? ` pro ${park.name}` : ''})`);
    }
  }
  const anchors = [{ x: 200, y: 126 }, east, west, north, { x: 140, y: 30 }];
  if (u.sewageNeeded > u.sewageCapacity * 0.9) {
    for (const anchor of anchors) {
      if (b.outskirts('vanilla:water_treatment', 1, anchor, 4, 55).length > 0) {
        added.push('čistírna');
        break;
      }
    }
  }
  if (u.wasteNeeded > u.wasteCapacity * 0.9) {
    for (const anchor of anchors) {
      if (b.outskirts('vanilla:incinerator', 1, anchor, 5, 55).length > 0) {
        added.push('spalovna');
        break;
      }
    }
  }
  if (u.waterNeeded > u.waterCapacity * 0.85) {
    // Vodárna musí na souš, kde je město: u středu čtvrti, s přístupovou cestou.
    for (const name of ['sidliste-vychod', 'sidliste-sever', 'sidliste-severovychod', 'predmesti', 'sidliste-jihovychod', 'sidliste-jih', 'prumysl-jih', 'centrum', 'prumysl-sever']) {
      const d = district(name);
      if (b.outskirts('vanilla:water_works', 1, { x: (d.x0 + d.x1) / 2, y: (d.y0 + d.y1) / 2 }, 6, 30, 0).length > 0) {
        added.push('vodárna');
        break;
      }
    }
  }
  if (added.length > 0) {
    b.log.push(
      `  tik ${tick}: přistavěno ${added.join(', ')} (proud ${Math.round(consumption)}/${production}, ` +
        `odpad ${u.wasteNeeded}/${u.wasteCapacity}, kanalizace ${u.sewageNeeded}/${u.sewageCapacity}, voda ${u.waterNeeded}/${u.waterCapacity})`,
    );
  }
  sizeFleets(b);
  widenJammedStreets(b, tick);
}

/**
 * Ulice, na které se nevejdou auta, hráč rozšíří na třídu. Dělá se to za
 * běhu, protože kde budou kolony, ukáže až město.
 */
function widenJammedStreets(b: Builder, tick: number): void {
  const w = b.world;
  const capacity = b.balance.traffic.roadTypes[ROAD.street - 1]?.capacity ?? 60;
  let widened = 0;
  for (const tile of [...w.roadTiles].sort((p, q) => p - q)) {
    if (w.layers.road[tile] !== ROAD.street) continue;
    if ((w.trafficLoad[tile] ?? 0) <= capacity) continue;
    const x = tile % w.size;
    if (buildRoad(w, x, (tile - x) / w.size, ROAD.avenue, b.balance).ok) widened++;
  }
  if (widened > 0) b.log.push(`  tik ${tick}: rozšířeno ulic na třídy ${widened}`);
}

/**
 * Vozy na linkách: tolik, kolik je v dosahu cestujících. Úleva od kolon
 * roste s tím, kolik lidí MHD opravdu odveze (T56), takže linka s pár vozy
 * přes celé sídliště nepomůže. Jízdné nulové — socialistická MHD.
 */
function sizeFleets(b: Builder): void {
  for (const line of b.world.lines) {
    const mode = b.balance.transit.modes[line.mode];
    const stats = b.world.lineStats.get(line.id);
    if (!mode || !stats) continue;
    if (line.fare !== 0) setLineFare(b.world, line.id, 0);
    const wanted = Math.min(4000, Math.max(line.vehicles, Math.ceil((stats.demand * 1.05) / mode.capacity)));
    if (wanted !== line.vehicles) setLineVehicles(b.world, b.balance, line.id, wanted);
  }
}

// ---------------------------------------------------------------- měření

function report(b: Builder, title: string): string {
  const w = b.world;
  let rci = 0;
  let powered = 0;
  let watered = 0;
  let abandoned = 0;
  let needsWater = 0;
  const levels = [0, 0, 0, 0, 0, 0];
  const byCategory = new Map<string, number>();
  let production = 0;
  let consumption = 0;
  for (const building of w.buildings.values()) {
    const def = b.content.get(building.definitionId);
    if (building.abandoned) abandoned++;
    production += building.abandoned ? 0 : def?.power?.production ?? 0;
    consumption += building.abandoned ? 0 : def?.power?.consumption ?? 0;
    const cat = def?.category ?? '?';
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
    if (cat === 'residential' || cat === 'commercial' || cat === 'industrial') {
      rci++;
      if (building.powered) powered++;
      levels[building.level] = (levels[building.level] ?? 0) + 1;
    }
    if (def?.construction.requiresWater === true) {
      needsWater++;
      if (w.watered.has(building.id)) watered++;
    }
  }
  let overloaded = 0;
  let starved = 0;
  for (const v of w.wireOverloaded) if (v === 1) overloaded++;
  for (const v of w.powerStarved) if (v === 1) starved++;
  let roads = 0;
  let jammed = 0;
  let loadSum = 0;
  const caps = b.balance.traffic.roadTypes.map((r) => r.capacity);
  for (const tile of w.roadTiles) {
    const type = w.layers.road[tile] ?? 0;
    const cap = caps[type - 1] ?? 60;
    const ratio = (w.trafficLoad[tile] ?? 0) / cap;
    roads++;
    loadSum += ratio;
    if (ratio > 1) jammed++;
  }
  // Rozbor spokojenosti po obydlených buňkách hrubé mřížky: co ji táhne dolů.
  const populated = new Set<number>();
  for (const building of w.buildings.values()) {
    if (building.abandoned || building.population === 0) continue;
    populated.add(coarseIndex(building.x, building.y, w.size));
  }
  const congestion = coarseCongestion(w, b.balance);
  const avg = (layer: ArrayLike<number> | undefined): string => {
    if (!layer) return '-';
    let sum = 0;
    for (const cell of populated) sum += layer[cell] ?? 0;
    return (sum / Math.max(1, populated.size)).toFixed(layer === congestion ? 2 : 0);
  };
  const coverage = [...w.coverage.keys()].sort().map((key) => `${key} ${avg(w.coverage.get(key))}`).join(', ');
  const zoneUse = [1, 2, 3].map((zone) => {
    let zoned = 0;
    let built = 0;
    for (let tile = 0; tile < w.layers.zone.length; tile++) {
      if (w.layers.zone[tile] !== zone) continue;
      zoned++;
      if ((w.layers.buildingId[tile] ?? 0) !== 0) built++;
    }
    return `${['', 'R', 'C', 'I'][zone]} ${built}/${zoned}`;
  });
  const u = cityUtilities(w, b.content, b.balance);
  let trafoMax = 0;
  for (const load of w.transformerLoad.values()) trafoMax = Math.max(trafoMax, load.load / load.capacity);
  const lines = [
    `=== ${title}`,
    `obyvatel ${totalPopulation(w.buildings)}, pracovních míst ${totalJobs(w.buildings)}, budov ${w.buildings.size} (RCI ${rci})`,
    `kategorie: ${[...byCategory.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `úrovně RCI: ${levels.map((v, i) => `${i}:${v}`).slice(1).join(' ')}`,
    `elektřina: RCI se proudem ${powered}/${rci} = ${((100 * powered) / Math.max(1, rci)).toFixed(1)} %, výroba ${production}, spotřeba ${consumption}, ` +
      `úzká hrdla (wireOverloaded) ${overloaded}, hladové dlaždice ${starved}, nejvytíženější trafo ${(trafoMax * 100).toFixed(0)} %`,
    `voda: s vodou ${watered}/${needsWater} = ${((100 * watered) / Math.max(1, needsWater)).toFixed(1)} %, ${u.waterNeeded}/${u.waterCapacity}; ` +
      `odpad ${u.wasteNeeded}/${u.wasteCapacity}, kanalizace ${u.sewageNeeded}/${u.sewageCapacity}`,
    `opuštěných ${abandoned}`,
    `doprava: ${roads} dlaždic silnic, průměrné vytížení ${((100 * loadSum) / Math.max(1, roads)).toFixed(0)} %, přetížených ${jammed} (${((100 * jammed) / Math.max(1, roads)).toFixed(1)} %), linek MHD ${w.lines.length}`,
    `spokojenost ${averageHappiness(w).toFixed(0)} / 255 (neutrál 128); obydlené buňky: cena půdy ${avg(w.coarse.landValue)}, znečištění ${avg(w.coarse.pollution)}, kriminalita ${avg(w.coarse.crime)}, kolony ${avg(congestion)}`,
    `pokrytí: ${coverage}`,
    `zóny zastavěné/vyznačené: ${zoneUse.join(', ')}; poptávka R ${w.demand.residential} C ${w.demand.commercial} I ${w.demand.industrial}, kasa ${Math.round(w.economy.funds)}`,
  ];
  console.log(lines.join('\n'));
  return lines.join('\n');
}

/** Načte save skutečnou cestou hry a porovná s městem v paměti. */
function verifyLoad(bytes: Uint8Array, world: WorldState, balance: Balance): void {
  const error = verifySave(bytes);
  if (error) throw new Error(`save neprošel verifySave: ${error.message}`);
  const save = migrate(unpackSave(bytes));
  const loaded = createWorld(save.meta.map?.seed ?? SEED, balance.economy, SIZE);
  applySaveToWorld(loaded, save);
  const same =
    loaded.buildings.size === world.buildings.size &&
    totalPopulation(loaded.buildings) === totalPopulation(world.buildings) &&
    loaded.lines.length === world.lines.length;
  console.log(
    `načtení zpět: formatVersion ${save.meta.formatVersion}, budov ${loaded.buildings.size}, obyvatel ${totalPopulation(loaded.buildings)}, ` +
      `linek ${loaded.lines.length}, katastrofy ${loaded.disasters.enabled ? 'zapnuté' : 'vypnuté'} — ${same ? 'sedí' : 'NESEDÍ'}`,
  );
  if (!same) process.exitCode = 1;
}

void main();
