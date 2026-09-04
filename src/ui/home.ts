import type { Balance } from '@/content/balance';
import { button, el } from './dom';
import type { I18n } from './i18n';
import { showNewGameDialog } from './newGameDialog';
import type { NewGame } from './newGameDialog';

/**
 * Úvodní obrazovka.
 *
 * Do T81 se hra otevírala rovnou dialogem nové hry. Fungovalo to, ale nebylo
 * z čeho poznat, co hráč vlastně spustil — žádný název, žádný obrázek, žádná
 * informace, že je to beta. Rozhodnutí autora: **udělat z toho rozcestník**
 * ve stylu, na jaký jsou lidi zvyklí z filmových služeb.
 *
 * Skládá se ze dvou částí:
 *
 * - **hlavička** přes celou šířku s obrázkem ze hry, značkou a tlačítky,
 * - **řady karet** pod ní, které se posouvají do strany.
 *
 * Obrázky jsou **skutečné snímky ze hry**, ne kresby. Je to poctivější
 * a zadarmo: hra si je umí uložit sama (tlačítko „Uložit snímek").
 */

/** Co si hráč vybral. Odpověď buď rozjede hru, nebo načte soubor. */
export type HomeChoice =
  | { kind: 'game'; game: NewGame }
  | { kind: 'file'; bytes: Uint8Array };

export interface HomeOptions {
  /** Je co obnovit? Bez toho se „Pokračovat" neukáže. */
  canResume: boolean;
  /** Přečte vybraný soubor. Jde přes platform vrstvu (§9), ne přes `File` API. */
  readFile: (file: File) => Promise<Uint8Array>;
}

/** Kam se hlásí chyby. Adresa autora, ne obecná schránka. */
const AUTHOR_EMAIL = 'jsem@zdendas.cz';

/** Snímky ze hry pro hlavičku a karty. Leží v `public/shots/`. */
const SHOTS = [
  { file: 'prehled.jpg', titleKey: 'ui.home.shot.overview' },
  { file: 'nabrezi.jpg', titleKey: 'ui.home.shot.waterfront' },
  { file: 'ctvrt.jpg', titleKey: 'ui.home.shot.quarter' },
  { file: 'detail.jpg', titleKey: 'ui.home.shot.street' },
] as const;

/**
 * Kreslené pohledy z úrovně očí. Leží v `public/scenes/`.
 *
 * **Nejsou to snímky ze hry** a nesmějí se za ně vydávat, proto mají vlastní
 * řadu s vlastním nadpisem. Kamera hry je pevná a izometrická; ulici z úrovně
 * chodníku z ní nedostaneš, tak se kreslí zvlášť (`docs/10-SCENY.md`).
 */
const SCENES = [
  { file: 'ulice.jpg', titleKey: 'ui.home.scene.street' },
  { file: 'prucelu.jpg', titleKey: 'ui.home.scene.facade' },
  { file: 'namesti.jpg', titleKey: 'ui.home.scene.square' },
  { file: 'sidliste.jpg', titleKey: 'ui.home.scene.estate' },
  { file: 'zastavka.jpg', titleKey: 'ui.home.scene.stop' },
  { file: 'prumysl.jpg', titleKey: 'ui.home.scene.works' },
] as const;

/** Jak dlouho zůstane jeden snímek v hlavičce, než se prolne do dalšího. */
const HERO_MS = 7000;

export function showHome(
  parent: HTMLElement,
  i18n: I18n,
  balance: Balance,
  options: HomeOptions,
): Promise<HomeChoice> {
  const t = (key: string) => i18n.t(key);
  let resolveChoice: (choice: HomeChoice) => void = () => {};
  let timer: number | undefined;

  const root = el('div', 'home');

  // --- hlavička -----------------------------------------------------------

  const hero = el('div', 'home__hero');
  const layers = SHOTS.map((shot, order) => {
    const layer = el('div', 'home__hero-shot');
    layer.style.backgroundImage = `url(shots/${shot.file})`;
    if (order === 0) layer.classList.add('is-visible');
    hero.appendChild(layer);
    return layer;
  });
  hero.appendChild(el('div', 'home__hero-veil'));

  // Snímky se prolínají samy. Statická hlavička vypadá jako obrázek, tohle
  // jako hra — a ukáže to čtyři různá místa místo jednoho.
  let shown = 0;
  if (layers.length > 1) {
    timer = window.setInterval(() => {
      layers[shown]?.classList.remove('is-visible');
      shown = (shown + 1) % layers.length;
      layers[shown]?.classList.add('is-visible');
    }, HERO_MS);
  }

  const brand = el('div', 'home__brand');
  const logo = el('img', 'home__logo');
  logo.src = 'brand/logo.png';
  logo.alt = '';
  // Chybějící logo nesmí rozbít stránku — stejné pravidlo jako u spritů (P5).
  logo.addEventListener('error', () => logo.remove());
  brand.appendChild(logo);

  const words = el('div', 'home__words');
  words.appendChild(el('h1', 'home__title', 'Zdenalcity'));
  words.appendChild(el('p', 'home__tagline', t('ui.home.tagline')));
  brand.appendChild(words);

  const beta = el('span', 'home__beta', t('ui.home.beta'));
  brand.appendChild(beta);
  hero.appendChild(brand);

  const actions = el('div', 'home__actions');

  if (options.canResume) {
    const resume = button('home__button home__button--primary', () => {
      finish({ kind: 'game', game: { cityName: '', seed: 0, size: 128, disasters: true, resume: true } });
    });
    resume.textContent = t('ui.home.resume');
    actions.appendChild(resume);
  }

  const start = button(
    options.canResume ? 'home__button' : 'home__button home__button--primary',
    () => {
      void showNewGameDialog(parent, i18n, balance, { canResume: false }).then((game) => {
        finish({ kind: 'game', game });
      });
    },
  );
  start.textContent = t('ui.home.newCity');
  actions.appendChild(start);

  const input = el('input', 'is-hidden');
  input.type = 'file';
  input.accept = '.city,.citysave';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void options.readFile(file).then((bytes) => finish({ kind: 'file', bytes }));
  });

  const open = button('home__button', () => input.click());
  open.textContent = t('ui.home.openFile');
  actions.append(open, input);

  hero.appendChild(actions);
  root.appendChild(hero);

  // --- řady karet ---------------------------------------------------------

  root.appendChild(cardRow(t, 'ui.home.fromTheGame', SHOTS, 'shots'));
  root.appendChild(cardRow(t, 'ui.home.fromTheWorld', SCENES, 'scenes'));
  root.appendChild(aboutRow(t, root));

  parent.appendChild(root);

  function finish(choice: HomeChoice): void {
    if (timer !== undefined) window.clearInterval(timer);
    root.remove();
    resolveChoice(choice);
  }

  return new Promise<HomeChoice>((resolve) => {
    resolveChoice = resolve;
  });
}

/** Řada obrázků. Posouvá se do strany, jako v katalogu filmů. */
function cardRow(
  t: (key: string) => string,
  titleKey: string,
  items: readonly { file: string; titleKey: string }[],
  folder: string,
): HTMLElement {
  const section = el('section', 'home__row');
  section.appendChild(el('h2', 'home__row-title', t(titleKey)));

  const strip = el('div', 'home__strip');
  for (const item of items) {
    const card = el('figure', 'home__card');
    const image = el('img', 'home__card-image');
    image.src = `${folder}/${item.file}`;
    image.alt = t(item.titleKey);
    image.loading = 'lazy';
    card.appendChild(image);
    card.appendChild(el('figcaption', 'home__card-label', t(item.titleKey)));
    strip.appendChild(card);
  }

  section.appendChild(strip);
  return section;
}

/** Řada s odkazy: zatím autoři, časem přibude nápověda a novinky. */
function aboutRow(t: (key: string) => string, root: HTMLElement): HTMLElement {
  const section = el('section', 'home__row');
  section.appendChild(el('h2', 'home__row-title', t('ui.home.about')));

  const strip = el('div', 'home__strip');
  const card = button('home__card home__card--text', () => showAuthors(root, t));
  card.appendChild(el('span', 'home__card-title', t('ui.home.authors')));
  card.appendChild(el('span', 'home__card-note', t('ui.home.authorsNote')));
  strip.appendChild(card);

  section.appendChild(strip);
  return section;
}

/**
 * Stránka „Autoři".
 *
 * Je to překryv nad domovskou stránkou, ne další obrazovka: hráč se z ní vrací
 * jedním tlačítkem a nemá kam zabloudit.
 */
function showAuthors(parent: HTMLElement, t: (key: string) => string): void {
  const overlay = el('div', 'home__overlay');
  const panel = el('div', 'home__panel');

  panel.appendChild(el('h2', 'home__panel-title', t('ui.home.authors')));

  for (const key of [
    'ui.authors.game',
    'ui.authors.author',
    'ui.authors.code',
    'ui.authors.art',
    'ui.authors.engine',
    'ui.authors.thanks',
  ]) {
    panel.appendChild(el('p', 'home__panel-line', t(key)));
  }

  // Adresa je **odkaz, ne text**: hráč, který právě narazil na chybu, nemá
  // opisovat e-mail z obrazovky. `mailto:` otevře jeho poštu rovnou.
  const contact = el('p', 'home__panel-line', `${t('ui.authors.bugs')} `);
  const mail = el('a', 'home__mail');
  mail.href = `mailto:${AUTHOR_EMAIL}`;
  mail.textContent = AUTHOR_EMAIL;
  contact.appendChild(mail);
  panel.appendChild(contact);

  const close = button('home__button home__button--primary', () => overlay.remove());
  close.textContent = t('ui.home.back');
  panel.appendChild(close);

  overlay.appendChild(panel);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  parent.appendChild(overlay);
}
