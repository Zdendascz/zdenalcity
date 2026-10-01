import type { Balance } from '@/content/balance';
import type { Definition } from '@/content/schema';
import { MAX_SAVE_FILE_BYTES } from '@/save/format';
import { button, el, markDialog } from './dom';
import { iconSvg } from './icons';
import { setTooltip } from './tooltip';
import type { TooltipContent } from './tooltip';
import { showHelp } from './help';
import type { I18n } from './i18n';
import { showNewGameDialog } from './newGameDialog';
import { BUILD_COMMIT, buildAge, buildDate, IS_DEV } from './version';
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
  | { kind: 'file'; bytes: Uint8Array }
  /** Město, které se minule nenačetlo a tahle verze hry ho už přečte. */
  | { kind: 'damaged' };

export interface HomeOptions {
  /** Je co obnovit? Bez toho se „Pokračovat" neukáže. */
  canResume: boolean;
  /**
   * Co je v rozehraném městě a jak si ho odnést.
   *
   * Tlačítko „Pokračovat" do teď nepsalo jméno města, které za ním leží, a
   * „Nové město" ho mlčky přepsalo — prohlížeč drží jeden slot, takže se
   * rozehraná hra ztratila, jakmile hráč poprvé schoval kartu. Neměl přitom
   * čím zjistit, o co přišel (T-revize, nález 30).
   */
  resumeInfo?: { name: string; playtimeSeconds: number; download: () => void };
  /**
   * Katalog staveb pro nápovědu.
   *
   * Domovská stránka sama žádnou budovu nezná a nepotřebuje — bere si ho jen
   * proto, aby přehled staveb v nápovědě fungoval i před rozehráním města.
   */
  catalogue?: { getAll(type: string): Definition[] };
  /** Přečte vybraný soubor. Jde přes platform vrstvu (§9), ne přes `File` API. */
  readFile: (file: File) => Promise<Uint8Array>;
  /**
   * Město, které se při minulém startu nepodařilo načíst (audit N4).
   *
   * Nemaže se, odkládá — a tady je jediné místo, kde se s ním dá něco dělat:
   * stáhnout ho jako soubor a poslat autorovi, nebo ho zahodit. Kdyby se
   * poškozený autosave mazal, byla by regrese v načítání ztráta bez důkazu.
   *
   * `restorable` znamená, že **tahle verze hry ho už načte** — typicky po opravě
   * chyby, kvůli které se minule nenačetlo. Pak se nabídne i otevření: hráč
   * nemá vědět, že si může město stáhnout a nahrát zpátky jako soubor.
   */
  damaged?: { download: () => void; discard: () => void; restorable: boolean };
  /** Jazyky hry a přepnutí. Bez toho se na rozcestníku jazyk měnit nedá. */
  languages?: { list: readonly string[]; current: () => string; set: (language: string) => void };
}

/** Kam se hlásí chyby. Adresa autora, ne obecná schránka. */
const AUTHOR_EMAIL = 'jsem@zdendas.cz';

/** Discord hráčů. Odkaz vede na pozvánku, ne na kanál — ta platí i pro nečleny. */
const DISCORD_URL = 'https://discord.gg/TrDVH5kFe2';

/**
 * Adresa, která se posílá kamarádovi.
 *
 * Napevno, ne `location.href`: hra běží i z `file://`, z localhostu a
 * z vývojového serveru, a nikomu není co poslat odtamtud. Tohle je jediné
 * místo, kde se dá hrát.
 */
const SHARE_URL = 'https://games.zdendas.cz/zdenalcity/';

/**
 * Další projekty autora. Logo je obrázek v `public/brand/`, ne text.
 *
 * `dark` říká, že logo má **vlastní tmavé pozadí** a nepotřebuje světlou
 * podložku. Kresba na průhledném pozadí by na tmavém panelu zmizela, takže
 * dostane bílou dlaždici; obrázek s vlastním papírem se položí, jak je.
 */
const PROJECTS = [
  { url: 'https://zeminarod.cz', logo: 'brand/zeminarod.webp', label: 'zeminarod.cz', dark: true },
  { url: 'https://rpgmagazin.cz', logo: 'brand/rpgmagazin.webp', label: 'rpgmagazin.cz', dark: false },
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
  { file: 'shots/prehled.webp', titleKey: 'ui.home.shot.overview', game: true },
  { file: 'scenes/ulice.webp', titleKey: 'ui.home.scene.street', game: false },
  { file: 'shots/ctvrt.webp', titleKey: 'ui.home.shot.quarter', game: true },
  { file: 'scenes/prucelu.webp', titleKey: 'ui.home.scene.facade', game: false },
  { file: 'shots/nabrezi.webp', titleKey: 'ui.home.shot.waterfront', game: true },
  { file: 'scenes/namesti.webp', titleKey: 'ui.home.scene.square', game: false },
  { file: 'shots/detail.webp', titleKey: 'ui.home.shot.street', game: true },
  { file: 'scenes/sidliste.webp', titleKey: 'ui.home.scene.estate', game: false },
  { file: 'scenes/zastavka.webp', titleKey: 'ui.home.scene.stop', game: false },
  { file: 'scenes/prumysl.webp', titleKey: 'ui.home.scene.works', game: false },
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

/** S jakým předstihem se začne stahovat další snímek hlavičky. */
const HERO_PREFETCH_MS = 2500;

export function showHome(
  parent: HTMLElement,
  i18n: I18n,
  balance: Balance,
  options: HomeOptions,
): Promise<HomeChoice> {
  const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);
  let resolveChoice: (choice: HomeChoice) => void = () => {};
  let timer: number | undefined;
  /** Odložené stažení dalšího snímku hlavičky. Po odchodu se zruší. */
  let heroPrefetch: number | undefined;

  const root = el('div', 'home');

  // --- hlavička -----------------------------------------------------------

  const hero = el('div', 'home__hero');
  const layers = HERO.map((_, order) => {
    const layer = el('div', 'home__hero-shot');
    if (order === 0) layer.classList.add('is-visible');
    hero.appendChild(layer);
    return layer;
  });
  hero.appendChild(el('div', 'home__hero-veil'));

  /*
   * Obrázek dostane vrstva **až krátce před tím, než přijde na řadu** (T134).
   * Dřív se všech šest nastavilo naráz a prohlížeč stahoval přes 3 MB snímků,
   * zatímco hráč koukal na první — a o linku s nimi soupeřila grafika hry.
   */
  const prime = (order: number) => {
    const layer = layers[order];
    const shot = HERO[order];
    if (layer && shot && layer.style.backgroundImage === '') {
      layer.style.backgroundImage = `url(${shot.file})`;
    }
  };
  prime(0);

  // Snímky se prolínají samy. Statická hlavička vypadá jako obrázek, tohle
  // jako hra — a ukáže to čtyři různá místa místo jednoho.
  let shown = 0;
  if (layers.length > 1) {
    const primeNext = () => {
      heroPrefetch = window.setTimeout(
        () => prime((shown + 1) % layers.length),
        HERO_MS - HERO_PREFETCH_MS,
      );
    };
    primeNext();
    timer = window.setInterval(() => {
      layers[shown]?.classList.remove('is-visible');
      shown = (shown + 1) % layers.length;
      prime(shown);
      layers[shown]?.classList.add('is-visible');
      primeNext();
    }, HERO_MS);
  }

  const brand = el('div', 'home__brand');
  const logo = el('img', 'home__logo');
  logo.src = 'brand/logo.webp';
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
    const info = options.resumeInfo;
    resume.append(
      iconSvg('resume'),
      info
        ? i18n.t('ui.home.resumeNamed', {
            city: info.name,
            minutes: Math.max(1, Math.round(info.playtimeSeconds / 60)),
          })
        : t('ui.home.resume'),
    );
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
  start.append(iconSvg('start-city'), t('ui.home.newCity'));
  actions.appendChild(start);

  // Varování, že nové město to rozehrané přepíše — a jedno kliknutí, kterým
  // si ho hráč odnese. Hra tenhle typ varování umí, poškozené město ho má.
  if (options.resumeInfo) {
    const warning = el('p', 'home__warning');
    warning.textContent = i18n.t('ui.home.overwriteWarning', { city: options.resumeInfo.name });
    const keep = button('home__link-button', () => options.resumeInfo?.download());
    keep.textContent = t('ui.home.keepCurrent');
    warning.append(' ', keep);
    actions.appendChild(warning);
  }

  const input = el('input', 'is-hidden');
  input.type = 'file';
  input.accept = '.city,.citysave';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // **Velikost se hlídá dřív, než se soubor přečte** (audit N3). Save
    // největšího města má hluboko pod megabajt; co je o řád větší, není save
    // a nemá se dostat ani do paměti, natož do rozbalovače.
    if (file.size > MAX_SAVE_FILE_BYTES) {
      note.textContent = t('ui.home.fileTooBig');
      return;
    }
    void options.readFile(file).then((bytes) => finish({ kind: 'file', bytes }));
  });

  const open = button('home__button', () => input.click());
  open.textContent = t('ui.home.openFile');
  actions.append(open, input);

  hero.appendChild(actions);

  /** Řádek pod tlačítky: odmítnutý soubor, poškozené město. */
  const note = el('p', 'home__note');
  hero.appendChild(note);

  const damaged = options.damaged;
  if (damaged) {
    // Otevření nahradí město, které hráč mezitím rozehrál. Musí to vědět dřív,
    // než klikne — ne až uvidí, že jeho nové město je pryč.
    note.textContent = damaged.restorable
      ? [t('ui.home.damagedRestorable'), options.canResume ? t('ui.home.damagedRestoreReplaces') : '']
          .filter((part) => part !== '')
          .join(' ')
      : t('ui.home.damaged');
    const row = el('p', 'home__note');
    if (damaged.restorable) {
      const restore = button('home__link-button', () => finish({ kind: 'damaged' }));
      restore.textContent = t('ui.home.damagedRestore');
      row.appendChild(restore);
    }
    const download = button('home__link-button', () => damaged.download());
    download.textContent = t('ui.home.damagedDownload');
    const discard = button('home__link-button', () => {
      damaged.discard();
      note.textContent = '';
      row.remove();
    });
    discard.textContent = t('ui.home.damagedDiscard');
    row.append(download, discard);
    hero.appendChild(row);
  }

  // Značka sestavení. Datum samo neodpoví na otázku „je to staré?", tak se
  // vypisuje i stáří slovy — a hash, aby šlo nahlášenou chybu přiřadit
  // ke konkrétní verzi.
  //
  // **Ve vývoji se hash ani stáří nevypisuje.** Vite je doplňuje při startu
  // serveru a od té chvíle se nemění, kdežto kód se přenačítá s každou úpravou.
  // Vypsaná verze by tedy lhala — a lhala přesně tím směrem, který mate:
  // tvrdila by, že lokál je starší než produkce, i když je napřed.
  const age = buildAge(t);
  hero.appendChild(
    el(
      'p',
      'home__version',
      IS_DEV
        ? t('ui.version.dev')
        : `${t('ui.version.label')} ${BUILD_COMMIT} · ${buildDate(i18n.getLanguage())}` +
          (age === '' ? '' : ` · ${age}`),
    ),
  );

  // Odkazy o hře patří **do hlavičky, vpravo nahoře**, ne pod galerii
  // (rozhodnutí autora). Dole splývaly s obsahem stránky a hráč je hledal;
  // v rohu nad obrázkem jsou hned vidět a nic nepřebíjejí.
  hero.appendChild(aboutRow(t, root, options));

  root.appendChild(hero);

  // --- řady karet ---------------------------------------------------------

  /*
   * Všechno, co si rozcestník zapsal mimo svůj strom, visí na jednom signálu
   * (T-revize, nález 38).
   *
   * Galerie si zakládala **vlastní** časovač a úklid po výběru zhasínal jen
   * ten v hlavičce. Odpojený uzel, který drží běžící časovač, se neuvolní,
   * takže po vstupu do hry držel prohlížeč celý rozcestník včetně velkých
   * obrázků a časovač se dál probouzel a sahal na uzly, které v dokumentu
   * nebyly. Totéž platilo pro posluchač klávesnice u zvětšeného obrázku.
   */
  const leaving = new AbortController();
  root.appendChild(galleryRow(t, root, leaving.signal));

  parent.appendChild(root);

  function finish(choice: HomeChoice): void {
    if (timer !== undefined) window.clearInterval(timer);
    if (heroPrefetch !== undefined) window.clearTimeout(heroPrefetch);
    leaving.abort();
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
function galleryRow(
  t: (key: string) => string,
  root: HTMLElement,
  leaving: AbortSignal,
): HTMLElement {
  const section = el('section', 'home__row');
  const frame = el('div', 'home__frame');
  const strip = el('div', 'home__strip');

  GALLERY.forEach((item, order) => {
    const card = button('home__card home__card--plain', () => showLightbox(root, t, order, leaving));
    const image = el('img', 'home__card-image');
    // Karta je nejvýš 340 px široká: náhled 640 px místo plného snímku
    // (T134). Celý obrázek se stáhne, až ho hráč otevře.
    image.src = item.file.replace(/\.webp$/, '-640.webp');
    image.alt = t(item.titleKey);
    // První dva se načtou hned, zbytek až se k němu doposouvá.
    image.loading = order < 2 ? 'eager' : 'lazy';
    card.appendChild(image);
    strip.appendChild(card);
  });

  /**
   * Posune pás o jednu kartu.
   *
   * **Rolováním, ne transformem.** Transformem se pás posouval jen šipkami,
   * takže na telefonu s ním nešlo hnout prstem — a šipky se objevovaly až na
   * `:hover`, tedy nikdy. Teď posouvá prst i šipky týž posuvník a nemají jak
   * se rozejít. Šířka karty se měří, protože je `clamp()` a na jiném okně
   * vychází jinak.
   */
  function step(delta: number): void {
    const first = strip.firstElementChild;
    if (!(first instanceof HTMLElement)) return;
    const gap = 14;
    const width = first.getBoundingClientRect().width + gap;
    const last = strip.scrollWidth - strip.clientWidth;

    // Za koncem se vrací na začátek a před začátkem na konec, aby šlo listovat
    // pořád dokola jako dřív.
    let left = strip.scrollLeft + delta * width;
    if (left > last + 1) left = 0;
    else if (left < -1) left = last;

    const target = Math.max(0, Math.min(left, last));
    // `scrollTo` s plynulým posunem neumí každé prostředí (třeba jsdom
    // v testech). Skok je pak ošklivý, ale karta sedí, kde má.
    if (typeof strip.scrollTo === 'function') strip.scrollTo({ left: target, behavior: 'smooth' });
    else strip.scrollLeft = target;
  }

  for (const [css, delta, label] of [
    ['home__step home__step--prev', -1, 'ui.home.previous'],
    ['home__step home__step--next', 1, 'ui.home.next'],
  ] as const) {
    const node = button(css, () => step(delta));
    node.textContent = delta < 0 ? '‹' : '›';
    setTooltip(node, tipOf(t, label));
    node.setAttribute('aria-label', t(label));
    frame.appendChild(node);
  }

  frame.appendChild(strip);
  section.appendChild(frame);

  /*
   * Sama se posouvá, dokud do ní hráč nesáhne.
   *
   * Myš ji zastaví najetím a po odjezdu se rozjede znovu. Prst ji zastaví
   * **natrvalo**: kdo si listuje sám, nechce, aby mu pás ujel pod rukou —
   * a na telefonu se kurzor nikdy neodjede.
   */
  let timer = 0;
  let handled = false;

  function play(): void {
    if (handled || leaving.aborted) return;
    window.clearInterval(timer);
    timer = window.setInterval(() => step(1), SLIDE_MS);
  }

  function pause(): void {
    window.clearInterval(timer);
  }

  play();
  // Odchod z rozcestníku časovač zhasne. Bez toho se probouzel po celou hru.
  leaving.addEventListener('abort', pause);
  strip.addEventListener('pointerdown', () => {
    handled = true;
    pause();
  });
  frame.addEventListener('mouseenter', pause);
  frame.addEventListener('mouseleave', play);

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
function showLightbox(
  parent: HTMLElement,
  t: (key: string) => string,
  from: number,
  leaving: AbortSignal,
): void {
  let at = from;

  const overlay = el('div', 'lightbox');
  const figure = el('figure', 'lightbox__figure');
  const image = el('img', 'lightbox__image');
  const caption = el('figcaption', 'lightbox__caption');
  figure.append(image, caption);
  overlay.appendChild(figure);
  markDialog(overlay, caption);

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

  // Odchod z rozcestníku zavře i otevřený obrázek — jinak by po sobě nechal
  // posluchač klávesnice, který se odhlašuje jen vlastním zavřením.
  leaving.addEventListener('abort', close);

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
    setTooltip(node, tipOf(t, label));
    node.setAttribute('aria-label', t(label));
    overlay.appendChild(node);
  }

  const close_ = button('lightbox__close', close);
  close_.textContent = '×';
  setTooltip(close_, tipOf(t, 'ui.home.back'));
  close_.setAttribute('aria-label', t('ui.home.back'));
  overlay.appendChild(close_);

  // Klik mimo obrázek zavírá. Klik na obrázek ne — hráč na něj míří, když si
  // ho chce prohlédnout, ne když chce pryč.
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target === figure) close();
  });
  window.addEventListener('keydown', onKey, { signal: leaving });

  draw();
  parent.appendChild(overlay);
}

/**
 * Pošle odkaz na hru dál.
 *
 * Nejdřív se zkusí **systémové sdílení** — na telefonu je to ta nabídka
 * s WhatsAppem a Messengerem, tedy přesně to, čím se odkaz doopravdy posílá.
 * Prohlížeč na počítači ho většinou nemá, tam se odkaz zkopíruje do schránky.
 * A když ani schránka není (starý prohlížeč, stránka bez HTTPS), otevře se
 * mailto, které umí každý.
 *
 * Vrací klíč hlášky, kterou má rozhraní ukázat — samo tu nic nevypisuje.
 */
async function shareGame(t: (key: string) => string): Promise<string> {
  const data = { title: 'Zdenalcity', text: t('ui.home.shareText'), url: SHARE_URL };

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return 'ui.home.shareSent';
    } catch {
      // Zavřená nabídka není chyba: hráč si to rozmyslel a nemá co číst.
      return '';
    }
  }

  try {
    await navigator.clipboard.writeText(SHARE_URL);
    return 'ui.home.shareCopied';
  } catch {
    // Poslední záchrana. `mailto:` funguje i tam, kde schránka není povolená.
    const subject = encodeURIComponent('Zdenalcity');
    const body = encodeURIComponent(`${t('ui.home.shareText')}

${SHARE_URL}`);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank', 'noreferrer');
    return '';
  }
}

/** Jak dlouho zůstane v kartě odpověď, než se vrátí původní popisek. */
const SHARE_NOTE_MS = 2500;

/**
 * Odkazy o hře: sdílení, nápověda, autor a Discord.
 *
 * **Sloupec vpravo nahoře, přes hlavičku, a jen ikony.** Nejdřív to byly čtyři
 * široké karty přes celou stránku, pak sloupec s názvem a popiskem — a autor
 * si vyžádal opak: „místo tlačítek s popisem vymysli špičkové ikonky, které
 * naprosto jasně každý pochopí, ale budou dělány grafikou hry."
 *
 * Ikony jsou proto **izometrické rendery** jako budovy na mapě, ne ploché
 * štítky z HUD (zadání v `docs/09-IKONY.md`, oddíl o domovské stránce).
 * Význam nese tvar: vlaštovka „pošli", otazník „nápověda", přilba s výkresem
 * „kdo to postavil", bubliny „povídej si".
 *
 * Slovo nezmizelo, jen se schovalo do `title` a `aria-label` — odečítačka i
 * najetí myší ho pořád najdou. Odpověď na sdílení se ukáže pod sloupcem, ne
 * v tlačítku: v ikoně by nebylo kam ji napsat.
 */
function aboutRow(t: (key: string) => string, root: HTMLElement, options: HomeOptions): HTMLElement {
  const section = el('section', 'home__about');
  const strip = el('div', 'home__links');
  const note = el('p', 'home__links-note');

  /** Ikona s popiskem jen pro odečítačku a pro najetí myší. */
  function fill(node: HTMLElement, icon: string, labelKey: string): HTMLElement {
    node.appendChild(iconSvg(icon));
    // Bublina, ne `title` (T138): ten se na dotyku neukáže nikdy.
    setTooltip(node, tipOf(t, labelKey));
    node.setAttribute('aria-label', t(labelKey));
    return node;
  }

  // Sdílení první: je to jediný odkaz, který hru **šíří**, a hráč po něm sáhne
  // hned po tom, co ho pobavila. Ostatní tři jsou o hře samotné.
  const share = button('home__link', () => {
    void shareGame(t).then((key) => {
      if (key === '') return;
      note.textContent = t(key);
      window.setTimeout(() => {
        note.textContent = '';
      }, SHARE_NOTE_MS);
    });
  });
  strip.appendChild(fill(share, 'home-share', 'ui.home.share'));

  // Nápověda: hra nemá tutoriál, takže je to jediné místo, kde se hráč
  // doví, proč mu zóna nezarostla.
  const help = button('home__link', () => showHelp(root, t, undefined, options.catalogue));
  strip.appendChild(fill(help, 'home-help', 'ui.help.title'));

  const authors = button('home__link', () => showAuthors(root, t));
  strip.appendChild(fill(authors, 'home-author', 'ui.home.authors'));

  // Jazyk patří sem, mezi věci o hře. Do teď se dal přepnout **až ve hře**,
  // takže anglicky hrající hráč musel nejdřív rozehrát město, aby si směl
  // přepnout jazyk rozcestníku (T-revize, nález 23).
  if (options.languages && options.languages.list.length > 1) {
    const languages = options.languages;
    const next = button('home__link', () => {
      const order = languages.list;
      const at = order.indexOf(languages.current());
      const pick = order[(at + 1) % order.length];
      if (pick) languages.set(pick);
    });
    strip.appendChild(fill(next, 'language', 'ui.language.label'));
  }

  // Discord je **odkaz ven**, ne překryv: je to jiné místo, ne další stránka hry.
  const discord = el('a', 'home__link home__link--out');
  discord.href = DISCORD_URL;
  discord.target = '_blank';
  discord.rel = 'noreferrer noopener';
  strip.appendChild(fill(discord, 'home-chat', 'ui.home.discord'));

  section.append(strip, note);
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

  const title = el('h2', 'home__panel-title', t('ui.home.authors'));
  panel.appendChild(title);
  markDialog(panel, title);

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

/**
 * Bublina z lokalizace pro rozcestník: tučně `labelKey`, pod ním
 * `<labelKey>.hint` (T138).
 *
 * Rozcestník dostává jen `t`, ne celé `I18n`, takže chybějící popis se pozná
 * jako jinde v tomhle souboru — `t` vrátí sám klíč.
 */
function tipOf(t: (key: string) => string, labelKey: string): TooltipContent {
  const hintKey = `${labelKey}.hint`;
  const text = t(hintKey);
  return text === hintKey ? { title: t(labelKey) } : { title: t(labelKey), text };
}
