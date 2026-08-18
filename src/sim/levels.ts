import type { Definition } from '@/content/schema';
import type { BuildingCatalogue } from './catalogue';
import { inBounds, index } from './layers';
import {
  markBuildingDirty,
  markCoverageDirty,
  markPowerNetworkDirty,
  markTileDirty,
  removeBuilding,
} from './world';
import type { Building, WorldState } from './world';

/**
 * Úrovně budov a slučování (§8 zadání fáze 2).
 *
 * Úroveň i půdorys jsou vlastnost **definice**, ne entity — entita nese jen
 * `level` a `definitionId`. Povýšení je proto vždycky výměna definice pod
 * stejnou entitou, ne úprava jejích čísel.
 *
 * Katalog nemusí mít všechny kombinace (kategorie, půdorys, úroveň). Chybějící
 * kombinace znamená, že daná cesta růstu není dostupná — ne chybu (R5).
 */

/**
 * Pořadí směrů je pevné kvůli P2: kdyby se procházely v pořadí podle nějakého
 * `Map`, výsledek by závisel na historii vkládání a determinismus by padl.
 * Kde je opravdu potřeba rozhodnout mezi rovnocennými možnostmi, rozhoduje
 * `world.rng`.
 */
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

/** Definice dané kategorie s přesně tímhle půdorysem a úrovní. */
export function definitionsFor(
  catalogue: BuildingCatalogue,
  category: string,
  width: number,
  depth: number,
  level: number,
): Definition[] {
  return catalogue
    .byCategory(category)
    .filter(
      (definition) =>
        definition.level === level &&
        definition.footprint[0] === width &&
        definition.footprint[1] === depth,
    );
}

/** Jedna z definic pro trojici (kategorie, půdorys, úroveň); vybírá `world.rng`. */
export function pickDefinition(
  world: WorldState,
  catalogue: BuildingCatalogue,
  category: string,
  width: number,
  depth: number,
  level: number,
): Definition | undefined {
  const options = definitionsFor(catalogue, category, width, depth, level);
  if (options.length === 0) return undefined;
  return options[world.rng.int(options.length)];
}

/**
 * Definice, kterými zástavba **začíná**: úroveň 1 a nejmenší půdorys v kategorii.
 *
 * Bez tohohle filtru by růst losoval z celého žebříčku a na prázdné parcele by
 * rovnou vyrostl věžák. Že je začátek ten nejmenší, plyne z obsahu — kód žádnou
 * velikost nezná (P5).
 */
export function seedDefinitions(catalogue: BuildingCatalogue, category: string): Definition[] {
  const level1 = catalogue.byCategory(category).filter((definition) => definition.level === 1);
  if (level1.length === 0) return [];

  const smallest = level1.reduce(
    (min, definition) => Math.min(min, area(definition)),
    Number.MAX_SAFE_INTEGER,
  );
  return level1.filter((definition) => area(definition) === smallest);
}

function area(definition: Definition): number {
  return definition.footprint[0] * definition.footprint[1];
}

/** Co povýšení udělá: novou definici, nový roh a budovy, které pohltí. */
interface Upgrade {
  definition: Definition;
  x: number;
  y: number;
  absorbed: number[];
}

/**
 * Zkusí budovu povýšit. Vrací `true`, když se něco stalo.
 *
 * **Šířka má přednost před výškou** (zadání autora): dřív než budova vyroste
 * o patro, zkusí pohltit sousední parcelu. Volající si musí sám ohlídat prahy
 * ceny půdy, poptávku a cooldown — tahle funkce řeší jen „co je vůbec možné".
 */
export function tryUpgrade(
  world: WorldState,
  catalogue: BuildingCatalogue,
  building: Building,
): boolean {
  const definition = catalogue.get(building.definitionId);
  if (!definition) return false;

  const widen = planWiden(world, catalogue, definition, building);
  const upgrade = widen ?? planTaller(world, catalogue, definition, building);
  if (!upgrade) return false;

  apply(world, definition, building, upgrade);
  return true;
}

/** Rozšíření do jednoho ze čtyř směrů. Pořadí směrů je pevné. */
function planWiden(
  world: WorldState,
  catalogue: BuildingCatalogue,
  definition: Definition,
  building: Building,
): Upgrade | null {
  const [width, depth] = definition.footprint;
  const zone = world.layers.zone[index(building.x, building.y)] ?? 0;

  for (const [dx, dy] of DIRECTIONS) {
    const newWidth = width + Math.abs(dx);
    const newDepth = depth + Math.abs(dy);
    // Roh se posouvá jen do minusových směrů; do plusu budova roste od svého rohu.
    const x = dx < 0 ? building.x - 1 : building.x;
    const y = dy < 0 ? building.y - 1 : building.y;

    const candidate = pickDefinition(
      world,
      catalogue,
      definition.category,
      newWidth,
      newDepth,
      building.level, // rozšíření drží úroveň, mění se jen půdorys
    );
    if (!candidate) continue;

    const absorbed = claimable(world, catalogue, candidate, building, zone, x, y);
    if (absorbed) return { definition: candidate, x, y, absorbed };
  }

  return null;
}

/**
 * Smí budova zabrat celý obdélník `x, y` o velikosti kandidáta?
 *
 * Vrací seznam budov, které se tím pohltí, nebo `null`, když to nejde. Prázdné
 * pole je platná odpověď — znamená „vejde se to na volné parcely".
 */
function claimable(
  world: WorldState,
  catalogue: BuildingCatalogue,
  candidate: Definition,
  building: Building,
  zone: number,
  x: number,
  y: number,
): number[] | null {
  const [width, depth] = candidate.footprint;
  const absorbed = new Set<number>();

  for (let ty = y; ty < y + depth; ty++) {
    for (let tx = x; tx < x + width; tx++) {
      if (!inBounds(tx, ty)) return null;
      const tile = index(tx, ty);

      if (world.layers.zone[tile] !== zone) return null;
      if (world.layers.road[tile] !== 0) return null;
      const terrain = world.layers.terrain[tile] ?? 0;
      if (!candidate.construction.allowedTerrain.includes(terrain)) return null;

      const occupant = world.layers.buildingId[tile] ?? 0;
      if (occupant === 0 || occupant === building.id) continue;

      // O sloučení rozhoduje úroveň souseda, ne cena půdy jeho dlaždice (R1).
      const neighbour = world.buildings.get(occupant);
      const neighbourDefinition = neighbour && catalogue.get(neighbour.definitionId);
      if (!neighbour || !neighbourDefinition) return null;
      if (neighbourDefinition.category !== candidate.category) return null;
      if (neighbour.level >= building.level) return null;

      absorbed.add(occupant);
    }
  }

  // Setříděné, aby pořadí bourání nezáviselo na pořadí průchodu dlaždicemi.
  return [...absorbed].sort((a, b) => a - b);
}

/** Vyrostení o patro na stejném půdorysu. */
function planTaller(
  world: WorldState,
  catalogue: BuildingCatalogue,
  definition: Definition,
  building: Building,
): Upgrade | null {
  const [width, depth] = definition.footprint;
  const taller = pickDefinition(
    world,
    catalogue,
    definition.category,
    width,
    depth,
    building.level + 1,
  );
  return taller ? { definition: taller, x: building.x, y: building.y, absorbed: [] } : null;
}

/**
 * Přepíše entitu na novou definici.
 *
 * Entita si drží `id` i `builtAtTick` — pro město je to pořád ten samý dům,
 * jen povýšený. Populace a pracovní místa se nesčítají, určuje je nová
 * definice (§8).
 */
function apply(
  world: WorldState,
  previous: Definition,
  building: Building,
  upgrade: Upgrade,
): void {
  clearFootprint(world, previous, building.x, building.y);
  for (const id of upgrade.absorbed) removeBuilding(world, id);

  const { definition } = upgrade;
  building.definitionId = definition.id;
  building.x = upgrade.x;
  building.y = upgrade.y;
  building.level = definition.level;
  building.population = definition.population?.capacity ?? 0;
  building.jobs = definition.jobs?.capacity ?? 0;
  building.levelChangedAtTick = world.tick;

  const [width, depth] = definition.footprint;
  for (let dy = 0; dy < depth; dy++) {
    for (let dx = 0; dx < width; dx++) {
      world.layers.buildingId[index(upgrade.x + dx, upgrade.y + dy)] = building.id;
      markTileDirty(world, upgrade.x + dx, upgrade.y + dy);
    }
  }

  markBuildingDirty(world, building.id);
  markPowerNetworkDirty(world); // jiný půdorys znamená jiné vodiče i jinou spotřebu
  if (previous.service || definition.service) markCoverageDirty(world);
}

function clearFootprint(world: WorldState, definition: Definition, x: number, y: number): void {
  const [width, depth] = definition.footprint;
  for (let dy = 0; dy < depth; dy++) {
    for (let dx = 0; dx < width; dx++) {
      world.layers.buildingId[index(x + dx, y + dy)] = 0;
      markTileDirty(world, x + dx, y + dy);
    }
  }
}
