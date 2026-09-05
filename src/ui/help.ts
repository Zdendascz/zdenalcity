import { button, el } from './dom';

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
  'quality',
  'terrain',
  'money',
  'disasters',
  'controls',
  'saving',
];

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
