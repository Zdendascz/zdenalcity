/** Relayují čerpací stanice? Jednorázové měření. */
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { buildPipe, buildRoad, placeDefinition } from '@/sim/commands';
import { index, ROAD, TERRAIN } from '@/sim/layers';
import { createDefaultSystems } from '@/sim/systems';
import { applyGeneratedMap, generateTerrain } from '@/sim/mapgen';
import { createWorld, tickWorld } from '@/sim/world';

const content = new ContentRegistry();
await content.load(createVanillaSource());
const balance = content.getBalance();

const world = createWorld(1, balance.economy, 128);
applyGeneratedMap(world, generateTerrain(1, balance, world.size));
world.economy.funds = 10_000_000;

// Najdi břeh: dlaždici 3×3 na souši u vody.
const size = world.size;
const isWater = (x: number, y: number): boolean =>
  world.layers.terrain[index(x, y, size)] === TERRAIN.water;
let spot: [number, number] | null = null;
for (let y = 10; y < 110 && !spot; y++) {
  for (let x = 10; x < 110 && !spot; x++) {
    let land = true;
    for (let oy = 0; oy < 3 && land; oy++)
      for (let ox = 0; ox < 3 && land; ox++) land = !isWater(x + ox, y + oy);
    if (!land) continue;
    let touches = false;
    for (let oy = -1; oy <= 3 && !touches; oy++)
      for (let ox = -1; ox <= 3 && !touches; ox++) if (isWater(x + ox, y + oy)) touches = true;
    if (touches) spot = [x, y];
  }
}
if (!spot) throw new Error('nenašel jsem břeh');
const [wx, wy] = spot;
process.stdout.write(`vodarna na ${wx},${wy}\n`);

// Rovná linka potrubí od vodárny na východ, 60 dlaždic.
const ROW = wy + 3; // řádek těsně pod půdorysem, ne skrz něj
for (let x = wx; x < wx + 60; x++) {
  buildRoad(world, x, ROW, ROAD.street, balance);
  buildPipe(world, x, ROW, balance);
}
process.stdout.write(`stavba vodarny: ${JSON.stringify(placeDefinition(world, content, 'vanilla:water_works', wx, wy, balance))}\n`);

const systems = createDefaultSystems(content, balance);
const watered = (): number => {
  let n = 0;
  for (let x = wx; x < wx + 60; x++) if ((world.waterSupply[index(x, ROW, size)] ?? 0) !== 0) n++;
  return n;
};
for (let i = 0; i < 5; i++) tickWorld(world, systems);
process.stdout.write(`voda dosahla na ${watered()} dlazdic z 60\n`);

// Čerpací stanice na poslední zavodněnou dlaždici.
let last = wx;
for (let x = wx; x < wx + 60; x++) if ((world.waterSupply[index(x, ROW, size)] ?? 0) !== 0) last = x;
process.stdout.write(`posledni zavodnena: ${last} (${last - wx} dlazdic od vodarny)\n`);
buildPipe(world, last, ROW + 1, balance);
const put = placeDefinition(world, content, 'vanilla:pump_station', last, ROW + 1, balance);
process.stdout.write(`stanice na ${last},${ROW + 1}: ${JSON.stringify(put)}\n`);
process.stdout.write(`potrubi pod stanici po stavbe: ${world.layers.pipe[index(last, ROW + 1, size)]}\n`);
for (let i = 0; i < 5; i++) tickWorld(world, systems);
process.stdout.write(`voda po stanici: ${watered()} dlazdic z 60\n`);
