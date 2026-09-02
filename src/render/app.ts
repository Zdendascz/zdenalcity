import { Application, Assets, Container, Graphics } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { TerrainDecor } from './decor';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import {
  applySaveToWorld,
  collectLoadWarnings,
  readSaveMeta,
  unpackSave,
} from '@/save/deserialize';
import { checkFootprint } from '@/sim/buildings';
import { estimatePlacement, estimateRoad, estimateZoning } from '@/sim/commands';
import { explainParcel, growthBlocker, worstBlocker } from '@/sim/diagnostics';
import { migrate } from '@/save/migrations';
import { serializeSave } from '@/save/serialize';
import type { Command } from '@/sim/commands';
import type { CommandResult } from '@/sim/result';
import { cornerIndex, tileCorners } from '@/sim/heights';
import { index, TERRAIN, ZONE } from '@/sim/layers';
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
import { coarseCellsOf } from '@/sim/coarse';
import { createWorld, NEUTRAL_HAPPINESS } from '@/sim/world';
import { BudgetPanel } from '@/ui/budgetPanel';
import { BuildingInfo } from '@/ui/buildingInfo';
import { FinancePanel } from '@/ui/financePanel';
import { TransitPanel } from '@/ui/transitPanel';
import { CostPopup } from '@/ui/costPopup';
import { PriceTag } from '@/ui/priceTag';
import { Notifications } from '@/ui/notifications';
import { formatNumber } from '@/ui/format';
import { Hud } from '@/ui/hud';
import { setIconImages } from '@/ui/icons';
import type { OverlayOption } from '@/ui/hud';
import { I18n, pickLanguage } from '@/ui/i18n';
import type { LocaleTables } from '@/ui/i18n';
import { createBrowserPlatform } from '@/platform';
import { DisasterAlert, nextToAnnounce } from '@/ui/disasterAlert';
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

function createAppearanceLookup(content: ContentRegistry): AppearanceLookup {
  return (definitionId, buildingId) => {
    const definition = content.get(definitionId);
    if (!definition) return undefined;
    const icon = definition.graphics.icon;

    const variant = variantFor(content.getSpriteVariants(definitionId), buildingId);
    const sprite = variant === undefined ? undefined : content.getSprite(definitionId, variant);

    return {
      color: Number.parseInt(definition.graphics.color.slice(1), 16),
      heightLevels: definition.graphics.heightLevels,
      footprint: definition.footprint,
      consumesPower: (definition.power?.consumption ?? 0) > 0,
      ...(icon === undefined ? {} : { icon }),
      ...(sprite === undefined ? {} : { sprite }),
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
            // **Natažení okraje, ne opakování.** Na svahu není dlaždice
            // rovnoběžník, takže afinní matice sáhne kousek za okraj textury.
            // S výchozím režimem tam karta vrátí průhlednou (černé klíny
            // u pobřeží), s opakováním skočí na protější okraj a udělá šev.
            texture.source.addressMode = 'clamp-to-edge';
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
            texture.source.addressMode = 'clamp-to-edge';
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

/** Kolik variant předmětu se smí načíst. Týž strop karty jako u povrchů. */
const DECOR_VARIANT_LIMIT = 2;

/**
 * Kolik variant od druhu terénu se smí načíst. Viz `loadSurfaces` — je to strop
 * daný kartou, ne volba vzhledu.
 */
const SURFACE_VARIANT_LIMIT = 1;

/** Druhy terénu, ke kterým se hledá obrázek. Sedí na `TERRAIN` v `sim/layers.ts`. */
const TERRAIN_NAMES = ['grass', 'water', 'sand', 'rock', 'forest', 'marsh'] as const;

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

  // Hra začíná dialogem: hráč si vybere jméno města a seed a rovnou vidí, jakou
  // mapu dostane (§3 fáze 3). Teprve pak vzniká svět.
  // Úložiště i soubory jdou přes platform vrstvu (§9). Herní kód nesahá na
  // `localStorage` ani `Blob` — až přijde Electron, přibude jiná implementace
  // a tady se nezmění nic.
  const platform = createBrowserPlatform();

  const newGame = await showNewGameDialog(mount, i18n, content.getBalance(), {
    canResume: await platform.storage.has('autosave'),
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
  disasterRegistry.register(createPileupDisaster());
  disasterRegistry.register(createStrikeDisaster());
  disasterRegistry.register(createRiotDisaster());
  disasterRegistry.register(createGangWarDisaster());
  disasterRegistry.register(createBlackoutDisaster());
  disasterRegistry.register(createEpidemicDisaster());
  disasterRegistry.register(createChemicalSpillDisaster());
  disasterRegistry.register(createLandslideDisaster());

  // Obnovení rozehraného města. Nečitelný autosave se **zahodí a hra začne
  // nové město** — spadnout na startu kvůli poškozenému úložišti by znamenalo,
  // že se hráč do hry nedostane vůbec.
  let cityName = newGame.cityName;
  const resumed = newGame.resume ? await platform.storage.read('autosave') : null;
  let restored = false;
  if (resumed) {
    try {
      applySaveToWorld(simWorld, migrate(unpackSave(resumed)));
      cityName = readSaveMeta(resumed).city.name;
      restored = true;
    } catch {
      void platform.storage.remove('autosave');
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
  // Silnice a potrubí se sem **záměrně nedávají**. Jejich dlaždice existují,
  // ale 42 ze 64 má vozovku jinde, než má, takže by na každém spoji uskakovala.
  // Rozhodnutí, co s tím, je v `docs/08-DLAZDICE.md`.
  void loadSurfaces(content).then((surfaces) => {
    if (surfaces.size > 0) chunkRenderer.setSurfaces(surfaces);
  });
  void loadDecor(content).then((decor) => {
    if (decor.size > 0) buildingRenderer.setDecor(decor);
  });
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
  const financePanel = new FinancePanel(mount, i18n, dispatch);
  const transitPanel = new TransitPanel(mount, i18n, dispatch, {
    onPickStop: (lineId) => {
      message = { key: 'ui.transit.pickHint', params: { id: lineId } };
    },
    onCancelPick: () => {
      message = null;
    },
  });
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
   */
  function dispatch(cmd: Command): CommandResult {
    const result = host.dispatch(cmd);
    if (!result.ok) notifications.show(i18n.t(result.reason, result.params));
    return result;
  }

  function reportCrash(message: string): void {
    notifications.show(i18n.t('error.crash', { message }), 'error');
  }

  window.addEventListener('error', (event) => reportCrash(event.message));
  window.addEventListener('unhandledrejection', (event) => reportCrash(String(event.reason)));

  const startedAt = Date.now();
  const createdAt = new Date(startedAt).toISOString();
  /** Rychlý save drží jen v paměti; do souboru se ukládá tlačítkem. */
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
      // Bez `await`: na `pagehide` už není kam čekat. Zápis v prohlížeči běží
      // synchronně, takže se stihne — a kdyby jednou neběžel, je to věc
      // platform vrstvy, ne tohohle místa.
      void platform.storage.write('autosave', serializeSave(simWorld, saveOptions()));
    } catch {
      // Rozehranou hru neshodí ani plné úložiště.
    }
  }

  async function quickSaveNow(): Promise<void> {
    const bytes = serializeSave(simWorld, saveOptions());
    const stored = await platform.storage.write('quick', bytes);
    // Rychlý save **přežije obnovení stránky**. Když se uložit nepovede, hráč
    // to musí vědět hned — jinak by se na něj spolehl a přišel o město.
    message = stored
      ? { key: 'ui.save.saved', params: { size: (bytes.byteLength / 1024).toFixed(1) } }
      : { key: 'ui.save.storeFailed' };
  }

  async function quickLoadNow(): Promise<void> {
    const bytes = await platform.storage.read('quick');
    if (!bytes) {
      message = { key: 'ui.save.empty' };
      return;
    }
    loadFromBytes(bytes);
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
    if (!alert.open(disaster.kind, disaster.x, disaster.y)) return;
    announced.add(disaster.id);
    setSpeed(0);
  }

  /** Srovná kameru na dlaždici, ať je uprostřed obrazovky. */
  function centreOn(x: number, y: number): void {
    const point = gridToScreen(x, y);
    camera.x = point.x;
    camera.y = point.y;
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

    // Jméno souboru obrázku je **dočasné** — autor podle něj kontroluje
    // vygenerované varianty ručně. Počítá se stejnou cestou jako v rendereru,
    // aby ukazovalo opravdu ten obrázek, který je na mapě vidět.
    const spriteVariant = building
      ? variantFor(content.getSpriteVariants(building.definitionId), building.id)
      : undefined;
    const spriteFile =
      building && spriteVariant !== undefined
        ? (content.getSprite(building.definitionId, spriteVariant)?.url ?? null)
        : null;

    buildingInfo.show(
      simWorld,
      parcel,
      building,
      building ? content.get(building.definitionId) : undefined,
      growthBlocker(simWorld, content, content.getBalance(), tile.x, tile.y),
      spriteFile,
    );
  }

  const views = createViewOptions();
  const layers = createLayerOptions(content);

  let viewMode = 'surface';
  let layerMode = 'none';
  let ghostBuildings = false;
  let decorVisible = true;

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
    buildingRenderer.setDecorVisible(decorVisible);
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
    onQuickSave: () => void quickSaveNow(),
    onQuickLoad: () => void quickLoadNow(),
    onDownload: () => {
      const bytes = serializeSave(simWorld, saveOptions());
      platform.files.save(bytes, 'mesto.city');
      message = { key: 'ui.save.saved', params: { size: (bytes.byteLength / 1024).toFixed(1) } };
    },
    onOpenFile: (file) => {
      void platform.files.read(file).then(loadFromBytes);
    },
    onToggleLayer: toggleLayer,
    onSetView: setView,
    onToggleBudget: () => budgetPanel.toggle(),
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

    // Pacička: klik bez tažení otevře detail, stejně jako pravé tlačítko.
    // Měří se posun ukazatele, ne to, jestli se změnila dlaždice — hráč může
    // mapou posunout o kus a skončit nad toutéž dlaždicí, a to výběr není.
    const start = panStartedAt;
    panStartedAt = null;
    if (!start) return;
    const moved = Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y);
    if (moved <= CLICK_SLOP) showBuildingAt(start.tile);
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => {
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

    // Hlásí se **po kroku**: pohroma, která právě vznikla, se má ohlásit
    // v témž snímku, ve kterém začala hořet, ne až v tom dalším.
    announceDisasters();

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
      financeVisible: financePanel.isVisible(),
      transitVisible: transitPanel.isVisible(),
      disastersEnabled: simWorld.disasters.enabled,
      ghost: ghostBuildings,
      decor: decorVisible,
      poweredBuildings,
      funding: simWorld.serviceFunding,
      message: message ? i18n.t(message.key, message.params) : '',
    });

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
