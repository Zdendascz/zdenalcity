import type { Balance } from '@/content/balance';
import { DEFAULT_MAP_SIZE, MAP_SIZES, TERRAIN } from '@/sim/layers';
import type { MapSize } from '@/sim/layers';
import { generateTerrain } from '@/sim/mapgen';
import { button, el } from './dom';
import type { I18n } from './i18n';

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
   * Hráč chce pokračovat v rozehraném městě, ne zakládat nové. Jméno a seed
   * si pak hra vezme ze savu, ne odsud.
   */
  resume?: boolean;
}

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
  let resolveGame: (game: NewGame) => void = () => {};

  const overlay = el('div', 'dialog__backdrop');
  const dialog = el('div', 'dialog');
  overlay.appendChild(dialog);

  dialog.appendChild(el('h1', 'dialog__title', t('ui.newGame.title')));

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
  sizeLabel.appendChild(el('span', undefined, t('ui.newGame.size')));
  const sizeChips = el('div', 'dialog__sizes');
  sizeLabel.appendChild(sizeChips);

  // Katastrofy jdou vypnout hned při zakládání města (R18). Kdo si chce
  // stavět a ne hasit, nemá důvod se to dozvídat až po prvním požáru.
  const disasterLabel = el('label', 'dialog__field dialog__field--check');
  const disasterInput = el('input');
  disasterInput.type = 'checkbox';
  disasterInput.checked = true;
  disasterLabel.appendChild(disasterInput);
  disasterLabel.appendChild(el('span', undefined, t('ui.newGame.disasters')));

  const seedLabel = el('label', 'dialog__field');
  seedLabel.appendChild(el('span', undefined, t('ui.newGame.seed')));
  const seedInput = el('input', 'dialog__input');
  seedInput.type = 'text';
  seedInput.inputMode = 'numeric';
  seedLabel.appendChild(seedInput);
  form.appendChild(seedLabel);

  dialog.appendChild(form);
  dialog.appendChild(sizeLabel);
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
    chips.set(option, chip);
    sizeChips.appendChild(chip);
  }

  function markChips(): void {
    for (const [option, chip] of chips) {
      chip.classList.toggle('is-active', option === size);
    }
  }

  function draw(): void {
    seedInput.value = String(seed);

    const context = canvas.getContext('2d');
    if (!context) return;

    const started = performance.now();
    const { terrain } = generateTerrain(seed, balance, size);

    // Jeden pixel na dlaždici; roztažení na 384 bodů obstará CSS
    // (`image-rendering: pixelated`). Do T43 se kreslily obdélníky, což u
    // 16 384 dlaždic nikoho nebolelo — u 262 144 by to bylo čtvrt milionu
    // volání `fillRect` při každém přepnutí velikosti.
    canvas.width = size;
    canvas.height = size;
    const image = context.createImageData(size, size);
    for (let tile = 0; tile < terrain.length; tile++) {
      const rgb = PREVIEW_RGB[terrain[tile] ?? TERRAIN.grass] ?? BLACK;
      const at = tile * 4;
      image.data[at] = rgb[0];
      image.data[at + 1] = rgb[1];
      image.data[at + 2] = rgb[2];
      image.data[at + 3] = 255;
    }
    context.putImageData(image, 0, 0);

    let land = 0;
    for (const value of terrain) if (value !== TERRAIN.water) land++;
    const stats = i18n.t('ui.newGame.stats', {
      land: Math.round((land / terrain.length) * 100),
      ms: Math.round(performance.now() - started),
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
      resolveGame({ cityName: '', seed, size, disasters: disasterInput.checked, resume: true });
    });
    resume.textContent = t('ui.newGame.resume');
    actions.appendChild(resume);
  }

  const reroll = button('chip', () => {
    seed = randomSeed();
    draw();
  });
  reroll.textContent = t('ui.newGame.reroll');
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
    });
  });
  start.textContent = t('ui.newGame.start');
  actions.appendChild(start);

  dialog.appendChild(actions);
  parent.appendChild(overlay);
  markChips();
  draw();

  return new Promise<NewGame>((resolve) => {
    resolveGame = resolve;
  });
}
