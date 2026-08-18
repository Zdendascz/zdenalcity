import { Application, Container, Graphics } from 'pixi.js';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { MAP_SIZE } from '@/sim/layers';
import { createSimHost, SPEEDS } from '@/sim/simHost';
import type { SimHost } from '@/sim/simHost';
import { createCamera, pan, zoomAt } from './camera';
import { ChunkRenderer } from './chunkRenderer';
import { DebugOverlay } from './debugOverlay';
import {
  BACKGROUND_COLOR,
  HOVER_COLOR,
  HOVER_FILL_ALPHA,
  HOVER_LINE_ALPHA,
} from './palette';
import { pickTile } from './picking';
import { diamondPoints, gridToScreen } from './projection';

/** Mapa je zatím všude tráva, takže na seedu vizuálně nezáleží. Generátor přijde později. */
const SEED = 483928492;

/** Jeden krok kolečka = násobitel zoomu. */
const ZOOM_STEP = 1.15;

/** Výchozí rychlost odpovídá `SimHost` — 1×. */
const DEFAULT_SPEED_INDEX = 1;

export async function startApp(mount: HTMLElement): Promise<SimHost> {
  // Obsah se načítá první. Nevalidní definice má spadnout dřív, než se objeví
  // plátno — tichý pád s polovinou obsahu je horší než hlasitá chyba.
  const content = new ContentRegistry();
  await content.load(createVanillaSource());

  const host = createSimHost(SEED);
  const world = host.getSnapshot();

  const app = new Application();
  await app.init({
    background: BACKGROUND_COLOR,
    resizeTo: mount,
    antialias: true,
  });
  mount.appendChild(app.canvas);

  const worldContainer = new Container();
  app.stage.addChild(worldContainer);

  const chunkRenderer = new ChunkRenderer(app.renderer, world, worldContainer);

  const hover = new Graphics();
  worldContainer.addChild(hover);

  const overlay = new DebugOverlay(mount);

  // Start uprostřed mapy, jinak by hráč koukal na roh diamantu mimo terén.
  const center = gridToScreen(world.size / 2, world.size / 2);
  const camera = createCamera(center.x, center.y, 1);

  let hoveredTile: { x: number; y: number } | null = null;
  let dragPointerId: number | null = null;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let spaceDown = false;
  // Zrcadlí poslední odeslaný `set_speed`. SimHost rychlost nevystavuje a kvůli
  // ladicímu výpisu nemá smysl rozšiřovat jeho rozhraní.
  let speedIndex = DEFAULT_SPEED_INDEX;

  const canvas = app.canvas;

  /** Panuje se prostředním tlačítkem nebo mezerníkem s levým — pravé bourá. */
  function isPanButton(event: PointerEvent): boolean {
    return event.button === 1 || (event.button === 0 && spaceDown);
  }

  function tileAt(event: PointerEvent): { x: number; y: number } | null {
    return pickTile(
      camera,
      event.offsetX,
      event.offsetY,
      app.screen.width,
      app.screen.height,
      MAP_SIZE,
    );
  }

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();

    if (isPanButton(event)) {
      dragPointerId = event.pointerId;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    const tile = tileAt(event);
    if (!tile) return;

    // Veškeré hráčské akce jdou přes dispatch — renderer na WorldState nesahá.
    if (event.button === 0) {
      host.dispatch({ type: 'build_road', x: tile.x, y: tile.y });
    } else if (event.button === 2) {
      host.dispatch({ type: 'bulldoze', x: tile.x, y: tile.y });
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (dragPointerId === event.pointerId) {
      pan(camera, event.clientX - lastPointerX, event.clientY - lastPointerY);
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
    }
    hoveredTile = tileAt(event);
  });

  function endDrag(event: PointerEvent): void {
    if (dragPointerId !== event.pointerId) return;
    canvas.releasePointerCapture(event.pointerId);
    dragPointerId = null;
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('pointerleave', () => {
    hoveredTile = null;
  });

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomAt(camera, factor, event.offsetX, event.offsetY, app.screen.width, app.screen.height);
    },
    { passive: false },
  );

  // Bez tohohle by pravé tlačítko při bourání otevřelo kontextové menu.
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      spaceDown = true;
      return;
    }
    // Klávesy 0–4 = pauza, 1×, 2×, 4×, 8×.
    const requested = Number.parseInt(event.key, 10);
    if (Number.isInteger(requested) && requested >= 0 && requested < SPEEDS.length) {
      speedIndex = requested;
      host.dispatch({ type: 'set_speed', speed: requested });
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') spaceDown = false;
  });

  app.ticker.add((ticker) => {
    host.step(ticker.deltaMS);
    chunkRenderer.update(host.consumeDirty());

    worldContainer.scale.set(camera.zoom);
    worldContainer.position.set(
      app.screen.width / 2 - camera.x * camera.zoom,
      app.screen.height / 2 - camera.y * camera.zoom,
    );

    hover.clear();
    if (hoveredTile) {
      const origin = gridToScreen(hoveredTile.x, hoveredTile.y);
      hover
        .poly(diamondPoints(origin.x, origin.y))
        .fill({ color: HOVER_COLOR, alpha: HOVER_FILL_ALPHA })
        .stroke({ color: HOVER_COLOR, alpha: HOVER_LINE_ALPHA, width: 2 / camera.zoom });
    }

    overlay.update([
      `tile   ${hoveredTile ? `${hoveredTile.x}, ${hoveredTile.y}` : '-'}`,
      `zoom   ${camera.zoom.toFixed(2)}x`,
      `speed  ${SPEEDS[speedIndex] ?? 0}x`,
      `tick   ${world.tick}`,
      `fps    ${app.ticker.FPS.toFixed(0)}`,
      `defs   ${content.getAll('building').length}`,
    ]);
  });

  if (import.meta.env.DEV) {
    // Ladicí přístup k běžící hře z konzole prohlížeče. Pouze ve vývojovém
    // buildu — v produkci se tahle větev odstraní při tree-shakingu.
    (globalThis as Record<string, unknown>).__city = { app, camera, host, chunkRenderer, content };
  }

  return host;
}
