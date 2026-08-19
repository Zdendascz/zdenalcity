import type { Balance } from '@/content/balance';
import { MAP_SIZE, TERRAIN } from '@/sim/layers';
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
}

/** Barvy náhledu odpovídají paletě rendereru; index = hodnota vrstvy terénu. */
const PREVIEW_COLORS: Readonly<Record<number, string>> = {
  [TERRAIN.grass]: '#6b9b4a',
  [TERRAIN.water]: '#3a6ea5',
  [TERRAIN.sand]: '#d6c48a',
  [TERRAIN.rock]: '#8a8a8a',
  [TERRAIN.forest]: '#3f6b34',
  [TERRAIN.marsh]: '#6d7a55',
};

const PREVIEW_SCALE = 3;

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

  const seedLabel = el('label', 'dialog__field');
  seedLabel.appendChild(el('span', undefined, t('ui.newGame.seed')));
  const seedInput = el('input', 'dialog__input');
  seedInput.type = 'text';
  seedInput.inputMode = 'numeric';
  seedLabel.appendChild(seedInput);
  form.appendChild(seedLabel);

  dialog.appendChild(form);

  const canvas = el('canvas', 'dialog__preview');
  canvas.width = MAP_SIZE * PREVIEW_SCALE;
  canvas.height = MAP_SIZE * PREVIEW_SCALE;
  dialog.appendChild(canvas);

  const note = el('p', 'dialog__note');
  dialog.appendChild(note);

  let seed = randomSeed();

  function draw(): void {
    seedInput.value = String(seed);

    const context = canvas.getContext('2d');
    if (!context) return;

    const started = performance.now();
    const { terrain } = generateTerrain(seed, balance);

    // Kreslí se po dlaždicích; 16 384 obdélníků je pod milisekundu a odpadá
    // tím práce s ImageData a jejím pořadím kanálů.
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        context.fillStyle = PREVIEW_COLORS[terrain[y * MAP_SIZE + x] ?? TERRAIN.grass] ?? '#000';
        context.fillRect(x * PREVIEW_SCALE, y * PREVIEW_SCALE, PREVIEW_SCALE, PREVIEW_SCALE);
      }
    }

    let land = 0;
    for (const value of terrain) if (value !== TERRAIN.water) land++;
    note.textContent = i18n.t('ui.newGame.stats', {
      land: Math.round((land / terrain.length) * 100),
      ms: Math.round(performance.now() - started),
    });
  }

  const actions = el('div', 'dialog__actions');
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

  const start = button('chip chip--primary', () => {
    overlay.remove();
    resolveGame({ cityName: nameInput.value.trim() || t('ui.newGame.defaultCityName'), seed });
  });
  start.textContent = t('ui.newGame.start');
  actions.appendChild(start);

  dialog.appendChild(actions);
  parent.appendChild(overlay);
  draw();

  return new Promise<NewGame>((resolve) => {
    resolveGame = resolve;
  });
}
