import type { Definition } from '@/content/schema';

/**
 * Co simulace potřebuje z obsahu. Úzké rozhraní místo celého registru, aby
 * `sim/` nezávisel na tom, jak se obsah načítá, a šel testovat s atrapou.
 *
 * `ContentRegistry` ho splňuje strukturálně, bez deklarace `implements`.
 */
export interface BuildingCatalogue {
  get(id: string): Definition | undefined;
  byCategory(category: string): readonly Definition[];
}
