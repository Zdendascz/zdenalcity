import type { ZoneType } from './layers';

/**
 * Všechny hráčské akce jdou přes `SimHost.dispatch`. `WorldState` se nikdy
 * nemodifikuje z UI ani z rendereru přímo.
 *
 * Union je kompletní podle architektury §5, ale obsluha se doplňuje po úkolech —
 * viz switch v `simHost.ts`. V T1 je implementován jen `set_speed`.
 */
export type Command =
  | { type: 'build_road'; x: number; y: number }
  | { type: 'bulldoze'; x: number; y: number }
  | { type: 'zone'; x: number; y: number; w: number; h: number; zone: ZoneType }
  | { type: 'place_building'; definitionId: string; x: number; y: number }
  | { type: 'set_tax_rate'; zone: ZoneType; rate: number }
  | { type: 'set_speed'; speed: number };
