import type { Definition } from '@/content/schema';
import { button, el } from './dom';
import { buildingFacts, HELP_PROBLEMS } from './helpData';
import type { HelpFact } from './helpData';
import { iconSvg } from './icons';

/**
 * Nápověda ke hře.
 *
 * Hra nemá tutoriál a autor si vyžádal „základní nápovědu, případně nějakou
 * wiki i v rámci hry". Tohle je ta wiki: seznam témat vlevo, text vpravo,
 * dostupná **z domovské stránky i za běhu**, protože otázka „proč mi to
 * neroste" přijde uprostřed hraní, ne před ním.
 *
 * Text je **celý v locale souborech** (§10, kritérium 25 fáze 4). Tady jsou jen
 * klíče a pořadí — přeložit hru do dalšího jazyka tak znamená doplnit soubor,
 * ne sáhnout do kódu.
 *
 * Odstavce dělí prázdný řádek, stejně jako u hlášení o katastrofě: text se píše
 * jako text a odstavce v něm jsou přirozená hranice. Řádek, který začíná
 * pomlčkou, se vysází jako **položka seznamu** — v nápovědě je výčtů hodně
 * a psát je jako souvislý odstavec by se špatně četlo.
 */

/** Prázdný řádek dělí odstavce. */
const PARAGRAPH_BREAK = /\n{2,}/;

/** Řádek začínající pomlčkou je položka seznamu. */
const BULLET = /^[-–—]\s+/;

/**
 * Témata v pořadí, ve kterém na ně hráč narazí.
 *
 * Není to abecedně a není to podle složitosti: je to podle toho, co člověk
 * potřebuje vědět dřív. Kdo hru zapne poprvé, potřebuje silnici a zónu; kdo
 * hraje hodinu, řeší dosah služeb a rozpočet.
 */
export const HELP_TOPICS: readonly string[] = [
  'start',
  'zones',
  'roads',
  'utilities',
  'services',
  // MHD má vlastní téma: hráči se ptali na koleje, tunely a na to, jak vůbec
  // linka vzniká — a nic z toho se do „služeb" nevešlo.
  'transit',
  'quality',
  'terrain',
  'money',
  'disasters',
  'controls',
  'saving',
  // Poslední dvě se **nečtou, ale hledá se v nich**: jsou to seznamy, do
  // kterých hráč skočí s konkrétní otázkou („co žere spalovna", „proč mi to
  // nezarůstá"), ne text, který si přečte odshora dolů.
  'problems',
  'buildings',
];

/** Témata, která se nekreslí z locale textu, ale skládají z dat. */
const GENERATED = new Set(['buildings', 'problems']);

/**
 * Otevře nápovědu jako překryv nad tím, co je pod ní.
 *
 * Překryv, ne další obrazovka: hráč se vrací jedním tlačítkem a nepřijde
 * o rozehrané město ani o místo, kde se zrovna díval.
 */
export function showHelp(
  parent: HTMLElement,
  t: (key: string) => string,
  startAt = HELP_TOPICS[0] ?? 'start',
  /**
   * Katalog staveb. Bez něj se přehled staveb nevykreslí — ostatní témata
   * fungují dál, protože jsou v locale. Volitelný proto, že nápovědu otevírá
   * i domovská stránka a ta obsah dostala až kvůli tomuhle.
   */
  catalogue?: { getAll(type: string): Definition[] },
): void {
  const overlay = el('div', 'home__overlay');
  const panel = el('div', 'home__panel help');

  panel.appendChild(el('h2', 'home__panel-title', t('ui.help.title')));
  panel.appendChild(el('p', 'help__lead', t('ui.help.lead')));

  const body = el('div', 'help__body');
  const menu = el('nav', 'help__menu');
  const article = el('article', 'help__article');
  body.append(menu, article);
  panel.appendChild(body);

  const buttons = new Map<string, HTMLButtonElement>();

  function open(topic: string): void {
    for (const [id, node] of buttons) node.classList.toggle('is-active', id === topic);
    article.replaceChildren();
    article.appendChild(el('h3', 'help__topic-title', t(`ui.help.${topic}.title`)));

    if (GENERATED.has(topic)) {
      article.appendChild(el('p', 'help__paragraph', t(`ui.help.${topic}.lead`)));
      if (topic === 'problems') problems(article, t);
      else buildings(article, t, catalogue);
      article.scrollTop = 0;
      return;
    }

    for (const paragraph of t(`ui.help.${topic}.body`).split(PARAGRAPH_BREAK)) {
      const bullet = BULLET.test(paragraph);
      article.appendChild(
        el('p', bullet ? 'help__bullet' : 'help__paragraph', paragraph.replace(BULLET, '')),
      );
    }
    // Dlouhé téma otevřené z prostředka by hráče vysypalo doprostřed textu.
    article.scrollTop = 0;
  }

  for (const topic of HELP_TOPICS) {
    const item = button('help__item', () => open(topic));
    item.textContent = t(`ui.help.${topic}.title`);
    buttons.set(topic, item);
    menu.appendChild(item);
  }

  const close = button('home__button home__button--primary', () => overlay.remove());
  close.textContent = t('ui.home.back');
  panel.appendChild(close);

  overlay.appendChild(panel);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  parent.appendChild(overlay);

  open(HELP_TOPICS.includes(startAt) ? startAt : (HELP_TOPICS[0] ?? 'start'));
}

/**
 * Seznam problémů: co to je, čím to je a co s tím.
 *
 * Pořadí je pevné a jde od nejčastějšího (`HELP_PROBLEMS`). Každý problém má
 * tři odstavce, protože přesně tohle si autor vyžádal: „co jej způsobuje, co
 * jej řeší".
 */
function problems(article: HTMLElement, t: (key: string) => string): void {
  for (const id of HELP_PROBLEMS) {
    const block = el('section', 'help__entry');
    block.appendChild(el('h4', 'help__entry-title', t(`ui.help.problem.${id}.title`)));
    block.appendChild(line(t('ui.help.problem.cause'), t(`ui.help.problem.${id}.cause`)));
    block.appendChild(line(t('ui.help.problem.fix'), t(`ui.help.problem.${id}.fix`)));
    article.appendChild(block);
  }
}

/** Odstavec „štítek: text". Štítek je tučný, aby šel seznam přeletět očima. */
function line(label: string, text: string): HTMLElement {
  const node = el('p', 'help__paragraph');
  node.appendChild(el('strong', 'help__label', `${label}: `));
  node.appendChild(document.createTextNode(text));
  return node;
}

/**
 * Přehled staveb **z dat, ne z textu**.
 *
 * Řadí se podle nabídky, ve které je hráč hledá ve hře, a v ní podle ceny —
 * to je pořadí, ve kterém k nim ve hře dojde. Čísla jsou tatáž, podle kterých
 * počítá simulace, takže nápověda nemůže lhát.
 */
function buildings(
  article: HTMLElement,
  t: (key: string) => string,
  catalogue?: { getAll(type: string): Definition[] },
): void {
  if (!catalogue) return;

  const all = [...catalogue.getAll('building')].sort(
    (a, b) =>
      (a.menu ?? a.category).localeCompare(b.menu ?? b.category) ||
      a.construction.cost - b.construction.cost,
  );

  let group = '';
  for (const definition of all) {
    const menu = definition.menu ?? definition.category;
    if (menu !== group) {
      group = menu;
      article.appendChild(el('h4', 'help__group', groupName(menu, t)));
    }

    const entry = el('section', 'help__entry');
    const head = el('div', 'help__entry-head');
    // Ikona je v definici volitelná (mod ji nemusí dodat); bez ní se kreslí
    // prázdný tvar, ne výjimka.
    head.appendChild(iconSvg(definition.graphics.icon ?? ''));
    const title = el('div', 'help__entry-text');
    title.appendChild(el('span', 'help__entry-title', t(definition.name)));
    title.appendChild(el('span', 'help__entry-note', t(definition.description)));
    head.appendChild(title);
    entry.appendChild(head);

    const facts = buildingFacts(definition, t);
    entry.appendChild(column(t('ui.help.section.needs'), facts.needs, t));
    entry.appendChild(column(t('ui.help.section.gives'), facts.gives, t));
    entry.appendChild(column(t('ui.help.section.takes'), facts.takes, t));
    article.appendChild(entry);
  }
}

/** Jeden sloupec údajů. Prázdný se nekreslí — mlčet je lepší než psát „nic". */
function column(title: string, facts: readonly HelpFact[], t: (key: string) => string): HTMLElement {
  const node = el('div', 'help__facts');
  if (facts.length === 0) return node;
  node.appendChild(el('span', 'help__facts-title', title));
  for (const item of facts) {
    const row = el('span', 'help__fact');
    row.appendChild(el('span', 'help__fact-key', t(item.key)));
    if (item.value !== '') row.appendChild(el('span', 'help__fact-value', item.value));
    node.appendChild(row);
  }
  return node;
}

/**
 * Jméno skupiny v přehledu staveb.
 *
 * Nabídkové skupiny mají klíč `ui.menu.*`, jenže domy, obchody a továrny
 * žádnou nabídku nemají — vyrostou ze zóny — a jmenují se podle ní. Chybějící
 * překlad se pozná po tom, že `t` vrátí sám klíč (§10), a sáhne se pro jméno
 * zóny.
 */
function groupName(menu: string, t: (key: string) => string): string {
  const key = `ui.menu.${menu}`;
  const named = t(key);
  return named === key ? t(`ui.zone.${menu}`) : named;
}
