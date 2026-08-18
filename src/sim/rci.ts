import { ZONE } from './layers';

/**
 * Tři zónové kategorie, na kterých stojí poptávka i daně.
 *
 * Kategorie je zároveň hodnota v definicích obsahu (`category` v JSONu), takže
 * tohle je jediné místo, kde se mřížková zóna potkává s taxonomií obsahu.
 * Konkrétní budovy tady nejsou (P5).
 */
export const RCI_CATEGORIES = ['residential', 'commercial', 'industrial'] as const;

export type RciCategory = (typeof RCI_CATEGORIES)[number];

export function categoryForZone(zone: number): RciCategory | null {
  if (zone === ZONE.residential) return 'residential';
  if (zone === ZONE.commercial) return 'commercial';
  if (zone === ZONE.industrial) return 'industrial';
  return null;
}

export function isRciCategory(category: string): category is RciCategory {
  return (RCI_CATEGORIES as readonly string[]).includes(category);
}
