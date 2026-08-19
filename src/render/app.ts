import { Application, Container, Graphics } from 'pixi.js';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { applySaveToWorld, collectLoadWarnings, unpackSave } from '@/save/deserialize';
import { checkFootprint } from '@/sim/buildings';
import { explainParcel } from '@/sim/diagnostics';
import { migrate } from '@/save/migrations';
import { serializeSave } from '@/save/serialize';
import type { Command } from '@/sim/commands';
import { index, MAP_SIZE, ZONE } from '@/sim/layers';
import type { ZoneType } from '@/sim/layers';
import { createSimHost, SPEEDS } from '@/sim/simHost';
import type { SimHost } from '@/sim/simHost';
import { createDefaultSystems } from '@/sim/systems';
import { computeBudget } from '@/sim/systems/economy';
import { createWorld } from '@/sim/world';
import { BudgetPanel } from '@/ui/budgetPanel';
import { BuildingInfo } from '@/ui/buildingInfo';
import { CostPopup } from '@/ui/costPopup';
import { Notifications } from '@/ui/notifications';
import { formatNumber } from '@/ui/format';
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
import type { OverlayMode } from './chunkRenderer';
import { CoarseOverlay } from './coarseOverlay';
import { DebugOverlay } from './debugOverlay';
import {
  BACKGROUND_COLOR,
  COVERAGE_COLOR,
  COVERAGE_MAX_ALPHA,
  CRIME_COLOR,
  CRIME_MAX_ALPHA,
  HOVER_BLOCKED_COLOR,
  HOVER_COLOR,
  HOVER_FILL_ALPHA,
  HOVER_LINE_ALPHA,
  LAND_VALUE_COLOR,
  LAND_VALUE_MAX_ALPHA,
  POLLUTION_COLOR,
  POLLUTION_MAX_ALPHA,
} from './palette';
import { pickTile } from './picking';
import { footprintQuad, gridToScreen } from './projection';

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
    const icon = definition.graphics.icon;
    return {
      color: Number.parseInt(definition.graphics.color.slice(1), 16),
      heightLevels: definition.graphics.heightLevels,
      footprint: definition.footprint,
      consumesPower: (definition.power?.consumption ?? 0) > 0,
      ...(icon === undefined ? {} : { icon }),
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

  // Vše, co nevyroste ze zóny, staví hráč ručně. Kategorie jde z obsahu,
  // takže nová třída budov přidá tlačítko bez zásahu do kódu (P5).
  const manual: [string, string][] = [
    ['utility', 'ui.tool.group.utility'],
    ['service', 'ui.tool.group.service'],
  ];

  for (const [category, groupKey] of manual) {
    content.byCategory(category).forEach((definition, order) => {
      tools.push({
        id: `place:${definition.id}`,
        labelKey: definition.name, // popisek pojmenuje obsah, ne kód
        hotkey: order === 0 && category === 'utility' ? 'u' : undefined,
        groupKey,
        action: { kind: 'place', definitionId: definition.id },
      });
    });
  }

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
  const simWorld = createWorld(SEED, content.getBalance().economy);
  const host = createSimHost(
    simWorld,
    createDefaultSystems(content, content.getBalance()),
    content,
  );
  const world = host.getSnapshot();

  const app = new Application();
  await app.init({ background: BACKGROUND_COLOR, resizeTo: mount, antialias: true });
  mount.appendChild(app.canvas);

  const worldContainer = new Container();
  app.stage.addChild(worldContainer);

  // Třídy služeb, které v načteném obsahu opravdu existují, v pevném pořadí.
  const serviceClasses = [
    ...new Set(
      content
        .getAll('building')
        .map((definition) => definition.service?.class)
        .filter((serviceClass): serviceClass is string => serviceClass !== undefined),
    ),
  ].sort();

  const chunkRenderer = new ChunkRenderer(world, worldContainer);
  const buildingRenderer = new BuildingRenderer(
    world,
    worldContainer,
    createAppearanceLookup(content),
  );

  const coarseOverlay = new CoarseOverlay(worldContainer, [
    {
      id: 'pollution',
      color: POLLUTION_COLOR,
      maxAlpha: POLLUTION_MAX_ALPHA,
      values: () => world.coarse.pollution,
    },
    {
      id: 'landValue',
      color: LAND_VALUE_COLOR,
      maxAlpha: LAND_VALUE_MAX_ALPHA,
      values: () => world.coarse.landValue,
    },
    { id: 'crime', color: CRIME_COLOR, maxAlpha: CRIME_MAX_ALPHA, values: () => world.coarse.crime },
    // Dosah každé třídy, která ve hře existuje. Seznam jde z obsahu, ne z kódu —
    // mod se svou třídou dostane přepínač zadarmo (P5).
    ...serviceClasses.map((serviceClass) => ({
      id: `coverage:${serviceClass}`,
      color: COVERAGE_COLOR,
      maxAlpha: COVERAGE_MAX_ALPHA,
      values: () => simWorld.coverage.get(serviceClass),
    })),
  ]);

  const hover = new Graphics();
  worldContainer.addChild(hover);


  const debug = new DebugOverlay(mount);
  debug.setVisible(false);
  const costPopup = new CostPopup(mount);
  const notifications = new Notifications(mount);
  const budgetPanel = new BudgetPanel(mount, i18n, content.getAll('building'));
  const buildingInfo = new BuildingInfo(mount, i18n, content.getBalance());

  /**
   * Hra nesmí mlčet. Odmítnutý příkaz i spadlý kód se musí objevit na obrazovce —
   * ve vývoji obzvlášť, protože jinak se chyba pozná až po hodině hraní.
   */
  function dispatch(cmd: Command): void {
    const result = host.dispatch(cmd);
    if (!result.ok) notifications.show(i18n.t(result.reason, result.params));
  }

  function reportCrash(message: string): void {
    notifications.show(i18n.t('error.crash', { message }), 'error');
  }

  window.addEventListener('error', (event) => reportCrash(event.message));
  window.addEventListener('unhandledrejection', (event) => reportCrash(String(event.reason)));

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

  function setSpeed(requested: number): void {
    if (requested < 0 || requested >= SPEEDS.length) return;
    speedIndex = requested;
    dispatch({ type: 'set_speed', speed: requested });
  }

  function changeTax(zone: ZoneType, delta: number): void {
    const category =
      zone === ZONE.residential
        ? 'residential'
        : zone === ZONE.commercial
          ? 'commercial'
          : 'industrial';
    dispatch({ type: 'set_tax_rate', zone, rate: world.economy.taxRates[category] + delta });
  }

  /** Půdorys, který právě vybraný nástroj položí. Vše kromě budov je 1×1. */
  function activeFootprint(): readonly [number, number] {
    if (activeTool.action.kind !== 'place') return [1, 1];
    return content.get(activeTool.action.definitionId)?.footprint ?? [1, 1];
  }

  /**
   * Vejde se sem to, co hráč drží? Ptá se stejné funkce jako příkaz, takže
   * rámeček nemůže tvrdit něco jiného, než co se pak stane.
   */
  function placementFits(tile: { x: number; y: number }, width: number, depth: number): boolean {
    if (activeTool.action.kind !== 'place') return true;
    if (tile.x + width > MAP_SIZE || tile.y + depth > MAP_SIZE) return false;

    const definition = content.get(activeTool.action.definitionId);
    return definition ? checkFootprint(simWorld, definition, tile.x, tile.y).ok : true;
  }

  /**
   * Pravé tlačítko ukazuje detail parcely — s budovou i bez ní. Bourání
   * zůstává na nástroji.
   */
  function showBuildingAt(tile: { x: number; y: number }): void {
    const buildingId = simWorld.layers.buildingId[index(tile.x, tile.y)] ?? 0;
    const building = buildingId === 0 ? undefined : simWorld.buildings.get(buildingId);
    const parcel = explainParcel(simWorld, content.getBalance(), tile.x, tile.y);

    buildingInfo.show(
      simWorld,
      parcel,
      building,
      building ? content.get(building.definitionId) : undefined,
    );
  }

  /** Diagnostické pohledy: čtyři veličiny plus dosah každé třídy služeb. */
  const overlays = [
    { id: 'power', labelKey: 'ui.overlay.power' },
    { id: 'pollution', labelKey: 'ui.overlay.pollution' },
    { id: 'landValue', labelKey: 'ui.overlay.landValue' },
    { id: 'crime', labelKey: 'ui.overlay.crime' },
    ...serviceClasses.map((serviceClass) => ({
      id: `coverage:${serviceClass}`,
      labelKey: `ui.overlay.coverage.${serviceClass}`,
    })),
  ];

  let overlayMode = 'none';

  function toggleOverlay(id: string): void {
    overlayMode = overlayMode === id ? 'none' : id;
    // Elektřina se zapéká do chunků, hrubé veličiny mají vlastní lehkou vrstvu.
    chunkRenderer.setOverlay(overlayMode === 'power' ? 'power' : ('none' as OverlayMode));
    coarseOverlay.setActive(overlayMode === 'power' ? 'none' : overlayMode);
  }

  const hud = new Hud(hudRoot, i18n, world, SPEEDS, overlays, serviceClasses, {
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
    onToggleOverlay: toggleOverlay,
    onToggleBudget: () => budgetPanel.toggle(),
    onFundingChange: (serviceClass, funding) =>
      dispatch({ type: 'set_service_funding', serviceClass, funding }),
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
  function applyTool(tile: { x: number; y: number }, viewX: number, viewY: number): void {
    const action = activeTool.action;
    const fundsBefore = world.economy.funds;

    switch (action.kind) {
      case 'road':
        dispatch({ type: 'build_road', x: tile.x, y: tile.y });
        break;
      case 'bulldoze':
        dispatch({ type: 'bulldoze', x: tile.x, y: tile.y });
        break;
      case 'zone':
        dispatch({ type: 'zone', x: tile.x, y: tile.y, w: 1, h: 1, zone: action.zone });
        break;
      case 'place':
        dispatch({
          type: 'place_building',
          definitionId: action.definitionId,
          x: tile.x,
          y: tile.y,
        });
        break;
    }

    // Cena se čte z rozdílu v kase, ne z definice — bublina tak vyskočí u čehokoli,
    // co kdy začne stát peníze, aniž by se sem muselo sahat.
    const spent = fundsBefore - world.economy.funds;
    if (spent > 0) {
      costPopup.show(viewX, viewY, i18n.t('ui.cost.spent', { amount: formatNumber(spent) }));
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

    if (event.button === 2) {
      showBuildingAt(tile);
      return;
    }

    paintButton = event.button;
    lastPaintedTile = tile.y * MAP_SIZE + tile.x;
    applyTool(tile, event.offsetX, event.offsetY);
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
        applyTool(hoveredTile, event.offsetX, event.offsetY);
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
      // Řeší se před kontrolou HUDu: mezerník musí panovat i tehdy, když má
      // fokus tlačítko v panelu. `preventDefault` zabrání tomu, aby tlačítko
      // mezerník zmáčkl a aby stránka odrolovala.
      event.preventDefault();
      spaceDown = true;
      return;
    }

    // Ostatní klávesy nesmí zasahovat do ovládání prvků v HUDu.
    if (event.target instanceof HTMLElement && event.target.closest('.hud')) return;

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
      toggleOverlay('power');
      return;
    }

    if (key === 'o') {
      toggleOverlay('pollution');
      return;
    }

    if (key === 'l') {
      toggleOverlay('landValue');
      return;
    }

    if (key === 'k') {
      toggleOverlay('crime');
      return;
    }

    if (key === 'b') {
      budgetPanel.toggle();
      return;
    }

    if (event.code === 'Escape') {
      buildingInfo.hide();
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
    try {
      renderFrame(ticker.deltaMS);
    } catch (error) {
      // Výjimka ve smyčce by jinak zmizela v konzoli. Stejná hláška se
      // v bublinách nehromadí, jen si přičte počet.
      reportCrash(error instanceof Error ? error.message : String(error));
    }
  });

  function renderFrame(deltaMS: number): void {
    host.step(deltaMS);

    const dirty = host.consumeDirty();
    chunkRenderer.update(dirty);
    buildingRenderer.update(dirty);
    coarseOverlay.update(dirty.coarseChanged);

    worldContainer.scale.set(camera.zoom);
    worldContainer.position.set(
      app.screen.width / 2 - camera.x * camera.zoom,
      app.screen.height / 2 - camera.y * camera.zoom,
    );

    hover.clear();
    if (hoveredTile) {
      // Rámeček kreslí **celý půdorys**, ne jen dlaždici pod kurzorem — u budovy
      // 4×4 jinak není poznat, kam se vlastně položí. Pro 1×1 vyjde přesně
      // diamant dlaždice.
      const [width, depth] = activeFootprint();
      const blocked = !placementFits(hoveredTile, width, depth);
      const color = blocked ? HOVER_BLOCKED_COLOR : HOVER_COLOR;

      hover
        .poly(footprintQuad(hoveredTile.x, hoveredTile.y, width, depth))
        .fill({ color, alpha: HOVER_FILL_ALPHA })
        .stroke({ color, alpha: HOVER_LINE_ALPHA, width: 2 / camera.zoom });
    }

    let poweredBuildings = 0;
    for (const building of world.buildings.values()) {
      if (building.powered) poweredBuildings++;
    }

    hud.update({
      speedIndex,
      overlay: overlayMode,
      budgetVisible: budgetPanel.isVisible(),
      poweredBuildings,
      funding: simWorld.serviceFunding,
      message: message ? i18n.t(message.key, message.params) : '',
    });

    // Rozpočet se počítá jen když se na něj někdo dívá.
    if (budgetPanel.isVisible()) {
      budgetPanel.update(computeBudget(simWorld, content, content.getBalance()), simWorld.economy.funds);
    }

    // Ladicí výpis je vývojářský nástroj, ne herní UI — proto nejde přes i18n.
    debug.update([
      `tile   ${hoveredTile ? `${hoveredTile.x}, ${hoveredTile.y}` : '-'}`,
      `zoom   ${camera.zoom.toFixed(2)}x`,
      `tick   ${world.tick}`,
      `fps    ${app.ticker.FPS.toFixed(0)}`,
      `defs   ${content.getAll('building').length}`,
      `lang   ${i18n.getLanguage()}`,
    ]);
  }

  if (import.meta.env.DEV) {
    // Ladicí přístup k běžící hře z konzole prohlížeče. Pouze ve vývojovém
    // buildu — v produkci se tahle větev odstraní při tree-shakingu.
    (globalThis as Record<string, unknown>).__city = {
      app,
      camera,
      host,
      chunkRenderer,
      buildingRenderer,
      coarseOverlay,
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
