import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import type { WorldState } from '../world';
import type { ActiveDisaster } from './state';

/**
 * Rozhraní jedné katastrofy (R13 fáze 4).
 *
 * Rozhodnutí autora: **každá má vlastní mechaniku, ne konfiguraci nad společným
 * tvarem.** Tornádo je pohyb v čase, nepokoje stav, oheň šíření — vecpat je do
 * jedné tabulky by znamenalo tabulku s patnácti výjimkami.
 *
 * Společné je jen tohle: kdy začít, co dělat každý tik a kdy je konec. Vlastní
 * stav si katastrofa drží v `ActiveDisaster.state`, aby ho uměl uložit save,
 * aniž by o jednotlivých pohromách cokoli věděl.
 */
export interface DisasterContext {
  readonly world: WorldState;
  readonly catalogue: BuildingCatalogue;
  readonly balance: Balance;
  /** Kde to má vzniknout. Plánovač ho vybere, menu ho dostane od hráče. */
  readonly x: number;
  readonly y: number;
}

export interface Disaster {
  readonly kind: string;

  /**
   * Kde má katastrofa vzniknout, když si místo neurčil hráč.
   *
   * Vrací `null`, když ve městě není kam — bez pobřeží není povodeň. Plánovač
   * to bere jako „letos ne", ne jako chybu.
   */
  pickOrigin(world: WorldState, catalogue: BuildingCatalogue, balance: Balance): { x: number; y: number } | null;

  /** Zapíše počáteční stav a udělá první zásah. */
  start(context: DisasterContext, active: ActiveDisaster): void;

  /** Jeden krok. Volá se každý tik, dokud katastrofa neskončí. */
  tick(context: DisasterContext, active: ActiveDisaster): void;

  /**
   * Skončila? Plánovač ji pak uklidí a zruší její dočasné postihy.
   *
   * Bere svět, protože konec bývá jeho vlastnost, ne vlastnost evidence:
   * lesní požár končí, až když nic nehoří, ne až doběhne odpočet.
   */
  isFinished(world: WorldState, active: ActiveDisaster): boolean;

  /**
   * Zapisuje se `lastOccurrence` až při skončení?
   *
   * Povodeň a lesní požár ano — obojí trvá dlouho a hájení od vzniku by
   * znamenalo, že další může přijít, zatímco ta první ještě neopadla.
   * Katalog to u obou poznamenává.
   */
  readonly cooldownFromEnd?: boolean;
}

/**
 * Registr katastrof.
 *
 * Prázdný registr je platný stav: plánovač pak nemá co spustit a hra běží dál.
 * Tak to vypadá po T47, který staví jen kostru — jednotlivé pohromy přidávají
 * T48 až T54.
 */
export class DisasterRegistry {
  private readonly byKind = new Map<string, Disaster>();

  register(disaster: Disaster): void {
    this.byKind.set(disaster.kind, disaster);
  }

  get(kind: string): Disaster | undefined {
    return this.byKind.get(kind);
  }

  /** Setříděné, aby na pořadí registrace nezáleželo — je součástí determinismu. */
  kinds(): string[] {
    return [...this.byKind.keys()].sort();
  }

  get size(): number {
    return this.byKind.size;
  }
}
