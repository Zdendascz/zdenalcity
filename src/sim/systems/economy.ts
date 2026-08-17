import type { System } from './index';

/** Měsíční rozpočet — 30 tiků = měsíc. Obsah doplní T7. */
export const economySystem: System = {
  name: 'economy',
  interval: 30,
  offset: 0,
  run() {},
};
