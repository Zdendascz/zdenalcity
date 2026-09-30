import { describe, expect, it } from 'vitest';
import { depthOrder, insertIntoOrder, mustDrawBefore } from '@/render/depth';
import type { DepthBox } from '@/render/depth';

/**
 * Vkládání do hotového pořadí (T133) musí dát **platné** pořadí: každá
 * dvojice, u které záleží na tom, kdo je vepředu, musí vyjít stejně jako
 * při úplném řazení. Na dvojicích, které se nepřekrývají, nezáleží.
 */

/** Náhodné město: domy různých půdorysů bez překryvu a hodně 1 × 1 kolem. */
function city(seed: number, size = 48): Map<number, DepthBox> {
  let state = seed;
  const random = (): number => ((state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  const taken = new Uint8Array(size * size);
  const boxes = new Map<number, DepthBox>();
  let id = 1;
  for (let attempt = 0; attempt < size * size; attempt++) {
    const width = random() < 0.6 ? 1 : 1 + Math.floor(random() * 4);
    const depth = width === 1 ? 1 : 1 + Math.floor(random() * 4);
    const x = Math.floor(random() * (size - width));
    const y = Math.floor(random() * (size - depth));
    let free = true;
    for (let dy = 0; dy < depth && free; dy++) {
      for (let dx = 0; dx < width; dx++) if (taken[(y + dy) * size + x + dx]) free = false;
    }
    if (!free) continue;
    for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) taken[(y + dy) * size + x + dx] = 1;
    boxes.set(id++, { x, y, width, depth, base: Math.floor(random() * 3) });
  }
  return boxes;
}

/**
 * Dvojice ve špatném pořadí. Počítají se jen ty, jejichž svislé pruhy
 * obrazovky se překrývají — jiné se nepřekryjí a `depthOrder` je neřadí.
 */
function violations(order: readonly number[], boxes: ReadonlyMap<number, DepthBox>): number {
  const at = new Map(order.map((id, i) => [id, i]));
  const from = (b: DepthBox): number => b.x - (b.y + b.depth);
  const to = (b: DepthBox): number => b.x + b.width - b.y;
  let bad = 0;
  for (const [a, boxA] of boxes) {
    for (const [b, boxB] of boxes) {
      if (a === b || to(boxA) <= from(boxB) || to(boxB) <= from(boxA)) continue;
      if (mustDrawBefore(boxA, boxB) && at.get(a)! > at.get(b)!) bad++;
    }
  }
  return bad;
}

describe('vkládání do hotového pořadí', () => {
  it('dá platné pořadí i tam, kde se musí přeřadit úsek', () => {
    let inserted = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const boxes = city(seed);
      const ids = [...boxes.keys()];
      // Každý sedmý uzel „přibyl“ až po seřazení.
      const added = ids.filter((id) => id % 7 === 0);
      const before = new Map([...boxes].filter(([id]) => id % 7 !== 0));
      const order = insertIntoOrder(depthOrder(before), boxes, added);
      expect(order).not.toBeNull();
      if (order === null) continue;
      inserted++;
      expect(order).toHaveLength(boxes.size);
      expect(new Set(order).size).toBe(boxes.size);
      expect(violations(order, boxes)).toBe(0);
    }
    expect(inserted).toBe(20);
  });

  it('úplné řazení je podle téhož měřítka platné', () => {
    const boxes = city(5);
    expect(violations(depthOrder(boxes), boxes)).toBe(0);
  });

  it('bez nových uzlů pořadí nezmění', () => {
    const boxes = city(3);
    const order = depthOrder(boxes);
    expect(insertIntoOrder(order, boxes, [])).toEqual(order);
  });
});
