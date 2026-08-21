import { Application, Container, Graphics } from 'pixi.js';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { applySaveToWorld, collectLoadWarnings, unpackSave } from '@/save/deserialize';
import { checkFootprint } from '@/sim/buildings';
import { estimatePlacement } from '@/sim/commands';
import { explainParcel } from '@/sim/diagnostics';
import { migrate } from '@/save/migrations';
import { serializeSave } from '@/save/serialize';
import type { Command } from '@/sim/commands';
import { cornerIndex, tileBaseHeight } from '@/sim/heights';
import { index, MAP_SIZE, ZONE } from '@/sim/layers';
import { applyGeneratedMap, generateTerrain } from '@/sim/mapgen';
import type { ZoneType } from '@/sim/layers';
import { createSimHost, SPEEDS } from '@/sim/simHost';
import type { SimHost } from '@/sim/simHost';
import { createDefaultSystems } from '@/sim/systems';
import { computeBudget } from '@/sim/systems/economy';
import { COARSE_CELLS } from '@/sim/coarse';
import { createWorld, NEUTRAL_HAPPINESS } from '@/sim/world';
import { BudgetPanel } from '@/ui/budgetPanel';
import { BuildingInfo } from '@/ui/buildingInfo';
import { CostPopup } from '@/ui/costPopup';
import { PriceTag } from '@/ui/priceTag';
import { Notifications } from '@/ui/notifications';
import { formatNumber } from '@/ui/format';
import { Hud } from '@/ui/hud';
import type { OverlayOption } from '@/ui/hud';
import { I18n, pickLanguage } from '@/ui/i18n';
import type { LocaleTables } from '@/ui/i18n';
import { downloadBytes, readFileBytes } from '@/ui/saveFile';
import { showNewGameDialog } from '@/ui/newGameDialog';
import { Toolbar } from '@/ui/toolbar';
import type { ToolOption } from '@/ui/tools';
import { BuildingRenderer } from './buildingRenderer';
import type { AppearanceLookup } from './buildingRenderer';
import { createCamera, pan, viewportToWorld, zoomAt } from './camera';
import { ChunkRenderer } from './chunkRenderer';
import type { OverlayMode } from './chunkRenderer';
import { CoarseOverlay } from './coarseOverlay';
import { TrafficOverlay } from './trafficOverlay';
import { DebugOverlay } from './debugOverlay';
import {
  BACKGROUND_COLOR,
  COVERAGE_COLOR,
  COVERAGE_MAX_ALPHA,
  CRIME_COLOR,
  CRIME_MAX_ALPHA,
  HAPPINESS_COLOR,
  HAPPINESS_MAX_ALPHA,
  HOVER_BLOCKED_COLOR,
  HOVER_COLOR,
  HOVER_FILL_ALPHA,
  HOVER_LINE_ALPHA,
  LAND_VALUE_COLOR,
  LAND_VALUE_MAX_ALPHA,
  POLLUTION_COLOR,
  POLLUTION_MAX_ALPHA,
  unhappinessValue,
} from './palette';
import { pickTile } from './picking';
import { footprintQuad, gridToScreen } from './projection';

/** Jeden krok kolečka = násobitel zoomu. */
const ZOOM_STEP = 1.15;

/** Značka rohu při terraformingu: bílá, aby ji nešlo splést s ničím v terénu. */
const CORNER_MARK_COLOR = 0xffffff;
const CORNER_MARK_SIZE = 7;

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

/**
 * Pohled na svět: povrch, nebo podzemí.
 *
 * **Není to overlay a nesmí s nimi sdílet jeden slot.** Podzemí mění i to, co
 * dělá stavební nástroj a buldozer (§8 fáze 3), takže když si hráč zapne
 * pokrytí policie, nemá mu to pod rukama přepnout ruční kladení potrubí zpět
 * na silnice. Dřív to jeden slot byl a přesně tohle dělal.
 */
export function createViewOptions(): OverlayOption[] {
  return [
    { id: 'surface', labelKey: 'ui.view.surface', icon: 'surface' },
    { id: 'underground', labelKey: 'ui.view.underground', icon: 'underground' },
  ];
}

/** Diagnostické vrstvy: šest veličin plus dosah každé třídy služeb. */
export function createLayerOptions(content: ContentRegistry): OverlayOption[] {
  return [
    { id: 'power', labelKey: 'ui.overlay.power', icon: 'bolt' },
    { id: 'pollution', labelKey: 'ui.overlay.pollution', icon: 'smoke' },
    { id: 'landValue', labelKey: 'ui.overlay.landValue', icon: 'coins' },
    { id: 'crime', labelKey: 'ui.overlay.crime', icon: 'shield' },
    { id: 'happiness', labelKey: 'ui.overlay.happiness', icon: 'heart' },
    { id: 'traffic', labelKey: 'ui.overlay.traffic', icon: 'street' },
    // Ikonu dosahu služby nese obsah: je to týž symbol, jaký má budova na
    // střeše, takže hráč nemusí luštit, čí dosah zrovna svítí (P5).
    ...serviceClassesOf(content).map((serviceClass) => ({
      id: `coverage:${serviceClass}`,
      labelKey: `ui.overlay.coverage.${serviceClass}`,
      icon: classIconsOf(content).get(serviceClass) ?? 'layers',
    })),
  ];
}

/** Třídy služeb, které v načteném obsahu opravdu existují, v pevném pořadí. */
export function serviceClassesOf(content: ContentRegistry): string[] {
  return [
    ...new Set(
      content
        .getAll('building')
        .map((definition) => definition.service?.class)
        .filter((serviceClass): serviceClass is string => serviceClass !== undefined),
    ),
  ].sort();
}

/** Symbol třídy služby: ten, který její první budova nosí na střeše (P5). */
export function classIconsOf(content: ContentRegistry): Map<string, string> {
  const icons = new Map<string, string>();
  for (const definition of content.getAll('building')) {
    const serviceClass = definition.service?.class;
    const icon = definition.graphics.icon;
    if (serviceClass && icon && !icons.has(serviceClass)) icons.set(serviceClass, icon);
  }
  return icons;
}

/**
 * Nástroje: pevné plus budovy z obsahu. Žádné jméno budovy v kódu (P5).
 *
 * Zařazení do nabídky i ikonu určuje obsah (`menu`, `graphics.icon`). Kód jen
 * seskupuje podle té hodnoty, takže mod se svou třídou služeb dostane vlastní
 * roletu bez jediného řádku navíc.
 */
export function createTools(content: ContentRegistry): ToolOption[] {
  const roadTypes = content.getBalance().traffic.roadTypes;
  const tools: ToolOption[] = [
    // Typy silnic jdou z balancu, ne z kódu: přidat čtvrtý je změna JSONu
    // a jednoho lokalizačního klíče (§4 fáze 3).
    ...roadTypes.map((road, order) => ({
      id: `road:${road.id}`,
      labelKey: `ui.tool.road.${road.id}`,
      icon: road.id,
      ...(order === 0 ? { hotkey: 'q' } : {}),
      groupKey: 'ui.menu.road',
      groupIcon: roadTypes[0]?.id ?? 'street',
      cost: road.cost,
      action: { kind: 'road' as const, roadType: order + 1 },
    })),
    {
      id: 'terrain:raise',
      labelKey: 'ui.tool.terrain.raise',
      icon: 'raise',
      hotkey: 'e',
      groupKey: 'ui.menu.terrain',
      groupIcon: 'raise',
      action: { kind: 'terraform', delta: 1 },
    },
    {
      id: 'terrain:lower',
      labelKey: 'ui.tool.terrain.lower',
      icon: 'lower',
      hotkey: 'd',
      groupKey: 'ui.menu.terrain',
      groupIcon: 'raise',
      action: { kind: 'terraform', delta: -1 },
    },
    {
      id: 'terrain:level',
      labelKey: 'ui.tool.terrain.level',
      icon: 'level',
      hotkey: 'f',
      groupKey: 'ui.menu.terrain',
      groupIcon: 'raise',
      action: { kind: 'terraform', delta: 0 },
    },
    {
      id: 'zone:residential',
      labelKey: 'ui.tool.zone.residential',
      icon: 'zone',
      hotkey: 'r',
      groupKey: 'ui.menu.zone',
      groupIcon: 'zone',
      action: { kind: 'zone', zone: ZONE.residential },
    },
    {
      id: 'zone:commercial',
      labelKey: 'ui.tool.zone.commercial',
      icon: 'zone',
      hotkey: 'c',
      groupKey: 'ui.menu.zone',
      groupIcon: 'zone',
      action: { kind: 'zone', zone: ZONE.commercial },
    },
    {
      id: 'zone:industrial',
      labelKey: 'ui.tool.zone.industrial',
      icon: 'zone',
      hotkey: 'i',
      groupKey: 'ui.menu.zone',
      groupIcon: 'zone',
      action: { kind: 'zone', zone: ZONE.industrial },
    },
    {
      id: 'bulldoze',
      labelKey: 'ui.tool.bulldoze',
      icon: 'bulldoze',
      hotkey: 'x',
      groupKey: 'ui.tool.bulldoze',
      groupIcon: 'bulldoze',
      action: { kind: 'bulldoze' },
    },
  ];

  // Vše, co nevyroste ze zóny, staví hráč ručně. Nabídku i ikonu nese definice;
  // budova bez `menu` skončí v nabídce podle své kategorie, aby se neztratila.
  const manual = [...content.byCategory('utility'), ...content.byCategory('service')];
  const firstIcon = new Map<string, string>();
  for (const definition of manual) {
    const menu = definition.menu ?? definition.category;
    if (!firstIcon.has(menu)) firstIcon.set(menu, definition.graphics.icon ?? 'gear');
  }

  manual.forEach((definition, order) => {
    const menu = definition.menu ?? definition.category;
    tools.push({
      id: `place:${definition.id}`,
      labelKey: definition.name, // popisek pojmenuje obsah, ne kód
      icon: definition.graphics.icon ?? 'gear',
      ...(order === 0 ? { hotkey: 'u' } : {}),
      groupKey: `ui.menu.${menu}`,
      groupIcon: firstIcon.get(menu) ?? 'gear',
      cost: definition.construction.cost,
      action: { kind: 'place' as const, definitionId: definition.id },
    });
  });

  // Nabídky musí jít v liště za sebou; obsah je seřazený podle id, ne podle
  // nabídky, takže se pořadí srovná tady.
  const order = new Map<string, number>();
  for (const tool of tools) {
    if (!order.has(tool.groupKey)) order.set(tool.groupKey, order.size);
  }
  return tools.sort((a, b) => (order.get(a.groupKey) ?? 0) - (order.get(b.groupKey) ?? 0));
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

  // Hra začíná dialogem: hráč si vybere jméno města a seed a rovnou vidí, jakou
  // mapu dostane (§3 fáze 3). Teprve pak vzniká svět.
  const newGame = await showNewGameDialog(mount, i18n, content.getBalance());

  // `simWorld` je zapisovatelný stav, který drží tahle vrstva, protože ho
  // potřebuje save. `world` je read-only pohled pro renderer a UI (T2).
  const simWorld = createWorld(newGame.seed, content.getBalance().economy);
  applyGeneratedMap(simWorld, generateTerrain(newGame.seed, content.getBalance()));
  // Ze seedu jde tenhle terén kdykoli vygenerovat znovu, tak ať to save ví.
  simWorld.map = { seed: newGame.seed, generated: true };
  const host = createSimHost(
    simWorld,
    createDefaultSystems(content, content.getBalance()),
    content,
    content.getBalance(),
  );
  const world = host.getSnapshot();

  const app = new Application();
  await app.init({ background: BACKGROUND_COLOR, resizeTo: mount, antialias: true });
  mount.appendChild(app.canvas);

  const worldContainer = new Container();
  app.stage.addChild(worldContainer);

  const serviceClasses = serviceClassesOf(content);

  /**
   * Nespokojenost pro overlay: `HAPPINESS_CLEAN_AT` a výš je nula, odtud to
   * lineárně roste až k 255 na dně stupnice.
   *
   * Overlaye v téhle hře kreslí problémy — kdyby tenhle maloval spokojenost,
   * nejsilněji by svítily čtvrti, se kterými není co dělat, a ta jediná, kde
   * se něco děje, by zůstala prázdná.
   */
  const unhappiness = new Uint8Array(COARSE_CELLS);
  const unhappinessLayer = (): Uint8Array => {
    for (let cell = 0; cell < unhappiness.length; cell++) {
      const value = world.happiness[cell] ?? NEUTRAL_HAPPINESS;
      unhappiness[cell] = unhappinessValue(value);
    }
    return unhappiness;
  };

  const chunkRenderer = new ChunkRenderer(world, worldContainer);
  const buildingRenderer = new BuildingRenderer(
    world,
    worldContainer,
    createAppearanceLookup(content),
  );

  const coarseOverlay = new CoarseOverlay(world, worldContainer, [
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
    {
      id: 'happiness',
      color: HAPPINESS_COLOR,
      maxAlpha: HAPPINESS_MAX_ALPHA,
      values: unhappinessLayer,
    },
    // Dosah každé třídy, která ve hře existuje. Seznam jde z obsahu, ne z kódu —
    // mod se svou třídou dostane přepínač zadarmo (P5).
    ...serviceClasses.map((serviceClass) => ({
      id: `coverage:${serviceClass}`,
      color: COVERAGE_COLOR,
      maxAlpha: COVERAGE_MAX_ALPHA,
      values: () => simWorld.coverage.get(serviceClass),
    })),
  ]);

  // Doprava má vlastní overlay: plné rozlišení, jen silnice.
  const trafficOverlay = new TrafficOverlay(
    worldContainer,
    world,
    (roadType) => content.getBalance().traffic.roadTypes[roadType - 1]?.capacity ?? 0,
  );

  const hover = new Graphics();
  worldContainer.addChild(hover);


  const debug = new DebugOverlay(mount);
  debug.setVisible(false);
  const costPopup = new CostPopup(mount);
  const priceTag = new PriceTag(mount);
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
      cityName: newGame.cityName,
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

      // Město po migraci z verze 4 nemá jedinou trubku a začne chátrat.
      // Hláška v řádku o uložení by se ztratila mezi „Načteno“ — tohle patří
      // do notifikací, protože to hráč musí vědět dřív, než mu ubudou lidi.
      if (warnings.waterlessBuildings > 0) {
        notifications.show(
          i18n.t('ui.save.noWaterNetwork', { count: warnings.waterlessBuildings }),
          'error',
        );
      }
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

  /**
   * Ukazuje se u kurzoru roh místo dlaždice?
   *
   * Jen u zvedání a snižování. Srovnání pracuje s celou plochou pod budovou,
   * takže tam čtverec sedí.
   */
  function cornerTool(): boolean {
    return activeTool.action.kind === 'terraform' && activeTool.action.delta !== 0;
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
    // Svah **není** překážka: parcela se srovná při stavbě, jen to něco stojí.
    return definition
      ? checkFootprint(simWorld, definition, tile.x, tile.y, { skipFlatCheck: true }).ok
      : true;
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

  const views = createViewOptions();
  const layers = createLayerOptions(content);

  let viewMode = 'surface';
  let layerMode = 'none';

  function applyViewAndLayer(): void {
    // Elektřina se zapéká do chunků, hrubé veličiny mají vlastní lehkou vrstvu
    // a doprava svou vlastní v plném rozlišení.
    const chunkMode: OverlayMode =
      viewMode === 'underground' ? 'underground' : layerMode === 'power' ? 'power' : 'none';
    chunkRenderer.setOverlay(chunkMode);
    const coarseId = layerMode === 'power' || layerMode === 'traffic' ? 'none' : layerMode;
    coarseOverlay.setActive(coarseId);
    trafficOverlay.setVisible(layerMode === 'traffic');
    // Budovy v podzemním pohledu překáží — hráč se dívá pod ně.
    buildingRenderer.setVisible(viewMode !== 'underground');
  }

  function setView(id: string): void {
    viewMode = id;
    applyViewAndLayer();
  }

  function toggleLayer(id: string): void {
    layerMode = layerMode === id ? 'none' : id;
    applyViewAndLayer();
  }

  const hud = new Hud(hudRoot, i18n, world, SPEEDS, views, layers, serviceClasses, {
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
    onToggleLayer: toggleLayer,
    onSetView: setView,
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
      world.cornerHeight,
    );
  }

  /**
   * Roh dlaždice nejblíž kurzoru.
   *
   * Terraforming hýbe rohem, ne dlaždicí, takže se hráč musí trefit do rohu.
   * Pevný severozápadní by znamenal, že kliknutí na pravou půlku dlaždice
   * zvedne roh na opačné straně, než kam hráč mířil.
   */
  function nearestCorner(
    tile: { x: number; y: number },
    viewX: number,
    viewY: number,
  ): { x: number; y: number } {
    const point = viewportToWorld(camera, viewX, viewY, app.screen.width, app.screen.height);
    const heights = world.cornerHeight;

    let best = { x: tile.x, y: tile.y };
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      const cx = tile.x + dx;
      const cy = tile.y + dy;
      const at = gridToScreen(cx, cy, heights[cornerIndex(cx, cy)] ?? 0);
      const distance = (at.x - point.x) ** 2 + (at.y - point.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: cx, y: cy };
      }
    }

    return best;
  }

  /** Poslední pozice kurzoru — cenovka se překresluje každý snímek. */
  let pointerX = 0;
  let pointerY = 0;

  /**
   * Cenovka u kurzoru: co bude stát postavit tohle sem, **včetně srovnání
   * parcely** (§12 kritérium 14). U ostatních nástrojů se schová — cena
   * silnice je pevná a v liště.
   */
  function showPlacementPrice(tile: { x: number; y: number }): void {
    if (activeTool.action.kind !== 'place') {
      priceTag.hide();
      return;
    }

    const plan = estimatePlacement(
      simWorld,
      content,
      activeTool.action.definitionId,
      tile.x,
      tile.y,
      content.getBalance(),
    );

    const text =
      plan.levelling > 0
        ? i18n.t('ui.price.withLevelling', {
            total: formatNumber(plan.total),
            levelling: formatNumber(plan.levelling),
          })
        : formatNumber(plan.total);
    priceTag.show(pointerX, pointerY, text);
  }

  /** Veškeré hráčské akce jdou přes dispatch — renderer na WorldState nesahá. */
  function applyTool(tile: { x: number; y: number }, viewX: number, viewY: number): void {
    const action = activeTool.action;
    const fundsBefore = world.economy.funds;

    switch (action.kind) {
      case 'road':
        // V podzemním pohledu klade stavební nástroj potrubí, ne silnici (§8).
        if (viewMode === 'underground') {
          dispatch({ type: 'build_pipe', x: tile.x, y: tile.y });
        } else {
          dispatch({ type: 'build_road', x: tile.x, y: tile.y, roadType: action.roadType });
        }
        break;
      case 'bulldoze':
        // A buldozer pod zemí bourá trubky, ne to, co stojí nad nimi.
        if (viewMode === 'underground') {
          dispatch({ type: 'remove_pipe', x: tile.x, y: tile.y });
        } else {
          dispatch({ type: 'bulldoze', x: tile.x, y: tile.y });
        }
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
      case 'terraform': {
        if (action.delta === 0) {
          dispatch({ type: 'level_area', x: tile.x, y: tile.y, w: 1, h: 1 });
          break;
        }
        // Zvedá se **nejbližší roh**, ne pevně ten severozápadní: hráč míří
        // kurzorem na konkrétní roh a čeká, že se zvedne ten.
        const corner = nearestCorner(tile, viewX, viewY);
        dispatch({ type: 'terraform_corner', x: corner.x, y: corner.y, delta: action.delta });
        break;
      }
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
    pointerX = event.offsetX;
    pointerY = event.offsetY;

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
      toggleLayer('power');
      return;
    }

    if (key === 'o') {
      toggleLayer('pollution');
      return;
    }

    if (key === 'l') {
      toggleLayer('landValue');
      return;
    }

    if (key === 'k') {
      toggleLayer('crime');
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
    trafficOverlay.update();

    worldContainer.scale.set(camera.zoom);
    worldContainer.position.set(
      app.screen.width / 2 - camera.x * camera.zoom,
      app.screen.height / 2 - camera.y * camera.zoom,
    );

    hover.clear();
    if (hoveredTile && cornerTool()) {
      // Zvedání a snižování hýbe **rohem**, ne dlaždicí. Rámeček kolem celého
      // čtverce by ukazoval čtyři rohy naráz a hráč by netušil, který z nich
      // se pohne — proto se místo něj rozsvítí ten jeden.
      const corner = nearestCorner(hoveredTile, pointerX, pointerY);
      const at = gridToScreen(corner.x, corner.y, world.cornerHeight[cornerIndex(corner.x, corner.y)] ?? 0);
      // Velikost v obrazovkových bodech, ne ve světových: značka má být stejně
      // čitelná při plném přiblížení i oddálení.
      const radius = CORNER_MARK_SIZE / camera.zoom;

      hover
        .poly([
          at.x, at.y - radius,
          at.x + radius, at.y,
          at.x, at.y + radius,
          at.x - radius, at.y,
        ])
        .fill({ color: CORNER_MARK_COLOR, alpha: 0.9 })
        .stroke({ color: 0x000000, alpha: 0.5, width: 1 / camera.zoom });

      priceTag.hide();
    } else if (hoveredTile) {
      // Rámeček kreslí **celý půdorys**, ne jen dlaždici pod kurzorem — u budovy
      // 4×4 jinak není poznat, kam se vlastně položí. Pro 1×1 vyjde přesně
      // diamant dlaždice.
      const [width, depth] = activeFootprint();
      const blocked = !placementFits(hoveredTile, width, depth);
      const color = blocked ? HOVER_BLOCKED_COLOR : HOVER_COLOR;

      hover
        .poly(
          footprintQuad(
            hoveredTile.x,
            hoveredTile.y,
            width,
            depth,
            tileBaseHeight(world.cornerHeight, hoveredTile.x, hoveredTile.y),
          ),
        )
        .fill({ color, alpha: HOVER_FILL_ALPHA })
        .stroke({ color, alpha: HOVER_LINE_ALPHA, width: 2 / camera.zoom });

      // Cena **předem** (§12 kritérium 14). Srovnání parcely se nemá objevit
      // až na účtu — hráč musí vidět, kolik ho svah bude stát, dřív než klikne.
      showPlacementPrice(hoveredTile);
    } else {
      priceTag.hide();
    }

    let poweredBuildings = 0;
    for (const building of world.buildings.values()) {
      if (building.powered) poweredBuildings++;
    }

    hud.update({
      speedIndex,
      layer: layerMode,
      view: viewMode,
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
