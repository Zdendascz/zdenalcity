import { Application, Container, Graphics } from 'pixi.js';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import {
  applySaveToWorld,
  collectLoadWarnings,
  readSaveMeta,
  unpackSave,
} from '@/save/deserialize';
import { checkFootprint } from '@/sim/buildings';
import { estimatePlacement } from '@/sim/commands';
import { explainParcel, growthBlocker, worstBlocker } from '@/sim/diagnostics';
import { migrate } from '@/save/migrations';
import { serializeSave } from '@/save/serialize';
import type { Command } from '@/sim/commands';
import { cornerIndex, tileCorners } from '@/sim/heights';
import { index, ZONE } from '@/sim/layers';
import { applyGeneratedMap, generateTerrain } from '@/sim/mapgen';
import type { ZoneType } from '@/sim/layers';
import { createSimHost, SPEEDS } from '@/sim/simHost';
import type { SimHost } from '@/sim/simHost';
import { createDefaultSystems } from '@/sim/systems';
import { DisasterRegistry } from '@/sim/disasters/registry';
import { startDisaster } from '@/sim/disasters/scheduler';
import { createFireDisaster, createWildfireDisaster } from '@/sim/disasters/fire';
import { createFloodDisaster } from '@/sim/disasters/flood';
import { createTornadoDisaster } from '@/sim/disasters/tornado';
import { createEarthquakeDisaster } from '@/sim/disasters/earthquake';
import {
  createExplosionDisaster,
  createIndustrialAccidentDisaster,
} from '@/sim/disasters/blast';
import { computeBudget } from '@/sim/systems/economy';
import { coarseCellsOf } from '@/sim/coarse';
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
import {
  clearAutosave,
  hasAutosave,
  loadAutosave,
  storeAutosave,
} from '@/ui/autosave';
import { downloadBytes, readFileBytes } from '@/ui/saveFile';
import { showNewGameDialog } from '@/ui/newGameDialog';
import { Toolbar } from '@/ui/toolbar';
import type { ToolOption } from '@/ui/tools';
import { BuildingRenderer } from './buildingRenderer';
import type { AppearanceLookup } from './buildingRenderer';
import { createCamera, pan, viewportToWorld, zoomAt } from './camera';
import { ChunkRenderer, viewportFor } from './chunkRenderer';
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
import { gridToScreen, tileQuad } from './projection';

/** Jeden krok kolečka = násobitel zoomu. */
const ZOOM_STEP = 1.15;

/** Značka rohu při terraformingu: bílá, aby ji nešlo splést s ničím v terénu. */
const CORNER_MARK_COLOR = 0xffffff;
const CORNER_MARK_SIZE = 7;

const DEFAULT_SPEED_INDEX = 1;

/** Jak často se ptáme, jestli je v zónách kde stavět. Zhruba jednou za pět vteřin. */
const WATER_CHECK_FRAMES = 300;

/** Kolik volných zónovaných parcel se při té kontrole prozkoumá. */
const SAMPLED_ZONE_TILES = 200;

/** Kolik obrazovkových bodů za vteřinu ujede mapa při držené šipce. */
const PAN_SPEED = 900;

/** Kam která šipka posouvá pohled. Klíč je `KeyboardEvent.code`. */
const PAN_KEYS: Readonly<Record<string, readonly [number, number] | undefined>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

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
      id: 'terrain:fill',
      labelKey: 'ui.tool.terrain.fill',
      icon: 'fill',
      hotkey: 'g',
      groupKey: 'ui.menu.terrain',
      groupIcon: 'raise',
      action: { kind: 'fill' },
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
    // Potrubí patří do nabídky Vodovod, mezi vodárnu a čerpací stanici —
    // hráč hledá vodovod na jednom místě, ne ve dvou.
    {
      id: 'pipe',
      labelKey: 'ui.tool.pipe',
      icon: 'pipe',
      hotkey: 'w',
      groupKey: 'ui.menu.water',
      groupIcon: 'drop',
      cost: content.getBalance().water.pipeCost,
      action: { kind: 'pipe' },
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
  const newGame = await showNewGameDialog(mount, i18n, content.getBalance(), {
    canResume: hasAutosave(),
  });

  // `simWorld` je zapisovatelný stav, který drží tahle vrstva, protože ho
  // potřebuje save. `world` je read-only pohled pro renderer a UI (T2).
  const simWorld = createWorld(newGame.seed, content.getBalance().economy, newGame.size);
  // Přepínač z dialogu (R18). Týká se jen plánovače — menu katastrof pod něj
  // nespadá, jinak by si hráč, který si je vypnul, neměl jak nic vyzkoušet.
  simWorld.disasters.enabled = newGame.disasters;

  /**
   * Registr katastrof.
   *
   * Po T47 je prázdný: kostra stojí, ale spustit ještě není co — jednotlivé
   * pohromy přidávají T48 až T54. Prázdný registr je platný stav, plánovač
   * v něm prostě nemá o čem losovat.
   */
  const disasterRegistry = new DisasterRegistry();
  disasterRegistry.register(createFireDisaster());
  disasterRegistry.register(createWildfireDisaster());
  disasterRegistry.register(createFloodDisaster());
  disasterRegistry.register(createTornadoDisaster());
  disasterRegistry.register(createEarthquakeDisaster());
  disasterRegistry.register(createExplosionDisaster());
  disasterRegistry.register(createIndustrialAccidentDisaster());

  // Obnovení rozehraného města. Nečitelný autosave se **zahodí a hra začne
  // nové město** — spadnout na startu kvůli poškozenému úložišti by znamenalo,
  // že se hráč do hry nedostane vůbec.
  let cityName = newGame.cityName;
  const resumed = newGame.resume ? loadAutosave() : null;
  let restored = false;
  if (resumed) {
    try {
      applySaveToWorld(simWorld, migrate(unpackSave(resumed)));
      cityName = readSaveMeta(resumed).city.name;
      restored = true;
    } catch {
      clearAutosave();
    }
  }

  if (!restored) {
    applyGeneratedMap(
      simWorld,
      generateTerrain(newGame.seed, content.getBalance(), simWorld.size),
    );
    // Ze seedu jde tenhle terén kdykoli vygenerovat znovu, tak ať to save ví.
    simWorld.map = { seed: newGame.seed, generated: true };
  }
  const host = createSimHost(
    simWorld,
    createDefaultSystems(content, content.getBalance(), disasterRegistry),
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
  const unhappiness = new Uint8Array(coarseCellsOf(world.size));
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
      cityName,
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

  /**
   * Uloží město do prohlížeče, aby ho obnovení stránky nesmazalo.
   *
   * Volá se při odchodu ze stránky a jednou za čas i během hry — `pagehide`
   * sám nestačí, prohlížeč ho po pádu karty nezavolá.
   */
  function autosaveNow(): void {
    try {
      storeAutosave(serializeSave(simWorld, saveOptions()));
    } catch {
      // Rozehranou hru neshodí ani plné úložiště.
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

  /**
   * Držené šipky. Ne jednorázový posun na `keydown`: opakování klávesy má
   * v systému vlastní prodlevu i frekvenci, takže by mapa škubala. Takhle se
   * posouvá plynule podle času snímku.
   */
  const panKeys = new Set<string>();
  let speedIndex = DEFAULT_SPEED_INDEX;
  let paintButton: number | null = null;
  let lastPaintedTile = -1;

  /**
   * Odkud se táhne. Zóny, silnice a potrubí se **nekreslí hned**: hráč vidí
   * náhled a použije se, až pustí tlačítko. Klikání po jedné dlaždici je
   * u čtvrti o dvaceti polích trest, a volná ruka u silnice dělá schody.
   */
  let dragAnchor: { x: number; y: number } | null = null;

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


  /**
   * Kreslí se tímhle nástrojem tažením?
   *
   * `area` je obdélník (zóny), `line` lomená čára (silnice, potrubí). Buldozer
   * ani terén sem nepatří: tam je okamžitá odezva to, co hráč čeká.
   */
  function dragKind(): 'area' | 'line' | null {
    const kind = activeTool.action.kind;
    if (kind === 'zone') return 'area';
    if (kind === 'road' || kind === 'pipe') return 'line';
    return null;
  }

  /**
   * Dlaždice, kterých se tažení dotkne.
   *
   * Čára je **lomená, ne úhlopříčná**: nejdřív se jde po ose x, pak po y.
   * Úhlopříčka by v izometrii vypadala jako schodiště a napojení silnic by
   * z ní bylo na nic.
   */
  function dragTiles(): { x: number; y: number }[] {
    if (!dragAnchor || !hoveredTile) return [];
    const kind = dragKind();
    if (kind === null) return [];

    const x0 = Math.min(dragAnchor.x, hoveredTile.x);
    const x1 = Math.max(dragAnchor.x, hoveredTile.x);
    const y0 = Math.min(dragAnchor.y, hoveredTile.y);
    const y1 = Math.max(dragAnchor.y, hoveredTile.y);

    const tiles: { x: number; y: number }[] = [];
    if (kind === 'area') {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) tiles.push({ x, y });
      }
      return tiles;
    }

    for (let x = x0; x <= x1; x++) tiles.push({ x, y: dragAnchor.y });
    for (let y = y0; y <= y1; y++) {
      if (y !== dragAnchor.y) tiles.push({ x: hoveredTile.x, y });
    }
    return tiles;
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
  function placementFits(
    tile: { x: number; y: number },
    width: number,
    depth: number,
  ): boolean {
    if (activeTool.action.kind !== 'place') return true;
    if (tile.x + width > world.size || tile.y + depth > world.size)
      return false;

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
    const buildingId =
      simWorld.layers.buildingId[index(tile.x, tile.y, world.size)] ?? 0;
    const building =
      buildingId === 0 ? undefined : simWorld.buildings.get(buildingId);
    const parcel = explainParcel(
      simWorld,
      content.getBalance(),
      tile.x,
      tile.y,
    );

    buildingInfo.show(
      simWorld,
      parcel,
      building,
      building ? content.get(building.definitionId) : undefined,
      growthBlocker(simWorld, content, content.getBalance(), tile.x, tile.y),
    );
  }

  const views = createViewOptions();
  const layers = createLayerOptions(content);

  let viewMode = 'surface';
  let layerMode = 'none';
  let ghostBuildings = false;

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
    buildingRenderer.setGhost(ghostBuildings);
  }

  function setView(id: string): void {
    viewMode = id;
    applyViewAndLayer();
  }

  function toggleLayer(id: string): void {
    layerMode = layerMode === id ? 'none' : id;
    applyViewAndLayer();
  }

  /**
   * Katastrofa čekající na místo.
   *
   * Menu ji jen nabije; spustí se až tam, kam hráč klikne. Bez toho by se
   * musela spouštět „někde", což je u tornáda a povodně bezcenné — celý smysl
   * menu je vyzkoušet si je tam, kde na to má město reagovat.
   */
  let armedDisaster: string | null = null;

  const hud = new Hud(hudRoot, i18n, world, SPEEDS, views, layers, serviceClasses, disasterRegistry.kinds(), {
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
    onToggleGhost: () => {
      ghostBuildings = !ghostBuildings;
      applyViewAndLayer();
    },
    onFundingChange: (serviceClass, funding) =>
      dispatch({ type: 'set_service_funding', serviceClass, funding }),
    onLanguageChange: (language) => i18n.setLanguage(language),
    onArmDisaster: (kind) => {
      armedDisaster = kind;
      message = { key: 'ui.disaster.armed', params: { name: i18n.t(`ui.disaster.${kind}`) } };
    },
  });

  function selectTool(tool: ToolOption): void {
    activeTool = tool;
    toolbar.setActive(tool.id);

    // Nástroj si přepne pohled sám. Potrubí je pod zemí vidět, nad zemí ne —
    // hráč by kladl trubky poslepu a nikdo by mu neřekl proč. A naopak: kdo
    // sáhne po silnici nebo budově, chce zase vidět povrch.
    //
    // Buldozer je schválně výjimka: pod zemí bourá trubky, nad zemí domy, a to
    // je jediný nástroj, u kterého má smysl obojí.
    if (tool.action.kind === 'pipe') setView('underground');
    else if (tool.action.kind !== 'bulldoze') setView('surface');
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
      world.size,
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
      const at = gridToScreen(
        cx,
        cy,
        heights[cornerIndex(cx, cy, world.size + 1)] ?? 0,
      );
      const distance = (at.x - point.x) ** 2 + (at.y - point.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: cx, y: cy };
      }
    }

    return best;
  }

  /** Byla kasa v mínusu už minulý snímek? Hláška patří k přechodu, ne ke stavu. */
  let wasBroke = false;

  /** Totéž pro nedostatek proudu. */
  let hadPowerShortage = false;

  /**
   * Odpočet snímků do další kontroly „zóny bez vody" a příznak, že se hláška
   * už objevila.
   *
   * Kontrola prochází celou vrstvu zón, takže se nedělá každý snímek. Hlásí se
   * **jednou za město**: opakovat hráči totéž každou minutu je otravné, a když
   * to jednou přečte, ví, kde problém hledat.
   */
  let waterCheckIn = 0;
  const reportedBlockers = new Set<string>();

  /**
   * Zóna bez vody je nejtišší způsob, jak se hra zasekne: silnice vede, proud
   * je, poptávka je kladná — a nevyroste nic, protože pod parcelou nejsou
   * trubky. Nikde to nebylo vidět, dokud si hráč neklikl na konkrétní parcelu.
   */
  function checkZonesCannotGrow(): void {
    const { zone, buildingId } = simWorld.layers;
    const balance = content.getBalance();

    // Vzorek, ne celá mapa: `growthBlocker` pouští tytéž kontroly jako růst
    // a na šestnácti tisících dlaždicích by to bylo znát.
    const reasons: string[] = [];
    let free = 0;
    for (let tile = 0; tile < zone.length && free < SAMPLED_ZONE_TILES; tile++) {
      if ((zone[tile] ?? ZONE.none) === ZONE.none) continue;
      if (buildingId[tile] !== 0) continue;
      free++;

      const x = tile % world.size;
      const reason = growthBlocker(
        simWorld,
        content,
        balance,
        x,
        (tile - x) / world.size,
      );
      // Jediná volná parcela, na které se stavět dá, znamená, že město běží.
      if (reason === null) return;
      reasons.push(reason);
    }

    if (free === 0) return;

    // Hlásí se ta překážka, která drží parcely nejblíž hotova, a každá jen
    // jednou. Opakovat hráči totéž každých pár vteřin je otravné; jakmile
    // jednu odstraní, dozví se o další.
    const worst = worstBlocker(reasons);
    if (worst === null || reportedBlockers.has(worst)) return;
    // „Není poptávka" není závada, jen chvilkový stav — tím se hráč obtěžovat
    // nemá.
    if (worst === 'ui.parcel.blocked.noDemand') return;

    reportedBlockers.add(worst);
    notifications.show(i18n.t('ui.notice.nothingGrows', { reason: i18n.t(worst) }), 'error');
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
  /**
   * Spustí nabitou katastrofu, je-li nějaká. Vrací `true`, když se to stalo.
   *
   * Musí se to vyhodnotit **dřív než tažení**: nástroje jako zóna nebo silnice
   * odkládají zásah na puštění tlačítka, takže by se katastrofa nespustila
   * vůbec a hráč by z menu klikal do prázdna.
   */
  function triggerArmedDisaster(tile: { x: number; y: number }): boolean {
    if (armedDisaster === null) return false;
    const kind = armedDisaster;
    armedDisaster = null;
    startDisaster(simWorld, content, content.getBalance(), disasterRegistry, kind, tile.x, tile.y);
    message = { key: 'ui.disaster.started', params: { name: i18n.t(`ui.disaster.${kind}`) } };
    return true;
  }

  function applyTool(tile: { x: number; y: number }, viewX: number, viewY: number): void {
    const action = activeTool.action;
    const fundsBefore = world.economy.funds;

    switch (action.kind) {
      case 'road':
        dispatch({ type: 'build_road', x: tile.x, y: tile.y, roadType: action.roadType });
        break;
      case 'pipe':
        dispatch({ type: 'build_pipe', x: tile.x, y: tile.y });
        break;
      case 'fill':
        dispatch({ type: 'level_area', x: tile.x, y: tile.y, w: 1, h: 1, mode: 'fill' });
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

    if (triggerArmedDisaster(tile)) return;

    paintButton = event.button;
    lastPaintedTile = tile.y * world.size + tile.x;

    // Nástroje s náhledem se použijí až při puštění; ostatní hned.
    if (dragKind() !== null) {
      dragAnchor = { x: tile.x, y: tile.y };
      return;
    }

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
    if (paintButton !== null && hoveredTile && dragAnchor === null) {
      const tile = hoveredTile.y * world.size + hoveredTile.x;
      if (tile !== lastPaintedTile) {
        lastPaintedTile = tile;
        applyTool(hoveredTile, event.offsetX, event.offsetY);
      }
    }
  });

  /**
   * Zóna se pokládá **jedním příkazem**, ne dlaždici po dlaždici: `zoneArea`
   * přeskočí, co nejde, a odmítnutí ohlásí jednou. Dvacet hlášek „tady to
   * nejde" za jedno tažení by hráč nepřečetl.
   */
  function commitDrag(): void {
    const tiles = dragTiles();
    const anchor = dragAnchor;
    dragAnchor = null;
    if (!anchor || tiles.length === 0) return;

    const action = activeTool.action;
    if (action.kind === 'zone') {
      const xs = tiles.map((tile) => tile.x);
      const ys = tiles.map((tile) => tile.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      dispatch({
        type: 'zone',
        x,
        y,
        w: Math.max(...xs) - x + 1,
        h: Math.max(...ys) - y + 1,
        zone: action.zone,
      });
      return;
    }

    // Silnice a potrubí: každá dlaždice je vlastní příkaz, ale hlásí se jen
    // první odmítnutí — jinak by most přes řeku vyplivl deset stejných hlášek.
    if (action.kind !== 'road' && action.kind !== 'pipe') return;

    let complained = false;
    for (const tile of tiles) {
      const command: Command =
        action.kind === 'pipe'
          ? { type: 'build_pipe', x: tile.x, y: tile.y }
          : { type: 'build_road', x: tile.x, y: tile.y, roadType: action.roadType };
      const result = host.dispatch(command);
      if (!result.ok && !complained) {
        complained = true;
        notifications.show(i18n.t(result.reason, result.params));
      }
    }
  }

  function endDrag(event: PointerEvent): void {
    if (dragAnchor !== null && paintButton === 0) {
      commitDrag();
    }
    dragAnchor = null;
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
    // Tažení, které opustilo plátno, se zahodí. Dokreslit ho naslepo by
    // znamenalo zónu tam, kam hráč nevidí.
    dragAnchor = null;
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

  // Pravé tlačítko je herní ovládání — otevírá panel parcely a ruší tažení.
  // Blokuje se proto na celém dokumentu, ne jen na plátně: nabídka vyskočená
  // nad HUDem překrývá hru úplně stejně jako nad mapou.
  document.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      // Řeší se před kontrolou HUDu: mezerník musí panovat i tehdy, když má
      // fokus tlačítko v panelu. `preventDefault` zabrání tomu, aby tlačítko
      // mezerník zmáčkl a aby stránka odrolovala.
      event.preventDefault();
      spaceDown = true;
      return;
    }

    if (PAN_KEYS[event.code]) {
      // Šipky by jinak odrolovaly stránku.
      event.preventDefault();
      panKeys.add(event.code);
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
    panKeys.delete(event.code);
  });

  // Při přepnutí jinam pustí prohlížeč klávesy bez `keyup` a mapa by ujížděla.
  window.addEventListener('blur', () => {
    panKeys.clear();
    spaceDown = false;
  });

  // `pagehide` pokrývá obnovení stránky, zavření karty i odchod jinam.
  // `visibilitychange` navíc přepnutí na jiný panel, po kterém se karta často
  // už neprobudí.
  window.addEventListener('pagehide', autosaveNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') autosaveNow();
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
    // Peče se až tady a jen to, na co je vidět (R20). Musí to být po
    // `update()`, aby se změna z tohohle tiku promítla ještě v tomhle snímku.
    chunkRenderer.cull(
      viewportFor(camera.x, camera.y, camera.zoom, app.screen.width, app.screen.height),
    );
    buildingRenderer.update(dirty);
    coarseOverlay.update(dirty.coarseChanged);
    trafficOverlay.update();

    // Šipky posouvají **konstantní rychlostí na obrazovce**, ne v souřadnicích
    // světa: při oddálení by jinak mapa létala a při přiblížení se sotva hnula.
    if (panKeys.size > 0) {
      const step = (PAN_SPEED * deltaMS) / 1000;
      let dx = 0;
      let dy = 0;
      for (const code of panKeys) {
        const direction = PAN_KEYS[code];
        if (direction) {
          dx += direction[0];
          dy += direction[1];
        }
      }
      if (dx !== 0 || dy !== 0) pan(camera, -dx * step, -dy * step);
    }

    worldContainer.scale.set(camera.zoom);
    worldContainer.position.set(
      app.screen.width / 2 - camera.x * camera.zoom,
      app.screen.height / 2 - camera.y * camera.zoom,
    );

    hover.clear();
    if (dragAnchor !== null) {
      // Náhled tažení: každá dotčená dlaždice zvlášť, podle svých rohů.
      // Hráč musí vidět, kam až sahá, dřív než pustí tlačítko.
      const tiles = dragTiles();
      for (const tile of tiles) {
        if (tile.x >= world.size || tile.y >= world.size) continue;
        hover
          .poly(tileQuad(tile.x, tile.y, tileCorners(world.cornerHeight, tile.x, tile.y)))
          .fill({ color: HOVER_COLOR, alpha: HOVER_FILL_ALPHA })
          .stroke({ color: HOVER_COLOR, alpha: HOVER_LINE_ALPHA, width: 2 / camera.zoom });
      }

      // Cena celého tažení, ne jedné dlaždice — u dvaceti polí je to rozdíl,
      // který hráč potřebuje vidět předem.
      const each = activeTool.cost ?? 0;
      if (each > 0 && tiles.length > 0) {
        priceTag.show(pointerX, pointerY, formatNumber(each * tiles.length));
      } else {
        priceTag.hide();
      }
    } else if (hoveredTile && cornerTool()) {
      // Zvedání a snižování hýbe **rohem**, ne dlaždicí. Rámeček kolem celého
      // čtverce by ukazoval čtyři rohy naráz a hráč by netušil, který z nich
      // se pohne — proto se místo něj rozsvítí ten jeden.
      const corner = nearestCorner(hoveredTile, pointerX, pointerY);
      const at = gridToScreen(
        corner.x,
        corner.y,
        world.cornerHeight[cornerIndex(corner.x, corner.y, world.size + 1)] ??
          0,
      );
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
      // Rámeček kreslí **každou dlaždici půdorysu zvlášť a podle jejích čtyř
      // rohů**. Dřív to byl jeden plochý kosočtverec v jedné výšce, takže na
      // svahu ležel vedle dlaždice, na kterou hráč mířil — a u budovy 4×4
      // nebylo poznat, které dlaždice vlastně zabere.
      const [width, depth] = activeFootprint();
      const blocked = !placementFits(hoveredTile, width, depth);
      const color = blocked ? HOVER_BLOCKED_COLOR : HOVER_COLOR;

      for (let dy = 0; dy < depth; dy++) {
        for (let dx = 0; dx < width; dx++) {
          const x = hoveredTile.x + dx;
          const y = hoveredTile.y + dy;
          if (x >= world.size || y >= world.size) continue;
          hover
            .poly(tileQuad(x, y, tileCorners(world.cornerHeight, x, y)))
            .fill({ color, alpha: HOVER_FILL_ALPHA })
            .stroke({ color, alpha: HOVER_LINE_ALPHA, width: 2 / camera.zoom });
        }
      }

      // Cena **předem** (§12 kritérium 14). Srovnání parcely se nemá objevit
      // až na účtu — hráč musí vidět, kolik ho svah bude stát, dřív než klikne.
      showPlacementPrice(hoveredTile);
    } else {
      priceTag.hide();
    }

    // Bankrot zastaví veškerý růst (§9 fáze 2) a do teď o tom hra mlčela:
    // hráč viděl jen město, které se přestalo hýbat. Hlásí se při přechodu do
    // mínusu, ne každý snímek.
    if (waterCheckIn-- <= 0) {
      waterCheckIn = WATER_CHECK_FRAMES;
      checkZonesCannotGrow();
    }

    const broke = world.economy.funds < 0;
    if (broke !== wasBroke) {
      wasBroke = broke;
      if (broke) notifications.show(i18n.t('ui.notice.bankrupt'), 'error');
    }

    // Výroba a spotřeba proudu. Hráč do teď viděl jen zlomek „65/86" a neměl
    // jak zjistit, jestli mu chybí vedení, nebo elektrárna — dvě úplně jiné
    // opravy. Autor na to narazil s dvěma elektrárnami a dvaceti tmavými domy.
    let poweredBuildings = 0;
    let powerProduced = 0;
    let powerNeeded = 0;
    for (const building of world.buildings.values()) {
      if (building.powered) poweredBuildings++;
      if (building.abandoned) continue;
      const definition = content.get(building.definitionId);
      powerProduced += definition?.power?.production ?? 0;
      powerNeeded += definition?.power?.consumption ?? 0;
    }

    // Hlásí se při přechodu do nedostatku, ne každý snímek. Když hráč postaví
    // elektrárnu a město zase přeroste, ozve se to znovu.
    const shortage = powerNeeded > powerProduced;
    if (shortage !== hadPowerShortage) {
      hadPowerShortage = shortage;
      if (shortage) {
        notifications.show(
          i18n.t('ui.notice.powerShortage', {
            produced: formatNumber(powerProduced),
            needed: formatNumber(powerNeeded),
          }),
          'error',
        );
      }
    }

    hud.update({
      powerProduced,
      powerNeeded,
      speedIndex,
      layer: layerMode,
      view: viewMode,
      budgetVisible: budgetPanel.isVisible(),
      ghost: ghostBuildings,
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
      // Registr katastrof: bez něj nejde z konzole ověřit, že menu a ruční
      // spuštění fungují, dokud v něm po T47 nic není.
      disasterRegistry,
    };
  }

  return host;
}
