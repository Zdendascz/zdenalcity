/**
 * Reprodukce: **stavba u silnice tiše zboří silnici**.
 *
 *   npx vite build --ssr tools/probe.ts --outDir tools/.build --logLevel error
 *   node tools/.build/probe.js
 *
 * Postaví rovný pruh ulice a vedle něj větrník o půdorysu jedné dlaždice.
 * Parcela pod větrníkem není rovná, takže `placeDefinition` srovná dva rohy —
 * jenže ty rohy sdílí se sousedními dlaždicemi silnice. Ty se tím zkroutí
 * a `collapseUnsupportedRoads` je zboří na suť.
 *
 * Příkaz přitom vrátí `ok` a nikde se neřekne, že ulice zmizela. Odhad ceny
 * (`estimatePlacement`) o tom taky mlčí — zaplatí se jen srovnání terénu.
 *
 * Proč to bolí víc, než to vypadá: silnice je **vodič elektřiny**. Díra v ní
 * odřízne čtvrť od proudu, nenapájené domy neplatí daň a městu spadne příjem
 * na nulu. Přesně na tohle umíraly simulované partie.
 *
 * Nalezeno při ladění simulovaného hráče. Hlásí se autorovi k rozhodnutí,
 * protože oprava je věc pravidel hry, ne rendereru.
 */
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { createDefaultSystems } from '@/sim/systems';
import { buildRoad, estimatePlacement, placeDefinition } from '@/sim/commands';
import { index, ROAD } from '@/sim/layers';
import { applyGeneratedMap, generateTerrain } from '@/sim/mapgen';
import { createWorld, tickWorld } from '@/sim/world';

const content = new ContentRegistry();
await content.load(createVanillaSource());
const balance = content.getBalance();

const world = createWorld(1, balance.economy, 128);
applyGeneratedMap(world, generateTerrain(1, balance, world.size));
world.economy.funds = 10_000_000;

const say = (label: string, value: unknown): void => {
  process.stdout.write(`${label} ${JSON.stringify(value)}\n`);
};

const roadAt = (x: number, y: number): number => world.layers.road[index(x, y, world.size)] ?? 0;
const rubbleAt = (x: number, y: number): number => world.rubble[index(x, y, world.size)] ?? 0;
const powerAt = (x: number, y: number): number => world.layers.power[index(x, y, world.size)] ?? 0;
const row = (read: (x: number, y: number) => number): number[] =>
  [50, 51, 52, 53].map((x) => read(x, 60));

// Rovný pruh ulice.
let roads = 0;
for (let x = 50; x < 70; x++) {
  if (buildRoad(world, x, 60, ROAD.street, balance).ok) roads++;
}
say('postaveno dlazdic ulice:', roads);
say('ulice na x=50..53:', row(roadAt));

// Větrník na sousední řadu. Jedna dlaždice, nic velkého.
const plan = estimatePlacement(world, content, 'vanilla:wind_turbine', 52, 61, balance);
say('srovna se rohu:', plan.changes.size);
say('cena i se srovnanim:', plan.total);

const placed = placeDefinition(world, content, 'vanilla:wind_turbine', 52, 61, balance);
say('stavba hlasi:', placed);

say('ulice na x=50..53 po stavbe:', row(roadAt));
say('sut na x=50..53 po stavbe:', row(rubbleAt));

const systems = createDefaultSystems(content, balance);
for (let i = 0; i < 5; i++) tickWorld(world, systems);

say('proud pod vetrnikem:', powerAt(52, 61));
say('proud na ulici vedle:', powerAt(52, 60));
say('proud na ulici o deset dal:', powerAt(62, 60));
