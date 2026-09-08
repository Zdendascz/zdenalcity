import { index } from '../layers';
import type { WorldState } from '../world';
import { lookup, noLosses, reportLosses, rollDamage } from './damage';
import { igniteTile } from './fire';
import type { Disaster, DisasterContext } from './registry';
import type { ActiveDisaster } from './state';

/**
 * Tornádo (katalog 3).
 *
 * Pohyb v čase, ne jednorázový zásah: vzniká na okraji mapy, míří do
 * vnitrozemí a každý tik urazí kus dráhy. Síla se v čase mění podle křivky
 * životnosti — slabé na začátku, nejhorší uprostřed, doznívá na konci.
 *
 * **Proti zásahu samotnému obrana neexistuje a je to záměr autora**: dráha se
 * nepředpovídá. Bránit se dá jen tomu, co přijde po něm, a to je podstatné —
 * následné požáry nadělají víc škody než tornádo samo.
 */

/**
 * Síla v závislosti na uplynulé části života: 0,4 → 1,0 → 0,3.
 *
 * Vystaveno kvůli testům: tahle křivka je celý rozdíl mezi tornádem a
 * pojízdným buldozerem a přes zásah do města ji spolehlivě změřit nejde.
 */
export function strengthAt(progress: number): number {
  if (progress <= 0.5) return 0.4 + (progress / 0.5) * 0.6;
  return 1 - ((progress - 0.5) / 0.5) * 0.7;
}

export function createTornadoDisaster(): Disaster {
  return {
    kind: 'tornado',
    pickOrigin: (world) => pickEdge(world),
    start: (context, active) => {
      const { world, balance } = context;
      const tornado = balance.disasters.tornado;

      const life =
        tornado.lifetimeMin + world.rng.int(tornado.lifetimeMax - tornado.lifetimeMin + 1);
      active.state['life'] = life;
      active.state['age'] = 0;
      // Tornádo počítá nahoru, takže hodiny pro lištu v HUD nese `span`.
      active.state['span'] = life;
      active.state['width'] =
        tornado.widthMin + world.rng.int(tornado.widthMax - tornado.widthMin + 1);
      active.state['x'] = context.x;
      active.state['y'] = context.y;
      // Míří do vnitrozemí: od okraje ke středu mapy, s náhodným rozptylem.
      const half = world.size / 2;
      active.state['angle'] = Math.atan2(half - context.y, half - context.x);
    },
    tick: (context, active) => advance(context, active),
    isFinished: (_world, active) =>
      ((active.state['age'] as number | undefined) ?? 0) >=
      ((active.state['life'] as number | undefined) ?? 0),
  };
}

function advance(context: DisasterContext, active: ActiveDisaster): void {
  const { world, catalogue, balance } = context;
  const tornado = balance.disasters.tornado;

  const age = ((active.state['age'] as number | undefined) ?? 0) + 1;
  const life = (active.state['life'] as number | undefined) ?? 1;
  active.state['age'] = age;

  // Dráha se každý tik stočí o pár stupňů. Bez toho by tornádo letělo po
  // pravítku a hráč by po prvním zásahu věděl, kudy to příště půjde.
  const turn = ((world.rng.next() * 2 - 1) * tornado.turnDegrees * Math.PI) / 180;
  const angle = ((active.state['angle'] as number | undefined) ?? 0) + turn;
  active.state['angle'] = angle;

  const fromX = (active.state['x'] as number | undefined) ?? 0;
  const fromY = (active.state['y'] as number | undefined) ?? 0;
  const toX = fromX + Math.cos(angle) * tornado.speed;
  const toY = fromY + Math.sin(angle) * tornado.speed;
  active.state['x'] = toX;
  active.state['y'] = toY;

  // Za mapou už není co ničit; tornádo se rozpustí.
  if (toX < 0 || toY < 0 || toX >= world.size || toY >= world.size) {
    active.state['age'] = life;
    return;
  }

  const width = (active.state['width'] as number | undefined) ?? 1;
  const strength = strengthAt(age / Math.max(1, life));
  const losses = noLosses();
  const shape = {
    kind: 'band' as const,
    fromX: Math.round(fromX),
    fromY: Math.round(fromY),
    toX: Math.round(toX),
    toY: Math.round(toY),
    width: width / 2,
  };

  const hit = rollDamage(
    world,
    catalogue,
    balance,
    shape,
    (tile, kind) => {
      // Útlum od osy: na kraji pásu tornádo jen olízne.
      const falloff = axisFalloff(tile, world, shape, width);
      return strength * falloff * (1 - lookup(tornado.survival, kind, 1));
    },
    losses,
  );

  // Zapaluje **zasažené** dlaždice, ne celý pás: hoří to, co se rozsypalo.
  for (const tile of hit) {
    if (world.rng.next() >= tornado.igniteChance) continue;
    igniteTile(world, catalogue, balance, tile, tornado.igniteIntensity, false);
  }

  reportLosses(world, balance, losses, tornado.happinessPerLoss);
}

/** 1 v ose pásu, 0 na jeho okraji. Vystaveno kvůli testům, viz `strengthAt`. */
export function axisFalloff(
  tile: number,
  world: WorldState,
  shape: { fromX: number; fromY: number; toX: number; toY: number },
  width: number,
): number {
  const x = tile % world.size;
  const y = (tile - x) / world.size;
  const dx = shape.toX - shape.fromX;
  const dy = shape.toY - shape.fromY;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - shape.fromX) * dx + (y - shape.fromY) * dy) / lengthSquared));
  const distance = Math.hypot(x - (shape.fromX + t * dx), y - (shape.fromY + t * dy));
  const half = Math.max(0.5, width / 2);
  return Math.max(0, 1 - distance / half);
}

/**
 * Náhodné místo na okraji mapy.
 *
 * Tornádo přichází zvenčí — nevzniká uprostřed města. Hráč tím dostane pár
 * tiků, než dorazí k zástavbě, což je jediné, co se s ním dá dělat.
 */
function pickEdge(world: WorldState): { x: number; y: number } | null {
  const size = world.size;
  if (size < 2) return null;

  const side = world.rng.int(4);
  const along = world.rng.int(size);
  if (side === 0) return { x: along, y: 0 };
  if (side === 1) return { x: size - 1, y: along };
  if (side === 2) return { x: along, y: size - 1 };
  return { x: 0, y: along };
}

/** Vystaveno kvůli testům: dlaždice pásu, který tornádo právě přejelo. */
export function tornadoPath(active: ActiveDisaster, world: WorldState): number {
  const x = Math.round((active.state['x'] as number | undefined) ?? 0);
  const y = Math.round((active.state['y'] as number | undefined) ?? 0);
  return index(
    Math.max(0, Math.min(world.size - 1, x)),
    Math.max(0, Math.min(world.size - 1, y)),
    world.size,
  );
}
