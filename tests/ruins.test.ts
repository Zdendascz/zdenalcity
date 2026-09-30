import { describe, expect, it } from 'vitest';
import type { Definition } from '@/content/schema';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { demolishRuins, placeDefinition } from '@/sim/commands';
import { spawnRubble } from '@/sim/disasters/rubble';
import { index } from '@/sim/layers';
import { createWorld } from '@/sim/world';

const HOUSE: Definition = {
  id: 'test:house',
  type: 'building',
  category: 'utility',
  name: 'building.house.name',
  description: 'building.house.desc',
  footprint: [1, 1],
  level: 1,
  construction: { cost: 0, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
  economy: { upkeep: 0 },
  graphics: { color: '#8fb4dd', heightLevels: 1 },
};

const catalogue: BuildingCatalogue = {
  get: (id) => (id === HOUSE.id ? HOUSE : undefined),
  byCategory: () => [HOUSE],
};

describe('hromadné bourání ruin (T136)', () => {
  it('zbourá jen opuštěné budovy, obydlené nechá', () => {
    const world = createWorld(1);
    for (const x of [10, 11, 12]) placeDefinition(world, catalogue, 'test:house', x, 10);
    const [a, b, c] = [...world.buildings.values()];
    a!.abandoned = true;
    c!.abandoned = true;

    expect(demolishRuins(world, 5, 5, 20, 20).ok).toBe(true);
    expect([...world.buildings.keys()]).toEqual([b!.id]);
  });

  it('bez ruin v obdélníku odmítne a nic nezmění', () => {
    const world = createWorld(1);
    placeDefinition(world, catalogue, 'test:house', 10, 10);
    const result = demolishRuins(world, 5, 5, 20, 20);
    expect(result.ok).toBe(false);
    expect(world.buildings.size).toBe(1);
  });

  it('uklidí suť a nepustí obdélník větší než mapa', () => {
    const world = createWorld(1);
    spawnRubble(world, index(30, 30, world.size));
    expect(demolishRuins(world, 29, 29, 3, 3).ok).toBe(true);
    expect(world.rubble[index(30, 30, world.size)]).toBe(0);
    expect(demolishRuins(world, 0, 0, 1e9, 1).ok).toBe(false);
  });
});
