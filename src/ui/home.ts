import type { Balance } from '@/content/balance';
import { button, el } from './dom';
import { showHelp } from './help';
import type { I18n } from './i18n';
import { showNewGameDialog } from './newGameDialog';
import { BUILD_COMMIT, buildAge, buildDate } from './version';
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

/** Discord hráčů. Odkaz vede na pozvánku, ne na kanál — ta platí i pro nečleny. */
const DISCORD_URL = 'https://discord.gg/TrDVH5kFe2';

/**
 * Další projekty autora. Logo je obrázek v `public/brand/`, ne text.
 *
 * `dark` říká, že logo má **vlastní tmavé pozadí** a nepotřebuje světlou
 * podložku. Kresba na průhledném pozadí by na tmavém panelu zmizela, takže
 * dostane bílou dlaždici; obrázek s vlastním papírem se položí, jak je.
 */
const PROJECTS = [
  { url: 'https://zeminarod.cz', logo: 'brand/zeminarod.jpg', label: 'zeminarod.cz', dark: true },
  { url: 'https://rpgmagazin.cz', logo: 'brand/rpgmagazin.png', label: 'rpgmagazin.cz', dark: false },
] as const;

/**
 * Obrázky do hlavičky i do galerie.
 *
 * **Střídá se snímek ze hry a kreslená scéna.** Snímky leží v `public/shots/`
 * a jsou to opravdové záběry z hraní; scény v `public/scenes/` jsou kreslené
 * pohledy z úrovně očí, které z izometrické kamery nejdou vyrobit
 * (`docs/10-SCENY.md`). Odkud obrázek je, se pozná v lightboxu — v řadě jsou
 * popisky pryč, rozhodnutí autora.
 */
const GALLERY = [
  { file: 'shots/prehled.jpg', titleKey: 'ui.home.shot.overview', game: true },
  { file: 'scenes/ulice.jpg', titleKey: 'ui.home.scene.street', game: false },
  { file: 'shots/ctvrt.jpg', titleKey: 'ui.home.shot.quarter', game: true },
  { file: 'scenes/prucelu.jpg', titleKey: 'ui.home.scene.facade', game: false },
  { file: 'shots/nabrezi.jpg', titleKey: 'ui.home.shot.waterfront', game: true },
  { file: 'scenes/namesti.jpg', titleKey: 'ui.home.scene.square', game: false },
  { file: 'shots/detail.jpg', titleKey: 'ui.home.shot.street', game: true },
  { file: 'scenes/sidliste.jpg', titleKey: 'ui.home.scene.estate', game: false },
  { file: 'scenes/zastavka.jpg', titleKey: 'ui.home.scene.stop', game: false },
  { file: 'scenes/prumysl.jpg', titleKey: 'ui.home.scene.works', game: false },
] as const;

/**
 * Co se prolíná v hlavičce: **šest obrázků, tři ze hry a tři z ulice.**
 * Celá galerie by běžela moc dlouho, jeden snímek zase neukáže, že hra má
 * obojí. Pořadí se střídá, takže po celku přijde detail.
 */
const HERO = GALLERY.slice(0, 6);

/** Jak dlouho stojí galerie na jedné kartě, než popojede. */
const SLIDE_MS = 4500;

/** Jak dlouho zůstane jeden snímek v hlavičce, než se prolne do dalšího. */
const HERO_MS = 7000;

export function showHome(
  parent: HTMLElement,
  i18n: I18n,
  balance: Balance,
  options: HomeOptions,
): Promise<HomeChoice> {
  const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);
  let resolveChoice: (choice: HomeChoice) => void = () => {};
  let timer: number | undefined;

  const root = el('div', 'home');

  // --- hlavička -----------------------------------------------------------

  const hero = el('div', 'home__hero');
  const layers = HERO.map((shot, order) => {
    const layer = el('div', 'home__hero-shot');
    layer.style.backgroundImage = `url(${shot.file})`;
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

  // Značka sestavení. Datum samo neodpoví na otázku „je to staré?", tak se
  // vypisuje i stáří slovy — a hash, aby šlo nahlášenou chybu přiřadit
  // ke konkrétní verzi.
  const age = buildAge(t);
  hero.appendChild(
    el(
      'p',
      'home__version',
      `${t('ui.version.label')} ${BUILD_COMMIT} · ${buildDate(i18n.getLanguage())}` +
        (age === '' ? '' : ` · ${age}`),
    ),
  );

  root.appendChild(hero);

  // --- řady karet ---------------------------------------------------------

  root.appendChild(galleryRow(t, root));
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

/**
 * Slideshow, ne pás se scrollbarem.
 *
 * Vodorovný posuvník byl na širokoúhlém monitoru široký přes celou stránku
 * a nevypadal jako galerie, ale jako tabulka, která se nevešla. Karty se
 * proto posouvají **po jedné** šipkami a samy od sebe; posuvník je pryč.
 *
 * Nadpis „Galerie" taky zmizel — řada obrázků se nemusí představovat.
 */
function galleryRow(t: (key: string) => string, root: HTMLElement): HTMLElement {
  const section = el('section', 'home__row');
  const frame = el('div', 'home__frame');
  const strip = el('div', 'home__strip');

  GALLERY.forEach((item, order) => {
    const card = button('home__card home__card--plain', () => showLightbox(root, t, order));
    const image = el('img', 'home__card-image');
    image.src = item.file;
    image.alt = t(item.titleKey);
    // První dva se načtou hned, zbytek až se k němu doposouvá.
    image.loading = order < 2 ? 'eager' : 'lazy';
    card.appendChild(image);
    strip.appendChild(card);
  });

  let at = 0;

  /**
   * Posun se počítá ze **skutečné šířky karty**, ne z konstanty: karta je
   * `clamp()`, takže na jiném okně vychází jinak. Kolik karet je vidět, se
   * spočítá taky — na širokém monitoru se posouvá po jedné, ale zastaví se
   * dřív, aby vpravo nezůstala díra.
   */
  function step(delta: number): void {
    const first = strip.firstElementChild;
    if (!(first instanceof HTMLElement)) return;
    const gap = 14;
    const width = first.getBoundingClientRect().width + gap;
    const visible = Math.max(1, Math.round(frame.clientWidth / width));
    const last = Math.max(0, GALLERY.length - visible);

    at += delta;
    if (at > last) at = 0;
    if (at < 0) at = last;
    strip.style.transform = `translateX(${-at * width}px)`;
  }

  for (const [css, delta, label] of [
    ['home__step home__step--prev', -1, 'ui.home.previous'],
    ['home__step home__step--next', 1, 'ui.home.next'],
  ] as const) {
    const node = button(css, () => step(delta));
    node.textContent = delta < 0 ? '‹' : '›';
    node.title = t(label);
    node.setAttribute('aria-label', t(label));
    frame.appendChild(node);
  }

  frame.appendChild(strip);
  section.appendChild(frame);

  // Sama se posouvá, dokud na ni hráč nemíří myší. Kdo si prohlíží obrázek,
  // nechce, aby mu ujel pod kurzorem.
  let timer = window.setInterval(() => step(1), SLIDE_MS);
  frame.addEventListener('mouseenter', () => window.clearInterval(timer));
  frame.addEventListener('mouseleave', () => {
    timer = window.setInterval(() => step(1), SLIDE_MS);
  });
  window.addEventListener('resize', () => step(0));

  return section;
}

/**
 * Lightbox: obrázek přes celou obrazovku a šipky mezi nimi.
 *
 * Karty v řadě jsou malé a na snímku ze hry v nich není vidět nic. Zvětšení
 * je proto jediný způsob, jak si je prohlédnout — a je to i místo, kde se
 * hráč dozví, **jestli kouká na hru, nebo na kreslený pohled**. V řadě to
 * nikde napsané není.
 */
function showLightbox(parent: HTMLElement, t: (key: string) => string, from: number): void {
  let at = from;

  const overlay = el('div', 'lightbox');
  const figure = el('figure', 'lightbox__figure');
  const image = el('img', 'lightbox__image');
  const caption = el('figcaption', 'lightbox__caption');
  figure.append(image, caption);
  overlay.appendChild(figure);

  function draw(): void {
    const item = GALLERY[at];
    if (item === undefined) return;
    image.src = item.file;
    image.alt = t(item.titleKey);
    caption.textContent = `${t(item.titleKey)} — ${t(item.game ? 'ui.home.fromTheGame' : 'ui.home.fromTheWorld')}`;
  }

  function step(delta: number): void {
    at = (at + delta + GALLERY.length) % GALLERY.length;
    draw();
  }

  function close(): void {
    overlay.remove();
    window.removeEventListener('keydown', onKey);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowRight') step(1);
    else if (event.key === 'ArrowLeft') step(-1);
  }

  for (const [css, delta, label] of [
    ['lightbox__step lightbox__step--prev', -1, 'ui.home.previous'],
    ['lightbox__step lightbox__step--next', 1, 'ui.home.next'],
  ] as const) {
    const node = button(css, () => step(delta));
    node.textContent = delta < 0 ? '‹' : '›';
    node.title = t(label);
    node.setAttribute('aria-label', t(label));
    overlay.appendChild(node);
  }

  const close_ = button('lightbox__close', close);
  close_.textContent = '×';
  close_.title = t('ui.home.back');
  close_.setAttribute('aria-label', t('ui.home.back'));
  overlay.appendChild(close_);

  // Klik mimo obrázek zavírá. Klik na obrázek ne — hráč na něj míří, když si
  // ho chce prohlédnout, ne když chce pryč.
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target === figure) close();
  });
  window.addEventListener('keydown', onKey);

  draw();
  parent.appendChild(overlay);
}

/** Řada s odkazy: nápověda, autor a Discord. */
function aboutRow(t: (key: string) => string, root: HTMLElement): HTMLElement {
  const section = el('section', 'home__row');
  section.appendChild(el('h2', 'home__row-title', t('ui.home.about')));

  const strip = el('div', 'home__strip');

  // Nápověda první: hra nemá tutoriál, takže je to jediné místo, kde se hráč
  // doví, proč mu zóna nezarostla.
  const help = button('home__card home__card--text', () => showHelp(root, t));
  help.appendChild(el('span', 'home__card-title', t('ui.help.title')));
  help.appendChild(el('span', 'home__card-note', t('ui.help.note')));
  strip.appendChild(help);

  const card = button('home__card home__card--text', () => showAuthors(root, t));
  card.appendChild(el('span', 'home__card-title', t('ui.home.authors')));
  card.appendChild(el('span', 'home__card-note', t('ui.home.authorsNote')));
  strip.appendChild(card);

  // Discord je **odkaz ven**, ne překryv: je to jiné místo, ne další stránka hry.
  const discord = el('a', 'home__card home__card--text home__card--link');
  discord.href = DISCORD_URL;
  discord.target = '_blank';
  discord.rel = 'noreferrer noopener';
  discord.appendChild(el('span', 'home__card-title', t('ui.home.discord')));
  discord.appendChild(el('span', 'home__card-note', t('ui.home.discordNote')));
  strip.appendChild(discord);

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

  // Věnování stojí samo a jinak než zbytek: není to údaj, je to důvod.
  panel.appendChild(el('p', 'home__dedication', t('ui.authors.dedication')));

  // Další projekty autora. Loga jsou odkazy — kdo sem došel, může chtít vidět,
  // co ještě dělá.
  panel.appendChild(el('h3', 'home__panel-subtitle', t('ui.authors.projects')));
  const projects = el('div', 'home__projects');
  for (const project of PROJECTS) {
    const link = el('a', `home__project${project.dark ? '' : ' home__project--light'}`);
    link.href = project.url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    const image = el('img', 'home__project-logo');
    image.src = project.logo;
    image.alt = project.label;
    // Chybějící logo nesmí odkaz zabít — zůstane jméno domény.
    image.addEventListener('error', () => image.remove());
    link.append(image, el('span', 'home__project-label', project.label));
    projects.appendChild(link);
  }
  panel.appendChild(projects);

  const close = button('home__button home__button--primary', () => overlay.remove());
  close.textContent = t('ui.home.back');
  panel.appendChild(close);

  overlay.appendChild(panel);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  parent.appendChild(overlay);
}
