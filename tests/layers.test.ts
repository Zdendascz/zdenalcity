import { describe, expect, it } from 'vitest';
import {
  createLayers,
  hashLayers,
  inBounds,
  index,
  LAYER_ORDER,
} from '@/sim/layers';
import { MAP_SIZE } from './support/grid';

describe('index / inBounds', () => {
  it('počítá index po řádcích', () => {
    expect(index(0, 0, MAP_SIZE)).toBe(0);
    expect(index(1, 0, MAP_SIZE)).toBe(1);
    expect(index(0, 1, MAP_SIZE)).toBe(MAP_SIZE);
    expect(index(3, 2, MAP_SIZE)).toBe(2 * MAP_SIZE + 3);
    expect(index(MAP_SIZE - 1, MAP_SIZE - 1, MAP_SIZE)).toBe(
      MAP_SIZE * MAP_SIZE - 1,
    );
  });

  it('hlídá okraje mapy', () => {
    expect(inBounds(0, 0, MAP_SIZE)).toBe(true);
    expect(inBounds(MAP_SIZE - 1, MAP_SIZE - 1, MAP_SIZE)).toBe(true);
    expect(inBounds(-1, 0, MAP_SIZE)).toBe(false);
    expect(inBounds(0, -1, MAP_SIZE)).toBe(false);
    expect(inBounds(MAP_SIZE, 0, MAP_SIZE)).toBe(false);
    expect(inBounds(0, MAP_SIZE, MAP_SIZE)).toBe(false);
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
    // Čtyři bajty od verze savu 12: id se nevrací, takže dvoubajtová vrstva
    // byla strop na všechny budovy za celou dobu města.
    expect(layers.buildingId.BYTES_PER_ELEMENT).toBe(4);
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
    layers.terrain[index(64, 64, MAP_SIZE)] = 1;
    expect(hashLayers(layers)).not.toBe(before);
  });

  it('rozlišuje, ve které vrstvě změna nastala', () => {
    const a = createLayers(MAP_SIZE);
    const b = createLayers(MAP_SIZE);
    a.terrain[10] = 1;
    b.zone[10] = 1;
    expect(hashLayers(a)).not.toBe(hashLayers(b));
  });

  it('nezahazuje horní bajty u vícebajtové vrstvy', () => {
    // 0x0101, 0x010001 a 0x01000001 — při hashování jen dolního bajtu nebo
    // jen dolních dvou by každé z nich kolidovalo s jedničkou.
    const hashes = [1, 257, 65_537, 16_777_217].map((id) => {
      const layers = createLayers(MAP_SIZE);
      layers.buildingId[0] = id;
      return hashLayers(layers);
    });
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('id do 65 535 hashuje stejně jako dřívější dvoubajtová vrstva', () => {
    // Rozšíření vrstvy nezměnilo simulaci a golden hashe to dokazují jen tím,
    // že zůstaly stejné. Kdyby se hashovaly i nulové horní bajty, změnil by se
    // každý a nešlo by poznat, jestli se nerozjelo i něco jiného.
    const wide = createLayers(MAP_SIZE);
    wide.buildingId[0] = 4242;
    wide.buildingId[MAP_SIZE * MAP_SIZE - 1] = 0xffff;
    const narrow = { ...wide, buildingId: Uint16Array.from(wide.buildingId) };

    expect(hashLayers(wide)).toBe(hashLayers(narrow as unknown as typeof wide));
  });

  it('vrací 8 hexadecimálních znaků', () => {
    expect(hashLayers(createLayers(MAP_SIZE))).toMatch(/^[0-9a-f]{8}$/);
  });
});
