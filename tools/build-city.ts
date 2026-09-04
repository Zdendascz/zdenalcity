/**
 * Postaví ukázkové město a uloží ho jako save.
 *
 *   npx vite build --ssr tools/build-city.ts --outDir tools/.build --logLevel error
 *   node tools/.build/build-city.js
 *
 * Proč přes `vite build --ssr`: skript sahá do `src/sim/` a potřebuje alias
 * `@`. Node sám TypeScript s aliasy nespustí a `vite-node` v projektu není.
 *
 * Sáhne to **jen na simulaci**, ne na renderer — takže tu neplatí P1 obráceně:
 * nástroj smí do simulace, simulace nesmí ven.
 *
 * Výstup: `art/city/showcase.citysave` (zip jako z hry) a `showcase.b64`
 * (tentýž save v base64, aby se dal vložit do `localStorage`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { serializeSave } from '@/save/serialize';
import { buildPipe, buildRoad, placeDefinition, zoneArea } from '@/sim/commands';
import { index, MAP_SIZES, ROAD, TERRAIN, ZONE } from '@/sim/layers';
import { applyGeneratedMap, generateTerrain } from '@/sim/mapgen';
import { createDefaultSystems } from '@/sim/systems';
import { createWorld, rebuildTileIndex, tickWorld, totalPopulation } from '@/sim/world';
import { isFlatTile } from '@/sim/heights';
import { checkFootprint } from '@/sim/buildings';
import type { WorldState } from '@/sim/world';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Hrana mapy. 256 je „velké město" bez toho, aby se tick vlekl jako u 512. */
const SIZE = MAP_SIZES[2] ?? 256;

/** Seed mapy. Vybraný ručně: pevnina s jezerem a pobřežím, ne ostrov. */
const SEED = 20260904;

/** Kolik tiků se nechá běžet. Město roste postupně, tohle je „pokročilé". */
const TICKS = 20_000;

/** Peníze na start. Ukázkové město se nemá zaseknout na rozpočtu. */
const FUNDS = 50_000_000;

/**
 * Vlastní míchačka, ne `world.rng`.
 *
 * Rozvržení města je **věc nástroje, ne simulace**: kdyby se sáhlo na
 * `world.rng`, posunul by se jeho stav a město by se pak vyvíjelo jinak, než
 * kdyby ho postavil hráč. Tohle je obyčejný xorshift, stačí to.
 */
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

function terrainAt(world: WorldState, x: number, y: number): number {
  if (x < 1 || y < 1 || x >= world.size - 1 || y >= world.size - 1) return TERRAIN.water;
  return world.layers.terrain[index(x, y, world.size)] ?? TERRAIN.water;
}

/**
 * Dá se sem stavět?
 *
 * **Tráva a písek, ne „cokoli kromě vody".** Definice mají
 * `allowedTerrain: [0, 2]`, takže na skále, v lese ani v mokřadu nevyroste nic
 * — první pokus stavěl kamkoli a všech osmnáct služeb padlo na
 * `error.terrainNotAllowed`.
 */
function buildable(world: WorldState, x: number, y: number): boolean {
  const terrain = terrainAt(world, x, y);
  return terrain === TERRAIN.grass || terrain === TERRAIN.sand;
}

/**
 * Kudy smí vést silnice: všude kromě vody.
 *
 * Zkoušel jsem ji držet **jen na trávě a písku**, aby se u každé vozovky dalo
 * zónovat. Dopadlo to hůř: v terénu poskládaném ze skvrn lesa a skály se
 * cesta po pár krocích zasekne a z 2431 dlaždic vozovky zbylo 198 zónovaných
 * parcel místo 875. Ulice lesem je lepší než ulice, která nikam nevede.
 */
function roadable(world: WorldState, x: number, y: number): boolean {
  return terrainAt(world, x, y) !== TERRAIN.water;
}

/** Je tu už silnice? */
function hasRoad(world: WorldState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
  return (world.layers.road[index(x, y, world.size)] ?? ROAD.none) !== ROAD.none;
}

/**
 * Střed města: těžiště největší souvislé plochy, na které se dá stavět.
 *
 * První pokus hledal „nejvíc souše" a našel skálu s lesem u okraje mapy —
 * silnice tam vedly, ale zónovat ani stavět se nedalo skoro nic a město
 * zůstalo na nule. Rozhoduje proto **tráva a písek**, ne „není to voda".
 *
 * Souvislost se počítá záplavou: dvě oddělené louky po dvou stech dlaždicích
 * jsou k ničemu, jedna o čtyřech stech je město.
 */
function findCentre(world: WorldState): { x: number; y: number } {
  const seen = new Uint8Array(SIZE * SIZE);
  let best = { x: SIZE / 2, y: SIZE / 2, size: -1 };

  for (let y = 8; y < SIZE - 8; y++) {
    for (let x = 8; x < SIZE - 8; x++) {
      const start = index(x, y, SIZE);
      if (seen[start] === 1 || !buildable(world, x, y)) continue;

      // Fronta jako pole s ukazatelem: `shift` na desítkách tisíc dlaždic je
      // kvadratický a záplava by trvala déle než celá simulace.
      const queue = [start];
      seen[start] = 1;
      let head = 0;
      let sumX = 0;
      let sumY = 0;
      let count = 0;

      while (head < queue.length) {
        const tile = queue[head++]!;
        const tx = tile % SIZE;
        const ty = Math.floor(tile / SIZE);
        sumX += tx;
        sumY += ty;
        count++;

        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx < 8 || ny < 8 || nx >= SIZE - 8 || ny >= SIZE - 8) continue;
          const next = index(nx, ny, SIZE);
          if (seen[next] === 1 || !buildable(world, nx, ny)) continue;
          seen[next] = 1;
          queue.push(next);
        }
      }

      if (count > best.size) {
        // **Těžiště se přichytí na plochu.** U rohaté nebo prohnuté pevniny
        // leží průměr souřadnic klidně v jezeře — a pak se nepostaví ani
        // jedna silnice, protože všechny startují na nestavitelné dlaždici.
        const cx = sumX / count;
        const cy = sumY / count;
        let snapped = queue[0]!;
        let closest = Infinity;
        for (const tile of queue) {
          const tx = tile % SIZE;
          const ty = Math.floor(tile / SIZE);
          const distance = (tx - cx) ** 2 + (ty - cy) ** 2;
          if (distance < closest) {
            closest = distance;
            snapped = tile;
          }
        }
        best = {
          x: snapped % SIZE,
          y: Math.floor(snapped / SIZE),
          size: count,
        };
      }
    }
  }

  console.log(`největší souvislá plocha: ${best.size} dlaždic`);
  return best;
}

/**
 * Jedna organická cesta.
 *
 * Roste po dlaždicích a **občas zahne o jednu**, místo aby jela rovně. Mřížka
 * vypadá jako tabulka, kdežto tohle jako město, které rostlo. Když narazí na
 * vodu nebo na okraj, skončí — mosty se stavějí zvlášť a záměrně.
 *
 * Vrací dlaždice, kterými prošla, aby se kolem nich dalo zónovat.
 */
function growRoad(
  world: WorldState,
  start: { x: number; y: number },
  direction: { x: number; y: number },
  length: number,
  type: number,
  random: () => number,
  balance: ReturnType<ContentRegistry['getBalance']>,
): { x: number; y: number }[] {
  const laid: { x: number; y: number }[] = [];
  let { x, y } = start;
  let dx = direction.x;
  let dy = direction.y;

  for (let step = 0; step < length; step++) {
    if (!roadable(world, x, y)) break;
    if (!hasRoad(world, x, y)) {
      const result = buildRoad(world, x, y, type, balance);
      if (!result.ok) break;
    }
    laid.push({ x, y });

    // Zatáčka: jednou za čas se směr otočí o devadesát stupňů a hned zpátky,
    // takže z přímky vznikne mírné vlnění místo schodů.
    if (random() < 0.12) {
      const turned = dx === 0 ? { x: random() < 0.5 ? -1 : 1, y: 0 } : { x: 0, y: random() < 0.5 ? -1 : 1 };
      const nx = x + turned.x;
      const ny = y + turned.y;
      if (roadable(world, nx, ny)) {
        if (!hasRoad(world, nx, ny)) buildRoad(world, nx, ny, type, balance);
        laid.push({ x: nx, y: ny });
        x = nx;
        y = ny;
      }
    }

    x += dx;
    y += dy;
    if (!roadable(world, x, y)) {
      // Slepá ulice u vody: zkusí uhnout, než to vzdá.
      const side = dx === 0 ? { x: random() < 0.5 ? -1 : 1, y: 0 } : { x: 0, y: random() < 0.5 ? -1 : 1 };
      x = x - dx + side.x;
      y = y - dy + side.y;
      dx = side.x;
      dy = side.y;
      if (!roadable(world, x, y)) break;
    }
  }

  return laid;
}

/** Zónuje pás podél silnice. Kategorie se řídí vzdáleností od centra. */
function zoneAlong(
  world: WorldState,
  road: { x: number; y: number }[],
  centre: { x: number; y: number },
  random: () => number,
  balance: ReturnType<ContentRegistry['getBalance']>,
): void {
  for (const tile of road) {
    const distance = Math.hypot(tile.x - centre.x, tile.y - centre.y);
    // Jádro je obchod, kolem něj bydlení, na kraji průmysl. Kousek náhody,
    // aby to nebyly soustředné kruhy.
    const jitter = random() * 12 - 6;
    // Poměr je **změřený, ne odhadnutý**. Zkoušel jsem jádro 14/18/22 proti
    // pásu bydlení 46/50/54 a výsledky se lišily víc než dvakrát:
    // 14/46 dalo 9172 obyvatel, 22/50 sedm a půl tisíce, 18/54 jen 4758.
    // Širší obchodní jádro zní logicky (chybí práce), jenže pak schází bydlení
    // a poptávka se převrátí na druhou stranu.
    const zone =
      distance + jitter < 14
        ? ZONE.commercial
        : distance + jitter < 46
          ? ZONE.residential
          : ZONE.industrial;

    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ] as const) {
      // Dva pruhy do hloubky: první u silnice, druhý za ním. Parcela dál než
      // dva kroky od vozovky stejně nevyroste.
      for (let depth = 1; depth <= 3; depth++) {
        const x = tile.x + dx * depth;
        const y = tile.y + dy * depth;
        if (!buildable(world, x, y)) continue;
        if (hasRoad(world, x, y)) continue;
        zoneArea(world, x, y, 1, 1, zone, balance);
      }
    }
  }
}

function main(): void {
  const content = new ContentRegistry();
  return void content.load(createVanillaSource()).then(() => {
    const balance = content.getBalance();
    const world = createWorld(SEED, balance.economy, SIZE);
    applyGeneratedMap(world, generateTerrain(SEED, balance, SIZE));
    world.map = { seed: SEED, generated: true };
    world.economy.funds = FUNDS;
    // **Bez katastrof.** Osmdesát tisíc tiků je dvě stě dvacet let a plánovač
    // za tu dobu město několikrát zaplaví a vypálí; na ukázkových snímcích pak
    // není město, ale povodeň. Ručně se katastrofa spustit dá pořád.
    world.disasters.enabled = false;

    const random = rng(SEED);
    const centre = findCentre(world);
    console.log(`střed města: ${centre.x}, ${centre.y}`);

    // Páteř: čtyři třídy z centra do kříže, ale každá se cestou vlní.
    const spines: { x: number; y: number }[] = [];
    for (const direction of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      spines.push(
        ...growRoad(world, centre, direction, 150, ROAD.avenue, random, balance),
      );
    }

    // Vedlejší ulice: odbočky z páteře, obě strany, různě dlouhé.
    const streets: { x: number; y: number }[] = [];
    for (const tile of spines) {
      if (random() > 0.45) continue;
      const along = random() < 0.5 ? { x: 1, y: 0 } : { x: 0, y: 1 };
      const direction = random() < 0.5 ? along : { x: -along.x, y: -along.y };
      const length = 14 + Math.floor(random() * 40);
      streets.push(
        ...growRoad(world, tile, direction, length, ROAD.street, random, balance),
      );
    }

    // Ulice třetího řádu, aby vznikly bloky a ne hřeben.
    const lanes: { x: number; y: number }[] = [];
    for (const tile of streets) {
      if (random() > 0.3) continue;
      const along = random() < 0.5 ? { x: 1, y: 0 } : { x: 0, y: 1 };
      const direction = random() < 0.5 ? along : { x: -along.x, y: -along.y };
      lanes.push(
        ...growRoad(world, tile, direction, 8 + Math.floor(random() * 16), ROAD.street, random, balance),
      );
    }

    const roads = [...spines, ...streets, ...lanes];
    console.log(`silnic: ${roads.length} dlaždic`);

    // Vodovod po páteři: bez vody nevyroste nic (§8 fáze 3).
    // Potrubí **pod všechny silnice**. Vodovod je podmínka růstu (§8 fáze 3)
    // a s potrubím jen po páteři zůstala většina města suchá.
    for (const tile of [...spines, ...streets, ...lanes]) {
      buildPipe(world, tile.x, tile.y, balance);
    }

    // **Služby dřív než zóny.** Na zónovanou dlaždici se stavět nedá, takže
    // kdyby se zónovalo první, nezbylo by pro ně místo — první pokus tak
    // skončil s nulou u všech osmnácti druhů.
    placeServices(world, content, roads, centre, random, balance);
    zoneAlong(world, roads, centre, random, balance);

    // **Potrubí i pod parcely, ne jen pod vozovku.** `checkFootprint` chce vodu
    // na dlaždici, kde budova stojí — s potrubím jen v ulici hlásily všechny
    // parcely `error.needsWater` a město zůstalo na nule obyvatel.
    let pipes = 0;
    for (let tile = 0; tile < world.layers.zone.length; tile++) {
      if ((world.layers.zone[tile] ?? 0) === 0) continue;
      const x = tile % world.size;
      const y = (tile - x) / world.size;
      if (buildPipe(world, x, y, balance).ok) pipes++;
    }
    console.log(`potrubí pod parcelami: ${pipes}`);

    rebuildTileIndex(world);

    const report = (): void => {
      let zoned = 0;
      for (const value of world.layers.zone) if (value !== 0) zoned++;
      let watered = 0;
      for (const value of world.waterSupply) if (value === 1) watered++;
      let zonedWatered = 0;
      for (let tile = 0; tile < world.layers.zone.length; tile++) {
        if ((world.layers.zone[tile] ?? 0) !== 0 && world.waterSupply[tile] === 1) zonedWatered++;
      }
      let flat = 0;
      let placeable = 0;
      const reasons = new Set<string>();
      const seed = content.get('vanilla:residential_small');
      for (let tile = 0; tile < world.layers.zone.length; tile++) {
        if ((world.layers.zone[tile] ?? 0) !== ZONE.residential) continue;
        const x = tile % world.size;
        const y = (tile - x) / world.size;
        if (isFlatTile(world.cornerHeight, x, y)) flat++;
        if (seed !== undefined) {
          const check = checkFootprint(world, seed, x, y);
          if (check.ok) placeable++;
          else if (placeable === 0 && flat > 0 && reasons.size < 6) reasons.add(check.reason);
        }
      }
      console.log(`  z toho rovných ${flat}, postavitelných ${placeable}`, [...reasons]);
      console.log(
        `zónovaných ${zoned}, s vodou ${watered}, zónovaných s vodou ${zonedWatered}, ` +
          `poptávka R ${world.demand.residential} C ${world.demand.commercial} I ${world.demand.industrial}, kasa ${Math.round(world.economy.funds)}`,
      );
    };
    report();

    const systems = createDefaultSystems(content, balance);
    const started = Date.now();
    for (let tick = 0; tick < TICKS; tick++) {
      tickWorld(world, systems);
      if ((tick + 1) % 10_000 === 0) {
        console.log(
          `  tik ${tick + 1}: obyvatel ${totalPopulation(world.buildings)}, budov ${world.buildings.size}`,
        );
      }
    }
    console.log(`simulace ${Math.round((Date.now() - started) / 1000)} s`);
    report();

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
    writeFileSync(resolve(out, 'showcase.citysave'), bytes);
    writeFileSync(resolve(out, 'showcase.b64'), Buffer.from(bytes).toString('base64'), 'utf8');
    console.log(
      `hotovo: ${totalPopulation(world.buildings)} obyvatel, ${world.buildings.size} budov, ` +
        `save ${Math.round(bytes.length / 1024)} kB`,
    );
  });
}

/**
 * Rozmístí služby podél silnic.
 *
 * Nehledá optimum — hledá **věrohodnost**: elektrárny na kraji, vodárna
 * u břehu, zbytek rovnoměrně po městě s odstupem, aby se dosahy překrývaly.
 */
/** Sousední dlaždice, na kterou se dá postavit budova u silnice. */
const AROUND: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (dx === 0 && dy === 0) continue;
      out.push([dx, dy]);
    }
  }
  // Blíž k silnici napřed: budova u vozovky vypadá líp než budova za rohem.
  return out.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
})();

function placeServices(
  world: WorldState,
  content: ContentRegistry,
  roads: { x: number; y: number }[],
  centre: { x: number; y: number },
  random: () => number,
  balance: ReturnType<ContentRegistry['getBalance']>,
): void {
  const placed: { x: number; y: number; id: string }[] = [];

  /**
   * Odstup se drží **jen proti témuž druhu**, ne proti všem stavbám.
   *
   * Napoprvé to bylo proti všem a šest čerpacích stanic s odstupem 26 zabralo
   * kruhy o ploše skoro celého města — všech osmnáct dalších druhů pak nemělo
   * kam. Dvě hasičárny od sebe daleko dávají smysl, hasičárna daleko od
   * lavičky v parku ne.
   */
  function free(x: number, y: number, keep: number, id: string): boolean {
    if (!buildable(world, x, y)) return false;
    return placed.every((other) =>
      other.id === id ? Math.hypot(other.x - x, other.y - y) > keep : Math.hypot(other.x - x, other.y - y) > 2,
    );
  }

  /**
   * Zkusí postavit `count` kusů u náhodných silnic s daným odstupem.
   *
   * Místo se **hledá v okolí silnice**, ne na jedné pevné sousední dlaždici.
   * Budova o půdorysu 2 × 2 se vedle vozovky málokdy trefí napoprvé: první
   * pokus dával `error.roadInTheWay` a ze všech osmnácti druhů se postavilo
   * jen to, co je 1 × 1. Prohledat čtverec kolem je o řád spolehlivější.
   */
  function spread(definitionId: string, count: number, keep: number): void {
    const definition = content.get(definitionId);
    if (definition === undefined) {
      console.log(`  ${definitionId}: v obsahu není`);
      return;
    }
    const [width, depth] = definition.footprint;

    let done = 0;
    let lastReason = '';
    for (let attempt = 0; attempt < roads.length * 3 && done < count; attempt++) {
      const road = roads[Math.floor(random() * roads.length)];
      if (road === undefined) continue;

      for (const [dx, dy] of AROUND) {
        const x = road.x + dx;
        const y = road.y + dy;
        if (!free(x, y, keep, definitionId)) continue;
        // Půdorys musí být celý na souši a bez silnice, jinak to příkaz
        // odmítne a zbytečně se protočí tisíce pokusů.
        let clear = true;
        for (let ty = 0; ty < depth && clear; ty++) {
          for (let tx = 0; tx < width && clear; tx++) {
            if (!buildable(world, x + tx, y + ty)) clear = false;
            else if (hasRoad(world, x + tx, y + ty)) clear = false;
          }
        }
        if (!clear) continue;

        const result = placeDefinition(world, content, definitionId, x, y, balance);
        if (!result.ok) {
          lastReason = result.reason;
          continue;
        }
        placed.push({ x, y, id: definitionId });
        done++;
        break;
      }
    }
    console.log(`  ${definitionId}: ${done}/${count}${done < count ? ` (${lastReason})` : ''}`);
  }

  // Energie na kraji: nikdo nechce elektrárnu na náměstí.
  const far = roads
    .filter((tile) => Math.hypot(tile.x - centre.x, tile.y - centre.y) > 40)
    .sort(() => random() - 0.5);
  for (const definitionId of [
    'vanilla:coal_power_plant',
    'vanilla:coal_power_plant',
    'vanilla:gas_power_plant',
    'vanilla:gas_power_plant',
    'vanilla:nuclear_power_plant',
  ]) {
    for (const tile of far) {
      const x = tile.x + 1;
      const y = tile.y + 1;
      if (!free(x, y, 12, definitionId)) continue;
      if (!placeDefinition(world, content, definitionId, x, y, balance).ok) continue;
      placed.push({ x, y, id: definitionId });
      break;
    }
  }

  // Vodárna musí k břehu (`nearWater`) a k silnici zároveň. Hledá se proto
  // **kolem každé silnice** jako u ostatních služeb, ne podle pevného odstupu
  // od vody — první pokus chtěl vodu přesně tři dlaždice od vozovky a nenašel
  // ani jednu.
  spread('vanilla:water_works', 8, 26);

  spread('vanilla:pump_station', 18, 14);
  spread('vanilla:fire_station', 10, 18);
  spread('vanilla:police_small', 10, 18);
  spread('vanilla:clinic', 10, 18);
  spread('vanilla:hospital', 2, 45);
  spread('vanilla:school', 10, 18);
  spread('vanilla:high_school', 3, 40);
  spread('vanilla:university', 1, 60);
  spread('vanilla:park_small', 24, 10);
  spread('vanilla:park_large', 5, 26);
  spread('vanilla:city_park', 3, 34);
  spread('vanilla:plaza', 4, 22);
  spread('vanilla:museum', 1, 60);
  spread('vanilla:theatre', 2, 45);
  spread('vanilla:cinema', 2, 40);
  spread('vanilla:community_centre', 3, 34);
  spread('vanilla:landfill', 2, 50);
}

main();
