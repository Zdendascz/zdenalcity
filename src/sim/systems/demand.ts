import type { System } from './index';

/** Přepočet RCI poptávky. Obsah doplní T7. */
export const demandSystem: System = {
  name: 'demand',
  interval: 4,
  offset: 1,
  run() {},
};
