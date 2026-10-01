import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { HELP_TOPICS } from '@/ui/help';
import { buildingFacts, HELP_PROBLEMS, PROBLEM_BY_REASON } from '@/ui/helpData';
import { formatMoney } from '@/ui/format';
import type { Definition } from '@/content/schema';

/**
 * Nápověda se **nesmí rozejít s hrou**.
 *
 * Autor si vyžádal, aby uměla „každou službu, každý problém: co jej způsobuje,
 * co jej řeší" a „každou budovu: co dělá, co žere, co přináší". Ručně psaný
 * seznam by po první změně obsahu zastaral a nikdo by si toho nevšiml, proto
 * se přehled staveb skládá z dat a testy hlídají zbytek: že každý údaj má
 * překlad, že žádná budova nezůstane bez popisu a že každá překážka růstu,
 * kterou hra umí nahlásit, má v nápovědě odstavec.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Témata, která se skládají z dat — ta nemají souvislý text v locale. */
const GENERATED = new Set(['buildings', 'problems']);

describe('nápověda: témata', () => {
  it('každé téma má nadpis v obou jazycích a text tam, kde se čte', async () => {
    const content = await vanilla();
    for (const language of ['cs', 'en']) {
      const table = content.getLocaleTable(language);
      for (const topic of HELP_TOPICS) {
        expect(table[`ui.help.${topic}.title`], `${language}: ${topic}.title`).toBeTruthy();
        const body = GENERATED.has(topic) ? `ui.help.${topic}.lead` : `ui.help.${topic}.body`;
        expect(table[body], `${language}: ${body}`).toBeTruthy();
      }
    }
  });
});

describe('nápověda: problémy', () => {
  it('každý problém má nadpis, příčinu i řešení v obou jazycích', async () => {
    const content = await vanilla();
    for (const language of ['cs', 'en']) {
      const table = content.getLocaleTable(language);
      for (const id of HELP_PROBLEMS) {
        for (const part of ['title', 'cause', 'fix']) {
          expect(table[`ui.help.problem.${id}.${part}`], `${language}: ${id}.${part}`).toBeTruthy();
        }
      }
    }
  });

  it('každá překážka růstu, kterou hra hlásí, má svůj odstavec', async () => {
    /*
     * Tohle je ta pojistka, kvůli které test existuje. `growthBlocker` vrací
     * klíče `ui.parcel.blocked.*`; kdo přidá novou překážku, přidá i klíč do
     * locale — a tenhle test ho pak chytí, dokud k němu nenapíše i nápovědu.
     */
    const content = await vanilla();
    const table = content.getLocaleTable('cs');
    const blockers = Object.keys(table).filter((key) => key.startsWith('ui.parcel.blocked.'));
    expect(blockers.length).toBeGreaterThan(4);

    for (const key of blockers) {
      const problem = PROBLEM_BY_REASON[key];
      expect(problem, `hláška ${key} nemá v nápovědě odstavec`).toBeTruthy();
      expect(HELP_PROBLEMS, `${key} → ${String(problem)}`).toContain(problem);
    }
  });
});

describe('nápověda: stavby', () => {
  it('žádná stavba nezůstane bez ceny, údržby a půdorysu', async () => {
    const content = await vanilla();
    const buildings = content.getAll('building');
    expect(buildings.length).toBeGreaterThan(20);

    for (const definition of buildings) {
      const facts = buildingFacts(definition as Definition, (key) => key);
      const takes = facts.takes.map((item) => item.key);
      expect(takes, definition.id).toContain('ui.help.fact.cost');
      expect(takes, definition.id).toContain('ui.help.fact.upkeep');
      expect(
        facts.needs.map((item) => item.key),
        definition.id,
      ).toContain('ui.help.fact.footprint');
    }
  });

  it('každý popisek údaje má překlad v obou jazycích', async () => {
    const content = await vanilla();
    const used = new Set<string>();
    for (const definition of content.getAll('building')) {
      const facts = buildingFacts(definition as Definition, (key) => {
        used.add(key);
        return key;
      });
      for (const item of [...facts.needs, ...facts.gives, ...facts.takes]) used.add(item.key);
    }
    // Sestava vanilla obsahu se dotkne většiny údajů; kdyby jich bylo pár,
    // test by měřil málo.
    expect(used.size).toBeGreaterThan(20);

    for (const language of ['cs', 'en']) {
      const table = content.getLocaleTable(language);
      for (const key of used) {
        expect(table[key], `${language}: ${key}`).toBeTruthy();
      }
    }
  });

  it('údaje odpovídají datům, ne textu — kontrola na vodárně', async () => {
    /*
     * Jedna konkrétní stavba, aby test neměřil jen „něco tam je". Vodárna má
     * všechny tři sloupce neprázdné: potřebuje břeh, dává vodu s dosahem,
     * bere peníze a údržbu.
     */
    const content = await vanilla();
    const works = content.get('vanilla:water_works');
    expect(works).toBeDefined();
    if (!works) return;

    const facts = buildingFacts(works, (key) => key);
    const value = (list: { key: string; value: string }[], key: string): string =>
      list.find((item) => item.key === key)?.value ?? '';

    expect(facts.needs.map((item) => item.key)).toContain('ui.help.fact.shore');
    expect(value(facts.gives, 'ui.help.fact.waterOut')).toBe(
      String(works.water?.production ?? 0),
    );
    // Cena je peníze, tak s měnou (T138).
    expect(value(facts.takes, 'ui.help.fact.cost')).toBe(formatMoney(works.construction.cost));
  });
});
