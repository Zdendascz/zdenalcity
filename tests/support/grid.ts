import { coarseCellsOf, coarseSizeOf } from "@/sim/coarse";
import { cornerCellsOf, cornerSizeOf } from "@/sim/heights";
import { DEFAULT_MAP_SIZE } from "@/sim/layers";

/**
 * Rozměry mřížek pro **výchozí** velikost mapy.
 *
 * Od T42 je velikost běhový údaj (`world.size`), ne konstanta. Většina testů
 * ale zkoumá něco jiného než škálování a pracuje se světem výchozí velikosti;
 * pro ně je pohodlnější sáhnout sem než si velikost tahat z každého světa.
 *
 * Co se naopak chová jinak podle velikosti mapy, si `size` musí předat samo —
 * a testuje se to v `layers.test.ts` a `mapgen.test.ts` na víc velikostech.
 */
export const MAP_SIZE = DEFAULT_MAP_SIZE;
export const COARSE_SIZE = coarseSizeOf(MAP_SIZE);
export const COARSE_CELLS = coarseCellsOf(MAP_SIZE);
export const CORNER_SIZE = cornerSizeOf(MAP_SIZE);
export const CORNER_CELLS = cornerCellsOf(MAP_SIZE);
