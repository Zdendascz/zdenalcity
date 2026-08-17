import { describe, expect, it } from 'vitest';
import { createLayers, hashLayers, inBounds, index, LAYER_ORDER, MAP_SIZE } from '@/sim/layers';

describe('index / inBounds', () => {
  it('počítá index po řádcích', () => {
    expect(index(0, 0)).toBe(0);
    expect(index(1, 0)).toBe(1);
    expect(index(0, 1)).toBe(MAP_SIZE);
    expect(index(3, 2)).toBe(2 * MAP_SIZE + 3);
    expect(index(MAP_SIZE - 1, MAP_SIZE - 1)).toBe(MAP_SIZE * MAP_SIZE - 1);
  });

  it('hlídá okraje mapy', () => {
    expect(inBounds(0, 0)).toBe(true);
    expect(inBounds(MAP_SIZE - 1, MAP_SIZE - 1)).toBe(true);
    expect(inBounds(-1, 0)).toBe(false);
    expect(inBounds(0, -1)).toBe(false);
    expect(inBounds(MAP_SIZE, 0)).toBe(false);
    expect(inBounds(0, MAP_SIZE)).toBe(false);
  });
});

describe('createLayers', () => {
  it('alokuje typed arrays správné velikosti a šířky (P4)', () => {
    const layers = createLayers(MAP_SIZE);
    const cells = MAP_SIZE * MAP_SIZE;

    for (const name of LAYER_ORDER) {
      expect(layers[name].length, name).toBe(cells);
    }

    expect(layers.terrain.BYTES_PER_ELEMENT).toBe(1);
    expect(layers.buildingId.BYTES_PER_ELEMENT).toBe(2);
  });

  it('startuje vynulovaná', () => {
    const layers = createLayers(MAP_SIZE);
    for (const name of LAYER_ORDER) {
      let nonZero = 0;
      for (const value of layers[name]) {
        if (value !== 0) nonZero++;
      }
      expect(nonZero, name).toBe(0);
    }
  });
});

describe('hashLayers', () => {
  it('je stabilní pro identická data', () => {
    expect(hashLayers(createLayers(MAP_SIZE))).toBe(hashLayers(createLayers(MAP_SIZE)));
  });

  it('reaguje na změnu jediné dlaždice', () => {
    const layers = createLayers(MAP_SIZE);
    const before = hashLayers(layers);
    layers.terrain[index(64, 64)] = 1;
    expect(hashLayers(layers)).not.toBe(before);
  });

  it('rozlišuje, ve které vrstvě změna nastala', () => {
    const a = createLayers(MAP_SIZE);
    const b = createLayers(MAP_SIZE);
    a.terrain[10] = 1;
    b.zone[10] = 1;
    expect(hashLayers(a)).not.toBe(hashLayers(b));
  });

  it('nezahazuje horní bajt u Uint16 vrstvy', () => {
    const a = createLayers(MAP_SIZE);
    const b = createLayers(MAP_SIZE);
    a.buildingId[0] = 1;
    b.buildingId[0] = 257; // 0x0101 — při hashování jen dolního bajtu by kolidovalo
    expect(hashLayers(a)).not.toBe(hashLayers(b));
  });

  it('vrací 8 hexadecimálních znaků', () => {
    expect(hashLayers(createLayers(MAP_SIZE))).toMatch(/^[0-9a-f]{8}$/);
  });
});
