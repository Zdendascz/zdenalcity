import type { ZoneType } from '@/sim/layers';

/**
 * Nástroj na levém tlačítku myši.
 *
 * Popisek je vždycky **lokalizační klíč**, nikdy text (§10). U budov je to
 * rovnou `name` z definice, takže tlačítko pojmenuje obsah a v kódu není jméno
 * ani jedné budovy (P5). Totéž platí pro ikonu i zařazení do nabídky.
 */
export type ToolAction =
  /**
   * Pacička: posun po mapě levým tlačítkem a **výběr** kliknutím.
   *
   * Dvě věci v jednom nástroji schválně (rozhodnutí autora): posouvat mapu šlo
   * jen prostředním tlačítkem nebo mezerníkem s levým, což na notebooku bez myši
   * nejde pohodlně. Klik bez tažení dělá totéž co pravé tlačítko, tedy otevře
   * detail budovy — proto nemá vlastní větev v `applyTool`, obsluhuje se
   * u ukazatele.
   */
  | { kind: 'pan' }
  | { kind: 'road'; roadType: number }
  /**
   * Potrubí. **Vlastní nástroj, ne přepnutý stavební**: do T41 kladl trubky
   * nástroj silnice, když byl zapnutý podzemní pohled, jenže lišta u toho dál
   * hlásila „Ulice, 10" a účtovala šest. Rozhraní lhalo a hráč neměl jak
   * poznat, že se vodovod vůbec staví.
   */
  | { kind: 'pipe' }
  /**
   * Elektrické vedení (T129): `wire` je `WIRE.low` nebo `WIRE.high`,
   * `WIRE.none` je odstranění vedení.
   */
  | { kind: 'wire'; wire: number }
  | { kind: 'bulldoze' }
  /** Hromadné bourání: v obdélníku jen opuštěné budovy a suť (T136). */
  | { kind: 'demolishRuins' }
  | { kind: 'zone'; zone: ZoneType }
  | { kind: 'place'; definitionId: string }
  /** Terraforming: kladná delta zvedá, záporná sníží. Nula srovná oblast. */
  | { kind: 'terraform'; delta: number }
  /**
   * Dozdění: plocha se zaveze na úroveň **nejvyššího** rohu, místo aby se
   * odkopala na průměr. U kopce tak vznikne terasa nahoře, ne jáma dole.
   */
  | { kind: 'fill' }
  /**
   * Vysazení lesa. Opak buldozeru na lese: z trávy udělá les, který pohlcuje
   * znečištění a zvedá cenu půdy.
   */
  | { kind: 'plantTrees' };

export interface ToolOption {
  id: string;
  labelKey: string;
  /**
   * Klíč popisu do bubliny (T138): co nástroj dělá a k čemu je. U budov je
   * to `desc` z definice, u ostatních `<labelKey>.hint`. Chybějící klíč
   * bublinu neshodí, jen v ní zůstane název — hlídá to test.
   */
  hintKey?: string;
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
  /** Platí se cena za každou dlaždici tahu (silnice, vedení, potrubí, les)? */
  perTile?: boolean;
  /**
   * Kolik nástroj unese — vedení a trafostanice (T136). Vypíše se vedle ceny,
   * „ať člověk ví co a jak".
   */
  capacity?: number;
  action: ToolAction;
}
