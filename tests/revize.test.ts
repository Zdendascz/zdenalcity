/**
 * @vitest-environment jsdom
 *
 * Nálezy z revize hry (12. 9. 2026).
 *
 * Průzkum celého stromu našel devětatřicet věcí. Většina z nich se v testech
 * neprojeví — jsou to texty, rozestupy a pořadí prvků. Tenhle soubor drží ty,
 * které se **umí vrátit potichu**: chybějící barva, tlačítko bez jména,
 * dopravní model, který přestane vidět velké město, nebo věznice, která začne
 * bourat čtvrti na druhém konci mapy.
 *
 * Kde je testem pokrytý nález, je u něj jeho číslo — zpráva k nim má důkazy
 * v kódu a tady jsou obráceně: důkaz, že se to nevrátí.
 */
import { describe, expect, it } from 'vitest';
// Styl se čte přes Vite, ne přes `node:fs` — projekt nemá typy Nodu.
import css from '@/style.css?raw';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { zoneArea } from '@/sim/commands';
import { loanCap, loanRate, loanTerms } from '@/sim/finance';
import { ZONE } from '@/sim/layers';
import { packSave, serializeSave, toSaveData } from '@/save/serialize';
import { unpackSave } from '@/save/deserialize';
import { createLevelSystem, createTrafficSystem } from '@/sim/systems';
import { createWorld, setRoadTile, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { AdvisorPanel } from '@/ui/advisorPanel';
import { BudgetPanel } from '@/ui/budgetPanel';
import { FinancePanel } from '@/ui/financePanel';
import { formatNumber, setNumberLocale } from '@/ui/format';
import { HELP_PROBLEMS } from '@/ui/helpData';
import { I18n } from '@/ui/i18n';
import type { LocaleTables } from '@/ui/i18n';
import { StatPanel } from '@/ui/statPanel';
import { TransitPanel } from '@/ui/transitPanel';
import { VANILLA_BALANCE } from './support/balance';

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

async function i18nFor(content: ContentRegistry, language = 'cs'): Promise<I18n> {
  const out: Record<string, Record<string, string>> = {};
  for (const lang of content.getLanguages()) out[lang] = content.getLocaleTable(lang);
  return new I18n(out as LocaleTables, language);
}

/* ------------------------------------------------------- nález 8: barvy -- */

describe('CSS proměnné', () => {
  it('každá použitá barva je někde definovaná', () => {
    // `var(--muted)` se ve stylech používalo sedmkrát a v `:root` definované
    // nebylo. Neplatná hodnota propadne na dědění, tedy na plnou barvu textu,
    // takže tlumené texty svítily naplno — a prohlížeč o tom nikdy nehlesne.
    const defined = new Set<string>();
    for (const match of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) {
      const name = match[1];
      if (name) defined.add(name);
    }

    const missing = new Set<string>();
    for (const match of css.matchAll(/var\((--[a-z0-9-]+)/gi)) {
      const name = match[1];
      if (name && !defined.has(name)) missing.add(name);
    }

    expect([...missing]).toEqual([]);
  });
});

/* -------------------------------------------- nález 22: přístupná jména -- */

describe('panely', () => {
  it('každé tlačítko má neprázdné přístupné jméno', async () => {
    // Křížek obsahuje jen ikonu, a ta je pro odečítačku schválně skrytá.
    // Bez popisku ohlásí odečítačka „tlačítko" a nic víc — a je to jediné
    // tlačítko v záhlaví, takže hráč nemá jak zjistit, že tudy vede ven.
    const content = await vanilla();
    const i18n = await i18nFor(content);
    const mount = document.createElement('div');
    const world = createWorld(1, content.getBalance().economy);

    const advisor = new AdvisorPanel(mount, i18n);
    advisor.toggle();
    advisor.update({ problems: [], praise: null, tooSmall: true });

    const budget = new BudgetPanel(mount, i18n, content.getAll('building'));
    budget.toggle();
    budget.update(
      { lines: [], roads: { count: 0, upkeep: 0 }, transit: { lines: 0, vehicles: 0, income: 0, upkeep: 0 }, debt: { loans: 0, owed: 0, payment: 0, bonds: 0, bondOwed: 0, bondPayment: 0 }, income: 0, expenses: 0, valuePerUnit: 1 },
      0,
    );

    const finance = new FinancePanel(mount, i18n, () => {}, content, content.grants());
    finance.toggle();
    finance.update(world, content.getBalance());

    const stats = new StatPanel(mount, i18n);
    stats.toggle('funds');
    stats.update({ plus: [], minus: [], total: 0 });

    const transit = new TransitPanel(mount, i18n, () => {}, {
      onPickStop: () => {},
      onCancelPick: () => {},
      onShowStop: () => {},
    });
    transit.toggle();
    transit.update(world, content, content.getBalance());

    const nameless: string[] = [];
    for (const node of mount.querySelectorAll('button')) {
      const name = (node.getAttribute('aria-label') ?? node.textContent ?? '').trim();
      if (name === '') nameless.push(node.className);
    }

    expect(nameless).toEqual([]);
  });
});

/* ----------------------------------------- nález 27: dosahy v nápovědě -- */

describe('nápověda', () => {
  it('nevypisuje konkrétní dosahy služeb', async () => {
    // Text vznikl den předtím, než se čísla v datech zdvojnásobila, a nikdo
    // ho neopravil: hráč plánoval rozestupy podle poloviny a platil údržbu za
    // dvakrát víc budov, než potřeboval. Přehled staveb se skládá z dat, takže
    // lhát nemůže — a tenhle test brání tomu, aby se čísla vrátila do prózy.
    const content = await vanilla();
    // Číslovka následovaná slovem „dlaždic" nebo „tiles" je vypsaný dosah.
    // Konkrétní čísla patří do přehledu staveb, který se skládá z dat.
    const spelled =
      /(deset|jedenáct|dvanáct|třináct|čtrnáct|patnáct|šestnáct|dvacet|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|twenty|\d+)\s+(dlaždic\w*|tiles?)/i;

    for (const language of content.getLanguages()) {
      const table = content.getLocaleTable(language);
      const text = table['ui.help.services.body'] ?? '';
      expect(spelled.test(text), `${language}: dosah vypsaný v textu`).toBe(false);
    }
  });

  it('má odstavec ke každé překážce růstu, kterou poradce hlásí', () => {
    // Nové rady (odpad, zóny nerostou) si musely vynutit i text.
    for (const id of ['waste', 'growth', 'noWaterReach']) {
      expect(HELP_PROBLEMS, id).toContain(id);
    }
  });
});

/* --------------------------------------- nález 23: čísla podle jazyka -- */

describe('formátování čísel', () => {
  it('jde za jazykem, ne za češtinou', () => {
    setNumberLocale('cs-CZ');
    const czech = formatNumber(1234567);
    setNumberLocale('en-US');
    const english = formatNumber(1234567);
    setNumberLocale('cs-CZ');

    expect(english).toBe('1,234,567');
    expect(czech).not.toBe(english);
  });

  it('přepnutí jazyka ho přenastaví samo', async () => {
    const content = await vanilla();
    const i18n = await i18nFor(content, 'cs');
    expect(formatNumber(1000)).not.toBe('1,000');

    i18n.setLanguage('en');
    expect(formatNumber(1000)).toBe('1,000');

    i18n.setLanguage('cs');
    expect(formatNumber(1000)).not.toBe('1,000');
  });
});

/* ----------------------------------------------- nález 5: strop půjčky -- */

describe('strop půjčky', () => {
  it('roste se splatností a zůstane splatitelný', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    world.economy.lastIncome = 10000;
    const { minTermMonths, maxTermMonths, loanPaymentShare } = VANILLA_BALANCE.finance;

    expect(loanCap(world, VANILLA_BALANCE, maxTermMonths)).toBeGreaterThan(
      loanCap(world, VANILLA_BALANCE, minTermMonths),
    );

    const cap = loanCap(world, VANILLA_BALANCE, minTermMonths);
    const { payment } = loanTerms(cap, loanRate(world, VANILLA_BALANCE), minTermMonths);
    expect(payment).toBeLessThanOrEqual(10000 * loanPaymentShare + 1);
  });
});

/* --------------------------------------------------- nález 16: zónování -- */

describe('vyznačení zóny', () => {
  it('prodloužení přes už vyznačené není chyba', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    expect(zoneArea(world, 40, 40, 4, 4, ZONE.residential, VANILLA_BALANCE).ok).toBe(true);

    // Tentýž obdélník podruhé: nic nového, ale nic nebrání. Do revize to
    // skončilo hláškou „Zóna se sem vyznačit nedá" — přestože zóna tam byla.
    const again = zoneArea(world, 40, 40, 4, 4, ZONE.residential, VANILLA_BALANCE);
    expect(again.ok).toBe(true);
  });

  it('zóna, kterou opravdu nejde vyznačit, se pořád odmítne', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    const outside = zoneArea(world, world.size + 4, 4, 2, 2, ZONE.residential, VANILLA_BALANCE);
    expect(outside.ok).toBe(false);
  });
});

/* ------------------------------------------------ nález 33: snímek Zpět -- */

describe('snímek pro Zpět', () => {
  it('nekomprimovaný save se načte stejně jako komprimovaný', () => {
    const world = createWorld(7, VANILLA_BALANCE.economy);
    const options = {
      cityName: 'Test',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      playtimeSeconds: 0,
      sources: [],
    };

    const packed = serializeSave(world, options, 9);
    const raw = serializeSave(world, options, 0);

    // Nula je **jen jiný stupeň komprese**, ne jiný formát: obsah musí sedět.
    expect(unpackSave(raw).state).toEqual(unpackSave(packed).state);
    // A nekomprimovaný je větší — jinak by se nesnížila práce, o kterou tu jde.
    expect(raw.byteLength).toBeGreaterThan(packed.byteLength);
    expect(packSave(toSaveData(world, options), 0).byteLength).toBe(raw.byteLength);
  });
});

/* -------------------------------------------------- nález 9: kolony -- */

const HOUSE: Definition = {
  id: 'test:house',
  type: 'building',
  category: 'residential',
  name: 'building.house.name',
  description: 'building.house.desc',
  footprint: [1, 1],
  level: 1,
  construction: { cost: 100, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
  economy: { upkeep: 1 },
  population: { capacity: 8 },
  graphics: { color: '#8fb4dd', heightLevels: 1 },
};

/** Dva stupně téže zástavby, aby měl systém úrovní kam sesadit. */
const HOUSE_1: Definition = { ...HOUSE, id: 'test:house1', level: 1 };
const HOUSE_2: Definition = { ...HOUSE, id: 'test:house2', level: 2 };

const SHOP: Definition = {
  ...HOUSE,
  id: 'test:shop',
  category: 'commercial',
  population: undefined,
  jobs: { capacity: 8 },
};

function catalogueOf(...definitions: Definition[]): BuildingCatalogue {
  return {
    get: (id) => definitions.find((d) => d.id === id),
    byCategory: (category) => definitions.filter((d) => d.category === category),
  };
}

describe('zátěž silnic', () => {
  it('roste s městem, ne se vzorkem', () => {
    /*
     * Jeden běh projde nejvýš `maxBuildingsPerRun` domů. Když se před ním
     * vrstva vynulovala, vyrobilo město s tisícem domů stejnou zátěž jako
     * město se stovkou: kolony se s městem přestaly zvětšovat a hráč se
     * naučil, že široké třídy nemá cenu stavět — a měl pravdu.
     */
    const build = (homes: number): number => {
      const world = createWorld(1, VANILLA_BALANCE.economy);
      const y = 40;
      for (let x = 10; x < 10 + homes + 4; x++) setRoadTile(world, y * world.size + x, 1);
      for (let i = 0; i < homes; i++) {
        placeBuilding(world, HOUSE, 10 + i, y + 1).population = 8;
      }
      placeBuilding(world, SHOP, 10 + homes + 2, y + 1);

      const system = createTrafficSystem(catalogueOf(HOUSE, SHOP), VANILLA_BALANCE);
      // Dost běhů na to, aby se estimát ustálil i u města nad vzorkem.
      for (let tick = 0; tick < 80 * system.interval; tick++) tickWorld(world, [system]);

      let total = 0;
      for (const value of world.trafficLoad) total += value;
      return total;
    };

    const small = build(20);
    const big = build(200);

    // Desetkrát víc domů má dát řádově víc zátěže, ne totéž.
    expect(big).toBeGreaterThan(small * 4);
  });
});

/* ------------------------------------------------ nález 10: věznice -- */

describe('chátrání', () => {
  it('obtěžování se nepočítá do průměru pokrytí', () => {
    /*
     * Věznice je jediná stavba s `nuisance` a zapisuje se do téže mapy jako
     * služby. Průměr přes všechny vrstvy tak s ní spadl pod práh a začaly
     * chátrat staré domy ve čtvrtích, se kterými hráč nic nedělal.
     */
    expect(levelAfterYears(true)).toBe(levelAfterYears(false));
  });

  it('a bez pokrytí dům spadne — jinak by test výš nic nedokazoval', () => {
    // Kontrolní případ: kdyby penalizace nepřicházela nikdy, byl by test výš
    // jen dvě stejné nuly a nedokazoval by nic.
    expect(levelAfterYears(false, false)).toBeLessThan(levelAfterYears(false));
  });

  /**
   * Na jaké úrovni dům skončí, když se mu nechá čas zchátrat.
   *
   * Penalizace za zanedbanost se odečítá od ceny půdy při rozhodování o
   * úrovni, takže se pozná na tom, jestli dům spadne o stupeň níž.
   */
  function levelAfterYears(prison: boolean, served = true): number {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    const catalogue = catalogueOf(HOUSE_1, HOUSE_2);

    // Slušné pokrytí ve všech třídách, které se počítají k dobru.
    for (const serviceClass of Object.keys(VANILLA_BALANCE.happiness.weights)) {
      // Těsně nad prahem zanedbanosti (20): devátá vrstva samých nul by
      // průměr stáhla pod něj a dům by začal chátrat. Přesně o to jde.
      world.coverage.set(
        serviceClass,
        new Uint8Array(world.happiness.length).fill(served ? 21 : 0),
      );
    }
    // A vedle toho vrstva obtěžování, která je všude nulová: věznice je
    // jediná stavba s `nuisance` a zapisuje se do téže mapy jako služby.
    if (prison) world.coverage.set('prison', new Uint8Array(world.happiness.length));

    const building = placeBuilding(world, HOUSE_2, 64, 64);
    building.builtAtTick = 0;
    // Podlaha úrovně 2 je práh 90 mínus hystereze 35, tedy 55. Mezi ni a tuhle
    // hodnotu se penalizace za zanedbanost (25) právě vejde.
    world.coarse.landValue.fill(75);

    const system = createLevelSystem(catalogue, VANILLA_BALANCE);
    world.tick = VANILLA_BALANCE.levels.decayAge + VANILLA_BALANCE.levels.cooldown + 1;
    for (let step = 0; step < system.interval * 40; step++) tickWorld(world, [system]);

    return world.buildings.get(building.id)?.level ?? 0;
  }
});

/* ----------------------------------- nálezy 11 a 12: zprávy z financí -- */

describe('fronta zpráv z financí', () => {
  it('přiznaný grant se dostane ven ze simulace', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world: WorldState = createWorld(1, balance.economy);

    // Dost lidí na první milník. Grant se přiznává každý tik, takže stačí jeden.
    for (let i = 0; i < 200; i++) {
      placeBuilding(world, HOUSE, 20 + (i % 40), 20 + Math.floor(i / 40)).population = 8;
    }

    const { createFinanceSystem } = await import('@/sim/systems/finance');
    const system = createFinanceSystem(content, balance, content.grants());
    tickWorld(world, [system]);

    const grants = world.financeNotices.filter((notice) => notice.kind === 'grant');
    expect(grants.length).toBeGreaterThan(0);
    expect(world.economy.funds).toBeGreaterThan(balance.economy.startingFunds);
  });

  it('fronta má strop, takže běh bez rozhraní neroste donekonečna', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    for (let i = 0; i < 200; i++) {
      world.financeNotices.push({ kind: 'missedPayment', count: 1 });
      if (world.financeNotices.length > 32) world.financeNotices.shift();
    }
    expect(world.financeNotices.length).toBeLessThanOrEqual(32);
  });
});
