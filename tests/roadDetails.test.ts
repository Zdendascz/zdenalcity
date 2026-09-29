import { describe, expect, it } from 'vitest';
import {
  bridgeParts,
  hasRoundabout,
  roadMarkings,
  roundabout,
  SIDEWALK,
  sidewalks,
} from '@/render/roadDetails';
import type { UV } from '@/render/roadDetails';
import { ROAD_E, ROAD_N, ROAD_S, ROAD_W } from '@/render/roads';

const bounds = (points: readonly UV[]) => ({
  u0: Math.min(...points.map((p) => p[0])),
  u1: Math.max(...points.map((p) => p[0])),
  v0: Math.min(...points.map((p) => p[1])),
  v1: Math.max(...points.map((p) => p[1])),
});

describe('značení silnic (T122)', () => {
  const street = { width: 0.38, lanes: 2 as const, edges: false };

  it('přerušovaná středová čára navazuje přes hranici dlaždice', () => {
    // Rovinka sever–jih: čárka u severní hrany jedné dlaždice musí být tam,
    // kde by pokračovala čárka od jižní hrany dlaždice nad ní. Vzor je
    // svázaný s hranou, takže první čárka začíná na GAP/2 a poslední končí
    // na 1 − GAP/2 + … — souměrně.
    const lines = roadMarkings(ROAD_N | ROAD_S, street).map(bounds);
    const top = Math.min(...lines.map((l) => l.v0));
    const bottom = Math.max(...lines.map((l) => l.v1));
    expect(top).toBeCloseTo(1 - bottom, 5);
    // Čára leží na ose.
    for (const line of lines) expect((line.u0 + line.u1) / 2).toBeCloseTo(0.5, 5);
  });

  it('uvnitř křižovatky se nekreslí nic', () => {
    const lo = 0.5 - 0.38 / 2;
    const hi = 0.5 + 0.38 / 2;
    const lines = roadMarkings(ROAD_N | ROAD_E | ROAD_S | ROAD_W, street).map(bounds);
    for (const line of lines) {
      const inside = line.u0 > lo + 1e-6 && line.u1 < hi - 1e-6 && line.v0 > lo + 1e-6 && line.v1 < hi - 1e-6;
      expect(inside).toBe(false);
    }
  });

  it('dálnice má dvojitou čáru a dva pruhy na každý směr', () => {
    const lines = roadMarkings(ROAD_E | ROAD_W, { width: 0.75, lanes: 4, edges: true }).map(bounds);
    // Podélné čáry (po u) seskupené podle polohy napříč.
    const across = new Set(lines.filter((l) => l.u1 - l.u0 > l.v1 - l.v0).map((l) => ((l.v0 + l.v1) / 2).toFixed(3)));
    // krajnice ×2, dvojčára ×2, čáry mezi pruhy ×2
    expect(across.size).toBe(6);
  });
});

describe('chodník (T122)', () => {
  it('leží jen na straně s domem a ne tam, kam vede silnice', () => {
    const parts = sidewalks(ROAD_N | ROAD_S, ROAD_E | ROAD_N, 0.38, 0.08);
    const walks = parts.filter((p) => p.kind === 'sidewalk').map((p) => bounds(p.points));
    expect(walks).toHaveLength(1);
    expect(walks[0]!.u0).toBeCloseTo(1 - SIDEWALK, 5);
  });

  it('na dálnici se nevejde', () => {
    expect(sidewalks(ROAD_E | ROAD_W, ROAD_N, 0.75, 0.08)).toEqual([]);
  });
});

describe('kruhový objezd a most (T122)', () => {
  it('kruháč je vždycky na týchž souřadnicích a jen na části z nich', () => {
    let count = 0;
    for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) if (hasRoundabout(x, y)) count++;
    expect(hasRoundabout(7, 9)).toBe(hasRoundabout(7, 9));
    expect(count).toBeGreaterThan(500);
    expect(count).toBeLessThan(1500);
    for (const part of roundabout()) {
      for (const [u, v] of part.points) {
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(1);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('most má zábradlí na obou stranách každého ramene', () => {
    const rails = bridgeParts(ROAD_E | ROAD_W, 0.55).filter((p) => p.kind === 'railing');
    // dvě ramena × dvě strany + dvě příčná (sever a jih uzavřené)
    expect(rails).toHaveLength(6);
  });
});

describe('WebP k obrázkům obsahu (T121)', () => {
  it('ke každému PNG existuje WebP, jinak by obrázek ve hře chyběl', () => {
    // Glob jen vyjmenuje soubory; obsah se nečte.
    const pngs = Object.keys(import.meta.glob('../content/vanilla/{sprites,tiles,parts,skirts}/*.png'));
    const webps = new Set(Object.keys(import.meta.glob('../content/vanilla/{sprites,tiles,parts,skirts}/*.webp')));
    const missing = pngs.filter((png) => !webps.has(png.replace(/\.png$/, '.webp')));
    expect(missing, 'pusť python tools/make-webp.py').toEqual([]);
  });
});
