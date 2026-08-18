import { Application, Container, Graphics } from 'pixi.js';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { MAP_SIZE, ZONE } from '@/sim/layers';
import type { ZoneType } from '@/sim/layers';
import { createSimHost, SPEEDS } from '@/sim/simHost';
import type { SimHost } from '@/sim/simHost';
import { createDefaultSystems } from '@/sim/systems';
import { totalJobs, totalPopulation } from '@/sim/world';
import { BuildingRenderer } from './buildingRenderer';
import type { AppearanceLookup } from './buildingRenderer';
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

/** Nástroj na levém tlačítku. Bourání je vždycky na pravém. */
type Tool = 'road' | 'residential' | 'commercial' | 'industrial' | 'utility';

const TOOL_KEYS: Readonly<Record<string, Tool>> = {
  q: 'road',
  r: 'residential',
  c: 'commercial',
  i: 'industrial',
  u: 'utility',
};

const TOOL_ZONE: Readonly<Record<'residential' | 'commercial' | 'industrial', ZoneType>> = {
  residential: ZONE.residential,
  commercial: ZONE.commercial,
  industrial: ZONE.industrial,
};

function createAppearanceLookup(content: ContentRegistry): AppearanceLookup {
  return (definitionId) => {
    const definition = content.get(definitionId);
    if (!definition) return undefined;
    return {
      color: Number.parseInt(definition.graphics.color.slice(1), 16),
      heightLevels: definition.graphics.heightLevels,
      footprint: definition.footprint,
    };
  };
}

export async function startApp(mount: HTMLElement): Promise<SimHost> {
  // Obsah se načítá první. Nevalidní definice má spadnout dřív, než se objeví
  // plátno — tichý pád s polovinou obsahu je horší než hlasitá chyba.
  const content = new ContentRegistry();
  await content.load(createVanillaSource());

  const host = createSimHost(SEED, createDefaultSystems(content), content);
  const world = host.getSnapshot();

  // Infrastruktura ze zóny nevyroste, staví ji hráč. Seznam jde z obsahu,
  // takže v rendereru není jméno ani jedné budovy (P5).
  const utilities = content.byCategory('utility');

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
  const buildingRenderer = new BuildingRenderer(
    world,
    worldContainer,
    createAppearanceLookup(content),
  );

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
  let tool: Tool = 'road';
  // Zrcadlí poslední odeslaný `set_speed`. SimHost rychlost nevystavuje a kvůli
  // ladicímu výpisu nemá smysl rozšiřovat jeho rozhraní.
  let speedIndex = DEFAULT_SPEED_INDEX;
  let paintButton: number | null = null;
  let lastPaintedTile = -1;
  let utilityIndex = 0;

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

  /** Veškeré hráčské akce jdou přes dispatch — renderer na WorldState nesahá. */
  function applyTool(tile: { x: number; y: number }, button: number): void {
    if (button === 2) {
      host.dispatch({ type: 'bulldoze', x: tile.x, y: tile.y });
      return;
    }
    if (tool === 'road') {
      host.dispatch({ type: 'build_road', x: tile.x, y: tile.y });
      return;
    }
    if (tool === 'utility') {
      const definition = utilities[utilityIndex];
      if (definition) {
        host.dispatch({ type: 'place_building', definitionId: definition.id, x: tile.x, y: tile.y });
      }
      return;
    }
    host.dispatch({ type: 'zone', x: tile.x, y: tile.y, w: 1, h: 1, zone: TOOL_ZONE[tool] });
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

    paintButton = event.button;
    lastPaintedTile = tile.y * MAP_SIZE + tile.x;
    applyTool(tile, event.button);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (dragPointerId === event.pointerId) {
      pan(camera, event.clientX - lastPointerX, event.clientY - lastPointerY);
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
    }

    hoveredTile = tileAt(event);

    // Malování tažením: dokud je tlačítko dole, každá nová dlaždice dostane
    // stejný nástroj. Bez toho by se zóna vyznačovala klikáním po jedné.
    if (paintButton !== null && hoveredTile) {
      const tile = hoveredTile.y * MAP_SIZE + hoveredTile.x;
      if (tile !== lastPaintedTile) {
        lastPaintedTile = tile;
        applyTool(hoveredTile, paintButton);
      }
    }
  });

  function endDrag(event: PointerEvent): void {
    paintButton = null;
    lastPaintedTile = -1;
    if (dragPointerId !== event.pointerId) return;
    canvas.releasePointerCapture(event.pointerId);
    dragPointerId = null;
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('pointerleave', () => {
    hoveredTile = null;
    paintButton = null;
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

    const key = event.key.toLowerCase();

    if (key === 'p') {
      chunkRenderer.setPowerOverlay(!chunkRenderer.isPowerOverlayVisible());
      return;
    }

    // Daň se mění u zóny, kterou má hráč zrovna vybranou. Pořádný panel je T9.
    if (key === ',' || key === '.') {
      if (tool !== 'road' && tool !== 'utility') {
        host.dispatch({
          type: 'set_tax_rate',
          zone: TOOL_ZONE[tool],
          rate: world.economy.taxRates[tool] + (key === '.' ? 1 : -1),
        });
      }
      return;
    }

    const requestedTool = TOOL_KEYS[key];
    if (requestedTool) {
      // Opakovaný stisk U cykluje mezi dostupnou infrastrukturou.
      if (requestedTool === 'utility' && tool === 'utility' && utilities.length > 0) {
        utilityIndex = (utilityIndex + 1) % utilities.length;
      }
      tool = requestedTool;
      return;
    }

    // Klávesy 0–4 = pauza, 1×, 2×, 4×, 8×.
    const requestedSpeed = Number.parseInt(event.key, 10);
    if (Number.isInteger(requestedSpeed) && requestedSpeed >= 0 && requestedSpeed < SPEEDS.length) {
      speedIndex = requestedSpeed;
      host.dispatch({ type: 'set_speed', speed: requestedSpeed });
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') spaceDown = false;
  });

  app.ticker.add((ticker) => {
    host.step(ticker.deltaMS);

    const dirty = host.consumeDirty();
    chunkRenderer.update(dirty);
    buildingRenderer.update(dirty);

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

    let poweredBuildings = 0;
    for (const building of world.buildings.values()) {
      if (building.powered) poweredBuildings++;
    }

    overlay.update([
      `tool   ${tool === 'utility' ? (utilities[utilityIndex]?.id ?? 'utility: nic') : tool}`,
      `tile   ${hoveredTile ? `${hoveredTile.x}, ${hoveredTile.y}` : '-'}`,
      `zoom   ${camera.zoom.toFixed(2)}x`,
      `speed  ${SPEEDS[speedIndex] ?? 0}x`,
      `tick   ${world.tick}`,
      `fps    ${app.ticker.FPS.toFixed(0)}`,
      `budov  ${world.buildings.size}`,
      `lidí   ${totalPopulation(world.buildings)}`,
      `práce  ${totalJobs(world.buildings)}`,
      `proud  ${poweredBuildings}/${world.buildings.size}${chunkRenderer.isPowerOverlayVisible() ? ' [P]' : ''}`,
      `kasa   ${world.economy.funds}`,
      `měsíc  +${world.economy.lastIncome} / -${world.economy.lastExpenses}`,
      `RCI    ${world.demand.residential} ${world.demand.commercial} ${world.demand.industrial}`,
      `daně   ${world.economy.taxRates.residential}/${world.economy.taxRates.commercial}/${world.economy.taxRates.industrial} %`,
    ]);
  });

  if (import.meta.env.DEV) {
    // Ladicí přístup k běžící hře z konzole prohlížeče. Pouze ve vývojovém
    // buildu — v produkci se tahle větev odstraní při tree-shakingu.
    (globalThis as Record<string, unknown>).__city = {
      app,
      camera,
      host,
      chunkRenderer,
      buildingRenderer,
      content,
    };
  }

  return host;
}
