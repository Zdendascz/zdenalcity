import { Application, Container, Graphics } from 'pixi.js';
import { MAP_SIZE } from '@/sim/layers';
import { createSimHost } from '@/sim/simHost';
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

export async function startApp(mount: HTMLElement): Promise<SimHost> {
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

  const canvas = app.canvas;

  function isPanButton(event: PointerEvent): boolean {
    // Prostřední nebo pravé tlačítko, případně mezerník + levé.
    return event.button === 1 || event.button === 2 || (event.button === 0 && spaceDown);
  }

  function updateHover(event: PointerEvent): void {
    hoveredTile = pickTile(
      camera,
      event.offsetX,
      event.offsetY,
      app.screen.width,
      app.screen.height,
      MAP_SIZE,
    );
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!isPanButton(event)) return;
    dragPointerId = event.pointerId;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (dragPointerId === event.pointerId) {
      pan(camera, event.clientX - lastPointerX, event.clientY - lastPointerY);
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
    }
    updateHover(event);
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

  // Bez tohohle by pravé tlačítko při panování otevřelo kontextové menu.
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') spaceDown = true;
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') spaceDown = false;
  });

  app.ticker.add(() => {
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
      `tick   ${world.tick}`,
      `fps    ${app.ticker.FPS.toFixed(0)}`,
    ]);
  });

  if (import.meta.env.DEV) {
    // Ladicí přístup k běžící hře z konzole prohlížeče. Pouze ve vývojovém
    // buildu — v produkci se tahle větev odstraní při tree-shakingu.
    (globalThis as Record<string, unknown>).__city = { app, camera, host, chunkRenderer };
  }

  return host;
}
