import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { buildRoad, placeDefinition, zoneArea } from '@/sim/commands';
import { hashCoarseLayers } from '@/sim/coarse';
import { hashLayers, index, ROAD, TERRAIN, ZONE } from '@/sim/layers';
import { createDefaultSystems } from '@/sim/systems';
import { applyGeneratedMap, generateTerrain } from '@/sim/mapgen';
import {
  createWorld,
  rebuildTileIndex,
  tickWorld,
  totalJobs,
  totalPopulation,
} from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { assumeWatered } from '../support/water';
import { MAP_SIZE } from '../support/grid';

/**
 * Golden test **celého města**, ne jen silnic (architektura §12).
 *
 * Do téhle chvíle existoval jediný golden test a běžel bez systémů — hlídal
 * příkazy a silnice, ne růst. Zadání ale předepisuje „1000 tiků z fixního
 * seedu → snapshot hashe vrstev", tedy simulaci se vším všudy: poptávka, růst,
 * úrovně, difuze, doprava, spokojenost.
 *
 * Hash je neprůhledný, proto jsou vedle něj čitelná čísla — když se snapshot
 * změní, napoví, jestli šlo o změnu chování, nebo jen o jiný způsob hashování.
 *
 * Přegenerování: `npm run test:update-golden`. Změna musí být vidět v diffu.
 */
const SEED = 483928492;
const TICKS = 1000;

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/**
 * Město na generované mapě: páteřní silnice, tři zóny a elektrárna.
 *
 * Vodovod se předstírá (`assumeWatered`), protože vodárna potřebuje břeh
 * a tenhle test není o tom, jestli se na daném seedu najde. Kde končí voda,
 * hlídá `water.test.ts`.
 */
function buildCity(content: ContentRegistry): WorldState {
  const balance = content.getBalance();
  const world = createWorld(SEED, balance.economy);
  applyGeneratedMap(world, generateTerrain(SEED, balance));
  world.map = { seed: SEED, generated: true };

  // Místo pro město se **hledá**, nesází se natvrdo. Generátor se ladí a
  // souřadnice, které dnes padnou na louku, můžou zítra padnout do jezera —
  // a z golden testu by se stal test prázdné mapy. Hledání je deterministické,
  // takže snapshot zůstává stabilní stejně jako pevná čísla.
  const site = findSite(world);

  const roadY = site.y + 3;
  for (let x = site.x; x < site.x + SITE_W; x++) buildRoad(world, x, roadY, ROAD.street, balance);

  // Zónuje se **s balancem**, jako v hře. Bez něj se srovnání parcely
  // neúčtovalo a neplatil pro ně strop — golden město tedy vznikalo podle
  // pravidel, podle kterých se nehraje (T41).
  //
  // Výsledek se kontroluje: od T68 se bez peněz nezónuje vůbec, takže
  // neúspěšný příkaz by tiše udělal jiné město a hash by se změnil bez
  // zjevného důvodu.
  for (const zoned of [
    zoneArea(world, site.x, site.y, SITE_W, 3, ZONE.residential, balance),
    zoneArea(world, site.x, roadY + 1, SITE_W / 2, 3, ZONE.commercial, balance),
    zoneArea(world, site.x + SITE_W / 2, roadY + 1, SITE_W / 2, 3, ZONE.industrial, balance),
  ]) {
    expect(zoned, JSON.stringify(zoned)).toEqual({ ok: true });
  }

  // Elektrárna nad zónou, napojená **odbočkou**.
  //
  // Do T41 se stavěla bez odbočky a **nepostavila se ani jednou**: mezi ní
  // a ulicí leží obytná zóna, takže příkaz padal na `error.needsRoad`. Výsledek
  // se nekontroloval, takže golden město sedm fází rostlo bez proudu, přestože
  // tenhle komentář tvrdil opak.
  //
  // U hlavní ulice pro ni místo není — všech 32 jejích sousedů je zónovaných
  // a na koncích stojí les a voda. Odbočka po `site.x - 1` je volná tráva od
  // ulice až nad elektrárnu a dotkne se jí bokem.
  for (let y = site.y - 5; y <= roadY; y++) {
    expect(buildRoad(world, site.x - 1, y, ROAD.street, balance).ok, `odbočka ${y}`).toBe(true);
  }

  const plant = placeDefinition(
    world,
    content,
    'vanilla:coal_power_plant',
    site.x,
    site.y - 5,
    balance,
  );
  expect(plant, JSON.stringify(plant)).toEqual({ ok: true });
  return world;
}

const SITE_W = 16;
const SITE_H = 8;

/** Okno `SITE_W × SITE_H` s nejvíc stavitelnými dlaždicemi. První vyhrává. */
function findSite(world: WorldState): { x: number; y: number } {
  let best = { x: 8, y: 8, score: -1 };

  for (let y = 8; y < MAP_SIZE - SITE_H - 8; y += 2) {
    for (let x = 8; x < MAP_SIZE - SITE_W - 8; x += 2) {
      let score = 0;
      for (let dy = 0; dy < SITE_H; dy++) {
        for (let dx = 0; dx < SITE_W; dx++) {
          const terrain =
            world.layers.terrain[index(x + dx, y + dy, world.size)] ??
            TERRAIN.water;
          if (terrain === TERRAIN.grass || terrain === TERRAIN.sand) score++;
        }
      }
      if (score > best.score) best = { x, y, score };
    }
  }

  return best;
}

/*
 * Snapshot se v T61 posunul a je to v pořádku: v řadě, kudy vede hlavní ulice,
 * jsou na tomhle seedu **tři zkroucené dlaždice**. Do T61 tam silnice odmítla
 * vzniknout a zůstaly v ní díry; teď si sedla srovná a ulice je souvislá, takže
 * má víc parcel přístup k silnici a město vyroste na 192 obyvatel místo 180.
 */
/*
 * V T66 se posunuly **hashe terénu, ne město**: zóna se při vyznačení srovná
 * (viz `levelZonedArea`), takže domy stojí na rovině místo na podezdívce.
 * Počet budov, obyvatel i práce zůstal na chlup stejný — právě proto, že
 * srovnání není podmínkou růstu, jen vzhledem.
 */
/*
 * V T41 se posunula **jediná hodnota, kasa**: 19 264 → 18 552. Golden město
 * zónovalo bez balancu, takže mu srovnání parcel běželo zadarmo a bez stropu.
 * Teď platí 712 jako každý hráč. Hashe terénu, počet budov, obyvatel i práce
 * zůstaly na chlup stejné — srovnání se dělo i předtím, jen se za ně nevybíralo.
 */
/*
 * V T41 se město **poprvé napojilo na proud** a posunulo se skoro všechno:
 * 61 budov → 59, práce 114 → 98, kasa 18 552 → 22 831. Obyvatel zůstalo 192.
 *
 * Nepovýšila přitom ani jedna budova — všechny jsou dál na první úrovni.
 * Změnil se **průmysl: 6 provozů na 3**, a to je zlepšení, ne úbytek. Bez
 * proudu byla průmyslová poptávka −18, tedy hluboká nadvýroba: zóna se
 * zaplnila provozy, které nikoho nezaměstnaly, jen čadily. S proudem je
 * poptávka −2, tedy skoro v rovnováze.
 *
 * Znečištění v průmyslové zóně kleslo z 65 na 27 a cena půdy tam vyskočila
 * z nuly na 24. Že přibyla uhelná elektrárna a znečištění přesto kleslo, není
 * překlep: měří se **v průmyslové zóně**, kde rozhodují místní provozy, a
 * elektrárna stojí o deset dlaždic dál.
 *
 * Referenční město tedy do teď stálo v degenerovaném stavu — bez proudu, bez
 * ceny půdy, s přebujelým průmyslem. Starší zápisy v tomhle dokumentu, které
 * mluví o „61 budovách a 192 obyvatelích", popisují právě ten stav.
 */
/*
 * Posun po zvětšení uhelné elektrárny na 5 × 5 a čtyři patra: kasa 22 831 →
 * 21 049 (dražší stavba) a hash vrstev (větší půdorys zabere víc dlaždic).
 * Budov, obyvatel i práce beze změny — výroba, znečištění ani zaměstnanost
 * se **nehýbaly**, jen velikost.
 */
/*
 * Posun po automatickém srovnání příčného spádu silnic (obr. 1 od autora):
 * budov 59 → 29, obyvatel 192 → 52, práce 98 → 50, kasa 21 049 → 7 834.
 *
 * Je to velký propad a **není to cena za srovnávání**. Terén se hnul o čtrnáct
 * rohů — všechny u odbočky k elektrárně, `x` 88–91 — a stálo to 152 kreditů.
 * Hlavní ulice si nesáhla ani na jeden roh: staví se na nejrovnějším okně mapy,
 * které `findSite` schválně hledá.
 *
 * Že těch čtrnáct rohů opravdu stačí, je změřené, ne odhadnuté: když se stejné
 * hodnoty nasadí ručně a srovnávání se **vypne**, vyjde stejných 29 budov
 * a stejná mapa dlaždici po dlaždici. Referenční město je tedy na změnu terénu
 * u kraje zóny takhle citlivé samo o sobě — to je vlastnost simulace, ne
 * tohohle příkazu.
 *
 * Roli hraje i pořadí ve scénáři: odbočka se staví **až po zónování**, takže
 * srovná terén pod hotovou zónou. Hráč silnice normálně klade dřív, než zónuje.
 */
/*
 * Posun po pravidle „zkroucená silnice se rozbije" (T89): budov 29 → 32,
 * obyvatel 52 → 58, kasa 7 834 → 8 686. Práce beze změny.
 *
 * Změna je v terénu, ne v ekonomice. Srovnávání pod zónou se od teď silnicím
 * **vyhne**: `reshapeBlocker` hlásí `road`, když by plán nechal vozovku
 * v sedle, a plocha se rozdělí na menší — stejně jako se odjakživa dělí kolem
 * budov. Referenční město si tím nechalo rohy, které se pod ním dřív
 * přesypávaly, a jak popisuje zápis výš, na pár rohů u kraje zóny je citlivé
 * takhle silně samo o sobě.
 *
 * Jedna dlaždice vozovky z pětadvaceti se přesto ztratí, a je to od
 * `placeDefinition`: stavba si srovná půdorys, kaskáda hne rohem pod sousední
 * silnicí a ta skončí v sedle. Rozbije se a nechá trosky — přesně to autor
 * chtěl. Vyhnout se tomu jde jen odmítnutím stavby a to by bylo horší.
 */
/*
 * Posun po zdražení (T92): kasa 7 834 → 8 686 → 31 686. Budov, obyvatel, práce
 * ani hashů se to **nedotklo** — město vyšlo dlaždici po dlaždici stejné.
 *
 * Stavba zdražila třikrát, silnice a vodovod pětkrát, bourání desetkrát; aby
 * šlo město vůbec založit, vyrostl startovní kapitál taky třikrát (elektrárna
 * sama stojí 24 000 z původních 20 000). Scénář tím utratil o zhruba 17 tisíc
 * víc a začal se čtyřiceti navíc, takže mu jich zbylo o 23 tisíc víc.
 *
 * Že se nehnulo nic jiného, je dobrá zpráva: ceny se v tomhle městě nikde
 * nedotkly stropu, takže hashe měří dál růst a ne rozpočet.
 */
/*
 * Posun po dorovnání terénu pod silnicí (T101): kasa 31 686 → 30 787, hashe
 * vrstev i hrubé mřížky jiné. **Budov 32, obyvatel 58, práce 50 — beze změny.**
 *
 * Srovnání parcely pod stavbou dřív sousední silnici zkroutilo a zbořilo;
 * nově se místo bourání dorovnají i rohy pod vozovkou. Rohů se tedy hýbe víc,
 * scénář za ně zaplatil o 899 navíc, a protože se hýbe terén, změní se i hash
 * vrstev. Že město vyšlo přesně stejně velké, znamená, že dorovnání jen
 * uklidilo terén — nezasáhlo do růstu.
 */
/*
 * Posun po zředění průmyslu (T109): budov 32 → 27, obyvatel 58 → 84, práce
 * 50 → 33, kasa 30 787 → 30 402, hashe jiné.
 *
 * Průmyslová budova dává **polovinu prací** za polovinu ceny a údržby; proud
 * a kouř na pozemku zůstaly, protože patří pozemku, ne osazenstvu. Město
 * s pevným scénářem tedy postaví za tytéž peníze míň průmyslu — a protože
 * je průmysl slabší odběratel pracovní síly, zbude poptávka po bydlení a
 * vyroste víc lidí na míň budovách.
 *
 * Kasa se skoro nehnula (−385), takže to není o penězích: je to čistě jiný
 * mix města, přesně jak měl zásah zamýšlet.
 */
describe('golden: město po 1000 tikách', () => {
  it('pevný seed a plná sestava systémů dají stabilní hashe', async () => {
    const content = await vanilla();
    const world = buildCity(content);
    const systems = createDefaultSystems(content, content.getBalance());

    for (let tick = 0; tick < TICKS; tick++) {
      tickWorld(world, systems);
      assumeWatered(world);
    }

    expect({
      layers: hashLayers(world.layers),
      coarse: hashCoarseLayers(world.coarse),
      buildings: world.buildings.size,
      population: totalPopulation(world.buildings),
      jobs: totalJobs(world.buildings),
      funds: world.economy.funds,
    }).toMatchSnapshot();
  });

  it('udržované seznamy sedí s vrstvami i po tisíci tikách', async () => {
    // Seznamy silnic a zón se od T45 udržují při zápisu. Jediné místo, kde se
    // do vrstvy zapíše mimo `setRoadTile` / `setZoneTile`, je rozejde — a
    // nepoznalo by se to: růst by prostě přestal vidět kus města.
    //
    // Tenhle test je proto nezávislé orákulum: po celém běhu se seznamy
    // postaví znovu průchodem vrstev a porovnají s tím, co se udržovalo.
    const content = await vanilla();
    const world = buildCity(content);
    const systems = createDefaultSystems(content, content.getBalance());

    for (let tick = 0; tick < TICKS; tick++) {
      tickWorld(world, systems);
      assumeWatered(world);
    }

    const maintainedRoads = [...world.roadTiles].sort((a, b) => a - b);
    const maintainedZones = [...world.zonedTiles].sort((a, b) => a - b);
    expect(maintainedRoads.length).toBeGreaterThan(0);
    expect(maintainedZones.length).toBeGreaterThan(0);

    rebuildTileIndex(world);
    expect([...world.roadTiles].sort((a, b) => a - b)).toEqual(maintainedRoads);
    expect([...world.zonedTiles].sort((a, b) => a - b)).toEqual(maintainedZones);
  });

  it('dva běhy téhož seedu dají identické město', async () => {
    // Golden hlídá „nezměnilo se chování", tohle „chování je vůbec
    // reprodukovatelné". Bez druhého by se dal snapshot přegenerovat i nad
    // nedeterministickým kódem a nikdo by si toho nevšiml.
    const content = await vanilla();
    const run = (): string => {
      const world = buildCity(content);
      const systems = createDefaultSystems(content, content.getBalance());
      for (let tick = 0; tick < TICKS; tick++) {
        tickWorld(world, systems);
        assumeWatered(world);
      }
      return `${hashLayers(world.layers)}:${hashCoarseLayers(world.coarse)}`;
    };

    expect(run()).toBe(run());
  });
});
