import type { Balance } from '@/content/balance';
import { DEFAULT_MAP_SIZE, MAP_SIZES, TERRAIN } from '@/sim/layers';
import { cornerSizeOf } from '@/sim/heights';
import type { MapSize } from '@/sim/layers';
import { balanceWithMap, generateTerrain } from '@/sim/mapgen';
import type { MapChoice } from '@/sim/mapgen';
import { MAX_HEIGHT } from '@/sim/heights';
import { button, el, markDialog, setPressed } from './dom';
import type { I18n } from './i18n';
import { iconSvg } from './icons';

/**
 * Dialog nové hry (§3 zadání fáze 3).
 *
 * Generátor bez náhledu je nepoužitelný — hráč nemá jak poznat, jestli mu seed
 * dal poloostrov, nebo jezerní krajinu. Zároveň tím padá dluh z fáze 1, že se
 * město dá pojmenovat jen v kódu.
 *
 * Náhled je **prostý bitmapový render** vrstvy terénu, ne izometrický: jde
 * o tvar pevniny, ne o obrázek města.
 */

export interface NewGame {
  cityName: string;
  seed: number;
  /** Hrana mapy v dlaždicích. Vybírá se v dialogu, dál ji nese `world.size`. */
  size: MapSize;
  /**
   * Smějí přijít katastrofy? (R18)
   *
   * Vypnutí se týká jen plánovače — ruční spuštění z menu jde pořád, jinak
   * by si hráč, který si je vypnul, neměl jak vyzkoušet, o co přišel.
   */
  disasters: boolean;
  /**
   * Jakou krajinu si hráč nastavil. Generátor ji dostane jako přepis balancu,
   * takže sám o dialogu nic neví (P5).
   *
   * Chybí u návratu do rozehraného města a u načteného souboru: tam si mapu
   * nese save a generátor se nespouští vůbec.
   */
  map?: MapChoice;
  /**
   * Hráč chce pokračovat v rozehraném městě, ne zakládat nové. Jméno a seed
   * si pak hra vezme ze savu, ne odsud.
   */
  resume?: boolean;
}

/**
 * Meze posuvníků krajiny.
 *
 * Voda se nepouští k nule ani k jedné: mapa úplně bez vody nemá kde vzít
 * vodárnu a mapa ze tří čtvrtin pod vodou nemá kde stavět. Kopce smějí až na
 * placku — rovina je legitimní přání, ne chyba.
 */
const WATER_MIN = 0.05;
const WATER_MAX = 0.6;

export interface NewGameOptions {
  /** Je co obnovit? Bez toho se tlačítko „Pokračovat" vůbec neukáže. */
  canResume: boolean;
}

/** Barvy náhledu odpovídají paletě rendereru; index = hodnota vrstvy terénu. */
const PREVIEW_RGB: Readonly<Record<number, readonly [number, number, number]>> = {
  [TERRAIN.grass]: [0x6b, 0x9b, 0x4a],
  [TERRAIN.water]: [0x3a, 0x6e, 0xa5],
  [TERRAIN.sand]: [0xd6, 0xc4, 0x8a],
  [TERRAIN.rock]: [0x8a, 0x8a, 0x8a],
  [TERRAIN.forest]: [0x3f, 0x6b, 0x34],
  [TERRAIN.marsh]: [0x6d, 0x7a, 0x55],
};

const BLACK = [0, 0, 0] as const;

/**
 * Od téhle velikosti se u volby ukáže varování.
 *
 * 512 × 512 je 262 144 dlaždic, šestnáctkrát víc než výchozí mapa. Zadání
 * (R20) s tím počítá jako s jiným režimem, ne s jiným číslem — hráč to má
 * vědět **předem**, ne až mu město začne trhat.
 */
const HEAVY_SIZE = 512;

/** Seed je uint32, aby se vešel do savu i do `Rng` beze změny významu. */
function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/**
 * Jeden posuvník s popiskem a hodnotou vpravo.
 *
 * Hodnotu píše volající do `readout`, ne tenhle kód: u vody jsou to procenta,
 * u kopců patra, a formátovat obojí jednou funkcí by znamenalo parametr navíc
 * jen kvůli znaku procenta.
 */
function slider(
  parent: HTMLElement,
  label: string,
  readout: HTMLElement,
  min: number,
  max: number,
  value: number,
  onChange: (value: number) => void,
  /**
   * Jedna věta o tom, co ta volba udělá.
   *
   * Hráč dostával před první hrou čtyři volby a k žádné vysvětlení: nikde
   * nestálo, že víc vody znamená míň místa a nutnost mostů a že kopce znamenají
   * platit za srovnávání u každé budovy (T-revize, nález 32).
   */
  hint?: string,
): HTMLInputElement {
  const field = el('label', 'dialog__field dialog__field--slider');
  const head = el('div', 'dialog__slider-head');
  head.appendChild(el('span', undefined, label));
  head.appendChild(readout);
  field.appendChild(head);
  if (hint !== undefined) field.appendChild(el('span', 'dialog__hint', hint));

  const input = el('input', 'dialog__slider');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.value = String(value);
  input.addEventListener('input', () => onChange(Number(input.value)));
  field.appendChild(input);
  parent.appendChild(field);
  return input;
}

/**
 * Ukáže dialog a počká, až hráč vybere. Vrací zvolené jméno a seed.
 *
 * `Math.random` tady vadit nemůže: P2 zakazuje náhodu **v simulaci**, ne v UI,
 * které si teprve vybírá, se kterým seedem se hra rozjede.
 */
export function showNewGameDialog(
  parent: HTMLElement,
  i18n: I18n,
  balance: Balance,
  options: NewGameOptions = { canResume: false },
): Promise<NewGame> {
  const t = (key: string) => i18n.t(key);
  const t2 = (key: string, params: Record<string, string | number>) => i18n.t(key, params);
  // Výchozí krajina je ta z obsahu, ne z kódu: mod si ji přenastaví (P5).
  const choice: MapChoice = { seaLevel: balance.map.seaLevel, maxHeight: balance.map.maxHeight };
  let resolveGame: (game: NewGame) => void = () => {};

  const overlay = el('div', 'dialog__backdrop');
  const dialog = el('div', 'dialog');
  overlay.appendChild(dialog);

  const title = el('h1', 'dialog__title', t('ui.newGame.title'));
  dialog.appendChild(title);
  markDialog(dialog, title);

  const form = el('div', 'dialog__form');

  const nameLabel = el('label', 'dialog__field');
  nameLabel.appendChild(el('span', undefined, t('ui.newGame.cityName')));
  const nameInput = el('input', 'dialog__input');
  nameInput.type = 'text';
  nameInput.value = t('ui.newGame.defaultCityName');
  nameLabel.appendChild(nameInput);
  form.appendChild(nameLabel);

  // Velikost mapy: čtyři pevné volby, ne posuvník. Mezivelikosti by nic
  // nepřinesly a save i mřížky se od nich odvozují (§2 fáze 4).
  const sizeLabel = el('div', 'dialog__field');
  // Ikona patří k nadpisu volby, ne ke čtyřem čipům: na každém by se jen
  // opakovala a čísla velikostí by se do čipu nevešla.
  const sizeHead = el('span', 'dialog__field-head');
  sizeHead.append(iconSvg('map-size'), t('ui.newGame.size'));
  sizeLabel.appendChild(sizeHead);
  const sizeChips = el('div', 'dialog__sizes');
  sizeLabel.appendChild(sizeChips);
  sizeLabel.appendChild(el('span', 'dialog__hint', t('ui.newGame.sizeHint')));

  // Katastrofy jdou vypnout hned při zakládání města (R18). Kdo si chce
  // stavět a ne hasit, nemá důvod se to dozvídat až po prvním požáru.
  const disasterLabel = el('label', 'dialog__field dialog__field--check');
  const disasterInput = el('input');
  disasterInput.type = 'checkbox';
  disasterInput.checked = true;
  disasterLabel.appendChild(disasterInput);
  const disasterText = el('span');
  disasterText.appendChild(el('span', undefined, t('ui.newGame.disasters')));
  disasterText.appendChild(el('span', 'dialog__hint', t('ui.newGame.disastersHint')));
  disasterLabel.appendChild(disasterText);

  const seedLabel = el('label', 'dialog__field');
  seedLabel.appendChild(el('span', undefined, t('ui.newGame.seed')));
  const seedInput = el('input', 'dialog__input');
  seedInput.type = 'text';
  seedInput.inputMode = 'numeric';
  seedLabel.appendChild(seedInput);
  form.appendChild(seedLabel);

  /*
   * Posuvníky krajiny.
   *
   * Vedle sebe, hned nad náhledem — hráč jimi hýbe a dívá se, co to udělá,
   * takže mezi ovladačem a obrázkem nemá co stát. Náhled se překresluje při
   * každém posunu, ne až po puštění: generátor 128×128 trvá jednotky
   * milisekund a čekání by z posuvníku udělalo hádanku.
   */
  const terrainFields = el('div', 'dialog__terrain');

  const waterValue = el('span', 'dialog__slider-value');
  slider(
    terrainFields,
    t('ui.newGame.water'),
    waterValue,
    Math.round(WATER_MIN * 100),
    Math.round(WATER_MAX * 100),
    Math.round(choice.seaLevel * 100),
    (percent) => {
      choice.seaLevel = percent / 100;
      draw();
    },
    t('ui.newGame.waterHint'),
  );

  const hillsValue = el('span', 'dialog__slider-value');
  slider(
    terrainFields,
    t('ui.newGame.hills'),
    hillsValue,
    0,
    MAX_HEIGHT,
    choice.maxHeight,
    (levels) => {
      choice.maxHeight = levels;
      draw();
    },
    t('ui.newGame.hillsHint'),
  );

  dialog.appendChild(form);
  dialog.appendChild(sizeLabel);
  dialog.appendChild(terrainFields);
  dialog.appendChild(disasterLabel);

  const canvas = el('canvas', 'dialog__preview');
  dialog.appendChild(canvas);

  const note = el('p', 'dialog__note');
  dialog.appendChild(note);

  let seed = randomSeed();
  let size: MapSize = DEFAULT_MAP_SIZE as MapSize;

  const chips = new Map<MapSize, HTMLButtonElement>();
  for (const option of MAP_SIZES) {
    const chip = button('chip', () => {
      size = option;
      markChips();
      draw();
    });
    chip.textContent = `${option}×${option}`;
    if (option >= HEAVY_SIZE) chip.title = t('ui.newGame.size.heavy');
    // U výchozí velikosti se říká, že je doporučená — jinak je to čtveřice
    // čísel, ze které si hráč nemá jak vybrat.
    else if (option === DEFAULT_MAP_SIZE) chip.title = t('ui.newGame.size.recommended');
    chips.set(option, chip);
    sizeChips.appendChild(chip);
  }

  function markChips(): void {
    for (const [option, chip] of chips) {
      setPressed(chip, option === size);
    }
  }

  function draw(): void {
    seedInput.value = String(seed);

    const context = canvas.getContext('2d');
    if (!context) return;

    const { terrain, cornerHeight } = generateTerrain(seed, balanceWithMap(balance, choice), size);

    // Jeden pixel na dlaždici; roztažení na 384 bodů obstará CSS
    // (`image-rendering: pixelated`). Do T43 se kreslily obdélníky, což u
    // 16 384 dlaždic nikoho nebolelo — u 262 144 by to bylo čtvrt milionu
    // volání `fillRect` při každém přepnutí velikosti.
    canvas.width = size;
    canvas.height = size;
    const image = context.createImageData(size, size);
    // Náhled **stínuje podle výšky**. Bez toho by posuvník kopců nedělal na
    // obrázku vůbec nic — barva terénu na patrech nezávisí — a hráč by hýbal
    // něčím, co nevidí. Roh stačí jeden: jde o dojem z reliéfu, ne o měření.
    const corners = cornerSizeOf(size);
    for (let tile = 0; tile < terrain.length; tile++) {
      const rgb = PREVIEW_RGB[terrain[tile] ?? TERRAIN.grass] ?? BLACK;
      const x = tile % size;
      const y = (tile - x) / size;
      const floors = cornerHeight[y * corners + x] ?? 0;
      const shade = choice.maxHeight > 0 ? 0.78 + (floors / choice.maxHeight) * 0.42 : 1;
      const at = tile * 4;
      image.data[at] = Math.min(255, Math.round(rgb[0] * shade));
      image.data[at + 1] = Math.min(255, Math.round(rgb[1] * shade));
      image.data[at + 2] = Math.min(255, Math.round(rgb[2] * shade));
      image.data[at + 3] = 255;
    }
    context.putImageData(image, 0, 0);

    waterValue.textContent = t2('ui.newGame.waterValue', {
      percent: Math.round(choice.seaLevel * 100),
    });
    hillsValue.textContent =
      choice.maxHeight === 0
        ? t('ui.newGame.hillsFlat')
        : t2('ui.newGame.hillsValue', { levels: choice.maxHeight });

    let land = 0;
    for (const value of terrain) if (value !== TERRAIN.water) land++;
    // Milisekundy generátoru hráči neříkají nic — je to údaj pro vývoj,
    // stejně jako značka sestavení, a ve hře nemá co dělat (nález 32).
    const stats = i18n.t('ui.newGame.stats', {
      land: Math.round((land / terrain.length) * 100),
    });
    // Varování se lepí za statistiku, ne místo ní: hráč potřebuje obojí.
    note.textContent = size >= HEAVY_SIZE ? `${stats} ${t('ui.newGame.size.heavy')}` : stats;
    note.classList.toggle('is-warning', size >= HEAVY_SIZE);
  }

  const actions = el('div', 'dialog__actions');

  // Pokračovat je první volba, když je v čem: kdo si obnovil stránku, chce
  // zpátky svoje město, ne nové.
  if (options.canResume) {
    const resume = button('chip chip--primary', () => {
      overlay.remove();
      resolveGame({
        cityName: '',
        seed,
        size,
        disasters: disasterInput.checked,
        map: { ...choice },
        resume: true,
      });
    });
    resume.append(iconSvg('resume'), t('ui.newGame.resume'));
    actions.appendChild(resume);
  }

  const reroll = button('chip', () => {
    seed = randomSeed();
    draw();
  });
  reroll.append(iconSvg('reroll'), t('ui.newGame.reroll'));
  actions.appendChild(reroll);

  // Ručně zapsaný seed má platit — je to hlavní důvod, proč je pole editovatelné.
  seedInput.addEventListener('change', () => {
    const typed = Number.parseInt(seedInput.value, 10);
    seed = Number.isFinite(typed) ? typed >>> 0 : seed;
    draw();
  });

  const start = button(options.canResume ? 'chip' : 'chip chip--primary', () => {
    overlay.remove();
    resolveGame({
      cityName: nameInput.value.trim() || t('ui.newGame.defaultCityName'),
      seed,
      size,
      disasters: disasterInput.checked,
      map: { ...choice },
    });
  });
  start.append(iconSvg('start-city'), t('ui.newGame.start'));
  actions.appendChild(start);

  dialog.appendChild(actions);
  parent.appendChild(overlay);
  markChips();
  draw();

  return new Promise<NewGame>((resolve) => {
    resolveGame = resolve;
  });
}
