import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import { ADVISOR_PRAISES, ADVISOR_PROBLEMS, cityAdvice } from '@/sim/advisor';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { createWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { HELP_PROBLEMS } from '@/ui/helpData';
import { VANILLA_BALANCE } from './support/balance';

/**
 * Poradce starosty.
 *
 * Zadání: „klikneš a vyskočí dvě největší bolesti, které by měl řešit, a jedna
 * pochvala, co dělá dobře." Testuje se to, co by jinak selhalo potichu —
 * poradce, který radí prázdné placce, poradce, který vždycky najde dvě věci,
 * a rada, ke které chybí text.
 */

const HOUSE: Definition = {
  id: 'test:house',
  type: 'building',
  category: 'residential',
  name: 'building.house.name',
  description: 'building.house.desc',
  footprint: [1, 1],
  level: 1,
  construction: { cost: 100, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
  economy: { upkeep: 10 },
  population: { capacity: 20 },
  graphics: { color: '#8fb4dd', heightLevels: 1 },
};

/**
 * Vodárna, spalovna a čistička v jedné budově.
 *
 * Bez ní má testovací město **stoprocentní** nedostatek vody, odpadu i stok
 * a ty dvě rady zaberou obě místa v poradci — což je správně, jenže pak se
 * na nich nedá zkoušet nic jiného.
 */
const UTILITIES: Definition = {
  ...HOUSE,
  id: 'test:utilities',
  category: 'service',
  population: undefined,
  water: { production: 100000 },
  waste: { capacity: 100000 },
  sewage: { capacity: 100000 },
};

function catalogueOf(...definitions: Definition[]): BuildingCatalogue {
  return {
    get: (id) => definitions.find((definition) => definition.id === id),
    byCategory: (category) => definitions.filter((definition) => definition.category === category),
  };
}

/** Město s lidmi a se sítěmi. Co je špatně, si každý test dodá sám. */
function town(houses: number): WorldState {
  const world = createWorld(1, VANILLA_BALANCE.economy);
  for (let i = 0; i < houses; i++) placeBuilding(world, HOUSE, 10 + i, 10);
  placeBuilding(world, UTILITIES, 10, 12);
  return world;
}

describe('poradce starosty', () => {
  it('prázdné placce neradí nic', () => {
    // Rady o kriminalitě na mapě bez lidí by byly komické — a hlavně by
    // hráče naučily poradce nečíst.
    const world = createWorld(1, VANILLA_BALANCE.economy);
    const advice = cityAdvice(world, catalogueOf(HOUSE, UTILITIES), VANILLA_BALANCE);
    expect(advice.problems).toEqual([]);
    expect(advice.praise).toBeNull();
  });

  it('vrací nejvýš dvě bolesti, seřazené od nejhorší', () => {
    const world = town(20);
    const advice = cityAdvice(world, catalogueOf(HOUSE, UTILITIES), VANILLA_BALANCE);

    expect(advice.problems.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < advice.problems.length; i++) {
      const before = advice.problems[i - 1];
      const current = advice.problems[i];
      expect(before && current && before.weight >= current.weight).toBe(true);
    }
  });

  it('mínus v kase přebije všechno ostatní', () => {
    // Záporná kasa zastaví růst v celém městě. Cokoli jiného je proti tomu
    // detail, takže musí stát první.
    const world = town(20);
    world.economy.funds = -5000;
    const advice = cityAdvice(world, catalogueOf(HOUSE, UTILITIES), VANILLA_BALANCE);
    expect(advice.problems[0]?.id).toBe('bankrupt');
  });

  it('tmavé město pozná podle budov, ne podle elektráren', () => {
    const world = town(20);
    world.economy.funds = 100000;
    for (const building of world.buildings.values()) building.powered = false;

    const advice = cityAdvice(world, catalogueOf(HOUSE, UTILITIES), VANILLA_BALANCE);
    expect(advice.problems.map((item) => item.id)).toContain('needsPower');
  });

  it('za blackoutu neradí dvakrát totéž', () => {
    /*
     * Tma je za výpadku **důsledek**, ne samostatná rada. Kdyby se hlásila
     * zvlášť, zabrala by obě místa jedna věc a hráč by přišel o tu druhou
     * skutečnou bolest.
     */
    const world = town(20);
    world.economy.funds = 100000;
    for (const building of world.buildings.values()) building.powered = false;
    world.disasters.active.push({
      id: 1,
      kind: 'blackout',
      startedAtTick: 0,
      x: 0,
      y: 0,
      state: {},
      finished: false,
    });

    const ids = cityAdvice(world, catalogueOf(HOUSE, UTILITIES), VANILLA_BALANCE).problems.map((i) => i.id);
    expect(ids).toContain('blackout');
    expect(ids).not.toContain('needsPower');
  });

  it('každá rada má odstavec v nápovědě', async () => {
    /*
     * Poradce si **nevymýšlí vlastní slovník** — pošle hráče do textu, který
     * v nápovědě už je. Tenhle test je ta pojistka: nový druh rady si vynutí
     * i vysvětlení, jinak by v panelu svítil syrový klíč.
     */
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    for (const language of content.getLanguages()) {
      const table = content.getLocaleTable(language);
      for (const id of ADVISOR_PROBLEMS) {
        expect(HELP_PROBLEMS, `${id} chybí v seznamu problémů nápovědy`).toContain(id);
        for (const part of ['title', 'cause', 'fix']) {
          expect(table[`ui.help.problem.${id}.${part}`], `${language}: ${id}.${part}`).toBeTruthy();
        }
        expect(table[`ui.advisor.detail.${id}`], `${language}: detail ${id}`).toBeTruthy();
      }
      for (const id of ADVISOR_PRAISES) {
        for (const part of ['title', 'text']) {
          expect(table[`ui.advisor.praise.${id}.${part}`], `${language}: ${id}.${part}`).toBeTruthy();
        }
      }
      for (const key of ['title', 'toggle', 'problems', 'praiseTitle', 'allGood']) {
        expect(table[`ui.advisor.${key}`], `${language}: ui.advisor.${key}`).toBeTruthy();
      }
    }
  });
});
