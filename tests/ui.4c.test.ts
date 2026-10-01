/**
 * @vitest-environment jsdom
 *
 * Panely sahají na DOM. Simulace zůstává ve `node` a za jsdom časem neplatí.
 */
import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Command } from '@/sim/commands';
import {
  addTransitStop,
  buildRoad,
  createTransitLine,
  placeDefinition,
} from '@/sim/commands';
import { loanTerms } from '@/sim/finance';
import { ROAD } from '@/sim/layers';
import { createWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { FinancePanel } from '@/ui/financePanel';
import { formatNumber } from '@/ui/format';
import { I18n } from '@/ui/i18n';
import type { LocaleTables } from '@/ui/i18n';
import { TransitPanel } from '@/ui/transitPanel';

/**
 * Rozhraní pro 4c — půjčky, dluhopisy a linky MHD.
 *
 * Simulace to uměla od T55 až T58, ale nevedlo k tomu tlačítko. Testuje se
 * hlavně to, co jde rozbít potichu:
 *
 * - panel by mohl **nabízet jinou splátku, než jakou pak město platí**,
 * - tlačítko by mohlo poslat příkaz, který simulace odmítne, a hráč by jen
 *   viděl, že se nic neděje,
 * - a klik do mapy při vybírání zastávky by mohl místo zastávky postavit
 *   silnici.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

async function i18nFor(content: ContentRegistry): Promise<I18n> {
  const out: Record<string, Record<string, string>> = {};
  for (const language of content.getLanguages()) out[language] = content.getLocaleTable(language);
  return new I18n(out as LocaleTables, 'cs');
}

/** Sběrač příkazů místo simulace — testy koukají, co panel poslal. */
function recorder(): { sent: Command[]; dispatch: (command: Command) => void } {
  const sent: Command[] = [];
  return { sent, dispatch: (command) => void sent.push(command) };
}

function textOf(node: HTMLElement): string {
  return node.textContent ?? '';
}

function buttonsIn(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll('button')];
}

function buttonWith(root: HTMLElement, text: string): HTMLButtonElement {
  const found = buttonsIn(root).find((node) => textOf(node).includes(text));
  if (!found) {
    throw new Error(`tlačítko „${text}" tam není; je tam: ${buttonsIn(root).map(textOf).join(' | ')}`);
  }
  return found;
}

function inputAfter(root: HTMLElement, label: string): HTMLInputElement {
  for (const field of root.querySelectorAll('label')) {
    if (!textOf(field as HTMLElement).includes(label)) continue;
    const input = field.querySelector('input');
    if (input) return input;
  }
  throw new Error(`pole „${label}" tam není`);
}

/**
 * Úsek panelu pod daným nadpisem.
 *
 * Půjčka i emise mají pole „Částka" — bez zúžení by testy plnily to první
 * a emise by odešla prázdná.
 */
function sectionWith(root: HTMLElement, heading: string): HTMLElement {
  for (const section of root.querySelectorAll('section')) {
    if (textOf(section.querySelector('h3') as HTMLElement | null ?? section).startsWith(heading)) {
      return section as HTMLElement;
    }
  }
  throw new Error(`úsek „${heading}" tam není`);
}

/* ----------------------------------------------------------- finance --- */

async function financeFixture(funds = 200_000, income = 20_000) {
  const content = await vanilla();
  const balance = content.getBalance();
  const world = createWorld(1, balance.economy);
  world.economy.funds = funds;
  // Strop se odvozuje od **příjmu, ne od kasy** — bez příjmu je nula a nic
  // by nešlo sjednat.
  world.economy.lastIncome = income;

  const mount = document.createElement('div');
  const { sent, dispatch } = recorder();
  const panel = new FinancePanel(mount, await i18nFor(content), dispatch, content, content.grants());
  panel.toggle();
  panel.update(world, balance);
  return { panel, mount, sent, world, balance };
}

describe('panel financí', () => {
  it('zavřený panel se nestaví — a otevřený ano', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    const mount = document.createElement('div');
    const panel = new FinancePanel(mount, await i18nFor(content), () => {}, content, content.grants());

    panel.update(world, balance);
    expect(mount.textContent).toBe('');

    panel.toggle();
    panel.update(world, balance);
    expect(mount.textContent).not.toBe('');
  });

  it('nabízená splátka je ta, kterou pak město platí', async () => {
    // Kdyby si panel vzorec opsal, rozešel by se s ním při první změně
    // pravidel — a hráč by viděl jinou splátku, než jakou by platil.
    const { panel, mount, world, balance } = await financeFixture();

    inputAfter(mount, 'Částka').value = '100000';
    inputAfter(mount, 'Doba').value = '60';
    panel.update(world, balance);

    const rate = balance.finance.baseRate + (1 - world.economy.creditRating) * balance.finance.ratePenalty;
    const terms = loanTerms(100_000, rate, 60);
    expect(mount.textContent).toContain(formatNumber(terms.payment));
  });

  it('částka nad strop tlačítko zamkne', async () => {
    const { panel, mount, world, balance, sent } = await financeFixture();
    const take = buttonWith(mount, 'Sjednat');

    inputAfter(mount, 'Částka').value = '100000';
    panel.update(world, balance);
    expect(take.disabled).toBe(false);

    // Strop je 24× měsíční příjem, tedy 480 000 při příjmu 20 000.
    inputAfter(mount, 'Částka').value = '900000';
    panel.update(world, balance);
    expect(take.disabled).toBe(true);

    take.click();
    expect(sent).toEqual([]);
  });

  it('sjednání pošle částku i dobu, jaké hráč zadal', async () => {
    const { panel, mount, world, balance, sent } = await financeFixture();
    inputAfter(mount, 'Částka').value = '50000';
    inputAfter(mount, 'Doba').value = '36';
    panel.update(world, balance);

    buttonWith(mount, 'Sjednat').click();

    expect(sent).toEqual([{ type: 'take_loan', amount: 50_000, termMonths: 36 }]);
  });

  it('emise pošle splatnost v ticích, ne v letech', async () => {
    // Hráč zadává roky, protože v tících nikdo nepřemýšlí. Simulace chce tiky
    // a překlep v převodu by se poznal až po pěti letech hry.
    const { panel, mount, world, balance, sent } = await financeFixture();
    const bonds = sectionWith(mount, 'Dluhopisy');
    inputAfter(bonds, 'Částka').value = '100000';
    inputAfter(bonds, 'Kupón').value = '6';
    inputAfter(bonds, 'Splatnost').value = '5';
    panel.update(world, balance);

    buttonWith(mount, 'Vypsat').click();

    expect(sent).toEqual([
      { type: 'issue_bond', amount: 100_000, rate: 6, maturityTicks: 5 * 360 },
    ]);
  });

  it('bez peněz na poplatek se emise nevypíše a řekne se proč', async () => {
    const { panel, mount, world, balance } = await financeFixture(100, 20_000);
    const bonds = sectionWith(mount, 'Dluhopisy');
    inputAfter(bonds, 'Částka').value = '100000';
    inputAfter(bonds, 'Kupón').value = '6';
    inputAfter(bonds, 'Splatnost').value = '5';
    panel.update(world, balance);

    expect(buttonWith(mount, 'Vypsat').disabled).toBe(true);
    expect(mount.textContent).toContain('poplatek');
  });

  it('po nesplacené jistině se emise nenabízí', async () => {
    const { panel, mount, world, balance } = await financeFixture();
    world.bondsBlockedUntil = world.tick + 1800;
    const bonds = sectionWith(mount, 'Dluhopisy');
    inputAfter(bonds, 'Částka').value = '100000';
    inputAfter(bonds, 'Kupón').value = '6';
    panel.update(world, balance);

    expect(buttonWith(mount, 'Vypsat').disabled).toBe(true);
  });

  it('víc půjček než dovoluje strop počtu se nesjedná', async () => {
    const { panel, mount, world, balance } = await financeFixture();
    for (let i = 0; i < balance.finance.maxLoans; i++) {
      world.loans.push({
        id: i + 1,
        principal: 1000,
        remaining: 1000,
        rate: 4,
        payment: 100,
        termMonths: 12,
        paidMonths: 0,
      });
    }
    inputAfter(mount, 'Částka').value = '1000';
    panel.update(world, balance);

    expect(buttonWith(mount, 'Sjednat').disabled).toBe(true);
  });

  it('psaní do pole nepřijde o kurzor', async () => {
    // Formulář se nesmí přestavovat každý snímek: hráč do něj píše a
    // znovupostavené `<input>` by mu částku sebralo i s kurzorem.
    const { panel, mount, world, balance } = await financeFixture();
    const field = inputAfter(mount, 'Částka');
    field.value = '1234';

    for (let frame = 0; frame < 10; frame++) panel.update(world, balance);

    expect(inputAfter(mount, 'Částka')).toBe(field);
    expect(field.value).toBe('1234');
  });
});

/* ------------------------------------------------------------- MHD ----- */

/** Město s ulicí, depem a dvěma autobusovými zastávkami. */
async function transitFixture() {
  const content = await vanilla();
  const balance = content.getBalance();
  const world = createWorld(1, balance.economy);
  world.economy.funds = 1_000_000;

  for (let x = 8; x < 40; x++) buildRoad(world, x, 20, ROAD.street, balance);
  expect(placeDefinition(world, content, 'vanilla:transit_depot', 8, 21, balance).ok).toBe(true);

  const stops = [12, 30].map((x) => {
    const before = new Set(world.buildings.keys());
    expect(placeDefinition(world, content, 'vanilla:transit_stop', x, 21, balance).ok).toBe(true);
    const id = [...world.buildings.keys()].find((key) => !before.has(key));
    if (id === undefined) throw new Error('zastávka nevznikla');
    return id;
  });

  const mount = document.createElement('div');
  const picks: number[] = [];
  const shown: { x: number; y: number }[] = [];
  let cancels = 0;
  const { sent, dispatch } = recorder();
  const panel = new TransitPanel(mount, await i18nFor(content), dispatch, {
    onPickStop: (lineId) => void picks.push(lineId),
    onCancelPick: () => void cancels++,
    onShowStop: (x, y) => void shown.push({ x, y }),
  });
  panel.toggle();

  const refresh = () => panel.update(world, content, balance);
  refresh();
  return {
    panel,
    mount,
    sent,
    world,
    content,
    balance,
    stops,
    picks,
    shown,
    refresh,
    cancels: () => cancels,
  };
}

/** Postaví `count` zastávek podél ulice a vrátí jejich id. */
function manyStops(world: WorldState, content: ContentRegistry, count: number): number[] {
  const balance = content.getBalance();
  const out: number[] = [];
  for (let i = 0; out.length < count; i++) {
    const x = 14 + i;
    if (x > 38) throw new Error('ulice došla dřív než zastávky');
    const before = new Set(world.buildings.keys());
    if (!placeDefinition(world, content, 'vanilla:transit_stop', x, 21, balance).ok) continue;
    const id = [...world.buildings.keys()].find((key) => !before.has(key));
    if (id !== undefined) out.push(id);
  }
  return out;
}

function addLine(world: WorldState, content: ContentRegistry, stops: number[]): number {
  const balance = content.getBalance();
  expect(createTransitLine(world, balance, 'bus').ok).toBe(true);
  const line = world.lines[world.lines.length - 1];
  if (!line) throw new Error('linka nevznikla');
  for (const stop of stops) {
    expect(addTransitStop(world, content, balance, line.id, stop).ok).toBe(true);
  }
  return line.id;
}

describe('panel MHD', () => {
  it('založení linky pošle mód z katalogu', async () => {
    // Módy nejsou výčet v kódu (P5) — tlačítko na nový mód se má objevit samo.
    const { mount, sent } = await transitFixture();

    buttonWith(mount, 'Autobus').click();

    expect(sent).toEqual([{ type: 'create_line', mode: 'bus' }]);
  });

  it('bez linek to řekne, místo aby nabídlo prázdno', async () => {
    const { mount } = await transitFixture();
    expect(mount.textContent).toContain('Zatím žádná linka');
  });

  it('zastávka se vybírá na mapě, ne ze seznamu', async () => {
    const { panel, mount, world, content, stops, picks, refresh } = await transitFixture();
    const lineId = addLine(world, content, [stops[0] ?? 0]);
    refresh();

    expect(panel.pickingLine()).toBeNull();
    buttonWith(mount, 'Přidat zastávku').click();

    expect(panel.pickingLine()).toBe(lineId);
    expect(picks).toEqual([lineId]);
  });

  it('druhé kliknutí vybírání zruší', async () => {
    const { panel, mount, world, content, stops, refresh, cancels } = await transitFixture();
    addLine(world, content, [stops[0] ?? 0]);
    refresh();

    buttonWith(mount, 'Přidat zastávku').click();
    refresh();
    buttonWith(mount, 'Klikni na zastávku').click();

    expect(panel.pickingLine()).toBeNull();
    expect(cancels()).toBe(1);
  });

  it('zavřený panel přestane polykat kliknutí do mapy', async () => {
    // Jinak by hráč zavřel panel, klikl do města a místo stavby by přidal
    // zastávku na linku, o které už nepřemýšlí.
    const { panel, mount, world, content, stops, refresh } = await transitFixture();
    addLine(world, content, [stops[0] ?? 0]);
    refresh();
    buttonWith(mount, 'Přidat zastávku').click();

    panel.toggle();

    expect(panel.pickingLine()).toBeNull();
  });

  it('klik na jméno zastávky ji ukáže na mapě, křížek ji vyhodí', async () => {
    /*
     * Dvě různé věci, dvě různá tlačítka. Dřív mazalo obojí a popisek byl holé
     * „1. 12, 21" — hráč se ptal, co ta čísla znamenají, a bál se na ně
     * kliknout. Souřadnice zůstaly, protože zastávky nemají jméno; nově se
     * s nimi ale dá skočit kamerou.
     */
    const { mount, sent, world, content, stops, refresh, shown } = await transitFixture();
    const lineId = addLine(world, content, stops);
    refresh();

    buttonWith(mount, '1. zastávka · 12, 21').click();
    expect(sent, 'klik na jméno nesmí nic měnit').toEqual([]);
    expect(shown).toEqual([{ x: 12, y: 21 }]);

    const drop = mount.querySelector('.chip__drop');
    expect(drop).toBeTruthy();
    (drop as HTMLButtonElement).click();
    expect(sent).toEqual([{ type: 'remove_stop', lineId, buildingId: stops[0] }]);
  });

  it('zbořená zastávka v seznamu není — z linky mizí sama', async () => {
    // Od T105 ji `removeBuilding` z linky vyhodí, takže v panelu nemá co
    // dělat. Dřív tam visela a linka kvůli ní nejezdila natrvalo.
    const { mount, world, content, stops, refresh } = await transitFixture();
    addLine(world, content, stops);
    world.buildings.delete(stops[0] ?? 0);
    refresh();

    expect(mount.textContent).not.toContain('12, 21');
  });

  it('linka se dá odstavit a zase rozjet', async () => {
    const { mount, sent, world, content, stops, refresh } = await transitFixture();
    const lineId = addLine(world, content, stops);
    refresh();

    // Tlačítko nese jen ikonu, takže se hledá podle popisku pro odečítačku.
    const pause = mount.querySelector('[aria-label="Odstavit linku (vozidla do depa)"]');
    expect(pause, 'přepínač jede/nejede v panelu chybí').toBeTruthy();
    (pause as HTMLButtonElement).click();
    expect(sent).toEqual([{ type: 'set_line_paused', lineId, paused: true }]);
  });

  it('vozidla se přidávají po jednom a s cenou', async () => {
    const { mount, sent, world, content, stops, refresh } = await transitFixture();
    const lineId = addLine(world, content, stops);
    refresh();

    expect(mount.textContent).toContain('900');
    buttonWith(mount, '+').click();

    expect(sent).toEqual([{ type: 'set_vehicles', lineId, vehicles: 1 }]);
  });

  it('bez peněz se vozidlo nenabízí', async () => {
    const { mount, world, content, stops, refresh } = await transitFixture();
    addLine(world, content, stops);
    world.economy.funds = 10;
    refresh();

    expect(buttonWith(mount, '+').disabled).toBe(true);
  });

  it('jízdné nejde pod nulu ani nad limit', async () => {
    const { mount, world, content, balance, stops, refresh } = await transitFixture();
    const lineId = addLine(world, content, stops);
    refresh();

    // Výchozí jízdné je nula, takže dolů to nejde.
    const minus = buttonsIn(mount).filter((node) => textOf(node) === '−');
    expect(minus[minus.length - 1]?.disabled).toBe(true);

    const line = world.lines.find((candidate) => candidate.id === lineId);
    if (!line) throw new Error('linka zmizela');
    line.fare = balance.transit.fareLimit;
    refresh();

    const plus = buttonsIn(mount).filter((node) => textOf(node) === '+');
    expect(plus[plus.length - 1]?.disabled).toBe(true);
  });

  it('plná linka další zastávku nenabídne', async () => {
    // Simulace by ji odmítla a hráč by dostal bublinu. Zamčené tlačítko je
    // řekne dřív, než klikne — a zároveň je to jediné místo, kde se strop
    // z katalogu v rozhraní projeví.
    const { mount, world, content, balance, refresh } = await transitFixture();
    const max = balance.transit.maxStops;
    const stops = manyStops(world, content, max);
    addLine(world, content, stops);
    refresh();

    expect(world.lines[0]?.stops.length).toBe(max);
    expect(buttonWith(mount, 'Přidat zastávku').disabled).toBe(true);
  });

  it('linka s jedinou zastávkou řekne, co jí chybí', async () => {
    const { mount, world, content, stops, balance, refresh } = await transitFixture();
    addLine(world, content, [stops[0] ?? 0]);
    refresh();

    expect(mount.textContent).toContain(String(balance.transit.minStops));
    expect(mount.textContent).toContain('stojí');
  });

  it('panel se přestavuje jen při změně', async () => {
    // Tlačítko postavené znovu při každém snímku by hráči mizelo pod kurzorem
    // a nešlo by ho zmáčknout.
    const { mount, world, content, stops, refresh } = await transitFixture();
    addLine(world, content, stops);
    refresh();
    const before = buttonWith(mount, 'Přidat zastávku');

    for (let frame = 0; frame < 10; frame++) refresh();
    expect(buttonWith(mount, 'Přidat zastávku')).toBe(before);

    world.lines[0]!.vehicles = 3;
    refresh();
    expect(buttonWith(mount, 'Přidat zastávku')).not.toBe(before);
  });
});
