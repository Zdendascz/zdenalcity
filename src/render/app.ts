import { Application, Container, Graphics } from 'pixi.js';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { applySaveToWorld, collectLoadWarnings, unpackSave } from '@/save/deserialize';
import { migrate } from '@/save/migrations';
import { serializeSave } from '@/save/serialize';
import { MAP_SIZE, ZONE } from '@/sim/layers';
import type { ZoneType } from '@/sim/layers';
import { createSimHost, SPEEDS } from '@/sim/simHost';
import type { SimHost } from '@/sim/simHost';
import { createDefaultSystems } from '@/sim/systems';
import { createWorld } from '@/sim/world';
import { Hud } from '@/ui/hud';
import { I18n, pickLanguage } from '@/ui/i18n';
import type { LocaleTables } from '@/ui/i18n';
import { downloadBytes, readFileBytes } from '@/ui/saveFile';
import { Toolbar } from '@/ui/toolbar';
import type { ToolOption } from '@/ui/tools';
import { BuildingRenderer } from './buildingRenderer';
import type { AppearanceLookup } from './buildingRenderer';
import { createCamera, pan, zoomAt } from './camera';
import { ChunkRenderer } from './chunkRenderer';
import { DebugOverlay } from './debugOverlay';
import { BACKGROUND_COLOR, HOVER_COLOR, HOVER_FILL_ALPHA, HOVER_LINE_ALPHA } from './palette';
import { pickTile } from './picking';
import { diamondPoints, gridToScreen } from './projection';

/** Mapa je zatím všude tráva, takže na seedu vizuálně nezáleží. Generátor přijde později. */
const SEED = 483928492;

/** Jeden krok kolečka = násobitel zoomu. */
const ZOOM_STEP = 1.15;

const DEFAULT_SPEED_INDEX = 1;

interface Message {
  key: string;
  params?: Record<string, string | number>;
}

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

/** Nástroje: pevné plus infrastruktura z obsahu. Žádné jméno budovy v kódu (P5). */
function createTools(content: ContentRegistry): ToolOption[] {
  const tools: ToolOption[] = [
    {
      id: 'road',
      labelKey: 'ui.tool.road',
      hotkey: 'q',
      groupKey: 'ui.tool.group.build',
      action: { kind: 'road' },
    },
    {
      id: 'bulldoze',
      labelKey: 'ui.tool.bulldoze',
      hotkey: 'x',
      groupKey: 'ui.tool.group.build',
      action: { kind: 'bulldoze' },
    },
    {
      id: 'zone:residential',
      labelKey: 'ui.tool.zone.residential',
      hotkey: 'r',
      groupKey: 'ui.tool.group.zones',
      action: { kind: 'zone', zone: ZONE.residential },
    },
    {
      id: 'zone:commercial',
      labelKey: 'ui.tool.zone.commercial',
      hotkey: 'c',
      groupKey: 'ui.tool.group.zones',
      action: { kind: 'zone', zone: ZONE.commercial },
    },
    {
      id: 'zone:industrial',
      labelKey: 'ui.tool.zone.industrial',
      hotkey: 'i',
      groupKey: 'ui.tool.group.zones',
      action: { kind: 'zone', zone: ZONE.industrial },
    },
  ];

  content.byCategory('utility').forEach((definition, order) => {
    tools.push({
      id: `place:${definition.id}`,
      labelKey: definition.name, // popisek pojmenuje obsah, ne kód
      hotkey: order === 0 ? 'u' : undefined,
      groupKey: 'ui.tool.group.utility',
      action: { kind: 'place', definitionId: definition.id },
    });
  });

  return tools;
}

export async function startApp(mount: HTMLElement): Promise<SimHost> {
  // Obsah se načítá první. Nevalidní definice má spadnout dřív, než se objeví
  // plátno — tichý pád s polovinou obsahu je horší než hlasitá chyba.
  const content = new ContentRegistry();
  await content.load(createVanillaSource());

  const tables: Record<string, Record<string, string>> = {};
  for (const language of content.getLanguages()) {
    tables[language] = content.getLocaleTable(language);
  }
  const i18n = new I18n(
    tables as LocaleTables,
    pickLanguage([...navigator.languages], content.getLanguages()),
  );

  // `simWorld` je zapisovatelný stav, který drží tahle vrstva, protože ho
  // potřebuje save. `world` je read-only pohled pro renderer a UI (T2).
  const simWorld = createWorld(SEED);
  const host = createSimHost(simWorld, createDefaultSystems(content), content);
  const world = host.getSnapshot();

  const app = new Application();
  await app.init({ background: BACKGROUND_COLOR, resizeTo: mount, antialias: true });
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

  const debug = new DebugOverlay(mount);
  debug.setVisible(false);

  const startedAt = Date.now();
  const createdAt = new Date(startedAt).toISOString();
  /** Rychlý save drží jen v paměti; do souboru se ukládá tlačítkem. */
  let quickSave: Uint8Array | null = null;
  let message: Message | null = null;

  function saveOptions() {
    return {
      cityName: 'quicksave', // pojmenování města přijde s dialogem nové hry
      createdAt,
      modifiedAt: new Date().toISOString(),
      playtimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      sources: content.getLoadedSources(),
    };
  }

  function loadFromBytes(bytes: Uint8Array): void {
    try {
      const save = migrate(unpackSave(bytes));
      const warnings = collectLoadWarnings(save, content, content.getLoadedSources());
      applySaveToWorld(simWorld, save);

      const missing = [...warnings.missingSources.map((s) => s.id), ...warnings.missingDefinitions];
      message =
        missing.length > 0
          ? { key: 'ui.save.missingContent', params: { list: missing.join(', ') } }
          : { key: 'ui.save.loaded' };
    } catch (error) {
      message = {
        key: 'ui.save.failed',
        params: { reason: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  function quickSaveNow(): void {
    quickSave = serializeSave(simWorld, saveOptions());
    message = { key: 'ui.save.saved', params: { size: (quickSave.byteLength / 1024).toFixed(1) } };
  }

  function quickLoadNow(): void {
    if (!quickSave) {
      message = { key: 'ui.save.empty' };
      return;
    }
    loadFromBytes(quickSave);
  }

  const camera = (() => {
    const center = gridToScreen(world.size / 2, world.size / 2);
    return createCamera(center.x, center.y, 1);
  })();

  let hoveredTile: { x: number; y: number } | null = null;
  let dragPointerId: number | null = null;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let spaceDown = false;
  let speedIndex = DEFAULT_SPEED_INDEX;
  let paintButton: number | null = null;
  let lastPaintedTile = -1;

  const tools = createTools(content);
  let activeTool: ToolOption = tools[0] as ToolOption;

  const hudRoot = document.createElement('div');
  hudRoot.className = 'hud';
  mount.appendChild(hudRoot);

  function setSpeed(index: number): void {
    if (index < 0 || index >= SPEEDS.length) return;
    speedIndex = index;
    host.dispatch({ type: 'set_speed', speed: index });
  }

  function changeTax(zone: ZoneType, delta: number): void {
    const category =
      zone === ZONE.residential
        ? 'residential'
        : zone === ZONE.commercial
          ? 'commercial'
          : 'industrial';
    host.dispatch({ type: 'set_tax_rate', zone, rate: world.economy.taxRates[category] + delta });
  }

  const hud = new Hud(hudRoot, i18n, world, SPEEDS, {
    onSpeed: setSpeed,
    onTaxChange: changeTax,
    onQuickSave: quickSaveNow,
    onQuickLoad: quickLoadNow,
    onDownload: () => {
      const bytes = serializeSave(simWorld, saveOptions());
      downloadBytes(bytes, 'mesto.city');
      message = { key: 'ui.save.saved', params: { size: (bytes.byteLength / 1024).toFixed(1) } };
    },
    onOpenFile: (file) => {
      void readFileBytes(file).then(loadFromBytes);
    },
    onTogglePowerOverlay: () => {
      chunkRenderer.setPowerOverlay(!chunkRenderer.isPowerOverlayVisible());
    },
    onLanguageChange: (language) => i18n.setLanguage(language),
  });

  function selectTool(tool: ToolOption): void {
    activeTool = tool;
    toolbar.setActive(tool.id);
  }

  const toolbar = new Toolbar(hud.toolsSlot, i18n, tools, activeTool.id, selectTool);

  const canvas = app.canvas;

  /** Panuje se prostředním tlačítkem nebo mezerníkem s levým. */
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
  function applyTool(tile: { x: number; y: number }, pointerButton: number): void {
    const action = pointerButton === 2 ? { kind: 'bulldoze' as const } : activeTool.action;

    switch (action.kind) {
      case 'road':
        host.dispatch({ type: 'build_road', x: tile.x, y: tile.y });
        break;
      case 'bulldoze':
        host.dispatch({ type: 'bulldoze', x: tile.x, y: tile.y });
        break;
      case 'zone':
        host.dispatch({ type: 'zone', x: tile.x, y: tile.y, w: 1, h: 1, zone: action.zone });
        break;
      case 'place':
        host.dispatch({
          type: 'place_building',
          definitionId: action.definitionId,
          x: tile.x,
          y: tile.y,
        });
        break;
    }
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
    // Klávesy nesmí zasahovat do psaní ve formulářových prvcích HUDu.
    if (event.target instanceof HTMLElement && event.target.closest('.hud')) return;

    if (event.code === 'Space') {
      spaceDown = true;
      return;
    }

    if (event.code === 'F5' || event.code === 'F9') {
      event.preventDefault(); // jinak by F5 obnovilo stránku
      if (event.code === 'F5') quickSaveNow();
      else quickLoadNow();
      return;
    }

    if (event.code === 'F3') {
      event.preventDefault();
      debug.toggle();
      return;
    }

    const key = event.key.toLowerCase();

    if (key === 'p') {
      chunkRenderer.setPowerOverlay(!chunkRenderer.isPowerOverlayVisible());
      return;
    }

    const tool = tools.find((candidate) => candidate.hotkey === key);
    if (tool) {
      selectTool(tool);
      return;
    }

    const requestedSpeed = Number.parseInt(event.key, 10);
    if (Number.isInteger(requestedSpeed)) setSpeed(requestedSpeed);
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

    hud.update({
      speedIndex,
      powerOverlay: chunkRenderer.isPowerOverlayVisible(),
      poweredBuildings,
      message: message ? i18n.t(message.key, message.params) : '',
    });

    // Ladicí výpis je vývojářský nástroj, ne herní UI — proto nejde přes i18n.
    debug.update([
      `tile   ${hoveredTile ? `${hoveredTile.x}, ${hoveredTile.y}` : '-'}`,
      `zoom   ${camera.zoom.toFixed(2)}x`,
      `tick   ${world.tick}`,
      `fps    ${app.ticker.FPS.toFixed(0)}`,
      `defs   ${content.getAll('building').length}`,
      `lang   ${i18n.getLanguage()}`,
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
      simWorld,
      i18n,
      quickSaveNow,
      quickLoadNow,
      selectTool,
      tools,
    };
  }

  return host;
}
