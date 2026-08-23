import type { BuildingCatalogue } from '../catalogue';
import { index } from '../layers';
import { markBuildingDirty, markTileDirty } from '../world';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * Elektřina ve dvou krocích.
 *
 * 1. **Topologie** — flood fill z elektráren po vodičích do vrstvy `power`.
 *    Vodičem je silnice a budova; samostatné elektrické vedení fáze 1 nemá.
 * 2. **Kapacita** — připojeným budovám se rozdává výroba podle `id`, tedy od
 *    nejstarší. Když výroba nestačí, zbytek zůstane bez proudu.
 *
 * Systém běží každý tik (§5), ale flood fill pouští jen když se síť změnila.
 * Bez toho by se 16 384 dlaždic procházelo čtyřikrát za sekundu pro nic.
 */
export function createPowerSystem(catalogue: BuildingCatalogue): System {
  return {
    name: 'power',
    interval: 1,
    offset: 0,
    run(world: WorldState) {
      if (!world.powerNetworkDirty) return;
      world.powerNetworkDirty = false;
      recompute(world, catalogue);
    },
  };
}

function recompute(world: WorldState, catalogue: BuildingCatalogue): void {
  // Pořadí budov je vzestupně podle id — deterministické bez ohledu na to,
  // jak se mapa naplnila (P2).
  const ids = [...world.buildings.keys()].sort((a, b) => a - b);

  const reached = new Uint8Array(world.layers.power.length);
  const queue: number[] = [];
  let production = 0;

  for (const id of ids) {
    const building = world.buildings.get(id);
    if (!building) continue;
    const definition = catalogue.get(building.definitionId);
    const produced = definition?.power?.production ?? 0;
    if (!definition || produced <= 0) continue;

    production += produced;

    const [width, depth] = definition.footprint;
    for (let dy = 0; dy < depth; dy++) {
      for (let dx = 0; dx < width; dx++) {
        const tile = index(building.x + dx, building.y + dy, world.size);
        if (reached[tile] === 0) {
          reached[tile] = 1;
          queue.push(tile);
        }
      }
    }
  }

  floodFill(world, reached, queue);
  writePowerLayer(world, reached);
  distributeCapacity(world, catalogue, ids, production);
}

function floodFill(world: WorldState, reached: Uint8Array, queue: number[]): void {
  const size = world.size;
  const { road, buildingId } = world.layers;

  const visit = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const tile = index(x, y, size);
    if (reached[tile] !== 0) return;
    // Vodičem je silnice nebo budova. Prázdná dlaždice proud nevede.
    if (road[tile] === 0 && buildingId[tile] === 0) return;
    reached[tile] = 1;
    queue.push(tile);
  };

  while (queue.length > 0) {
    const tile = queue.pop();
    if (tile === undefined) break;
    const x = tile % size;
    const y = (tile - x) / size;
    visit(x, y - 1);
    visit(x + 1, y);
    visit(x, y + 1);
    visit(x - 1, y);
  }
}

function writePowerLayer(world: WorldState, reached: Uint8Array): void {
  const power = world.layers.power;

  for (let tile = 0; tile < power.length; tile++) {
    const next = reached[tile] === 1 ? 1 : 0;
    if (power[tile] === next) continue;
    power[tile] = next;
    const x = tile % world.size;
    markTileDirty(world, x, (tile - x) / world.size);
  }
}

function distributeCapacity(
  world: WorldState,
  catalogue: BuildingCatalogue,
  ids: readonly number[],
  production: number,
): void {
  let remaining = production;

  for (const id of ids) {
    const building = world.buildings.get(id);
    if (!building) continue;

    const definition = catalogue.get(building.definitionId);
    const consumption = definition?.power?.consumption ?? 0;
    const connected = isConnected(world, building.x, building.y, definition?.footprint);

    let powered = false;
    // Ruina proud nebere a ani se za připojenou nepovažuje — jinak by prázdné
    // domy ukrajovaly kapacitu živým. Vodičem přes pozemek zůstává.
    if (connected && !building.abandoned) {
      if (consumption === 0) {
        powered = true; // elektrárny a budovy bez spotřeby
      } else if (remaining >= consumption) {
        powered = true;
        remaining -= consumption;
      }
    }

    if (building.powered !== powered) {
      building.powered = powered;
      markBuildingDirty(world, id);
    }
  }
}

function isConnected(
  world: WorldState,
  x: number,
  y: number,
  footprint: readonly [number, number] | undefined,
): boolean {
  const [width, depth] = footprint ?? [1, 1];

  for (let dy = 0; dy < depth; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const tileX = x + dx;
      const tileY = y + dy;
      if (tileX >= world.size || tileY >= world.size) continue;
      if (world.layers.power[index(tileX, tileY, world.size)] === 1)
        return true;
    }
  }

  return false;
}
