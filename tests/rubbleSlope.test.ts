import { describe, expect, it } from 'vitest';
import { cornerIndex, createCornerHeights } from '@/sim/heights';
import { rubbleSlope } from '@/render/decor';
import { CORNER_SIZE, MAP_SIZE } from './support/grid';

/**
 * Který obrázek suti padne na kterou dlaždici.
 *
 * Plochá hromada na nakloněné rovině sedět nemůže: buď jí polovina visí, nebo
 * se zaboří. Autor to nahlásil dvakrát — „suť je pořád nad kopcem, ne na
 * stráni" a pak „je to lepší, ale ne dokonalé" — a vyžádal si obrázky
 * kreslené přímo do svahu.
 *
 * Rohy dlaždice leží na obrazovce takhle: **nw nahoře, ne vpravo, sw vlevo,
 * se dole**. Hromada se vybírá podle **nejnižší hrany** kosočtverce, protože
 * tam země klesá — a přesně tak jsou obrázky nakreslené.
 */
describe('sklon pod hromadou suti', () => {
  /** Rovina, do které se dá jednotlivým rohům sáhnout. */
  function heights(): Uint8Array {
    const out = createCornerHeights(MAP_SIZE);
    out.fill(4);
    return out;
  }

  /** Dlaždice (10,10): rohy jsou (10,10), (11,10), (10,11) a (11,11). */
  function set(out: Uint8Array, cx: number, cy: number, value: number): void {
    out[cornerIndex(cx, cy, CORNER_SIZE)] = value;
  }

  it('rovná dlaždice dostane rovnou hromadu', () => {
    expect(rubbleSlope(heights(), 10, 10)).toBe('flat');
  });

  it('rampa klesající vpravo dolů vybere `lr`', () => {
    // Klesá k hraně mezi pravým (ne) a dolním (se) rohem.
    const out = heights();
    set(out, 11, 10, 3);
    set(out, 11, 11, 3);
    expect(rubbleSlope(out, 10, 10)).toBe('lr');
  });

  it('rampa klesající vlevo dolů vybere `ll`', () => {
    const out = heights();
    set(out, 10, 11, 3);
    set(out, 11, 11, 3);
    expect(rubbleSlope(out, 10, 10)).toBe('ll');
  });

  it('rampa klesající vlevo nahoru vybere `ul`', () => {
    const out = heights();
    set(out, 10, 10, 3);
    set(out, 10, 11, 3);
    expect(rubbleSlope(out, 10, 10)).toBe('ul');
  });

  it('rampa klesající vpravo nahoru vybere `ur`', () => {
    const out = heights();
    set(out, 10, 10, 3);
    set(out, 11, 10, 3);
    expect(rubbleSlope(out, 10, 10)).toBe('ur');
  });

  it('dlaždice klesající k jednomu rohu si vezme nejbližší hranu', () => {
    // Klesá k dolnímu rohu, tedy mezi `lr` a `ll`. Obojí je vedle sebe a
    // rozhoduje pevné pořadí, aby výběr nezávisel na ničem proměnlivém (P2).
    const out = heights();
    set(out, 11, 11, 3);
    const picked = rubbleSlope(out, 10, 10);
    expect(['lr', 'll']).toContain(picked);
    // A hlavně **stabilně**: dvakrát totéž.
    expect(rubbleSlope(out, 10, 10)).toBe(picked);
  });

  it('sedlo taky dostane sklon, ne rovinu — zkroucená dlaždice rovná není', () => {
    const out = heights();
    set(out, 10, 10, 3);
    set(out, 11, 11, 3);
    expect(rubbleSlope(out, 10, 10)).not.toBe('flat');
  });
});
