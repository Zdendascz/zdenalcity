import type { ZoneType } from '@/sim/layers';

/**
 * Nástroj na levém tlačítku myši.
 *
 * Popisek je vždycky **lokalizační klíč**, nikdy text (§10). U budov je to
 * rovnou `name` z definice, takže tlačítko pojmenuje obsah a v kódu není jméno
 * ani jedné budovy (P5). Totéž platí pro ikonu i zařazení do nabídky.
 */
export type ToolAction =
  | { kind: 'road'; roadType: number }
  | { kind: 'bulldoze' }
  | { kind: 'zone'; zone: ZoneType }
  | { kind: 'place'; definitionId: string }
  /** Terraforming: kladná delta zvedá, záporná sníží. Nula srovná oblast. */
  | { kind: 'terraform'; delta: number };

export interface ToolOption {
  id: string;
  labelKey: string;
  /** Jméno tvaru z `ui/icons.ts` nebo ze střešních symbolů. */
  icon: string;
  /** Klíč `KeyboardEvent.key` malými písmeny. */
  hotkey?: string;
  /**
   * Do které nabídky nástroj patří. Zároveň lokalizační klíč jejího popisku.
   * Nástroje se stejným klíčem musí jít v seznamu za sebou.
   */
  groupKey: string;
  /** Ikona na tlačítku nabídky, dokud si hráč nevybere konkrétní nástroj. */
  groupIcon: string;
  /** Cena, pokud ji zná — vypíše se v nabídce napravo od jména. */
  cost?: number;
  action: ToolAction;
}
