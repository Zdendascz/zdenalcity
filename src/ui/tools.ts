import type { ZoneType } from '@/sim/layers';

/**
 * Nástroj na levém tlačítku myši.
 *
 * Popisek je vždycky **lokalizační klíč**, nikdy text (§10). U infrastruktury
 * je to rovnou `name` z definice budovy, takže tlačítko pojmenuje obsah a
 * v kódu není jméno ani jedné budovy (P5).
 */
export type ToolAction =
  | { kind: 'road' }
  | { kind: 'bulldoze' }
  | { kind: 'zone'; zone: ZoneType }
  | { kind: 'place'; definitionId: string };

export interface ToolOption {
  id: string;
  labelKey: string;
  /** Klíč `KeyboardEvent.key` malými písmeny. */
  hotkey?: string;
  groupKey: string;
  action: ToolAction;
}
