import { Application, Assets, Container, Graphics, RenderTexture } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { TerrainDecor } from './decor';
import { PlacementGhost } from './placementGhost';
import { sampleSmooth } from './textures';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import {
  applySaveToWorld,
  collectLoadWarnings,
  readSaveMeta,
  unpackSave,
} from '@/save/deserialize';
import type { LoadWarnings } from '@/save/deserialize';
import type { SaveMeta } from '@/save/format';
import { checkFootprint } from '@/sim/buildings';
import {
  estimateCornerHeight,
  estimatePlacement,
  estimateRoad,
  estimateZoning,
} from '@/sim/commands';
import { cityAdvice } from '@/sim/advisor';
import { explainStat } from '@/sim/statBreakdown';
import type { ExplainedStat } from '@/sim/statBreakdown';
import {
  alertTarget,
  cityUtilities,
  explainDemand,
  explainParcel,
  growthBlocker,
  worstBlocker,
} from '@/sim/diagnostics';
import { migrate } from '@/save/migrations';
import { planInGameLoad, verifySave } from '@/save/verify';
import { serializeSave } from '@/save/serialize';
import type { Command } from '@/sim/commands';
import type { CommandResult } from '@/sim/result';
import { MAX_FUNDING, fundingCost, fundingEffect } from '@/sim/funding';
import { cornerIndex, tileBaseHeight, tileCorners } from '@/sim/heights';
import { DEFAULT_MAP_SIZE, TERRAIN, WIRE, ZONE, index } from '@/sim/layers';
import type { MapSize } from '@/sim/layers';
import { applyGeneratedMap, balanceWithMap, generateTerrain } from '@/sim/mapgen';
import type { ZoneType } from '@/sim/layers';
import { createSimHost, SPEEDS, TICK_MS } from '@/sim/simHost';
import type { SimHost } from '@/sim/simHost';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { createDefaultSystems } from '@/sim/systems';
import { DisasterRegistry } from '@/sim/disasters/registry';
import { startDisaster } from '@/sim/disasters/scheduler';
import { createFireDisaster, createWildfireDisaster } from '@/sim/disasters/fire';
import { createFloodDisaster } from '@/sim/disasters/flood';
import { createTornadoDisaster } from '@/sim/disasters/tornado';
import { createEarthquakeDisaster } from '@/sim/disasters/earthquake';
import { createBlackoutDisaster } from '@/sim/disasters/blackout';
import { createChemicalSpillDisaster } from '@/sim/disasters/chemicalSpill';
import { createEpidemicDisaster } from '@/sim/disasters/epidemic';
import { createGangWarDisaster } from '@/sim/disasters/gangWar';
import { createLandslideDisaster } from '@/sim/disasters/landslide';
import { createPileupDisaster } from '@/sim/disasters/pileup';
import { createRiotDisaster } from '@/sim/disasters/riot';
import { createStrikeDisaster } from '@/sim/disasters/strike';
import {
  createExplosionDisaster,
  createIndustrialAccidentDisaster,
} from '@/sim/disasters/blast';
import { computeBudget } from '@/sim/systems/economy';
import { coarseCellsOf, coarseIndex } from '@/sim/coarse';
import { createWorld, NEUTRAL_HAPPINESS } from '@/sim/world';
import { BudgetPanel } from '@/ui/budgetPanel';
import { AdvisorPanel } from '@/ui/advisorPanel';
import { StatPanel } from '@/ui/statPanel';
import { BuildingInfo } from '@/ui/buildingInfo';
import { FinancePanel } from '@/ui/financePanel';
import { TransitPanel } from '@/ui/transitPanel';
import { CostPopup } from '@/ui/costPopup';
import { PriceTag } from '@/ui/priceTag';
import { isRoutine, Notifications } from '@/ui/notifications';
import { UndoBar } from '@/ui/undoBar';
import { formatNumber } from '@/ui/format';
import { Hud } from '@/ui/hud';
import { setIconImages } from '@/ui/icons';
import type { OverlayOption } from '@/ui/hud';
import { I18n, pickLanguage } from '@/ui/i18n';
import { layoutMode, watchLayout } from '@/ui/layout';
import type { LocaleTables } from '@/ui/i18n';
import { createBrowserPlatform } from '@/platform';
import { DisasterAlert, nextToAnnounce } from '@/ui/disasterAlert';
import { YearReport } from '@/ui/yearReport';
import { showHelp } from '@/ui/help';
import { showHome } from '@/ui/home';
import type { HomeChoice } from '@/ui/home';
import { Legend } from '@/ui/legend';
import { Toolbar } from '@/ui/toolbar';
import type { ToolOption } from '@/ui/tools';
import { BuildingRenderer } from './buildingRenderer';
import type { AppearanceLookup, LoadedPart } from './buildingRenderer';
import { clampCamera, createCamera, pan, viewportToWorld, zoomAt } from './camera';
import { ChunkRenderer, viewportFor } from './chunkRenderer';
import { tilesIn } from './vehicles';
import type { MotionView } from './effects';
import { RoadRenderer, ROAD_FAMILIES } from './roadRenderer';
import type { OverlayMode } from './chunkRenderer';
import { CoarseOverlay } from './coarseOverlay';
import { GridOverlay } from './gridOverlay';
import { computeRiskMap, RISK_WARNING } from '@/sim/disasters/riskMap';
import { DisasterScenes } from './disasterScenes';
import { Effects } from './effects';
import { FireLayer } from './fireLayer';
import { People } from './people';
import type { Entrance } from './people';
import { WaterGlints } from './water';
import {
  backgroundUrls,
  prefetchInBackground,
  preloadGraphics,
  spriteUrlOf,
  startupUrls,
  withTimeout,
} from './preload';
import { spriteResolution } from './spriteResolution';
import { Preloader } from '@/ui/preloader';
import { Vehicles } from './vehicles';
import type { VehicleLook } from './vehicles';
import { ServiceMarkers } from './serviceMarkers';
import { TrafficOverlay } from './trafficOverlay';
import { WireOverlay } from './wireOverlay';
import { DebugOverlay } from './debugOverlay';
import {
  BACKGROUND_COLOR,
  HAPPINESS_CLEAN_AT,
  HEAT_STOPS,
  HOVER_BLOCKED_COLOR,
  HOVER_COLOR,
  HOVER_FILL_ALPHA,
  HOVER_LINE_ALPHA,
  LAND_VALUE_GOOD,
  TRAFFIC_COLORS,
} from './palette';
import { pickTile } from './picking';
import { gridToScreen, LEVEL_H, TILE_H, TILE_W, tileQuad } from './projection';

/** Jeden krok kolečka = násobitel zoomu. */
const ZOOM_STEP = 1.15;

/**
 * O kolik bodů výš než prst se míří budovou.
 *
 * Bříško kryje přesně tu dlaždici, na kterou ukazuje, takže i s průhledným
 * náhledem stavěl hráč naslepo. Čtyřiašedesát bodů jsou dvě dlaždice na výšku
 * při základním měřítku — dost, aby byl náhled celý vidět, a pořád tak blízko,
 * že se poloha dá tažením dotáhnout.
 */
const AIM_LIFT = 64;

/** Jak dlouho se drží prst, než se otevře karta parcely. */
const LONG_PRESS_MS = 450;

/**
 * Od jaké ceny se u stavby nabízí „Zpět".
 *
 * Bourání se nabízí vždycky — je nevratné. U stavby ne: hláška po každé
 * silnici za stovku by v liště jen překážela. Dva tisíce jsou ve vanille pod
 * cenou nejlevnější elektrárny, takže se nabídka objeví u všeho, co bolí.
 */
const UNDO_PRICE = 2000;

/** Jak často se město uloží samo, když hra běží. */
const AUTOSAVE_EVERY_MS = 120_000;
/** Každé N-té periodické uložení se ověří celé, ostatní se ověřením nezdržují. */
const AUTOSAVE_VERIFY_EVERY = 5;

/**
 * Měřítko, ve kterém se na telefonu začíná.
 *
 * Při jedničce je přes šířku 375bodového displeje vidět asi šest dlaždic ze
 * sto dvaceti osmi: hráč viděl trávu a kámen a nepoznal, kde ve městě je.
 */
const COMPACT_START_ZOOM = 0.5;

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

/**
 * Varianta obrázku pro danou budovu.
 *
 * Odvozuje se **z id entity**, ne z losu při stavbě, a je za tím rozvaha:
 *
 * - Do savu nic nepřibývá. Id se ukládá odjakživa, takže varianta přežije
 *   uložení sama od sebe a **není potřeba nová verze formátu ani migrace**.
 * - Nesahá se na `world.rng`. Los při stavbě by posunul celý proud náhody
 *   a s ním každý golden test i každé rozehrané město.
 * - Je to pořád „náhodně a navždy", jak si autor přál: id je jedinečné,
 *   po zbourání a znovupostavení vyjde jiné.
 *
 * Kolik variant budova má, říká **obsah** (P5) — kód jen bere zbytek po dělení,
 * takže budova s jedinou variantou i budova s pěti fungují stejně.
 */
export function variantFor(variants: readonly string[], buildingId: number): string | undefined {
  if (variants.length === 0) return undefined;
  // Rozhoz bitů: sousední id musí dát nesouvisející varianty, jinak by celá
  // řada domů postavená za sebou vyšla stejně.
  let h = Math.imul(buildingId ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  // `>>> 0` na konci schválně: `^` vrací znaménkové číslo, takže bez toho
  // vyjde u části id záporný zbytek, `variants[-2]` je `undefined` a budova
  // se místo obrázku nakreslí jako kvádr. Odhalil to test rozložení.
  return variants[((h ^ (h >>> 16)) >>> 0) % variants.length];
}

/**
 * Kategorie budovy, ke kterým existuje materiál podezdívky.
 *
 * Služby a sítě mají podezdívku po bydlení: panelák i škola stojí na téže
 * omítnuté patce a vyrábět pro ně zvlášť materiál by bylo plýtvání.
 */
const SKIRT_CATEGORIES = new Set(['residential', 'commercial', 'industrial']);

/** Kolik variant má každá kategorie. Sedí na `docs/13-PODEZDIVKY.md`. */
const SKIRT_VARIANTS = ['a', 'b', 'c'] as const;

/**
 * Materiál podezdívky pro budovu.
 *
 * Losuje se **z id budovy**, ne z `world.rng`: musí vyjít stejně po načtení
 * savu i po překreslení. A ne stejnou míchačkou jako varianta spritu — jinak
 * by měl dům se světlou fasádou vždycky tutéž podezdívku.
 */
function skirtFor(category: string, buildingId: number): string {
  const family = SKIRT_CATEGORIES.has(category) ? category : 'residential';
  let hash = Math.imul(buildingId ^ 0x27d4eb2d, 0x165667b1) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x9e3779b1) >>> 0;
  const variant = SKIRT_VARIANTS[(hash >>> 8) % SKIRT_VARIANTS.length] ?? 'a';
  return `${family}__${variant}`;
}

function createAppearanceLookup(content: ContentRegistry): AppearanceLookup {
  return (definitionId, buildingId) => {
    const definition = content.get(definitionId);
    if (!definition) return undefined;
    const icon = definition.graphics.icon;

    const variant = variantFor(content.getSpriteVariants(definitionId), buildingId);
    const sprite = variant === undefined ? undefined : content.getSprite(definitionId, variant);

    // Zpustlá budova: obrázek podle **kategorie**, ne podle definice. Slum
    // vypadá jako slum, ať v něm stál řadový dům nebo činžák, a devět obrázků
    // tak nahradí třicet.
    const derelictId = DERELICT_SPRITES[definition.category];
    const derelictVariant =
      derelictId === undefined
        ? undefined
        : variantFor(content.getSpriteVariants(derelictId), buildingId);
    const derelict =
      derelictId === undefined || derelictVariant === undefined
        ? undefined
        : content.getSprite(derelictId, derelictVariant);

    return {
      color: Number.parseInt(definition.graphics.color.slice(1), 16),
      heightLevels: definition.graphics.heightLevels,
      footprint: definition.footprint,
      consumesPower: (definition.power?.consumption ?? 0) > 0,
      skirt: skirtFor(definition.category, buildingId),
      ...(icon === undefined ? {} : { icon }),
      ...(sprite === undefined ? {} : { sprite }),
      ...(derelict === undefined ? {} : { derelict }),
    };
  };
}

/**
 * Obrázek zpustlé budovy podle kategorie.
 *
 * Kategorie bez záznamu — služby, elektrárny — zůstane u šedého kvádru.
 * Opuštěná nemocnice je vzácnost a vlastní obrázek by za ni nestál; slum
 * a brownfield jsou to, co hráč v zanedbané čtvrti opravdu vidí.
 */
const DERELICT_SPRITES: Readonly<Record<string, string>> = {
  residential: 'derelict_residential',
  commercial: 'derelict_commercial',
  industrial: 'derelict_industrial',
};

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
    { id: 'surface', labelKey: 'ui.view.surface', icon: 'view-surface' },
    { id: 'underground', labelKey: 'ui.view.underground', icon: 'view-underground' },
  ];
}

/** Diagnostické vrstvy: šest veličin plus dosah každé třídy služeb. */
export function createLayerOptions(content: ContentRegistry): OverlayOption[] {
  return [
    { id: 'power', labelKey: 'ui.overlay.power', icon: 'layer-power' },
    { id: 'pollution', labelKey: 'ui.overlay.pollution', icon: 'layer-pollution' },
    { id: 'landValue', labelKey: 'ui.overlay.landValue', icon: 'layer-landvalue' },
    { id: 'crime', labelKey: 'ui.overlay.crime', icon: 'layer-crime' },
    { id: 'happiness', labelKey: 'ui.overlay.happiness', icon: 'layer-happiness' },
    { id: 'traffic', labelKey: 'ui.overlay.traffic', icon: 'layer-traffic' },
    // Riziko nepřírodních katastrof. Přírodní se nepočítají: hráč s nimi nic
    // neudělá, takže varování před nimi by nenesla radu.
    { id: 'risk', labelKey: 'ui.overlay.risk', icon: 'layer-risk' },
    // Dosah služby má vlastní ikonu `coverage:<třída>`, když ji obsah dodal.
    // Jinak se sáhne po symbolu, který nosí na střeše první budova té třídy —
    // hráč tak pořád pozná, čí dosah svítí, i u třídy, kterou přinesl mod (P5).
    ...serviceClassesOf(content).map((serviceClass) => ({
      id: `coverage:${serviceClass}`,
      labelKey: `ui.overlay.coverage.${serviceClass}`,
      icon: coverageIconOf(content, serviceClass),
    })),
  ];
}

/**
 * Kam se má podívat kamera: **nejhustší kus zástavby**, ne její průměr.
 *
 * Průměr polohy budov zní jako správná odpověď a není: elektrárna na kraji
 * mapy a čistička na druhém konci ho odtáhnou do prázdna mezi čtvrtěmi.
 * Na ukázkovém městě o 777 budovách vyšel doprostřed lesa.
 *
 * Počítá se proto **hrubá mřížka po šestnácti dlaždicích** a bere se nejtěžší
 * buňka; uvnitř ní pak průměr, ať pohled neskáče po hranách buněk. Prázdný
 * svět nemá zástavbu, tam zůstává střed mapy.
 */
/** Požádal hráč v systému o méně pohybu? Bez `matchMedia` (testy) ne. */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function cityCentre(world: ReadonlyWorldView): { x: number; y: number } {
  const cell = 16;
  const buckets = new Map<number, { x: number; y: number; count: number }>();
  let best = -1;
  let heaviest: { x: number; y: number; count: number } | undefined;

  for (const building of world.buildings.values()) {
    const key =
      Math.floor(building.y / cell) * Math.ceil(world.size / cell) +
      Math.floor(building.x / cell);
    const bucket = buckets.get(key) ?? { x: 0, y: 0, count: 0 };
    bucket.x += building.x;
    bucket.y += building.y;
    bucket.count++;
    buckets.set(key, bucket);
    if (bucket.count > best) {
      best = bucket.count;
      heaviest = bucket;
    }
  }

  if (heaviest === undefined) return { x: world.size / 2, y: world.size / 2 };
  return { x: heaviest.x / heaviest.count, y: heaviest.y / heaviest.count };
}

/**
 * Ikona budovy do palety nástrojů.
 *
 * Přednost má obrázek pojmenovaný jako budova sama (`vanilla:hospital` →
 * `hospital`), takže každá budova má v paletě svoji tvář. Když ho obsah nemá,
 * vezme se `graphics.icon` — tedy symbol ze střechy, který dřív nosila paleta
 * celý.
 *
 * `graphics.icon` se schválně **nepoužívá jako jméno obrázku**: řídí zároveň
 * symbol na střeše ve 3D a ten je z polygonů. Kdyby se přejmenoval, zmizel by
 * z domů ve městě.
 */
export function buildingIcon(content: ContentRegistry, definition: Definition): string {
  const bare = definition.id.slice(definition.id.indexOf(':') + 1);
  if (content.getIcons()[bare] !== undefined) return bare;
  return definition.graphics.icon ?? 'gear';
}

/**
 * Ikona pro vrstvu dosahu dané třídy služby.
 *
 * `coverage-<třída>` má přednost, protože kreslená vrstva ukazuje dosah, ne
 * budovu. Když ji obsah nemá, vezme se střešní symbol první budovy té třídy.
 */
export function coverageIconOf(content: ContentRegistry, serviceClass: string): string {
  const drawn = `coverage-${serviceClass}`;
  if (content.getIcons()[drawn] !== undefined) return drawn;
  return classIconsOf(content).get(serviceClass) ?? 'layers';
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
    // Pacička je první, protože se s ní nic nestaví ani nebourá — je to jediný
    // nástroj, ve kterém hráč nemůže omylem nic provést.
    {
      id: 'pan',
      labelKey: 'ui.tool.pan',
      icon: 'hand',
      hotkey: 'h',
      groupKey: 'ui.menu.pan',
      groupIcon: 'hand',
      action: { kind: 'pan' as const },
    },
    // Typy silnic jdou z balancu, ne z kódu: přidat čtvrtý je změna JSONu
    // a jednoho lokalizačního klíče (§4 fáze 3).
    ...roadTypes.map((road, order) => ({
      id: `road:${road.id}`,
      labelKey: `ui.tool.road.${road.id}`,
      icon: `road-${road.id}`,
      ...(order === 0 ? { hotkey: 'q' } : {}),
      groupKey: 'ui.menu.road',
      groupIcon: `road-${roadTypes[0]?.id ?? 'street'}`,
      cost: road.cost,
      action: { kind: 'road' as const, roadType: order + 1 },
    })),
    {
      id: 'terrain:raise',
      labelKey: 'ui.tool.terrain.raise',
      icon: 'terrain-raise',
      hotkey: 'e',
      groupKey: 'ui.menu.terrain',
      groupIcon: 'terrain-raise',
      action: { kind: 'terraform', delta: 1 },
    },
    {
      id: 'terrain:lower',
      labelKey: 'ui.tool.terrain.lower',
      icon: 'terrain-lower',
      hotkey: 'd',
      groupKey: 'ui.menu.terrain',
      groupIcon: 'terrain-raise',
      action: { kind: 'terraform', delta: -1 },
    },
    {
      id: 'terrain:level',
      labelKey: 'ui.tool.terrain.level',
      icon: 'terrain-level',
      hotkey: 'f',
      groupKey: 'ui.menu.terrain',
      groupIcon: 'terrain-raise',
      action: { kind: 'terraform', delta: 0 },
    },
    {
      id: 'terrain:fill',
      labelKey: 'ui.tool.terrain.fill',
      icon: 'terrain-fill',
      hotkey: 'g',
      groupKey: 'ui.menu.terrain',
      groupIcon: 'terrain-raise',
      action: { kind: 'fill' },
    },
    /*
     * Vysazení lesa (rozhodnutí autora).
     *
     * Patří k terénním nástrojům, protože mění povrch, ne zástavbu — a je to
     * protějšek buldozeru, který les kácí. Ve hře je to jediná obrana proti
     * znečištění bez údržby: les pohltí půlku kouře v buňce, kterou zarůstá,
     * a zvedne cenu půdy kolem.
     */
    {
      id: 'terrain:trees',
      labelKey: 'ui.tool.terrain.trees',
      icon: 'plant-trees',
      hotkey: 't',
      groupKey: 'ui.menu.terrain',
      groupIcon: 'terrain-raise',
      cost: content.getBalance().map.plantTreesCost,
      action: { kind: 'plantTrees' },
    },
    {
      id: 'zone:residential',
      labelKey: 'ui.tool.zone.residential',
      icon: 'zone-residential',
      hotkey: 'r',
      groupKey: 'ui.menu.zone',
      groupIcon: 'zone-residential',
      action: { kind: 'zone', zone: ZONE.residential },
    },
    {
      id: 'zone:commercial',
      labelKey: 'ui.tool.zone.commercial',
      icon: 'zone-commercial',
      hotkey: 'c',
      groupKey: 'ui.menu.zone',
      groupIcon: 'zone-residential',
      action: { kind: 'zone', zone: ZONE.commercial },
    },
    {
      id: 'zone:industrial',
      labelKey: 'ui.tool.zone.industrial',
      icon: 'zone-industrial',
      hotkey: 'i',
      groupKey: 'ui.menu.zone',
      groupIcon: 'zone-residential',
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
    // Rušení zón je **vlastní nástroj** (rozhodnutí autora, T62). Buldozer se
    // zóny nedotkne, takže probourat průsek proti ohni už nesmaže čtvrť pod
    // ním. Je to zóna s hodnotou „žádná", ne buldozer — dostane tím tažení
    // přes obdélník zadarmo, což je přesně to, co hráč u rušení zón chce.
    {
      id: 'zone:clear',
      labelKey: 'ui.tool.zone.clear',
      icon: 'zone-clear',
      hotkey: 'v',
      groupKey: 'ui.menu.zone',
      groupIcon: 'zone-residential',
      action: { kind: 'zone', zone: ZONE.none },
    },
    // Potrubí patří do nabídky Vodovod, mezi vodárnu a čerpací stanici —
    // hráč hledá vodovod na jednom místě, ne ve dvou.
    {
      id: 'pipe',
      labelKey: 'ui.tool.pipe',
      icon: 'pipe',
      hotkey: 'w',
      groupKey: 'ui.menu.water',
      groupIcon: 'pump_station',
      cost: content.getBalance().water.pipeCost,
      action: { kind: 'pipe' },
    },
    // Vedení (T129) má vlastní nabídku hned vedle Energetiky — do ní se tři
    // nástroje navíc nevešly (roleta nejvýš šest položek). Nízké napětí
    // rozvádí po čtvrti, vysoké nese proud od elektrárny.
    {
      id: 'wire:low',
      labelKey: 'ui.tool.wire.low',
      icon: 'bolt',
      hotkey: 'j',
      groupKey: 'ui.menu.wires',
      groupIcon: 'bolt',
      cost: content.getBalance().power.wires[0]?.cost ?? 0,
      action: { kind: 'wire', wire: WIRE.low },
    },
    {
      id: 'wire:high',
      labelKey: 'ui.tool.wire.high',
      icon: 'bolt',
      groupKey: 'ui.menu.wires',
      groupIcon: 'bolt',
      cost: content.getBalance().power.wires[1]?.cost ?? 0,
      action: { kind: 'wire', wire: WIRE.high },
    },
    // Odstranění vedení — tažením po trase, jen vedení, nic pod ním.
    {
      id: 'wire:remove',
      labelKey: 'ui.tool.wire.remove',
      icon: 'bulldoze',
      groupKey: 'ui.menu.wires',
      groupIcon: 'bolt',
      action: { kind: 'wire', wire: WIRE.none },
    },
  ];

  // Vše, co nevyroste ze zóny, staví hráč ručně. Nabídku i ikonu nese definice;
  // budova bez `menu` skončí v nabídce podle své kategorie, aby se neztratila.
  const manual = [...content.byCategory('utility'), ...content.byCategory('service')];
  const firstIcon = new Map<string, string>();
  for (const definition of manual) {
    const menu = definition.menu ?? definition.category;
    if (!firstIcon.has(menu)) firstIcon.set(menu, buildingIcon(content, definition));
  }

  manual.forEach((definition, order) => {
    const menu = definition.menu ?? definition.category;
    tools.push({
      id: `place:${definition.id}`,
      labelKey: definition.name, // popisek pojmenuje obsah, ne kód
      icon: buildingIcon(content, definition),
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

/**
 * Načte obrázky povrchu, které obsah dodal.
 *
 * **Bere nejvýš `SURFACE_VARIANT_LIMIT` variant od druhu**, a to je oprava, ne
 * úspora. Chunk je jeden `Graphics` se 256 dlaždicemi a všechny výplně v něm
 * jdou na kartu jednou dávkou; do té se vejde jen omezený počet různých textur
 * a zbytek karta **zahodí**. Na mapě se to projevilo jako fialové skvrny ve
 * vodě, kde prosvítala barva pod obrázkem. Změřeno: s osmnácti texturami skvrny
 * byly, se šesti zmizely.
 *
 * Zkoušel jsem to obejít atlasem, tedy slepit obrázky do jednoho a adresovat
 * v něm výřezy. Nefunguje: výplň s maticí v Pixi rámeček textury nectí
 * a vzorkuje ve zdroji, takže každá dlaždice bere kus celého atlasu. Ubrat
 * varianty je proti tomu jednoduché a prokazatelně funguje — a pestrost stejně
 * nese hlavně otáčení po dlaždicích, které nic nestojí.
 *
 * Co se nepovede stáhnout, se přeskočí: chybějící obrázek nesmí hru zastavit,
 * jen se dlaždice nakreslí barvou.
 */
async function loadSurfaces(content: ContentRegistry): Promise<Map<string, Texture>> {
  const out = new Map<string, Texture>();
  const jobs: Promise<void>[] = [];

  for (const terrain of TERRAIN_NAMES) {
    for (const variant of content.getTileVariants(terrain).slice(0, SURFACE_VARIANT_LIMIT)) {
      const url = content.getTile(terrain, variant);
      if (url === undefined) continue;
      jobs.push(
        Assets.load(url)
          .then((texture: Texture) => {
            sampleSmooth(texture);
            out.set(`${terrain}|${variant}`, texture);
          })
          .catch(() => undefined),
      );
    }
  }

  await Promise.all(jobs);
  return out;
}

/**
 * Jeden obrázek dlaždice podle jména. `undefined`, když ho obsah nedodal —
 * chybějící obrázek je vzhled, ne podmínka běhu (P5).
 */
async function loadTile(content: ContentRegistry, name: string): Promise<Texture | undefined> {
  const [variant] = content.getTileVariants(name);
  if (variant === undefined) return undefined;
  const url = content.getTile(name, variant);
  if (url === undefined) return undefined;
  try {
    const texture: Texture = await Assets.load(url);
    sampleSmooth(texture);
    return texture;
  } catch {
    return undefined;
  }
}

/**
 * Ikony tříd služeb jako textury pro špendlíky nad budovami.
 *
 * Bere se **`coverage-<třída>`**, tedy tentýž symbol, který nosí přepínač
 * vrstvy. Hráč tak vidí stejný obrázek na tlačítku i nad stanicí a nemusí
 * hádat, čí dosah se kreslí.
 */
async function loadServiceIcons(
  content: ContentRegistry,
  serviceClasses: readonly string[],
): Promise<Map<string, Texture>> {
  const out = new Map<string, Texture>();
  const jobs: Promise<void>[] = [];

  for (const serviceClass of serviceClasses) {
    const url = content.getIcons()[coverageIconOf(content, serviceClass)];
    if (url === undefined) continue;
    jobs.push(
      Assets.load(url)
        .then((texture: Texture) => {
          out.set(serviceClass, texture);
        })
        // Chybějící ikona nechá jen špendlík — pořád je vidět, kde stanice je.
        .catch(() => undefined),
    );
  }

  await Promise.all(jobs);
  return out;
}

/**
 * Načte materiály vozovky — **jeden obrázek na typ**, ne dlaždici na tvar.
 *
 * Tvar kreslí `RoadRenderer` z rohů dlaždice, obrázek nese jen povrch. Tři
 * textury v jedné dávce jsou hluboko pod stropem karty.
 */
async function loadRoadMaterials(content: ContentRegistry): Promise<Map<string, Texture>> {
  const out = new Map<string, Texture>();
  const jobs: Promise<void>[] = [];

  for (const family of ROAD_FAMILIES) {
    if (family === undefined) continue;
    const [variant] = content.getTileVariants(`asphalt_${family}`);
    if (variant === undefined) continue;
    const url = content.getTile(`asphalt_${family}`, variant);
    if (url === undefined) continue;
    jobs.push(
      Assets.load(url)
        .then((texture: Texture) => {
          sampleSmooth(texture);
          out.set(family, texture);
        })
        .catch(() => undefined),
    );
  }

  await Promise.all(jobs);
  return out;
}

/**
 * Načte materiály podezdívek. Klíč je `kategorie__varianta`.
 *
 * Devět obrázků: tři kategorie po třech variantách. Kreslí se jako výplň
 * v `Graphics` každé budovy, takže se nesčítají do jedné dávky jako povrchy
 * terénu — každá zeď si nese svůj jeden materiál.
 */
async function loadSkirts(content: ContentRegistry): Promise<Map<string, Texture>> {
  const out = new Map<string, Texture>();
  const jobs: Promise<void>[] = [];

  for (const [key, url] of Object.entries(content.getSkirts())) {
    jobs.push(
      Assets.load(url)
        .then((texture: Texture) => {
          sampleSmooth(texture);
          out.set(key, texture);
        })
        .catch(() => undefined),
    );
  }

  await Promise.all(jobs);
  return out;
}

/** Měřítko dílů: obrázky jsou kreslené ve čtyřnásobku jako budovy. */
const PART_SCALE = 4;

/** Odkud jezdí popeláři. Odpady nemají třídu služby, poznají se podle id. */
const WASTE_SITES = new Set(['vanilla:incinerator', 'vanilla:landfill']);

/**
 * Díly pro animace (T116): rotor, auta, chodci, plameny, lampa.
 *
 * Načtou se všechny naráz a hra je dostane najednou. Chybějící díl se
 * nekreslí — efekt, který ho potřebuje, se prostě přeskočí.
 */
export async function loadParts(content: ContentRegistry): Promise<Map<string, LoadedPart>> {
  const out = new Map<string, LoadedPart>();
  const jobs: Promise<void>[] = [];
  for (const name of content.getPartNames()) {
    const part = content.getPart(name);
    if (part === undefined) continue;
    jobs.push(
      Assets.load(part.url)
        .then((texture: Texture) => {
          sampleSmooth(texture);
          out.set(name, {
            texture,
            anchor: part.anchor,
            ...(part.radius === undefined ? {} : { radius: part.radius }),
            ...(part.skew === undefined ? {} : { skew: part.skew }),
            ...(part.attach === undefined ? {} : { attach: part.attach }),
          });
        })
        .catch(() => undefined),
    );
  }
  await Promise.all(jobs);
  return out;
}

/**
 * Předměty, které stojí na terénu: strom na lese, balvan na skále.
 *
 * Rozhodnutí autora — a je za ním měření: jako **materiál** skála i les
 * napoprvé selhaly, protože se z parku nedaly opsat, kdežto jako **předmět**
 * je generátor nakreslil napoprvé. Povrch pod nimi zůstává, kreslí se navrch.
 *
 * V simulaci nepřibývá nic: je to čistě věc rendereru, takže les o dvou
 * tisících dlaždicích nestojí ani jednu entitu.
 */
const TERRAIN_DECOR: readonly (readonly [number, string])[] = [
  [TERRAIN.forest, 'forest_clump'],
  [TERRAIN.rock, 'boulders'],
];

async function loadDecor(content: ContentRegistry): Promise<Map<number, TerrainDecor[]>> {
  const out = new Map<number, TerrainDecor[]>();
  const jobs: Promise<void>[] = [];

  for (const [terrain, id] of TERRAIN_DECOR) {
    // Dvě varianty, ne tři: karta unese jen pár různých textur na chunk, viz
    // `SURFACE_VARIANT_LIMIT`. S jedinou byly všechny stromy v lese stejné.
    for (const variant of content.getSpriteVariants(id).slice(0, DECOR_VARIANT_LIMIT)) {
      const sprite = content.getSprite(id, variant);
      if (sprite === undefined) continue;
      jobs.push(
        Assets.load(sprite.url)
          .then((texture: Texture) => {
            sampleSmooth(texture);
            const list = out.get(terrain) ?? [];
            list.push({ texture, anchor: sprite.anchor, scale: sprite.scale });
            out.set(terrain, list);
          })
          .catch(() => undefined),
      );
    }
  }

  await Promise.all(jobs);
  // Pořadí musí být stabilní: stahování dobíhá, jak přijde ze sítě, a losování
  // podle souřadnic by pak po každém spuštění padlo jinam.
  for (const list of out.values()) list.sort((a, b) => a.texture.label!.localeCompare(b.texture.label!));
  return out;
}

/**
 * Všechny varianty jednoho vystřiženého objektu jako předměty na terénu.
 *
 * Pořadí je stabilní: stahování dobíhá, jak přijde ze sítě, a výběr podle
 * souřadnic by pak po každém spuštění padl na jiný obrázek.
 */
async function loadObject(content: ContentRegistry, id: string): Promise<TerrainDecor[]> {
  const out: TerrainDecor[] = [];
  const jobs: Promise<void>[] = [];

  for (const variant of content.getSpriteVariants(id)) {
    const sprite = content.getSprite(id, variant);
    if (sprite === undefined) continue;
    jobs.push(
      // Poloviční obrázek (T134): suť a scény katastrof se na mapě kreslí
      // malé a plná velikost by jen zabírala paměť. Rozlišení 0,5 z přípony
      // `@0.5x` drží logickou velikost, takže `scale` platí dál.
      Assets.load(spriteUrlOf(sprite))
        .then((texture: Texture) => {
          sampleSmooth(texture);
          out.push({ texture, anchor: sprite.anchor, scale: sprite.scale });
        })
        .catch(() => undefined),
    );
  }

  await Promise.all(jobs);
  out.sort((a, b) => (a.texture.label ?? '').localeCompare(b.texture.label ?? ''));
  return out;
}

/**
 * Obrázky katastrof, které se odehrávají na ulici.
 *
 * Klíč je **druh katastrofy**, ne jméno spritu: renderer o `riot_crowd` nemá
 * co vědět, ptá se na `riot`. Mod, který přidá svou katastrofu a k ní obrázek,
 * ji tím dostane nakreslenou zadarmo (P5).
 */
const DISASTER_SCENES: readonly (readonly [string, string])[] = [
  ['riot', 'riot_crowd'],
  ['gangWar', 'riot_crowd'],
  ['pileup', 'pileup_wreck'],
  // Oheň má jeden obrázek pro dům i les: plameny vypadají stejně, ať hoří
  // střecha nebo smrk. Do T97 měl požár na mapě jen oranžový nádech dlaždice
  // a autor to nahlásil — je to nejčastější pohroma ze všech.
  ['fire', 'fire_blaze'],
  ['wildfire', 'fire_blaze'],
  // T107: zbylých šest. Autor nahlásil epidemii bez obrázku — obrázek měla
  // do té doby jen třetina pohrom. Bez obrázku zůstávají tři a je to záměr:
  // blackout nemá střed, zemětřesení má epicentrum klidně v pustině a povodeň
  // se kreslí vrstvou vody, ne objektem.
  ['tornado', 'tornado_funnel'],
  ['explosion', 'blast_smoke'],
  ['industrialAccident', 'blast_smoke'],
  ['strike', 'strike_picket'],
  ['epidemic', 'epidemic_care'],
  ['chemicalSpill', 'spill_hazmat'],
  ['landslide', 'landslide_earth'],
];

async function loadDisasterScenes(
  content: ContentRegistry,
): Promise<Map<string, TerrainDecor[]>> {
  const out = new Map<string, TerrainDecor[]>();
  const jobs: Promise<void>[] = [];

  for (const [kind, id] of DISASTER_SCENES) {
    for (const variant of content.getSpriteVariants(id)) {
      const sprite = content.getSprite(id, variant);
      if (sprite === undefined) continue;
      jobs.push(
        // Poloviční obrázek, stejně jako u suti (`loadObject`, T134).
        Assets.load(spriteUrlOf(sprite))
          .then((texture: Texture) => {
            sampleSmooth(texture);
            const list = out.get(kind) ?? [];
            list.push({ texture, anchor: sprite.anchor, scale: sprite.scale });
            out.set(kind, list);
          })
          .catch(() => undefined),
      );
    }
  }

  await Promise.all(jobs);
  // Pořadí musí být stabilní: stahování dobíhá, jak přijde ze sítě, a výběr
  // podle id katastrofy by pak po každém spuštění padl na jiný obrázek.
  for (const list of out.values()) {
    list.sort((a, b) => (a.texture.label ?? '').localeCompare(b.texture.label ?? ''));
  }
  return out;
}

/** Kolik variant předmětu se smí načíst. Týž strop karty jako u povrchů. */
const DECOR_VARIANT_LIMIT = 2;

/**
 * Kolik variant od druhu terénu se smí načíst. Viz `loadSurfaces` — je to strop
 * daný kartou, ne volba vzhledu.
 */
const SURFACE_VARIANT_LIMIT = 1;

/**
 * Kolikrát jemněji než okno se kreslí snímek obrazovky.
 *
 * Dvojnásobek: z herního okna 1920 × 1080 vyjde 4K. Víc už nedává smysl —
 * sprity jsou rastr a nad dvojnásobek se jen zvětší pixely.
 */
const SCREENSHOT_RESOLUTION = 2;

/** Druhy terénu, ke kterým se hledá obrázek. Sedí na `TERRAIN` v `sim/layers.ts`. */
const TERRAIN_NAMES = ['grass', 'water', 'sand', 'rock', 'forest', 'marsh'] as const;

/**
 * Obrázky budov, které stojí v načteném městě (T134) — přesně ty varianty,
 * které si pak vybere `createAppearanceLookup`, v poloviční velikosti.
 * Zpustlé budovy se nepočítají: dotáhnou se z pozadí.
 */
function savedSpriteUrls(
  world: { readonly buildings: ReadonlyMap<number, { id: number; definitionId: string }> },
  content: ContentRegistry,
): string[] {
  const lookup = createAppearanceLookup(content);
  const urls = new Set<string>();
  for (const building of world.buildings.values()) {
    const sprite = lookup(building.definitionId, building.id)?.sprite;
    if (sprite !== undefined) urls.add(spriteUrlOf(sprite));
  }
  return [...urls].sort();
}


export async function startApp(mount: HTMLElement): Promise<SimHost> {
  // Obsah se načítá první. Nevalidní definice má spadnout dřív, než se objeví
  // plátno — tichý pád s polovinou obsahu je horší než hlasitá chyba.
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  setIconImages(content.getIcons());

  const tables: Record<string, Record<string, string>> = {};
  for (const language of content.getLanguages()) {
    tables[language] = content.getLocaleTable(language);
  }
  const i18n = new I18n(
    tables as LocaleTables,
    pickLanguage([...navigator.languages], content.getLanguages()),
  );

  // Grafika se začne stahovat **hned**, zatímco hráč stojí na rozcestníku
  // (T121). Ukazatel visí na `body`, ne na `mount`: rozcestník si svůj
  // kontejner přestavuje a vzal by ukazatel s sebou.
  //
  // Jen to, co ukáže první obrazovka (T134): povrchy, díly, podezdívky
  // a budovy, které jdou postavit v novém městě. Zbytek jde na pozadí, až hra
  // běží — viz `render/preload.ts`.
  const firstScreen = startupUrls(content, {
    surfaces: [
      ...TERRAIN_NAMES,
      ...ROAD_FAMILIES.flatMap((family) => (family === undefined ? [] : [`asphalt_${family}`])),
      'rubble',
    ],
    surfaceVariants: SURFACE_VARIANT_LIMIT,
    objects: TERRAIN_DECOR.map(([, id]) => [id, DECOR_VARIANT_LIMIT] as const),
  });
  let preloader: Preloader | null = new Preloader(document.body, i18n.t('ui.preload.label'));
  /** Kolik z prvního balíku a kolik z města ze savu je hotovo — pro jeden proužek. */
  const progress = { first: 0, saved: 1, savedCount: 0 };
  const showProgress = () => {
    const total = firstScreen.length + progress.savedCount;
    preloader?.set(
      total === 0 ? 1 : (progress.first * firstScreen.length + progress.saved * progress.savedCount) / total,
    );
  };
  const preloading = preloadGraphics(firstScreen, (done) => {
    progress.first = done;
    showProgress();
  });
  let firstScreenReady = false;
  // Hotovo dřív, než si hráč vybral: proužek zmizí, na rozcestníku nemá co dělat.
  void preloading.then(() => {
    firstScreenReady = true;
    preloader?.remove();
    preloader = null;
  });

  // Hra začíná dialogem: hráč si vybere jméno města a seed a rovnou vidí, jakou
  // mapu dostane (§3 fáze 3). Teprve pak vzniká svět.
  // Úložiště i soubory jdou přes platform vrstvu (§9). Herní kód nesahá na
  // `localStorage` ani `Blob` — až přijde Electron, přibude jiná implementace
  // a tady se nezmění nic.
  const platform = createBrowserPlatform();

  // Rozcestník: značka, snímky ze hry a tři cesty dál — pokračovat, nové
  // město, nebo načíst soubor. Dialog nové hry z něj vychází, nezanikl.
  const canResume = await platform.storage.has('autosave');
  /*
   * Co je v rozehraném městě.
   *
   * Rozcestník to potřebuje na dvě věci: napsat do tlačítka „Pokračovat",
   * o které město jde, a varovat u „Nové město", že ho nová hra přepíše
   * (T-revize, nález 30). Metadata se čtou bez rozbalení zbytku — save je má
   * nekomprimovaná právě proto. Nečitelný autosave tu **nic nerozbije**:
   * rozcestník se prostě zeptá jako dřív.
   */
  const resumeBytes = canResume ? await platform.storage.read('autosave') : null;
  let resumeMeta: SaveMeta | null = null;
  if (resumeBytes) {
    try {
      resumeMeta = readSaveMeta(resumeBytes);
    } catch {
      resumeMeta = null;
    }
  }
  // Autosave, který se minule nepodařilo načíst. Neleží tam nic než důkaz —
  // hráč si ho může stáhnout a poslat, nebo ho zahodit (audit N4).
  const damagedSave = await platform.storage.read('corrupt');
  // Po „načíst novou verzi" se rozcestník **přeskočí**. Hráč si vyžádal jen
  // novou verzi hry, ne návrat do menu — a město mu při té cestě zůstalo
  // v prohlížeči právě proto, aby se do něj vrátil.
  const choice: HomeChoice =
    canResume && platform.resumedAfterUpdate()
      ? { kind: 'game', game: { cityName: '', seed: 0, size: DEFAULT_MAP_SIZE, disasters: true, resume: true } }
      : await showHome(mount, i18n, content.getBalance(), {
          canResume,
          readFile: (file) => platform.files.read(file),
          catalogue: content,
          languages: {
            list: content.getLanguages(),
            current: () => i18n.getLanguage(),
            set: (language) => i18n.setLanguage(language),
          },
          ...(resumeMeta
            ? {
                resumeInfo: {
                  name: resumeMeta.city.name,
                  playtimeSeconds: resumeMeta.playtimeSeconds,
                  download: () => {
                    if (resumeBytes) {
                      platform.files.save(resumeBytes, `${resumeMeta.city.name || 'zdenalcity'}.city`);
                    }
                  },
                },
              }
            : {}),
          ...(damagedSave
            ? {
                damaged: {
                  download: () =>
                    platform.files.save(damagedSave, 'zdenalcity-poskozene-mesto.city'),
                  discard: () => void platform.storage.remove('corrupt'),
                  // Po opravě chyby, kvůli které se minule nenačetl, ho hráč
                  // dostane zpátky. Zkouší se stejnou cestou jako při startu.
                  restorable: verifySave(damagedSave) === null,
                },
              }
            : {}),
        });
  const newGame =
    choice.kind === 'game'
      ? choice.game
      : // Soubor nese vlastní mapu i jméno, takže na parametrech nové hry
        // nezáleží — přepíše je `applySaveToWorld` o pár řádků níž.
        { cityName: '', seed: 0, size: DEFAULT_MAP_SIZE as MapSize, disasters: true };
  // Město ze slotu „poškozený" se otevírá jako soubor: nese vlastní mapu i jméno,
  // a kdyby se přece jen nenačetlo, autosave zůstane nedotčený.
  const openedFile =
    choice.kind === 'file' ? choice.bytes : choice.kind === 'damaged' ? damagedSave : null;

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
  disasterRegistry.register(createPileupDisaster());
  disasterRegistry.register(createStrikeDisaster());
  disasterRegistry.register(createRiotDisaster());
  disasterRegistry.register(createGangWarDisaster());
  disasterRegistry.register(createBlackoutDisaster());
  disasterRegistry.register(createEpidemicDisaster());
  disasterRegistry.register(createChemicalSpillDisaster());
  disasterRegistry.register(createLandslideDisaster());

  // Obnovení rozehraného města. Nečitelný autosave hru **nezastaví** — spadnout
  // na startu kvůli poškozenému úložišti by znamenalo, že se hráč do hry
  // nedostane vůbec — ale ani se nemaže: odloží se do slotu „poškozený", odkud
  // si ho na rozcestníku stáhne a může ho poslat (audit N4).
  let cityName = newGame.cityName;
  const resumed = openedFile ?? (newGame.resume ? await platform.storage.read('autosave') : null);
  let restored = false;
  /** Načtení selhalo a hráč místo svého města dostal nové. Musí to vědět. */
  let loadFailed = false;
  /** Co hráči chybí v obnoveném městě. Hlásí se, až budou notifikace. */
  let startupWarnings: LoadWarnings | null = null;
  if (resumed) {
    try {
      const save = migrate(unpackSave(resumed));
      startupWarnings = collectLoadWarnings(save, content, content.getLoadedSources());
      applySaveToWorld(simWorld, save);
      cityName = readSaveMeta(resumed).city.name;
      restored = true;
      // Poškozené město se právě otevřelo, odkládat už není co.
      if (choice.kind === 'damaged') await platform.storage.remove('corrupt');
    } catch {
      // **Jen když šlo o autosave.** Když se nepovede otevřít soubor, který
      // hráč vybral na rozcestníku, nemá s tím rozehrané město nic společného
      // a smazat ho by byla ztráta z čistého nebe.
      if (!openedFile) {
        await platform.storage.write('corrupt', resumed);
        await platform.storage.remove('autosave');
      }
      loadFailed = true;
    }
  }

  if (!restored) {
    applyGeneratedMap(
      simWorld,
      // Krajina podle posuvníků z dialogu. Generátor o dialogu neví — dostane
      // balanc s přepsanými dvěma čísly a počítá jako vždycky.
      generateTerrain(newGame.seed, balanceWithMap(content.getBalance(), newGame.map), simWorld.size),
    );
    // Ze seedu jde tenhle terén kdykoli vygenerovat znovu, tak ať to save ví.
    simWorld.map = { seed: newGame.seed, generated: true };
  }

  // Hráč si vybral dřív, než se grafika načetla: počká se, ať budovy
  // nenaskakují jedna po druhé. Ukazatel se roztáhne přes obrazovku.
  //
  // Rozehrané město přidá **obrázky budov, které v něm stojí** (T134): na
  // start se bere jen to, co jde postavit v novém městě, a čtvrť páté úrovně
  // by jinak naskakovala po kouscích. Čeká se nejvýš `PRELOAD_TIMEOUT_MS` —
  // visící požadavek hru nezastaví, obrázek si renderer dotáhne sám.
  const firstScreenSet = new Set(firstScreen);
  const savedUrls = restored ? savedSpriteUrls(simWorld, content).filter((url) => !firstScreenSet.has(url)) : [];
  progress.savedCount = savedUrls.length;
  progress.saved = savedUrls.length === 0 ? 1 : 0;
  if (!firstScreenReady || savedUrls.length > 0) {
    preloader ??= new Preloader(document.body, i18n.t('ui.preload.label'));
    preloader.block();
    showProgress();
    const savedLoading = preloadGraphics(savedUrls, (done) => {
      progress.saved = done;
      showProgress();
    });
    await withTimeout(Promise.all([preloading, savedLoading]));
    preloader?.remove();
    preloader = null;
  }
  const host = createSimHost(
    simWorld,
    createDefaultSystems(content, content.getBalance(), disasterRegistry, content.grants()),
    content,
    content.getBalance(),
  );
  const world = host.getSnapshot();

  const app = new Application();
  await app.init({ background: BACKGROUND_COLOR, resizeTo: mount, antialias: true });
  mount.appendChild(app.canvas);

  const worldContainer = new Container();
  app.stage.addChild(worldContainer);

  // Plné obrázky budov jen při přiblížení (T134). Zoom a posun kamery se
  // čtou z kontejneru světa, který nastavuje smyčka snímku.
  app.ticker.add((ticker) => {
    spriteResolution.update(worldContainer.scale.x, worldContainer.position, app.screen, ticker.lastTime);
  });

  const serviceClasses = serviceClassesOf(content);

  /**
   * Spokojenost pro overlay. Kopie, protože `world.happiness` může být kratší
   * než hrubá mřížka, dokud město nezačne počítat.
   *
   * **Kreslí se spokojenost, ne nespokojenost.** Do T90 to bylo obráceně, a byl
   * to důsledek toho, že overlay uměl jednu barvu se sílou v průhlednosti:
   * musel malovat problém, jinak by nejsilněji svítily čtvrti, se kterými není
   * co dělat. Tepelná mapa tuhle past nemá — zelená a rudá jsou obě vidět —
   * takže se ukazuje rovnou stav.
   */
  const happinessCells = new Uint8Array(coarseCellsOf(world.size));
  const happinessLayer = (): Uint8Array => {
    for (let cell = 0; cell < happinessCells.length; cell++) {
      happinessCells[cell] = world.happiness[cell] ?? NEUTRAL_HAPPINESS;
    }
    return happinessCells;
  };

  const chunkRenderer = new ChunkRenderer(
    world,
    worldContainer,
    // Trosky nesou symbol toho, co tu stálo. Renderer terénu obsah nezná,
    // dostane jen tuhle jednu funkci (P5).
    (definitionId) => content.get(definitionId)?.graphics.icon,
  );

  // Obrázky povrchu se dotahují **na pozadí**: pečení chunku je synchronní
  // a nemá kde počkat, takže se do té doby kreslí barva. Když obsah obrázky
  // nemá, zůstane barva navždy a hra běží dál (P5).
  //
  // Silnice mají **materiál, ne tvar**: tvar vozovky se počítá z rohů dlaždice.
  // Hotové dlaždice na každý tvar v repu leží, ale 42 ze 64 má vozovku jinde,
  // než má — a hlavně by se jich tolik nevešlo do jedné dávky. Proč, viz
  // `docs/08-DLAZDICE.md`. Potrubí zatím zůstává procedurální.
  //
  // **Všechno se použije naráz, v jednom synchronním bloku** (T134). Dřív měl
  // každý druh obrázků vlastní `.then()` a dobíhaly v různých snímcích:
  // povrchy, trosky i pásy přechodů zvlášť zneplatnily celý terén, takže se
  // upekl třikrát, a budovy se přeřadily šestkrát po sobě. Chunky se pečou
  // líně v dalším snímku, takže jeden blok znamená jedno pečení.
  //
  // Nepovedené načtení nic neblokuje: každá funkce chyby spolkne sama
  // a `allSettled` pokryje i to, co by přece jen vyhodilo (P5).
  const rubbleSlopes = ['flat', 'ur', 'lr', 'll', 'ul'] as const;
  void Promise.allSettled([
    loadSurfaces(content),
    loadServiceIcons(content, serviceClasses),
    // Trosky: jeden obrázek, kreslí se do polygonu dlaždice jako povrch.
    loadTile(content, 'rubble'),
    loadDisasterScenes(content),
    /*
   * Suť: hromada pro rovinu a čtyři hromady kreslené do svahu.
   *
   * Klíč je **směr, kterým na obrazovce klesá země** — `flat`, `ur`, `lr`,
   * `ll`, `ul`. Renderer si podle rohů dlaždice vybere, kterou sadu vzít;
   * chybějící sada nevadí, spadne zpátky na rovnou hromadu (P5, mod nemusí
     * dodat všechny).
     */
    Promise.all(
      rubbleSlopes.map((slope) =>
        loadObject(content, slope === 'flat' ? 'rubble_pile' : `rubble_slope_${slope}`).then(
          (piles) => [slope, piles] as const,
        ),
      ),
    ),
    loadRoadMaterials(content),
    loadDecor(content),
    loadSkirts(content),
    loadParts(content),
  ]).then((results) => {
    const [surfaces, icons, rubble, scenes, sets, materials, decor, skirts, parts] = results.map(
      (result) => (result.status === 'fulfilled' ? result.value : undefined),
    ) as [
      Map<string, Texture> | undefined,
      Map<string, Texture> | undefined,
      Texture | undefined,
      Map<string, TerrainDecor[]> | undefined,
      (readonly (readonly [(typeof rubbleSlopes)[number], TerrainDecor[]])[]) | undefined,
      Map<string, Texture> | undefined,
      Map<number, TerrainDecor[]> | undefined,
      Map<string, Texture> | undefined,
      Map<string, LoadedPart> | undefined,
    ];

    if (surfaces && surfaces.size > 0) chunkRenderer.setSurfaces(surfaces);
    if (icons) serviceMarkers.setTextures(icons);
    chunkRenderer.setRubble(rubble);
    if (scenes && scenes.size > 0) disasterScenes.setScenes(scenes);
    const piles = new Map((sets ?? []).filter(([, list]) => list.length > 0));
    if (piles.size > 0) buildingRenderer.setRubblePiles(piles);
    if (materials && materials.size > 0) roadRenderer.setTextures(materials);
    if (decor && decor.size > 0) buildingRenderer.setDecor(decor);
    if (skirts && skirts.size > 0) buildingRenderer.setSkirtTextures(skirts);
    if (parts && parts.size > 0) applyParts(parts);

    // Hra běží a první obrazovka je celá: teď může na pozadí dojít na zbytek
    // grafiky. Ne dřív — soupeřil by o linku s tím, na co hráč čeká.
    const ready = new Set([...firstScreen, ...savedUrls]);
    prefetchInBackground(backgroundUrls(content, ready));
  });

  function applyParts(parts: ReadonlyMap<string, LoadedPart>): void {
    buildingRenderer.setParts(parts);
    roadRenderer.setSidewalkTexture(parts.get('sidewalk')?.texture);
    // Přechody povrchů (T130): materiály pásů jdou do terénních chunků.
    chunkRenderer.setBands(
      new Map(
        [...parts.entries()]
          .filter(([name]) => name.startsWith('band_'))
          .map(([name, part]) => {
            sampleSmooth(part.texture);
            return [name, part.texture] as const;
          }),
      ),
    );
    const flames = [...parts.entries()]
      .filter(([name]) => name.startsWith('flames_'))
      .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
      .map(([, part]) => part);
    const person = (name: string) => {
      const part = parts.get(name);
      return part === undefined ? undefined : { texture: part.texture, anchor: part.anchor };
    };
    const range = (sheet: string, from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) => person(`${sheet}_${from + i}`)).filter(
        (found): found is NonNullable<typeof found> => found !== undefined,
      );
    // Cyklus chůze (T126): tři postavy po čtyřech fázích. Bez něj staré
    // nehybné postavy, každá jako „cyklus" o jedné fázi.
    const cycles = (sheet: string) =>
      [0, 1, 2].map((p) => range(sheet, p * 4, p * 4 + 4)).filter((frames) => frames.length === 4);
    const walkFront = cycles('walk_front');
    const walkRear = cycles('walk_rear');
    people.setLooks({
      front: walkFront.length > 0 ? walkFront : range('people_walk', 0, 6).map((look) => [look]),
      rear: walkRear.length > 0 ? walkRear : range('people_walk', 6, 12).map((look) => [look]),
      sit: range('people_sit', 0, 8),
    });
    fireLayer.setTextures(
      flames.map((part) => part.texture),
      flames.map((part) => part.anchor),
      PART_SCALE,
    );
    buildingRenderer.setLamp(parts.get('street_lamp'));
    buildingRenderer.setPoles(parts.get('wood_pole'), parts.get('pylon'));
    const look = (sheet: string, i: number, weight: number): VehicleLook | undefined => {
      const front = parts.get(`${sheet}_front_${i}`);
      const rear = parts.get(`${sheet}_rear_${i}`);
      if (front === undefined || rear === undefined) return undefined;
      return {
        front: { texture: front.texture, anchor: front.anchor, scale: PART_SCALE, skew: front.skew ?? 0 },
        rear: { texture: rear.texture, anchor: rear.anchor, scale: PART_SCALE, skew: rear.skew ?? 0 },
        weight,
      };
    };
    // Škoda 105, 120, Trabant, Lada, Avia, Karosa. Nákladních a autobusů je
    // ve městě míň — a váha pod jedna je zároveň o kus pomalejší.
    const weights = [1, 1, 1, 1, 0.35, 0.2];
    vehicles.setLooks(
      weights
        .map((weight, i) => look('cars', i, weight))
        .filter((found): found is VehicleLook => found !== undefined),
    );
    serviceLooks = new Map(
      (['police', 'fire', 'health', 'waste'] as const)
        .map((service, i) => [service, look('service', i, 0.5)] as const)
        .filter((entry): entry is readonly [typeof entry[0], VehicleLook] => entry[1] !== undefined),
    );
  }
  // Silnice leží **mezi terénem a budovami**: kreslí se po chunku, ale pod
  // domy. Vlastní kontejner, ne řazení podle hloubky — vozovka je země.
  // Odlesky na vodě (T117): nad upečenou vodou, pod mosty a silnicemi.
  const waterGlints = new WaterGlints(world, worldContainer, app.renderer);
  const roadRenderer = new RoadRenderer(world, worldContainer);


  // Čtvercová síť leží **nad zemí a pod domy**, ze stejného důvodu jako
  // vozovka: je to hranice pozemku, ne kresba přes město. V podzemním pohledu
  // jsou domy schované, takže tam je vidět celá.
  const gridOverlay = new GridOverlay(world, worldContainer);

  const buildingRenderer = new BuildingRenderer(
    world,
    worldContainer,
    createAppearanceLookup(content),
  );

  // Auta (T115) se řadí **mezi budovy** (T124): ve vlastní vrstvě pod domy
  // je na svahu ořízla podezdívka domu za nimi.
  const vehicles = new Vehicles(
    world,
    buildingRenderer.layer,
    (roadType) => content.getBalance().traffic.roadTypes[roadType - 1]?.capacity ?? 0,
    (x, y) => buildingRenderer.depthAt(x, y),
  );
  /** Vozidla služeb podle třídy (T118). Plní se, až se načtou díly. */
  let serviceLooks = new Map<string, VehicleLook>();

  // Tepelné mapy: barva říká **jak je na tom čtvrť**, ne jak velké je číslo.
  // Směr se proto zadává u každé zvlášť — u znečištění je vysoká hodnota zlá,
  // u ceny půdy dobrá.
  const coarseOverlay = new CoarseOverlay(world, worldContainer, [
    {
      id: 'pollution',
      kind: 'heat',
      goodness: (value) => 1 - value / 255,
      values: () => world.coarse.pollution,
    },
    {
      id: 'landValue',
      kind: 'heat',
      // Cena půdy se ve zdravém městě drží hluboko pod stropem, takže na plnou
      // stupnici by byla mapa celá rudá. `LAND_VALUE_GOOD` je hodnota, u které
      // už parcela roste na nejvyšší úroveň — nad ní je zelená zasloužená.
      goodness: (value) => Math.min(1, value / LAND_VALUE_GOOD),
      values: () => world.coarse.landValue,
    },
    {
      id: 'crime',
      kind: 'heat',
      goodness: (value) => 1 - value / 255,
      values: () => world.coarse.crime,
    },
    {
      id: 'risk',
      kind: 'heat',
      // Vysoké riziko je zlé, takže se stupnice otáčí. Přepočítává se **až při
      // překreslení**: je to průchod celou mapou a nikdo jiný než tenhle pohled
      // ho nepotřebuje.
      goodness: (value) => 1 - value / 255,
      values: () => computeRiskMap(simWorld, content, content.getBalance()).values,
    },
    {
      id: 'happiness',
      kind: 'heat',
      // Nula je dno stupnice, `HAPPINESS_CLEAN_AT` je čtvrť, se kterou není co
      // řešit. Rozdíl mezi „ujde to" a „zle" tak zabere většinu barev.
      goodness: (value) => Math.min(1, value / HAPPINESS_CLEAN_AT),
      values: happinessLayer,
    },
    // Dosah každé třídy, která ve hře existuje. Seznam jde z obsahu, ne z kódu —
    // mod se svou třídou dostane přepínač zadarmo (P5).
    ...serviceClasses.map((serviceClass) => ({
      id: `coverage:${serviceClass}`,
      kind: 'coverage' as const,
      values: () => simWorld.coverage.get(serviceClass),
    })),
  ]);

  /**
   * Značky nad budovami služby, jejíž dosah se zrovna kreslí.
   *
   * Mapa pokrytí ukazuje kruh, ale ne jeho střed — autor napsal, že netuší, kde
   * hasičskou stanici vůbec má. Rozměry i třída jdou z obsahu (P5), takže třídu
   * z modu to obslouží stejně.
   */
  /**
   * Scény katastrof leží **nad silnicí a pod domy**: dav stojí v ulici, ne na
   * střeše, a zároveň nemá zmizet za prvním barákem.
   */
  const disasterScenes = new DisasterScenes(world, worldContainer);

  // Odezva na akce (T114): prach při bourání. Nad budovami, protože prach
  // stoupá před fasádou.
  const effects = new Effects(worldContainer, app.renderer);
  buildingRenderer.onVanished = (area) => effects.dust(area);
  // Plameny na každé hořící dlaždici (T120) a prach u paty tornáda.
  const fireLayer = new FireLayer(world, worldContainer);
  // Lidé u zastávek a metra (T118).
  const people = new People(
    world,
    buildingRenderer.layer,
    (x, y) => buildingRenderer.depthAt(x, y),
    (id) => buildingRenderer.zIndexOf(id),
  );
  /** Vchody zastávek a metra. Přepočítává se jednou za vteřinu, ne za snímek. */
  let entrances: Entrance[] = [];
  let entrancesAge = Infinity;
  function transitEntrances(): Entrance[] {
    const out: Entrance[] = [];
    for (const [id, building] of world.buildings) {
      if (building.abandoned) continue;
      const definition = content.get(building.definitionId);
      if (definition?.service?.class !== 'transit') continue;
      const [width, depth] = definition.footprint;
      out.push({
        id,
        x: building.x,
        y: building.y,
        width,
        depth,
        busy: building.definitionId === 'vanilla:metro_station' ? 2.5 : 1,
      });
    }
    return out;
  }
  disasterScenes.onDust = (x, y, base) =>
    effects.dust({ x: x - 0.35, y: y - 0.35, width: 0.7, depth: 0.7, base });

  const serviceMarkers = new ServiceMarkers(world, worldContainer);
  serviceMarkers.setLookup(
    (definitionId) => {
      const definition = content.get(definitionId);
      if (!definition) return undefined;
      const [width, depth] = definition.footprint;
      return { x: 0, y: 0, width, depth, height: definition.graphics.heightLevels * LEVEL_H };
    },
    (definitionId) => content.get(definitionId)?.service?.class,
  );

  // Doprava má vlastní overlay: plné rozlišení, jen silnice.
  const trafficOverlay = new TrafficOverlay(
    worldContainer,
    world,
    (roadType) => content.getBalance().traffic.roadTypes[roadType - 1]?.capacity ?? 0,
  );

  // Elektrické vedení (T129) s vytížením, jen ve vrstvě elektřiny.
  const wireOverlay = new WireOverlay(
    worldContainer,
    world,
    (type) => content.getBalance().power.wires[type - 1]?.capacity ?? 1,
  );

  const hover = new Graphics();
  worldContainer.addChild(hover);

  // Průhledný dům pod prstem. Kreslí se jen při míření prstem — myš nic
  // nezakrývá a rámeček jí stačí.
  const placementGhost = new PlacementGhost(
    world,
    worldContainer,
    createAppearanceLookup(content),
  );


  const debug = new DebugOverlay(mount);
  debug.setVisible(false);
  const costPopup = new CostPopup(mount);
  const priceTag = new PriceTag(mount);
  const notifications = new Notifications(mount);
  /**
   * Nabídka „Zpět" po bourání a po drahé stavbě.
   *
   * Vrácení je **načtení snímku**, ne opačný příkaz: ten k bourání neexistuje
   * (dům se nepostaví zpět s týmž id, věkem a obyvateli), kdežto uložená hra
   * to všechno nese a načte se deterministicky (P2). Mapa má tutéž velikost,
   * takže se renderer nemusí přestavovat.
   */
  const undoBar = new UndoBar(mount, i18n, (snapshot) => {
    applySaveToWorld(simWorld, migrate(unpackSave(snapshot)));
    message = { key: 'ui.undo.done' };
  });
  // Když se rozehrané město nepodařilo načíst, hráč vidí prázdnou mapu a neví
  // proč. Soubor přitom zůstal ležet ve slotu „poškozený" (audit N4).
  if (loadFailed) notifications.show(i18n.t('ui.save.loadFailedAtStart'));
  // Totéž, co hlásí načtení za běhu. Save s jinou velikostí mapy se teď načítá
  // novým startem (`planInGameLoad`) a bez tohohle by se hráč o chybějícím
  // obsahu a městě bez vodovodu nedozvěděl.
  if (startupWarnings) {
    const missing = [
      ...startupWarnings.missingSources.map((source) => source.id),
      ...startupWarnings.missingDefinitions,
    ];
    if (missing.length > 0) {
      notifications.show(i18n.t('ui.save.missingContent', { list: missing.join(', ') }));
    }
    if (startupWarnings.waterlessBuildings > 0) {
      notifications.show(
        i18n.t('ui.save.noWaterNetwork', { count: startupWarnings.waterlessBuildings }),
      );
    }
    if (startupWarnings.unwiredBuildings > 0) {
      notifications.show(
        i18n.t('ui.save.noPowerLines', { count: startupWarnings.unwiredBuildings }),
      );
    }
  }
  const legend = new Legend(mount, i18n);
  const budgetPanel = new BudgetPanel(mount, i18n, content.getAll('building'));
  const advisorPanel = new AdvisorPanel(mount, i18n);
  const statPanel = new StatPanel(mount, i18n);
  const buildingInfo = new BuildingInfo(mount, i18n, content.getBalance(), (terrain) => {
    // Náhled povrchu v rozboru parcely. Bere **první variantu**, ne tu, která
    // na dlaždici padla: v panelu jde o materiál, ne o konkrétní kus mapy.
    const name = TERRAIN_NAMES[terrain];
    if (name === undefined) return undefined;
    const [variant] = content.getTileVariants(name);
    return variant === undefined ? undefined : content.getTile(name, variant);
  }, () => cityUtilities(simWorld, content, content.getBalance()));
  const financePanel = new FinancePanel(mount, i18n, dispatch, content, content.grants());
  const transitPanel = new TransitPanel(mount, i18n, dispatch, {
    onPickStop: (lineId) => {
      message = { key: 'ui.transit.pickHint', params: { id: lineId } };
    },
    onCancelPick: () => {
      message = null;
    },
    // Zastávky nemají jméno, tak ať se na ně dá aspoň podívat.
    onShowStop: (x, y) => centreOn(x, y),
  });
  /*
   * Roční uzávěrka. Otevře se **1. ledna**, hned jak simulace uzavře knihu.
   *
   * Hra se přitom zastaví ze stejného důvodu jako u katastrofy: výkaz, přes
   * který město dál roste, si nikdo nepřečte. Rychlost se po zavření vrací
   * na výchozí, ne na tu předchozí — hráč se po ročence obvykle rozhoduje,
   * ne spěchá.
   */
  const yearReport = new YearReport(mount, i18n, {
    onClose: () => setSpeed(DEFAULT_SPEED_INDEX),
  });
  // Totéž pro město obnovené hned při startu.
  if (simWorld.economy.lastYear) yearReport.markSeen(simWorld.economy.lastYear.year);

  const alert = new DisasterAlert(mount, i18n, {
    onIgnore: () => setSpeed(DEFAULT_SPEED_INDEX),
    onShow: (x, y) => {
      centreOn(x, y);
      // Rychlost se **nevrací sama**. Hráč právě dostal na obrazovku hořící
      // čtvrť a má si ji v klidu prohlédnout; rozjet hru je jeho rozhodnutí.
    },
  });

  /**
   * Hra nesmí mlčet. Odmítnutý příkaz i spadlý kód se musí objevit na obrazovce —
   * ve vývoji obzvlášť, protože jinak se chyba pozná až po hodině hraní.
   *
   * **Provozní odmítnutí se ale zahazují** (`isRoutine`). Že klik na obsazenou
   * dlaždici nic neudělal, je vidět z toho, že se nic nestalo; hláška o tom byla
   * jen šum přes obraz.
   */
  function dispatch(cmd: Command): CommandResult {
    const result = host.dispatch(cmd);
    if (!result.ok) report(result);
    return result;
  }

  /** Ukáže důvod odmítnutí, pokud to není provozní šum. */
  function report(result: Extract<CommandResult, { ok: false }>): void {
    if (isRoutine(result.reason)) return;
    notifications.show(i18n.t(result.reason, result.params));
  }

  function reportCrash(message: string): void {
    notifications.show(i18n.t('error.crash', { message }));
  }

  window.addEventListener('error', (event) => reportCrash(event.message));
  window.addEventListener('unhandledrejection', (event) => reportCrash(String(event.reason)));

  /**
   * Odkdy se počítá doba hraní a kdy město vzniklo.
   *
   * Obojí se přepisuje při načtení na místě: hraná hra je od té chvíle **to
   * načtené město**, ne to předchozí (T-revize, nález 37).
   */
  let startedAt = Date.now();
  let createdAt = new Date(startedAt).toISOString();
  /** Rychlý save drží jen v paměti; do souboru se ukládá tlačítkem. */
  let message: Message | null = null;

  /**
   * Snímek města pro nabídku „Zpět".
   *
   * Ukládá se **bez komprese**: na disk nikdy nepůjde a žije nejvýš pět
   * sekund, kdežto deflate na devítce dělal z mapy 512 × 512 pět megabajtů
   * mačkaných synchronně v obsluze stisku — tedy zaseknutí při každém kliknutí
   * buldozerem, i při tom, které příkaz odmítl (T-revize, nález 33).
   */
  function undoSnapshotNow(): Uint8Array {
    return serializeSave(simWorld, saveOptions(), 0);
  }

  function saveOptions() {
    return {
      cityName,
      createdAt,
      modifiedAt: new Date().toISOString(),
      playtimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      sources: content.getLoadedSources(),
    };
  }

  async function loadFromBytes(bytes: Uint8Array): Promise<void> {
    const plan = planInGameLoad(bytes, world.size);
    if (plan.kind === 'invalid') {
      message = { key: 'ui.save.failed', params: { reason: plan.error.message } };
      return;
    }

    if (plan.kind === 'restart') {
      // Jiná velikost mapy: renderer si ji bere při startu, takže se město
      // načte novým startem. Uloží se jako rozehrané a hra naběhne rovnou do
      // něj, bez rozcestníku.
      if (!(await platform.storage.write('autosave', bytes))) {
        message = { key: 'ui.save.storeFailed' };
        return;
      }
      // Autosave při odchodu ze stránky by ho jinak přepsal městem, které se
      // právě zavírá — a hráč by po obnovení viděl zase to staré.
      restarting = true;
      platform.restartIntoAutosave();
      return;
    }

    try {
      const save = plan.save;
      const warnings = collectLoadWarnings(save, content, content.getLoadedSources());
      applySaveToWorld(simWorld, save);

      // **Město si nese svoje jméno.** Do teď se jméno nastavovalo jen při
      // startu, takže se načtený Zlín od téhle chvíle ukládal jako „Brno" —
      // do autosave i do staženého souboru — a původní jméno bylo nevratně
      // pryč. Totéž platilo pro datum vzniku a odehraný čas (nález 37).
      cityName = save.meta.city.name;
      createdAt = save.meta.createdAt;
      startedAt = Date.now() - save.meta.playtimeSeconds * 1000;

      // Běhový stav hlášení patří k **předchozímu** městu (nález 4).
      resetRuntimeNotices();
      // Loňskou uzávěrku už hráč viděl, když se zavírala. Bez tohohle by mu
      // vyskočila znovu při každém načtení téhož města.
      if (simWorld.economy.lastYear) yearReport.markSeen(simWorld.economy.lastYear.year);

      // Kamera **na načtené město**, stejně jako při startu. Zůstávala tam, kam
      // se dívalo to předchozí, a hráč po načtení viděl prázdnou krajinu.
      const centre = cityCentre(world);
      centreOn(centre.x, centre.y);

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
        );
      }
      if (warnings.unwiredBuildings > 0) {
        notifications.show(i18n.t('ui.save.noPowerLines', { count: warnings.unwiredBuildings }));
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
  /** Aby se hláška o plném úložišti neopakovala každou uzávěrku. */
  let autosaveWarned = false;

  /** Hlásí se jen přechod do nedostatku, ne každý snímek. */
  const utilityShortage: Record<'waste' | 'sewage' | 'water', boolean> = {
    waste: false,
    sewage: false,
    water: false,
  };

  /** Aby se hláška o nečitelném savu neopakovala při každém uložení. */
  let unreadableWarned = false;

  /**
   * Hra se restartuje do načteného savu. Autosave je v tu chvíli **ten savem**
   * a nesmí ho přepsat město, které se zavírá (`loadFromBytes`).
   */
  let restarting = false;

  /**
   * Načetlo by se tohle město při příštím startu?
   *
   * Save, který by se nenačetl, **nesmí přepsat ten poslední dobrý** (viz
   * `save/verify.ts`). Hráč by o město přišel až po obnovení stránky, kdy už
   * se s tím nedá nic dělat.
   */
  function saveIsReadable(bytes: Uint8Array): boolean {
    const problem = verifySave(bytes);
    if (problem === null) return true;
    // Celá výjimka do konzole: je to chyba hry, ne hráče, a bez zprávy se
    // nedá dohledat, které pole se s loaderem rozešlo.
    console.error('Uložené město by se znovu nenačetlo:', problem);
    if (!unreadableWarned) {
      unreadableWarned = true;
      notifications.show(i18n.t('ui.save.unreadable'));
    }
    return false;
  }

  /**
   * Kdy se naposledy povedlo uložit samo. `0` = ještě nikdy.
   *
   * Čte to panel uložení: hráč do teď neměl z čeho poznat, jestli se vůbec
   * někdy uložilo.
   */
  let lastAutosaveAt = 0;
  /** Kolik milisekund zbývá do dalšího automatického uložení. */
  let autosaveDue = AUTOSAVE_EVERY_MS;
  /** Kolikáté periodické uložení běží. Každé páté se pro jistotu ověří. */
  let autosaveRuns = 0;

  function autosaveNow(verify = true): void {
    if (restarting) return;
    try {
      const bytes = serializeSave(simWorld, saveOptions());
      if (verify && !saveIsReadable(bytes)) return;

      // Bez `await`: na `pagehide` už není kam čekat. Zápis v prohlížeči běží
      // synchronně, takže se stihne — a kdyby jednou neběžel, je to věc
      // platform vrstvy, ne tohohle místa.
      //
      // Výsledek se ale **nezahazuje** (audit N8): kvóta `localStorage` je
      // kolem pěti megabajtů a base64 save nafoukne o třetinu, takže velké
      // město se jednou uložit nemusí. Rychlé uložení chybu hlásilo, tohle ne
      // — a hráč se o ztrátě dozvídal až po obnovení stránky.
      void platform.storage
        .write('autosave', bytes)
        .then((stored) => {
          if (stored) {
            lastAutosaveAt = Date.now();
            return;
          }
          if (autosaveWarned) return;
          autosaveWarned = true;
          notifications.show(i18n.t('ui.save.autosaveFailed'));
        });
    } catch {
      // Rozehranou hru neshodí ani plné úložiště.
    }
  }

  /**
   * Načte novou verzi hry a **město nechá být**.
   *
   * Pořadí je to jediné, na čem tu záleží: nejdřív se rozehrané město odloží
   * do prohlížeče, teprve pak se sáhne na keš. `localStorage` píše synchronně,
   * takže je uložené dřív, než se stránka začne obnovovat.
   */
  async function reloadNewVersion(): Promise<void> {
    autosaveNow();
    message = { key: 'ui.save.updating' };
    await platform.reloadNewVersion();
  }

  async function quickSaveNow(): Promise<void> {
    const bytes = serializeSave(simWorld, saveOptions());
    // Nečitelný save nepřepíše předchozí rychlé uložení, stejně jako u autosave.
    if (!saveIsReadable(bytes)) {
      message = { key: 'ui.save.unreadableShort' };
      return;
    }
    const stored = await platform.storage.write('quick', bytes);
    // Rychlý save **přežije obnovení stránky**. Když se uložit nepovede, hráč
    // to musí vědět hned — jinak by se na něj spolehl a přišel o město.
    message = stored
      ? { key: 'ui.save.saved', params: { size: (bytes.byteLength / 1024).toFixed(1) } }
      : { key: 'ui.save.storeFailed' };
  }

  /**
   * Uloží snímek herní plochy jako PNG.
   *
   * Bere se **obsah scény přes `extract`, ne plátno**. Plátno by šlo číst jen
   * s `preserveDrawingBuffer`, a to zpomaluje každý snímek hry kvůli funkci,
   * která se použije jednou za čas. `extract` si scénu překreslí zvlášť.
   *
   * Rozlišení je dvojnásobek okna: snímek z herního okna 1920 × 1080 vyjde
   * ve 4K a dá se z něj něco vyříznout. HUD na něm není, protože je to DOM,
   * ne Pixi — a na propagačním snímku stejně nemá co dělat.
   */
  async function saveScreenshot(): Promise<void> {
    // **Kreslí se do vlastní textury o velikosti okna.**
    // `extract` bez cíle si vezme obálku celého jeviště, a to je u mapy
    // 256 × 256 přes třicet tisíc pixelů na šířku — prohlížeč to odmítl
    // s „Array buffer allocation failed". Ani `frame` to nespravil: obálka se
    // spočítá dřív. Textura dané velikosti je jistota.
    const texture = RenderTexture.create({
      width: app.screen.width,
      height: app.screen.height,
      resolution: SCREENSHOT_RESOLUTION,
    });
    app.renderer.render({ container: app.stage, target: texture });
    const canvas = app.renderer.extract.canvas(texture);
    texture.destroy(true);

    const blob = await new Promise<Blob | null>((resolve) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        resolve(null);
        return;
      }
      canvas.toBlob(resolve, 'image/png');
    });
    if (blob === null) {
      message = { key: 'ui.save.screenshotFailed' };
      return;
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    platform.files.save(bytes, `zdenalcity-${stamp}.png`, 'image/png');
    message = { key: 'ui.save.screenshotSaved' };
  }

  async function quickLoadNow(): Promise<void> {
    const bytes = await platform.storage.read('quick');
    if (!bytes) {
      message = { key: 'ui.save.empty' };
      return;
    }
    await loadFromBytes(bytes);
  }

  const camera = (() => {
    // **Na město, ne doprostřed mapy.** Načtený save otevřel pohled na střed
    // čtverce, což je u města na kraji pevniny prázdná voda — hráč po načtení
    // viděl jezero a musel své město hledat tažením. Když ve světě nic nestojí,
    // zůstává střed mapy: nové město se zakládá kdekoli.
    const centre = cityCentre(world);
    const point = gridToScreen(centre.x, centre.y);
    return createCamera(
      point.x,
      point.y,
      layoutMode() === 'compact' ? COMPACT_START_ZOOM : 1,
    );
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

  /**
   * Katastrofy, o kterých už hráč ví. Hlásí se **jednou při vzniku**, ne
   * pokaždé, co se na ně renderer podívá.
   *
   * Drží se tu id, ne počet: pohroma může skončit a hned začít jiná, a hráč
   * má dostat dvě zprávy, ne žádnou.
   */
  const announced = new Set<number>();

  /**
   * Pohromy, které hráč spustil sám z menu. Ohlašovat mu je nemá cenu — ví
   * o nich líp než hra, právě na ně klikl.
   */
  const armedManually = new Set<number>();

  /**
   * Vybere frontu zpráv z financí a řekne je hráči.
   *
   * Přiznaný grant, zmeškaná splátka, nezaplacený kupón i propadlý dluhopis
   * se do teď **zahazovaly** rovnou v simulaci: za tisíc obyvatel přiteklo
   * 8 000 a hráč nedostal ani slovo, po pár zmeškaných splátkách mu panel
   * nabídl 12 % místo 4 % a neřekl proč (T-revize, nálezy 11 a 12).
   *
   * Fronta se **vyprázdní** — je to jednosměrný kanál a druhé čtení téže
   * zprávy by znamenalo druhou bublinu o témže grantu.
   */
  function announceFinance(): void {
    const notices = simWorld.financeNotices;
    if (notices.length === 0) return;

    for (const notice of notices.splice(0, notices.length)) {
      switch (notice.kind) {
        case 'grant': {
          const grant = content.grants().find((candidate) => candidate.id === notice.grantId);
          notifications.show(
            i18n.t('ui.notice.grantAwarded', {
              name: grant ? i18n.t(grant.name) : notice.grantId,
              amount: formatNumber(notice.amount),
            }),
          );
          break;
        }
        case 'missedPayment':
          notifications.show(i18n.t('ui.notice.missedPayment', { count: notice.count }));
          break;
        case 'missedCoupon':
          notifications.show(i18n.t('ui.notice.missedCoupon', { count: notice.count }));
          break;
        case 'bondDefault':
          notifications.show(i18n.t('ui.notice.bondDefault'));
          break;
        case 'bondDue':
          notifications.show(i18n.t('ui.notice.bondDue', { years: notice.years }));
          break;
      }
    }
  }

  /**
   * Vynuluje **běhový stav hlášení**. Volá načtení města i start.
   *
   * Množina ohlášených pohrom žila po celou dobu běhu, kdežto čítač
   * `disasters.nextId` se bere ze savu. Po načtení se tedy id vrátila do
   * minulosti, množina ne — a každá nová pohroma vypadala jako už ohlášená.
   * Město od té chvíle hořelo potichu: žádné okno, žádná pauza, tedy přesně
   * to, kvůli čemu okno vzniklo (T-revize, nález 4).
   *
   * Řeší se to **jedním místem pro všechno běhové**, ne záplatou na `announced`:
   * stejnou past má každý příznak, který si pamatuje „tohle jsem už hlásil",
   * a u příštího počítadla by se to stalo znovu.
   */
  function resetRuntimeNotices(): void {
    announced.clear();
    armedManually.clear();
    reportedBlockers.clear();
    wasBroke = world.economy.funds < 0;
    hadPowerShortage = false;
    lastPowerOffline = 0;
    utilityShortage.waste = false;
    utilityShortage.sewage = false;
    utilityShortage.water = false;
    // Fronta zpráv z financí patří k předchozímu městu.
    simWorld.financeNotices.length = 0;
    // Karta parcely a nabídka „Zpět" mluví o městě, které už není.
    buildingInfo.hide();
    undoBar.hide();
  }

  /**
   * Ohlásí nově vzniklé pohromy a hru zastaví.
   *
   * Pauza je součást zprávy, ne zdvořilost. Hráč, který si zrovna odskočil, se
   * jinak vrátí k ruině — přesně to se stalo autorovi a je to důvod, proč tohle
   * okno vzniklo.
   */
  function announceDisasters(): void {
    // Ručně spuštěné se odbydou hned: hráč o nich ví, jen ať nepřekáží ve
    // frontě té, kterou poslal plánovač.
    for (const id of armedManually) announced.add(id);
    armedManually.clear();

    const disaster = nextToAnnounce(world.disasters.active, announced, armedManually);
    if (!disaster) return;

    // `announced` se doplní **až když se okno opravdu otevřelo**. Kdyby se
    // zapsalo dřív, pohroma, která přišla přes už otevřené okno, by se
    // označila za ohlášenou a hráč by se o ní nedozvěděl nikdy.
    // Kamera míří tam, **kde to bolí**, ne kam spadlo epicentrum: zemětřesení
    // ho má kdekoli, i v pustině, a hráč pak koukal do prázdné krajiny.
    const where = alertTarget(simWorld, disaster.x, disaster.y);
    if (!alert.open(disaster.kind, where.x, where.y)) return;
    announced.add(disaster.id);
    setSpeed(0);
  }

  /** Srovná kameru na dlaždici, ať je uprostřed obrazovky. */
  function centreOn(x: number, y: number): void {
    const point = gridToScreen(x, y);
    camera.x = point.x;
    camera.y = point.y;
  }

  /**
   * Meze pro střed kamery: mapa plus rezerva pár dlaždic.
   *
   * Mapa je v projekci kosočtverec od `(0,0)` po `(size,size)`, takže vodorovně
   * sahá na obě strany o půl šířky dlaždice krát velikost mapy a svisle od
   * severního rohu k jižnímu. Rezerva je proto, aby šlo dojet na okraj a vidět
   * i to, co za ním je — ne aby šlo odjet do prázdna (nález 18).
   */
  const CAMERA_MARGIN_TILES = 6;
  function cameraBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    const size = world.size;
    const marginX = (CAMERA_MARGIN_TILES * TILE_W) / 2;
    const marginY = (CAMERA_MARGIN_TILES * TILE_H) / 2;
    return {
      minX: -(size * TILE_W) / 2 - marginX,
      maxX: (size * TILE_W) / 2 + marginX,
      minY: -marginY,
      maxY: size * TILE_H + marginY,
    };
  }

  /**
   * Kamera nad střed města, nebo nad střed mapy, když ještě žádné není.
   *
   * Střed se počítá z **obydlených** budov: hráč, který si odjel za okraj,
   * se chce vrátit tam, kde bydlí lidi, ne k první postavené trafostanici.
   */
  function focusCity(): void {
    let sumX = 0;
    let sumY = 0;
    let people = 0;
    for (const building of world.buildings.values()) {
      if (building.abandoned || building.population === 0) continue;
      sumX += building.x * building.population;
      sumY += building.y * building.population;
      people += building.population;
    }
    if (people > 0) centreOn(sumX / people, sumY / people);
    else centreOn(world.size / 2, world.size / 2);
    clampCamera(camera, cameraBounds());
  }

  /**
   * Srovná dlaždici **nad vysunutý panel**.
   *
   * Na telefonu se panely vysouvají zespodu (`style.css`) a karta parcely se
   * otevře přes spodní část obrazovky — jenže kamera míří na střed, tedy
   * přesně tam, kam hráč klepl. Panel tak zakryl dlaždici, o které mluví.
   *
   * Na počítači se nesrovnává nic: tam je panel malý a leží vedle.
   */
  function centreAboveSheet(x: number, y: number): void {
    if (layoutMode() !== 'compact') return;

    const sheet = document.querySelector('.sheet:not(.is-hidden)');
    if (!(sheet instanceof HTMLElement)) return;

    centreOn(x, y);
    // Volná plocha je nad panelem a její střed leží o polovinu té plochy výš.
    const free = window.innerHeight - sheet.getBoundingClientRect().top;
    if (free > 0) pan(camera, 0, -free / 2);
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
    if (kind === 'road' || kind === 'pipe' || kind === 'wire') return 'line';
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

    // Pořadí je **od kotvy k ukazateli**, ne od menší souřadnice k větší
    // (T-revize, nález 6). Vozovka na vodě potřebuje sousední silnici, takže
    // most se staví od břehu. Když hráč táhl doleva nebo nahoru, začínalo se
    // uprostřed vody: první dlaždice spadla a s ní zbytek, a hra k tomu
    // oznámila „Most musí začínat na břehu, ne uprostřed vody" — tedy přesně
    // to, co hráč udělal. Opačným směrem to fungovalo. Kotva je jediné místo,
    // o kterém hráč ví, že je napojené.
    const stepX = Math.sign(hoveredTile.x - dragAnchor.x) || 1;
    for (let x = dragAnchor.x; ; x += stepX) {
      tiles.push({ x, y: dragAnchor.y });
      if (x === hoveredTile.x) break;
    }
    const stepY = Math.sign(hoveredTile.y - dragAnchor.y) || 1;
    for (let y = dragAnchor.y; ; y += stepY) {
      if (y !== dragAnchor.y) tiles.push({ x: hoveredTile.x, y });
      if (y === hoveredTile.y) break;
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

    // Obrázek budovy do panelu. Počítá se **stejnou cestou jako v rendereru**,
    // aby v kartičce byla ta varianta, která je opravdu na mapě.
    const spriteVariant = building
      ? variantFor(content.getSpriteVariants(building.definitionId), building.id)
      : undefined;
    const spriteUrl =
      building && spriteVariant !== undefined
        ? (content.getSprite(building.definitionId, spriteVariant)?.url ?? null)
        : null;

    buildingInfo.show(
      simWorld,
      parcel,
      building,
      building ? content.get(building.definitionId) : undefined,
      growthBlocker(simWorld, content, content.getBalance(), tile.x, tile.y),
      spriteUrl,
      riskAt(tile.x, tile.y),
    );

    centreAboveSheet(tile.x, tile.y);
  }

  /**
   * Co v téhle čtvrti hrozí, když je riziko nad prahem. `null` jinak.
   *
   * Počítá se **na kliknutí, ne v tiku**: je to průchod celou mapou a nikdo ho
   * nepotřebuje častěji než ve chvíli, kdy si hráč parcelu otevře.
   */
  function riskAt(x: number, y: number): string | null {
    const map = computeRiskMap(simWorld, content, content.getBalance());
    const cell = coarseIndex(x, y, simWorld.size);
    if ((map.values[cell] ?? 0) < RISK_WARNING) return null;
    return map.kinds[cell] ?? null;
  }

  const views = createViewOptions();
  const layers = createLayerOptions(content);

  let viewMode = 'surface';
  let layerMode = 'none';
  let ghostBuildings = false;
  let decorVisible = true;
  let gridVisible = false;
  /**
   * Hýbe se něco jen pro parádu? Výchozí hodnota ctí `prefers-reduced-motion`:
   * komu se z pohybu na obrazovce dělá zle, ten si to v systému už řekl
   * a nemá to hledat v liště znovu.
   */
  let motionOn = !prefersReducedMotion();

  function applyViewAndLayer(): void {
    // Elektřina se zapéká do chunků, hrubé veličiny mají vlastní lehkou vrstvu
    // a doprava svou vlastní v plném rozlišení.
    const chunkMode: OverlayMode =
      viewMode === 'underground' ? 'underground' : layerMode === 'power' ? 'power' : 'none';
    chunkRenderer.setOverlay(chunkMode);
    const coarseId = layerMode === 'power' || layerMode === 'traffic' ? 'none' : layerMode;
    coarseOverlay.setActive(coarseId);
    trafficOverlay.setVisible(layerMode === 'traffic');
    wireOverlay.setVisible(layerMode === 'power' && viewMode !== 'underground');
    // Špendlíky jen u mapy dosahu: tam se hráč ptá „kde ta stanice je".
    // U tepelných map by ukazovaly na budovu, která s tou veličinou nesouvisí.
    serviceMarkers.setActive(
      layerMode.startsWith('coverage:') ? layerMode.slice('coverage:'.length) : null,
    );
    showLegend();
    // Budovy v podzemním pohledu překáží — hráč se dívá pod ně.
    buildingRenderer.setVisible(viewMode !== 'underground');
    roadRenderer.setVisible(viewMode !== 'underground');
    disasterScenes.setVisible(viewMode !== 'underground');
    buildingRenderer.setGhost(ghostBuildings);
    buildingRenderer.setDecorVisible(decorVisible);
    buildingRenderer.setMotion(motionOn);
    placementGhost.setMotion(motionOn);
    effects.setEnabled(motionOn);
    effects.setVisible(viewMode !== 'underground');
    vehicles.setEnabled(motionOn);
    vehicles.setVisible(viewMode !== 'underground');
    fireLayer.setEnabled(motionOn);
    fireLayer.setVisible(viewMode !== 'underground');
    people.setEnabled(motionOn);
    people.setVisible(viewMode !== 'underground');
    waterGlints.setEnabled(motionOn);
    waterGlints.setVisible(viewMode !== 'underground');
    // Barva sítě se řídí pohledem, ne přepínačem: pod zemí bílá, nad zemí
    // černá. Přepnutí sítě naopak pohledem nehne — viz `gridOverlay.ts`.
    gridOverlay.setUnderground(viewMode === 'underground');
  }

  /**
   * Popisek k zapnutému pohledu.
   *
   * Konce stupnice se pojmenovávají **podle veličiny**, ne obecným „zle/dobře":
   * u znečištění je to „čisto" a „zamořeno", u ceny půdy „bezcenná" a „drahá".
   * Obecné popisky by hráči neřekly, na co se vlastně dívá.
   */
  function showLegend(): void {
    const ends: Record<string, [string, string]> = {
      pollution: ['ui.legend.dirty', 'ui.legend.clean'],
      landValue: ['ui.legend.cheap', 'ui.legend.pricey'],
      crime: ['ui.legend.dangerous', 'ui.legend.safe'],
      happiness: ['ui.legend.miserable', 'ui.legend.content'],
      risk: ['ui.legend.atRisk', 'ui.legend.safe'],
      traffic: ['ui.legend.worst', 'ui.legend.best'],
    };

    const labelKey = layers.find((option) => option.id === layerMode)?.labelKey;
    if (labelKey === undefined) {
      legend.hide();
      return;
    }
    if (layerMode.startsWith('coverage:')) {
      legend.showCoverage(labelKey);
      return;
    }
    // Elektřina není stupnice, ale tři stavy — a bez legendy byla nečitelná.
    if (layerMode === 'power') {
      legend.showSwatches(labelKey, [
        ['power-on', 'ui.legend.power.on'],
        ['power-off', 'ui.legend.power.off'],
        ['power-none', 'ui.legend.power.none'],
      ]);
      return;
    }

    const pair = ends[layerMode];
    if (pair === undefined) {
      legend.hide();
      return;
    }
    // Doprava má vlastní stupnici v plném rozlišení, ale čte se stejně:
    // zelená volno, rudá ucpáno.
    const stops = layerMode === 'traffic' ? [...TRAFFIC_COLORS] : [...HEAT_STOPS];
    legend.showHeat(labelKey, { stops, worstKey: pair[0], bestKey: pair[1] });
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

  const hud = new Hud(
    hudRoot,
    i18n,
    world,
    SPEEDS,
    views,
    layers,
    serviceClasses,
    {
      max: MAX_FUNDING,
      effect: (level) => fundingEffect(content.getBalance(), level),
      cost: (level) => fundingCost(content.getBalance(), level),
    },
    disasterRegistry.kinds(),
    layoutMode(),
    {
    onSpeed: setSpeed,
    onTaxChange: changeTax,
    onQuickSave: () => void quickSaveNow(),
    onQuickLoad: () => void quickLoadNow(),
    onDownload: () => {
      const bytes = serializeSave(simWorld, saveOptions());
      // Soubor se stáhne **i tak**: je to jediná kopie rozehrané hry a zároveň
      // důkaz, podle kterého se dá chyba opravit. Hráč jen musí vědět, že ho
      // tahle verze neotevře.
      const readable = saveIsReadable(bytes);
      platform.files.save(bytes, 'mesto.city');
      message = readable
        ? { key: 'ui.save.saved', params: { size: (bytes.byteLength / 1024).toFixed(1) } }
        : { key: 'ui.save.downloadedUnreadable' };
    },
    onOpenFile: (file) => {
      void platform.files.read(file).then(loadFromBytes);
    },
    onScreenshot: () => void saveScreenshot(),
    // Lupa přibližuje **doprostřed obrazovky**. Kolečko se drží kurzoru,
    // jenže tlačítko žádný kurzor nemá a držet se jeho vlastní polohy by
    // znamenalo přibližovat k pravému dolnímu rohu.
    onFocusCity: () => focusCity(),
    onZoom: (factor) =>
      zoomAt(camera, factor, app.screen.width / 2, app.screen.height / 2, app.screen.width, app.screen.height),
    onReload: () => void reloadNewVersion(),
    onToggleLayer: toggleLayer,
    onSetView: setView,
    onToggleBudget: () => budgetPanel.toggle(),
    onToggleAdvisor: () => advisorPanel.toggle(),
    onStatClick: (key) => statPanel.toggle(key),
    onToggleFinance: () => financePanel.toggle(),
    onToggleTransit: () => transitPanel.toggle(),
    onToggleDisasters: () => {
      simWorld.disasters.enabled = !simWorld.disasters.enabled;
      message = {
        key: simWorld.disasters.enabled ? 'ui.disaster.turnedOn' : 'ui.disaster.turnedOff',
      };
    },
    onToggleGhost: () => {
      ghostBuildings = !ghostBuildings;
      applyViewAndLayer();
    },
    onToggleDecor: () => {
      decorVisible = !decorVisible;
      applyViewAndLayer();
    },
    onToggleMotion: () => {
      motionOn = !motionOn;
      applyViewAndLayer();
    },
    onToggleGrid: () => {
      gridVisible = !gridVisible;
      gridOverlay.setVisible(gridVisible);
    },
    onFundingChange: (serviceClass, funding) =>
      dispatch({ type: 'set_service_funding', serviceClass, funding }),
    onLanguageChange: (language) => i18n.setLanguage(language),
    // Nápověda se otevírá **nad hrou**, ne místo ní: hráč se vrací jedním
    // tlačítkem a nepřijde o místo, kde se zrovna díval.
    onHelp: () => showHelp(mount, (key) => i18n.t(key), undefined, content),
    onArmDisaster: (kind) => {
      armedDisaster = kind;
      message = { key: 'ui.disaster.armed', params: { name: i18n.t(`ui.disaster.${kind}`) } };
    },
    // Klik na ikonu u hodin vrátí **tutéž kartu, která přišla při vzniku**.
    // Hra se u ní znovu zastaví: kdo si ji otevřel, chce číst, ne dohánět.
    onDisasterClick: (kind, x, y, dead) => {
      const where = alertTarget(simWorld, x, y);
      if (alert.open(kind, where.x, where.y, dead)) setSpeed(0);
    },
    },
  );

  function selectTool(tool: ToolOption): void {
    activeTool = tool;
    toolbar.setActive(tool.id);

    // Nástroj si přepne pohled sám. Potrubí je pod zemí vidět, nad zemí ne —
    // hráč by kladl trubky poslepu a nikdo by mu neřekl proč. A naopak: kdo
    // sáhne po silnici nebo budově, chce zase vidět povrch.
    //
    // Buldozer a pacička jsou schválně výjimka. Buldozer pod zemí bourá trubky
    // a nad zemí domy, takže mu vyhovuje obojí. A pacička nedělá **nic** —
    // posouvá mapu a otevírá parcely. Když s ní pod zemí vyskočil povrch,
    // přišel hráč o pohled, ve kterém pracoval, jen tím, že si chtěl posunout
    // mapu. Hlásil to autor.
    if (tool.action.kind === 'pipe') setView('underground');
    else if (tool.action.kind !== 'bulldoze' && tool.action.kind !== 'pan') setView('surface');
    // Vedení je vidět ve vrstvě elektřiny (T129) — hráč ho má vidět, když ho
    // staví, stejně jako potrubí v podzemí.
    if (tool.action.kind === 'wire' && layerMode !== 'power') toggleLayer('power');
  }

  // Vysunutou řadu vlastní HUD: je společná pro schované nástroje i schované
  // ovládání a otevírá je jedna trojtečka.
  const toolbar = new Toolbar(
    hud.toolsSlot,
    i18n,
    tools,
    activeTool.id,
    layoutMode() !== 'full',
    hud.overflow,
    selectTool,
  );
  watchLayout((mode) => {
    hud.setLayout(mode);
    toolbar.setDense(mode !== 'full');
  });

  const canvas = app.canvas;

  /**
   * Panuje se prostředním tlačítkem, mezerníkem s levým, nebo **pacičkou**.
   *
   * Pacička je normální nástroj: když je vybraná, levé tlačítko posouvá mapu.
   * Rozdíl proti ostatním dvěma je, že klik bez tažení u ní ještě něco udělá —
   * viz `panStartedAt`.
   */
  function isPanButton(event: PointerEvent): boolean {
    if (event.button === 1) return true;
    if (event.button !== 0) return false;
    return spaceDown || activeTool.action.kind === 'pan';
  }

  /**
   * Kde a čím začalo panování pacičkou. `null` u ostatních způsobů posunu —
   * u nich se klik bez tažení nemá čím projevit.
   *
   * Prahem osmi pixelů se odlišuje klik od tažení: prst ani myš nedrží polohu
   * přesně a bez prahu by se výběr při sebemenším chvění neotevřel.
   */
  let panStartedAt: { x: number; y: number; tile: { x: number; y: number } } | null = null;
  const CLICK_SLOP = 8;

  function tileAt(event: PointerEvent, liftY = 0): { x: number; y: number } | null {
    return pickTile(
      camera,
      event.offsetX,
      event.offsetY - liftY,
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
  /** Kolik kapacity drží dole běžící blackout. Hlásí se jen při změně. */
  let lastPowerOffline = 0;

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
    // Chybějící voda má **vlastní, konkrétní hlášku** (T-revize, nález 1):
    // leží v překladu hotová a vysvětluje přesně tuhle situaci, kdežto obecné
    // „nic neroste, protože chybí voda" hráči neřekne, co s tím.
    notifications.show(
      worst === 'error.needsWater'
        ? i18n.t('ui.notice.zonesWithoutWater')
        : i18n.t('ui.notice.nothingGrows', { reason: i18n.t(worst) }),
    );
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
    const started = startDisaster(
      simWorld,
      content,
      content.getBalance(),
      disasterRegistry,
      kind,
      tile.x,
      tile.y,
    );
    if (started) armedManually.add(started.id);
    message = { key: 'ui.disaster.started', params: { name: i18n.t(`ui.disaster.${kind}`) } };
    return true;
  }

  /**
   * Klik do mapy, když panel MHD čeká na zastávku. `true` = klik se spotřeboval.
   *
   * Musí to být **dřív než nástroje**: hráč, který sbírá zastávky, má
   * v paletě pořád zapnutou silnici, a bez tohohle by si místo přidání
   * zastávky přestavěl město.
   *
   * Vedle nemá nikdo trpělivost: netrefený klik nabídku **nezhasne**. Zhasne
   * ji až přidaná zastávka nebo druhé kliknutí na tlačítko. Co je špatně
   * (prázdná dlaždice, jiný mód, už je na lince) rozsoudí příkaz, ne rozhraní —
   * jinak by rozhraní hlídalo pravidla podruhé a jinak.
   */
  function pickTransitStop(tile: { x: number; y: number }): boolean {
    const lineId = transitPanel.pickingLine();
    if (lineId === null) return false;

    const buildingId = simWorld.layers.buildingId[index(tile.x, tile.y, world.size)] ?? 0;
    if (dispatch({ type: 'add_stop', lineId, buildingId }).ok) transitPanel.stopPicked();
    return true;
  }

  function applyTool(tile: { x: number; y: number }, viewX: number, viewY: number): void {
    const action = activeTool.action;
    const fundsBefore = world.economy.funds;

    /*
     * Snímek pro „Zpět" se bere **před** příkazem a jen u tahů, které se
     * nedají snadno vrátit: bourání a stavba. Během jednoho tahu se bere
     * jenom první — tažení buldozerem se tak vrátí celé, ne po dlaždici.
     */
    const undoKey =
      action.kind === 'bulldoze'
        ? 'ui.undo.demolished'
        : action.kind === 'place'
          ? 'ui.undo.built'
          : null;
    if (undoKey !== null && undoSnapshot === null) {
      undoSnapshot = undoSnapshotNow();
    }
    let undone = false;

    switch (action.kind) {
      case 'road':
        dispatch({ type: 'build_road', x: tile.x, y: tile.y, roadType: action.roadType });
        break;
      case 'pipe':
        dispatch({ type: 'build_pipe', x: tile.x, y: tile.y });
        break;
      case 'wire':
        dispatch(
          action.wire === WIRE.none
            ? { type: 'remove_wire', x: tile.x, y: tile.y }
            : { type: 'build_wire', x: tile.x, y: tile.y, wire: action.wire },
        );
        break;
      case 'fill':
        dispatch({ type: 'level_area', x: tile.x, y: tile.y, w: 1, h: 1, mode: 'fill' });
        break;
      case 'plantTrees':
        dispatch({ type: 'plant_trees', x: tile.x, y: tile.y });
        break;
      case 'bulldoze': {
        const buildingIdBefore =
          world.layers.buildingId[tile.y * world.size + tile.x] ?? 0;
        // A buldozer pod zemí bourá trubky, ne to, co stojí nad nimi. Ve vrstvě
        // elektřiny bourá vedení (T129): hráč se na něj dívá a míří na něj.
        const wireHere = (world.layers.wire[tile.y * world.size + tile.x] ?? 0) !== 0;
        const result =
          viewMode === 'underground'
            ? dispatch({ type: 'remove_pipe', x: tile.x, y: tile.y })
            : layerMode === 'power' && wireHere
              ? dispatch({ type: 'remove_wire', x: tile.x, y: tile.y })
              : dispatch({ type: 'bulldoze', x: tile.x, y: tile.y });
        undone = result.ok;
        // Silnice a stromy taky zvednou prach. Budova si svůj obláček zvedne
        // sama, až zmizí z mapy, a větší — dvakrát ji prášit nemá smysl.
        if (result.ok && viewMode !== 'underground' && buildingIdBefore === 0) {
          effects.dust({
            x: tile.x,
            y: tile.y,
            width: 1,
            depth: 1,
            base: tileBaseHeight(world.cornerHeight, tile.x, tile.y),
          });
        }
        break;
      }
      case 'zone':
        dispatch({ type: 'zone', x: tile.x, y: tile.y, w: 1, h: 1, zone: action.zone });
        break;
      case 'place': {
        const result = dispatch({
          type: 'place_building',
          definitionId: action.definitionId,
          x: tile.x,
          y: tile.y,
        });
        undone = result.ok;
        break;
      }
      case 'terraform': {
        if (action.delta === 0) {
          // Srovnává se **na výšku dlaždice, kde tah začal**, ne na průměr
          // každé dlaždice zvlášť. Autor to popsal takhle: „vezmu dlaždici
          // a táhnu, okolní nižší se zvednou, vyšší se sníží." Bez pevné
          // výšky se svah po tahu jen rozmazal — každá dlaždice si spočítala
          // svůj průměr a výsledek byl zase svah, jen mírnější.
          dispatch({
            type: 'level_area',
            x: tile.x,
            y: tile.y,
            w: 1,
            h: 1,
            ...(levelHeight === null ? {} : { height: levelHeight }),
          });
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

    // Nabídka „Zpět": u bourání vždycky, u stavby jen když stála dost.
    // U silnice za stovku by hláška jen překážela.
    if (undoKey !== null && undone && undoSnapshot !== null) {
      if (action.kind === 'bulldoze' || spent >= UNDO_PRICE) {
        undoBar.show(undoKey, undoSnapshot);
      }
    }
  }

  /**
   * Na jakou výšku srovnává právě probíhající tah. `null` mimo tah.
   *
   * Zapíše se při stisku z dlaždice pod kurzorem a drží se do puštění, takže
   * celý tah dá jednu rovinu.
   */
  let levelHeight: number | null = null;

  /**
   * Kde na obrazovce naposledy nástroj zabral.
   *
   * Slouží jako pojistka proti **dvojímu provedení jedním klikem**. Terén se
   * po zvednutí rohu posune o patro nahoru, takže pod nehybným kurzorem je
   * najednou jiná dlaždice — a kontrola „už jsem tuhle dlaždici maloval" to
   * nepozná. Stačí přitom nepatrné cuknutí myší při kliku a zvedne se o dvě.
   * Autor to nahlásil jako „velmi zhusta se mi stává, že jednou kliknu a
   * provedou se dvě akce".
   */
  let lastPaintX = 0;
  let lastPaintY = 0;

  /** O kolik pixelů se musí ukazatel posunout, než nástroj zabere podruhé. */
  const PAINT_STEP = 10;

  /**
   * Prst, kterým se právě míří budovou. `null`, když se nemíří.
   *
   * Na dotyku se budova **nepokládá při doteku, ale při zvednutí prstu**.
   * Autor: „silnice a zóny fungují dobře, ale budovy jsou špatně. Musí to
   * fungovat tak, že v okamžiku doteku se objeví částečně průhledná budova,
   * která má být umístěna, a spolu s ní se bíle vysvítí oblast, kde by zrovna
   * měla být. Táhnutím prstu se ta pozice může měnit. Po zvednutí prstu se
   * teprve budova umístí."
   *
   * Důvod je prostý a myší se nedá zažít: **prst kryje přesně to místo, na
   * které míří.** Kdo staví naslepo, staví vedle — a zaplatí za to.
   *
   * Silnic a zón se to netýká schválně. Ty se kreslí tažením a hráč u nich
   * vidí, co vzniká, protože roste za prstem, ne pod ním.
   */
  let aimingPointer: number | null = null;

  /**
   * Prsty na plátně.
   *
   * Dva znamenají **kameru**: posouvá se jejich středem a přibližuje jejich
   * vzdáleností, ať má hráč v ruce jakýkoli nástroj. Do teď posun umělo jen
   * pacička, takže delší silnice na telefonu znamenala pořád přepínat mezi
   * nástrojem a rukou.
   */
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; x: number; y: number } | null = null;

  /** Podržení prstu otevře kartu parcely, ať je vybraný jakýkoli nástroj. */
  let longPress: { x: number; y: number; timer: number } | null = null;

  /**
   * Město před rozdělaným tahem, pro „Zpět". `null` mimo tah.
   *
   * Bere se jednou na začátek tahu, takže tažení buldozerem se vrátí celé.
   */
  let undoSnapshot: Uint8Array | null = null;

  /**
   * Zahodí, co prst rozdělal: míření budovou, malování i tažení.
   *
   * Tohle je ten důvod, proč se gesto dvěma prsty **nepere s kreslením**
   * (`docs/15-MOBIL.md`): druhý prst znamená „chci se rozhlédnout", ne
   * „postav zónu odtud až sem".
   */
  function cancelTouchAction(): void {
    cancelLongPress();
    dragAnchor = null;
    paintButton = null;
    lastPaintedTile = -1;
    levelHeight = null;
    panStartedAt = null;

    if (aimingPointer !== null) {
      if (canvas.hasPointerCapture(aimingPointer)) canvas.releasePointerCapture(aimingPointer);
      aimingPointer = null;
    }
    if (dragPointerId !== null) {
      if (canvas.hasPointerCapture(dragPointerId)) canvas.releasePointerCapture(dragPointerId);
      dragPointerId = null;
    }
    hoveredTile = null;
  }

  function beginGesture(): void {
    cancelTouchAction();

    const [first, second] = [...touches.values()];
    if (!first || !second) return;
    pinch = {
      distance: Math.hypot(first.x - second.x, first.y - second.y),
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
  }

  function updateGesture(): void {
    const [first, second] = [...touches.values()];
    if (pinch === null || !first || !second) return;

    const x = (first.x + second.x) / 2;
    const y = (first.y + second.y) / 2;
    const distance = Math.hypot(first.x - second.x, first.y - second.y);

    pan(camera, x - pinch.x, y - pinch.y);
    // Přibližuje se **k místu mezi prsty**, ne ke středu obrazovky: bod, který
    // hráč drží, má pod prsty zůstat.
    if (pinch.distance > 0 && distance > 0) {
      const rect = canvas.getBoundingClientRect();
      zoomAt(
        camera,
        distance / pinch.distance,
        x - rect.left,
        y - rect.top,
        app.screen.width,
        app.screen.height,
      );
    }

    pinch = { distance, x, y };
  }

  function startLongPress(event: PointerEvent): void {
    const tile = tileAt(event);
    cancelLongPress();
    if (!tile) return;

    const at = { x: tile.x, y: tile.y };
    longPress = {
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        longPress = null;
        // Rozdělaná akce se zahodí, takže zvednutí prstu už nic nepostaví.
        cancelTouchAction();
        showBuildingAt(at);
      }, LONG_PRESS_MS),
    };
  }

  function cancelLongPress(): void {
    if (longPress === null) return;
    window.clearTimeout(longPress.timer);
    longPress = null;
  }

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    // Nový tah, nový snímek pro „Zpět" (bere si ho `applyTool`).
    undoSnapshot = null;

    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size >= 2) {
        beginGesture();
        return;
      }
      // Dlouhý stisk se **nezakládá u nástroje, který už zabral**: jinak se
      // akce provedla a nad zbouranou parcelou se pak ještě otevřela její
      // karta (T-revize, nález 19). Míření prstem akci odkládá až na zvednutí,
      // takže tam dlouhý stisk smysl dává — ten ji zruší.
      if (!actsOnTouchDown(event)) startLongPress(event);
    }

    if (isPanButton(event)) {
      dragPointerId = event.pointerId;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      capturePointer(event.pointerId);
      const tile = activeTool.action.kind === 'pan' ? tileAt(event) : null;
      panStartedAt = tile ? { x: event.clientX, y: event.clientY, tile } : null;
      return;
    }

    const tile = tileAt(event);
    if (!tile) return;

    if (event.button === 2) {
      showBuildingAt(tile);
      return;
    }

    if (triggerArmedDisaster(tile)) return;
    if (pickTransitStop(tile)) return;

    paintButton = event.button;
    lastPaintedTile = tile.y * world.size + tile.x;
    lastPaintX = event.clientX;
    lastPaintY = event.clientY;
    levelHeight =
      activeTool.action.kind === 'terraform' && activeTool.action.delta === 0
        ? tileBaseHeight(simWorld.cornerHeight, tile.x, tile.y)
        : null;

    // Nástroje s náhledem se použijí až při puštění; ostatní hned.
    if (dragKind() !== null) {
      dragAnchor = { x: tile.x, y: tile.y };
      // Dlaždice pod ukazatelem se nastaví **hned při stisku** (T-revize,
      // nález 15). Do teď se plnila až pohybem, takže jedno klepnutí prstem
      // dalo tah nulové délky, prázdný seznam dlaždic a vůbec žádný příkaz:
      // hráč klepl na místo pro jeden kus ulice a nestalo se nic, ani hláška.
      // Myší to fungovalo jen proto, že kurzor po mapě jezdí i bez stisku.
      hoveredTile = { x: tile.x, y: tile.y };
      // Tažení si zachytí ukazatel, aby přežilo přejezd přes lištu nástrojů
      // (T-revize, nález 20). Panely mají zapnutý příjem kliknutí, takže
      // plátno jinak dostane „ukazatel odešel" a rozdělaný tah se zahodil
      // bez hlášky i bez výsledku.
      capturePointer(event.pointerId);
      return;
    }

    // Budova prstem: míří se, dokud je prst dole, a staví se až po zvednutí.
    // Zachycení ukazatele je nutné — bez něj přestanou chodit `pointermove`,
    // jakmile prst opustí místo, kde začal.
    if (aimsWithFinger(event)) {
      aimingPointer = event.pointerId;
      // Malování tažením se musí vypnout, jinak by prst při míření postavil
      // budovu na každé dlaždici, přes kterou přejede.
      paintButton = null;
      // Míří se **nad prst**, ne pod něj: bříško kryje přesně tu dlaždici, na
      // kterou ukazuje, takže i s náhledem stavěl hráč naslepo.
      hoveredTile = tileAt(event, AIM_LIFT) ?? tile;
      pointerX = event.offsetX;
      pointerY = event.offsetY;
      capturePointer(event.pointerId);
      return;
    }

    // Malování tažením si ukazatel zachytí ze stejného důvodu jako tažení:
    // přejezd přes lištu nástrojů nemá tah zabít (nález 20).
    capturePointer(event.pointerId);
    applyTool(tile, event.offsetX, event.offsetY);
  });

  /**
   * Mění tenhle nástroj svět **jedním klepnutím**?
   *
   * Silnice, potrubí a zóny sem nepatří: ty se kreslí tažením a mají vlastní
   * cestu. Zbytek — stavba, buldozer, zvedání a snižování rohu, srovnání,
   * sázení lesa — zabere okamžitě, a proto se na dotyku míří nad prst.
   */
  function instantTool(): boolean {
    const kind = activeTool.action.kind;
    return (
      kind === 'place' ||
      kind === 'bulldoze' ||
      kind === 'terraform' ||
      kind === 'fill' ||
      kind === 'plantTrees'
    );
  }

  /**
   * Míří se tímhle stiskem prstem?
   *
   * Do T-revize to platilo **jen pro budovy**. Buldozer, zvedání rohu,
   * srovnání i les zabraly v okamžiku doteku a na dlaždici, kterou prst kryje
   * — u rohu navíc na cíl velký pár pixelů. Hráč neviděl ani náhled, ani cenu,
   * a bořil naslepo. Rozdíl mezi „ukazuje se" a „koná se" přitom nemá být
   * v tom, který nástroj to je (nález 19).
   */
  function aimsWithFinger(event: PointerEvent): boolean {
    return event.pointerType === 'touch' && event.button === 0 && instantTool();
  }

  /** Zabere nástroj pod tímhle prstem hned při doteku? */
  function actsOnTouchDown(event: PointerEvent): boolean {
    return event.pointerType === 'touch' && instantTool();
  }

  /**
   * Zachytí ukazatel, pokud to jde.
   *
   * Zachycení smí selhat (prst, který mezitím zmizel), a padat kvůli tomu do
   * hlášky „chyba v běhu hry" je horší než tah, který se hůř drží.
   */
  function capturePointer(pointerId: number): void {
    try {
      canvas.setPointerCapture(pointerId);
    } catch {
      // Nic. Sáhnout po výjimce je tu jediná rozumná reakce.
    }
  }

  /** Uvolní zachycení, jen když opravdu platí. Druhé uvolnění je výjimka. */
  function releasePointer(pointerId: number): void {
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  }

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') {
      const point = touches.get(event.pointerId);
      if (point) {
        point.x = event.clientX;
        point.y = event.clientY;
      }
      if (pinch !== null) {
        updateGesture();
        return;
      }
      // Prst, který se rozjel, už nic nedrží.
      if (
        longPress !== null &&
        Math.abs(event.clientX - longPress.x) + Math.abs(event.clientY - longPress.y) > CLICK_SLOP
      ) {
        cancelLongPress();
      }
    }

    if (dragPointerId === event.pointerId) {
      pan(camera, event.clientX - lastPointerX, event.clientY - lastPointerY);
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
    }

    hoveredTile = aimingPointer === event.pointerId ? tileAt(event, AIM_LIFT) : tileAt(event);
    pointerX = event.offsetX;
    pointerY = event.offsetY;

    // Malování tažením: dokud je tlačítko dole, každá nová dlaždice dostane
    // stejný nástroj. Bez toho by se zóna vyznačovala klikáním po jedné.
    if (paintButton !== null && hoveredTile && dragAnchor === null) {
      const tile = hoveredTile.y * world.size + hoveredTile.x;
      // **Dvě podmínky, ne jedna.** Jiná dlaždice sama nestačí: terén se pod
      // kurzorem hýbe, takže po zvednutí rohu ukazuje myš na jinou dlaždici,
      // aniž by se hnula. Proto se ještě žádá skutečný posun ukazatele.
      const moved =
        Math.abs(event.clientX - lastPaintX) + Math.abs(event.clientY - lastPaintY);
      if (tile !== lastPaintedTile && moved >= PAINT_STEP) {
        lastPaintedTile = tile;
        lastPaintX = event.clientX;
        lastPaintY = event.clientY;
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
    if (action.kind !== 'road' && action.kind !== 'pipe' && action.kind !== 'wire') return;

    /*
     * Nejdřív se **sečte**, teprve pak staví (T-revize, nález 14).
     *
     * Kontrola peněz je uvnitř jedné dlaždice, takže se tažení dálnice přes
     * dvacet polí stavělo do vyčerpání kasy: hráči zbyla půl silnice a nula.
     * Půl silnice není levnější silnice, jsou to zmařené peníze — zóna se
     * proto pokládá atomicky a tažení to má mít stejné.
     */
    const balance = content.getBalance();
    const price =
      action.kind === 'road'
        ? tiles.reduce(
            (sum, tile) => sum + estimateRoad(world, tile.x, tile.y, action.roadType, balance).total,
            0,
          )
        : (activeTool.cost ?? 0) * tiles.length;

    if (price > world.economy.funds) {
      notifications.show(
        i18n.t('error.notEnoughFunds', { cost: price, funds: world.economy.funds }),
      );
      return;
    }

    // Snímek pro „Zpět": nejdražší gesto ve hře ho do teď nemělo, přestože
    // jediná budova za 2 000 ho dostane. Bere se jen u tahu, který stojí dost
    // — u tří dlaždic ulice by nabídka jen překážela.
    const snapshot = price >= UNDO_PRICE ? undoSnapshotNow() : null;

    let complained = false;
    let built = 0;
    for (const tile of tiles) {
      const command: Command =
        action.kind === 'pipe'
          ? { type: 'build_pipe', x: tile.x, y: tile.y }
          : action.kind === 'wire'
            ? action.wire === WIRE.none
              ? { type: 'remove_wire', x: tile.x, y: tile.y }
              : { type: 'build_wire', x: tile.x, y: tile.y, wire: action.wire }
            : { type: 'build_road', x: tile.x, y: tile.y, roadType: action.roadType };
      const result = host.dispatch(command);
      if (result.ok) built++;
      else if (!complained && !isRoutine(result.reason)) {
        complained = true;
        report(result);
      }
    }

    if (snapshot !== null && built > 0) undoBar.show('ui.undo.drawn', snapshot);
  }

  function endDrag(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      touches.delete(event.pointerId);
      cancelLongPress();
      if (pinch !== null) {
        // Gesto skončí, až zůstane jediný prst — a ten už nic nestaví.
        pinch = touches.size < 2 ? null : pinch;
        if (pinch !== null) beginGesture();
        return;
      }
    }

    /*
     * Zvednutí prstu **postaví** to, na co se mířilo.
     *
     * Bere se poslední dlaždice pod prstem, ne ta, kde dotek začal: celý smysl
     * míření je, že se pozice dá tažením opravit. Náhled se pak schová hned,
     * ať po zvednutí prstu nezůstane viset průhledný dům bez majitele.
     */
    if (aimingPointer === event.pointerId) {
      aimingPointer = null;
      releasePointer(event.pointerId);
      const tile = hoveredTile;
      hoveredTile = null;
      paintButton = null;
      // Bod na obrazovce se posouvá **o tentýž zdvih jako dlaždice**. Bez toho
      // by zvedání rohu sáhlo po rohu pod prstem, ne po tom v zaměřené
      // dlaždici, a bublina s cenou by vyskočila jinde než náhled.
      if (event.type === 'pointerup' && tile) applyTool(tile, pointerX, pointerY - AIM_LIFT);
      return;
    }

    if (dragAnchor !== null && paintButton === 0) {
      commitDrag();
    }
    dragAnchor = null;
    paintButton = null;
    lastPaintedTile = -1;
    levelHeight = null;
    releasePointer(event.pointerId);
    if (dragPointerId !== event.pointerId) return;
    dragPointerId = null;

    // Pacička: klik bez tažení otevře detail, stejně jako pravé tlačítko.
    // Měří se posun ukazatele, ne to, jestli se změnila dlaždice — hráč může
    // mapou posunout o kus a skončit nad toutéž dlaždicí, a to výběr není.
    const start = panStartedAt;
    panStartedAt = null;
    if (!start) return;
    const moved = Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y);
    if (moved > CLICK_SLOP) return;

    // Klik pacičkou dělá totéž co klik čímkoli jiným — jen se to rozhodne až
    // tady, protože do posledního okamžiku mohl být začátkem tažení.
    //
    // Bez tohohle se **pacičkou nedala vybrat zastávka ani umístit ručně
    // spuštěná katastrofa**: obojí se vyhodnocuje na stisknutí, jenže pacička
    // se z toho místa vracela dřív. Hráč klikl na stanici metra a místo
    // přidání na linku se mu otevřel rozbor parcely. Hlásil to autor.
    if (triggerArmedDisaster(start.tile)) return;
    if (pickTransitStop(start.tile)) return;
    showBuildingAt(start.tile);
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', (event) => {
    // Míření prstem má zachycený ukazatel a `pointerleave` mu chodí i tehdy,
    // když prst z plátna neodešel. Zhasnout ho tady by náhled zabilo hned
    // v první milisekundě tahu.
    if (aimingPointer !== null) return;
    // Totéž platí pro rozdělané tažení a malování: dokud ukazatel drží
    // zachycení, „odešel" znamená jen to, že přejel přes lištu položenou na
    // mapě — a zahozený tah bez hlášky i bez výsledku byla ta horší varianta
    // (T-revize, nález 20). Zrušit se má, teprve když zachycení neplatí.
    if (canvas.hasPointerCapture(event.pointerId)) return;
    hoveredTile = null;
    paintButton = null;
    panStartedAt = null;
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

  /**
   * Píše hráč právě do pole, nebo drží posuvník?
   *
   * Šipky a mezerník se zpracovávaly a zakazovaly dřív, než se vůbec zjistilo,
   * kde je fokus — takže ťuknutí do výše půjčky klávesou nahoru posunulo mapu
   * a posuvníkem financování nešlo hnout (T-revize, nález 39). Panování mapou
   * má ustoupit tomu, kdo něco píše.
   */
  function typingSomewhere(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  window.addEventListener('keydown', (event) => {
    const typing = typingSomewhere(event.target);

    if (event.code === 'Space') {
      // Řeší se před kontrolou HUDu: mezerník musí panovat i tehdy, když má
      // fokus tlačítko v panelu. `preventDefault` zabrání tomu, aby tlačítko
      // mezerník zmáčkl a aby stránka odrolovala.
      if (typing) return;
      event.preventDefault();
      spaceDown = true;
      return;
    }

    if (PAN_KEYS[event.code]) {
      if (typing) return;
      // Šipky by jinak odrolovaly stránku.
      event.preventDefault();
      panKeys.add(event.code);
      return;
    }

    // Ostatní klávesy nesmí zasahovat do ovládání prvků v HUDu.
    if (event.target instanceof HTMLElement && event.target.closest('.hud')) return;

    if (event.code === 'F5' || event.code === 'F9') {
      event.preventDefault(); // jinak by F5 obnovilo stránku
      if (event.code === 'F5') void quickSaveNow();
      else void quickLoadNow();
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
      // **Nejdřív modální okno, teprve pak karta parcely** (T-revize,
      // nález 26). Roční uzávěrka se přes obrazovku otevřela, hru zastavila
      // a zavřít ji šlo jedině myší: Escape ji neznal a v okně nebylo nic
      // zaostřeného, takže nefungoval ani Enter.
      if (yearReport.isVisible()) {
        yearReport.close();
        return;
      }
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
  // už neprobudí. Samo o sobě to ale **nestačí**: kdo hraje tři hodiny v jedné
  // kartě a spadne mu prohlížeč, měl v úložišti stav z chvíle, kdy naposledy
  // přepnul panel (T-revize, nález 3). Od toho je odpočet v `renderFrame`.
  window.addEventListener('pagehide', () => autosaveNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') autosaveNow();
  });

  // Běhový stav hlášení se srovná i na startu, ať je ta invariance na jednom
  // místě a nespoléhá na to, že se pole náhodou zakládají prázdná.
  resetRuntimeNotices();

  // Ladicí přístup **jen ve vývoji** (T115): testovací skript v headless
  // prohlížeči staví přes něj město a posouvá kameru, aby šlo animace
  // nasnímat bez klikání do lišty. Do produkčního buildu se nedostane —
  // Vite `import.meta.env.DEV` ve buildu nahradí `false` a větev vypadne.
  if (import.meta.env.DEV) {
    (window as unknown as { __citybuilder?: unknown }).__citybuilder = {
      dispatch: (command: Command) => host.dispatch(command),
      world,
      camera,
      setSpeed,
      load: (base64: string) =>
        loadFromBytes(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))),
      startDisaster: (kind: string, x: number, y: number) =>
        startDisaster(simWorld, content, content.getBalance(), disasterRegistry, kind, x, y),
    };
  }

  app.ticker.add((ticker) => {
    try {
      renderFrame(ticker.deltaMS);
    } catch (error) {
      // Výjimka ve smyčce by jinak zmizela v konzoli. Stejná hláška se
      // v bublinách nehromadí, jen si přičte počet.
      reportCrash(error instanceof Error ? error.message : String(error));
    }
  });

  /**
   * Život u budov služeb (T118): policejní auto vyjede na obchůzku, sanitka
   * a hasiči občas taky, od spalovny a skládky jezdí popeláři.
   *
   * Každá budova má vlastní odpočet, odvozený z id, takže se stanice
   * nerozjedou všechny naráz. Jezdí jen budovy ve výřezu — auto, které
   * nikdo neuvidí, se nepočítá.
   */
  const serviceClocks = new Map<number, number>();
  function dispatchServiceVehicles(elapsed: number, view: MotionView): void {
    if (elapsed <= 0 || serviceLooks.size === 0) return;
    const range = tilesIn(view, world.size);
    for (const [id, building] of world.buildings) {
      if (building.abandoned) continue;
      if (building.x < range.x0 || building.x > range.x1 || building.y < range.y0 || building.y > range.y1) {
        continue;
      }
      const definition = content.get(building.definitionId);
      if (definition === undefined) continue;
      const service = WASTE_SITES.has(building.definitionId) ? 'waste' : definition.service?.class;
      const look = service === undefined ? undefined : serviceLooks.get(service);
      if (look === undefined) continue;
      const spread = ((id * 0.618034) % 1 + 1) % 1;
      const left = (serviceClocks.get(id) ?? 4000 + spread * 20000) - elapsed;
      if (left > 0) {
        serviceClocks.set(id, left);
        continue;
      }
      const [width, depth] = definition.footprint;
      vehicles.dispatch(look, building.x, building.y, width, depth, 6 + Math.floor(spread * 10));
      serviceClocks.set(id, 18000 + spread * 30000);
    }
  }

  function renderFrame(deltaMS: number): void {
    host.step(deltaMS);

    /*
     * Automatické ukládání **i během hry** (nález 3).
     *
     * Ověření savu se u periodického ukládání většinou přeskakuje: je to
     * druhý round-trip přes celé město a to, co hlídá — rozpor mezí mezi
     * posuvníkem a loaderem — se mezi dvěma minutami skoro nikdy nezmění.
     * „Skoro" je tu ale důležité: přesně takový rozpor uměl hráč vyrobit
     * posuvníkem financování, takže se každé páté uložení ověří celé.
     */
    autosaveDue -= deltaMS;
    if (autosaveDue <= 0) {
      autosaveDue = AUTOSAVE_EVERY_MS;
      autosaveRuns++;
      autosaveNow(autosaveRuns % AUTOSAVE_VERIFY_EVERY === 1);
    }

    // Hlásí se **po kroku**: pohroma, která právě vznikla, se má ohlásit
    // v témž snímku, ve kterém začala hořet, ne až v tom dalším.
    announceDisasters();
    announceFinance();

    // Uzávěrka roku. Okno se otevře jednou za rok a hru zastaví; katastrofa
    // má přednost, protože ta hoří teď.
    const closed = simWorld.economy.lastYear;
    if (closed && !alert.isVisible() && yearReport.show(closed, simWorld.economy.funds)) {
      setSpeed(0);
    }

    const dirty = host.consumeDirty();
    const viewport = viewportFor(
      camera.x,
      camera.y,
      camera.zoom,
      app.screen.width,
      app.screen.height,
    );
    chunkRenderer.update(dirty);
    // Peče se až tady a jen to, na co je vidět (R20). Musí to být po
    // `update()`, aby se změna z tohohle tiku promítla ještě v tomhle snímku.
    chunkRenderer.cull(viewport);
    roadRenderer.update(dirty);
    buildingRenderer.update(dirty);
    coarseOverlay.update(dirty.coarseChanged);
    // Síť se překresluje jen při změně terénu, posunu o blok nebo změně
    // měřítka — proto ten vlastní příznak vedle `tiles`.
    gridOverlay.update(dirty.heightsChanged, viewport, camera.zoom);
    // Značky se hýbou s budovami, ne s hrubou mřížkou.
    serviceMarkers.update(dirty.fullRedraw || dirty.buildings.size > 0);
    disasterScenes.update();
    trafficOverlay.update();
    wireOverlay.update(dirty.fullRedraw || dirty.tiles.size > 0);
    buildingRenderer.animate(deltaMS);
    buildingRenderer.sway(deltaMS, viewport, camera.zoom);
    placementGhost.animate(deltaMS);
    // Kouř jen z komínů ve výřezu; `viewport` je spočítaný výš pro chunky.
    if (viewMode !== 'underground') {
      effects.smoke(buildingRenderer.smokeSources(), deltaMS, viewport);
      fireLayer.update(deltaMS, viewport);
      effects.smoke(fireLayer.smokeSources(), deltaMS, viewport);
      // Kolik tiku uběhlo za tenhle snímek — tornádo mezi tiky dojíždí.
      disasterScenes.animate(deltaMS, (deltaMS * (SPEEDS[speedIndex] ?? 0)) / TICK_MS, motionOn);
    }
    effects.update(deltaMS);
    if (viewMode !== 'underground') {
      const speedFactor = [0, 1, 1.5, 2, 2.5][speedIndex] ?? 1;
      vehicles.update(deltaMS, speedFactor, viewport, camera.zoom);
      dispatchServiceVehicles(deltaMS * speedFactor, viewport);
      entrancesAge += deltaMS;
      if (entrancesAge > 1000) {
        entrancesAge = 0;
        entrances = transitEntrances();
      }
      people.update(deltaMS, speedFactor, viewport, camera.zoom, buildingRenderer.seatSpots(), entrances);
      waterGlints.update(deltaMS, viewport, camera.zoom);
    }

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

    // Kamera se srovnává **jednou za snímek**, ne v každé obsluze: posouvá ji
    // tažení, gesto dvěma prsty, šipky i zoom k bodu, a jedno místo se nedá
    // obejít zapomenutím.
    clampCamera(camera, cameraBounds());

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
      //
      // U silnice se počítá **po dlaždicích**: od T61 si vozovka umí vyklidit
      // les a srovnat sedlo, takže sazba za vozovku už není celá cena. Ostatní
      // nástroje mají cenu pevnou a sčítat se u nich nemá co.
      const road = activeTool.action.kind === 'road' ? activeTool.action.roadType : null;
      const each = activeTool.cost ?? 0;
      let total = each * tiles.length;

      if (road !== null) {
        total = tiles.reduce(
          (sum, tile) => sum + estimateRoad(world, tile.x, tile.y, road, content.getBalance()).total,
          0,
        );
      } else if (
        hoveredTile &&
        activeTool.action.kind === 'zone' &&
        activeTool.action.zone !== ZONE.none
      ) {
        // Zóna sama nic nestojí; platí se **srovnání terénu pod ní** (T67).
        // Počítá se za celý obdélník naráz, ne po dlaždicích: srovnání je jeden
        // plán přes celou plochu a součet po jedné by vyšel úplně jinak.
        const corner = hoveredTile;
        total = estimateZoning(
          world,
          Math.min(dragAnchor.x, corner.x),
          Math.min(dragAnchor.y, corner.y),
          Math.abs(corner.x - dragAnchor.x) + 1,
          Math.abs(corner.y - dragAnchor.y) + 1,
          content.getBalance(),
        );
      }

      if (total > 0 && tiles.length > 0) {
        priceTag.show(pointerX, pointerY, formatNumber(total));
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

      /*
       * **Kaskáda se ukáže dřív, než se klikne.**
       *
       * Zvednutí rohu táhne sousedy, aby si terén udržel spád po jedné úrovni,
       * a hráč hlásil „nevím, co všechno se stane, než kliknu". Odhad, ze
       * kterého se počítá cena, přesně tenhle seznam rohů vrací — tak se
       * rovnou nakreslí. Zasažené rohy slabě, ten pod kurzorem naplno.
       */
      const delta = activeTool.action.kind === 'terraform' ? activeTool.action.delta : 0;
      const plan = estimateCornerHeight(simWorld, corner.x, corner.y, delta, content.getBalance());
      const side = world.size + 1;
      for (const changed of plan.changes.keys()) {
        const cx = changed % side;
        const cy = (changed - cx) / side;
        if (cx === corner.x && cy === corner.y) continue;
        const spot = gridToScreen(cx, cy, world.cornerHeight[changed] ?? 0);
        const small = radius * 0.6;
        hover
          .poly([
            spot.x, spot.y - small,
            spot.x + small, spot.y,
            spot.x, spot.y + small,
            spot.x - small, spot.y,
          ])
          .fill({ color: CORNER_MARK_COLOR, alpha: 0.35 });
      }

      hover
        .poly([
          at.x, at.y - radius,
          at.x + radius, at.y,
          at.x, at.y + radius,
          at.x - radius, at.y,
        ])
        .fill({ color: CORNER_MARK_COLOR, alpha: 0.9 })
        .stroke({ color: 0x000000, alpha: 0.5, width: 1 / camera.zoom });

      // Cena předem, stejně jako u staveb: kaskáda se platí po rozích a hráč
      // má vědět kolik, ne to zjistit z kasy po kliknutí.
      if (plan.cost > 0) priceTag.show(pointerX, pointerY, formatNumber(plan.cost));
      else priceTag.hide();
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

    /*
     * Průhledný dům pod prstem.
     *
     * Podmínka je `aimingPointer`, ne „drží se budova": na myši nic
     * nezakrývá a rámeček stačí. Na dotyku je to naopak jediné, co hráč
     * o poloze ví, protože přesně to místo mu kryje prst.
     */
    const aimed = activeTool.action;
    if (aimingPointer !== null && hoveredTile && aimed.kind === 'place') {
      const [width, depth] = activeFootprint();
      placementGhost.show(
        aimed.definitionId,
        hoveredTile.x,
        hoveredTile.y,
        !placementFits(hoveredTile, width, depth),
      );
    } else {
      placementGhost.hide();
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
      if (broke) notifications.show(i18n.t('ui.notice.bankrupt'));
    }

    // Výroba a spotřeba proudu. Hráč do teď viděl jen zlomek „65/86" a neměl
    // jak zjistit, jestli mu chybí vedení, nebo elektrárna — dvě úplně jiné
    // opravy. Autor na to narazil s dvěma elektrárnami a dvaceti tmavými domy.
    let poweredBuildings = 0;
    let powerProduced = 0;
    let powerNeeded = 0;
    // Odpad a kanalizace se do teď **nikde nezobrazovaly**, přestože rozhodují
    // o znečištění celé mapy: nepokrytý zbytek se rozlije do každé buňky.
    // Autor to popsal takhle: „odpady vůbec nikde nevidím, nevnímám, že by
    // měly nějaký efekt." Čte se to stejně jako proud — kapacita / potřeba.
    /*
     * Odstavená elektrárna se do kapacity **nepočítá**.
     *
     * Autor poslal město, kde HUD hlásil 498 800 / 315 850 — tedy velkou
     * rezervu — a přitom byla půlka města potmě a metro stálo. Kaskáda
     * blackoutu měla dole 42 elektráren, jenže tenhle součet je bral jako
     * kdyby jely. Číslo, které během výpadku tvrdí, že je proudu dost, je
     * horší než žádné: hráč podle něj hledá chybu úplně jinde.
     */
    let powerOffline = 0;
    for (const [id, building] of world.buildings) {
      if (building.powered) poweredBuildings++;
      if (building.abandoned) continue;
      const definition = content.get(building.definitionId);
      const produced = definition?.power?.production ?? 0;
      if (produced > 0 && simWorld.disasters.offlinePlants.has(id)) powerOffline += produced;
      else powerProduced += produced;
      powerNeeded += definition?.power?.consumption ?? 0;
    }

    // Hlásí se při změně počtu odstavených elektráren, ne každý snímek: během
    // kaskády jich ubývá po jedné a hráč má vidět, že se to hýbe.
    if (powerOffline !== lastPowerOffline) {
      lastPowerOffline = powerOffline;
      if (powerOffline > 0) {
        notifications.show(
          i18n.t('ui.notice.plantsOffline', { capacity: formatNumber(powerOffline) }),
        );
      }
    }
    const utilities = cityUtilities(simWorld, content, content.getBalance());

    /*
     * Hlášky o překročené kapacitě.
     *
     * Hlásí se **při přechodu**, ne každý snímek, přesně jako nedostatek
     * proudu. Bez nich se hráč o tom, že mu čistička nestačí, nedozvěděl
     * vůbec — a přitom je to největší zdroj znečištění ve hře: co se
     * nezpracuje, rozlije se rovnoměrně po celé mapě.
     */
    for (const [key, capacity, needed] of [
      ['waste', utilities.wasteCapacity, utilities.wasteNeeded],
      ['sewage', utilities.sewageCapacity, utilities.sewageNeeded],
      ['water', utilities.waterCapacity, utilities.waterNeeded],
    ] as const) {
      const short = needed > capacity;
      if (short === utilityShortage[key]) continue;
      utilityShortage[key] = short;
      if (!short) continue;
      notifications.show(
        i18n.t(`ui.notice.${key}Shortage`, {
          capacity: formatNumber(capacity),
          needed: formatNumber(needed),
        }),
      );
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
        );
      }
    }

    hud.update({
      powerProduced,
      powerNeeded,
      wasteCapacity: utilities.wasteCapacity,
      wasteNeeded: utilities.wasteNeeded,
      sewageCapacity: utilities.sewageCapacity,
      sewageNeeded: utilities.sewageNeeded,
      waterCapacity: utilities.waterCapacity,
      waterNeeded: utilities.waterNeeded,
      // Rozpad poptávky se počítá tady, ne v HUD: potřebuje katalog i balanc.
      demandTerms: explainDemand(simWorld, content, content.getBalance()),
      speedIndex,
      layer: layerMode,
      view: viewMode,
      budgetVisible: budgetPanel.isVisible(),
      advisorVisible: advisorPanel.isVisible(),
      financeVisible: financePanel.isVisible(),
      transitVisible: transitPanel.isVisible(),
      disastersEnabled: simWorld.disasters.enabled,
      ghost: ghostBuildings,
      decor: decorVisible,
      motion: motionOn,
      grid: gridVisible,
      poweredBuildings,
      funding: simWorld.serviceFunding,
      message: message ? i18n.t(message.key, message.params) : '',
      autosaveMinutesAgo:
        lastAutosaveAt === 0 ? null : Math.floor((Date.now() - lastAutosaveAt) / 60000),
    });

    // Rozpis údaje z lišty. Taky jen když je otevřený — rozpad spokojenosti
    // projde všechny buňky a to není práce na každý snímek.
    const openStat = statPanel.openKey();
    if (openStat !== null) {
      statPanel.update(
        explainStat(simWorld, content, content.getBalance(), openStat as ExplainedStat),
      );
    }
    // Poradce se počítá, jen když je otevřený: prochází budovy, buňky i pokrytí
    // všech tříd, což je práce na úrovni jednoho systému, ne popisku.
    if (advisorPanel.isVisible()) {
      advisorPanel.update(cityAdvice(simWorld, content, content.getBalance(), serviceClasses));
    }
    // Rozpočet se počítá jen když se na něj někdo dívá.
    if (budgetPanel.isVisible()) {
      budgetPanel.update(computeBudget(simWorld, content, content.getBalance()), simWorld.economy.funds);
    }
    financePanel.update(simWorld, content.getBalance());
    transitPanel.update(simWorld, content, content.getBalance());

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
