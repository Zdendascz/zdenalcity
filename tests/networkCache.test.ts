import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { applySaveToWorld, unpackSave } from '@/save/deserialize';
import { migrate } from '@/save/migrations';
import { createDefaultSystems } from '@/sim/systems';
import { forgetPowerCache } from '@/sim/systems/power';
import { forgetWaterCache } from '@/sim/systems/water';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';

/**
 * Zkratka přepočtu sítí (T133) musí dát **totéž** co úplný přepočet.
 *
 * Elektřina i voda si pamatují tvar sítě a při domě vyrostlém na zóně ho
 * nepočítají znovu. Tady běží dvě kopie téhož města vedle sebe: jedna se
 * zkratkou, druhá s pamětí smazanou před každým tikem, tedy vždy úplně.
 * Když se rozejdou, zkratka něco přehlédla — a v živém městě se růst
 * rozjede, takže i drobný rozdíl je po pár stech ticích vidět.
 */

const regressions = import.meta.glob('./fixtures/regressions/*.base64', {
  eager: true,
  query: '?raw',
  import: 'default',
});

function decode(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function load(): WorldState {
  const entry = Object.entries(regressions).find(([path]) => path.includes('overfunded-services'));
  if (!entry) throw new Error('chybí fixtura overfunded-services');
  const world = createWorld(1);
  applySaveToWorld(world, migrate(unpackSave(decode(entry[1] as string))));
  return world;
}

function fingerprint(world: WorldState): string {
  let hash = 0;
  const mix = (value: number): void => {
    hash = (Math.imul(hash, 31) + (value | 0)) | 0;
  };
  for (const value of world.layers.power) mix(value);
  for (const value of world.waterSupply) mix(value);
  for (const value of world.wireLoad) mix(Math.round(value * 1000));
  for (const value of world.wireOverloaded) mix(value);
  for (const [id, building] of world.buildings) {
    mix(id);
    mix(building.powered ? 1 : 0);
    mix(building.population);
    mix(building.level);
  }
  for (const id of [...world.watered].sort((a, b) => a - b)) mix(id);
  return `${world.tick}:${world.buildings.size}:${hash}`;
}

describe('zkratka přepočtu sítí', () => {
  it('dá po stovkách tiků totéž co úplný přepočet', { timeout: 120_000 }, async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    const balance = content.getBalance();
    const fast = load();
    const full = load();
    const fastSystems = createDefaultSystems(content, balance);
    const fullSystems = createDefaultSystems(content, balance);
    const shape = (world: WorldState): number =>
      world.buildings.size * 1000 + [...world.buildings.values()].reduce((sum, b) => sum + b.level, 0);
    const before = shape(fast);

    for (let tick = 0; tick < 400; tick++) {
      forgetPowerCache(full);
      forgetWaterCache(full);
      tickWorld(fast, fastSystems);
      tickWorld(full, fullSystems);
      if (tick % 50 === 49) expect(fingerprint(fast)).toBe(fingerprint(full));
    }
    expect(fingerprint(fast)).toBe(fingerprint(full));
    // Test má smysl, jen když ve městě něco vyrostlo nebo zmizelo.
    expect(shape(fast)).not.toBe(before);
  });
});
