import type { BuildingCatalogue } from '../catalogue';
import type { WorldState } from '../world';
import { CITY_WIDE, clearModifiersOf, happinessPenalty } from './effects';
import type { Disaster, DisasterContext } from './registry';
import type { ActiveDisaster } from './state';

/**
 * Blackout (katalog 12).
 *
 * **Nic nezničí — otevře dveře všemu ostatnímu.** Budovy bez proudu nedaní,
 * chátrají a hlavně: služby bez proudu nepokrývají. Během blackoutu tak skokově
 * roste riziko požáru, války gangů i hromadné nehody. To je celý smysl téhle
 * katastrofy a důvod, proč je nejčastější v seznamu.
 *
 * Kaskáda **se zastaví sama**: jakmile zbylá kapacita stačí na spotřebu,
 * přestane se odpojovat a po chvíli klidu se elektrárny vracejí jedna po druhé.
 * Není to odpočet — je to stav sítě, a hráč ho může zkrátit jedině tím, že
 * spotřebu sníží (zbourá, nebo počká, až se budovy samy odpojí).
 *
 * Odpojené elektrárny drží `disasters.offlinePlants`, ne příznak na budově:
 * kdyby to byla vlastnost elektrárny, přežila by konec blackoutu.
 */

export function createBlackoutDisaster(): Disaster {
  return {
    kind: 'blackout',
    pickOrigin: (world, catalogue) => pickPlant(world, catalogue),
    start: (context, active) => begin(context, active),
    tick: (context, active) => advance(context, active),
    /*
     * Konec je jediný: **vrátily se všechny elektrárny**.
     *
     * Strop na délku je taky, ale hlídá si ho `advance`, protože jedině ten
     * dostane balanc. Když dojde čas, vrátí elektrárny sám a tahle podmínka
     * pak platí. Dřív se strop bral z `active.state`, kam si ho zapsal
     * `start` — a to je špatně u savu, který vznikl dřív, než strop existoval:
     * v takové partii se blackout neukončil **nikdy**. Autor ho poslal
     * s věkem 1692 tiků, tedy skoro pět herních let.
     */
    isFinished: (_world, active) =>
      ((active.state['offline'] as number[] | undefined) ?? []).length === 0,
    cooldownFromEnd: true,
  };
}

function begin(context: DisasterContext, active: ActiveDisaster): void {
  const { world, catalogue } = context;

  // Spouštěčem je jedna odpojená elektrárna. Která, to určil `pickOrigin`
  // váženým losem podle kapacity — velká elektrárna spadne spíš než malá
  // a její výpadek zároveň bolí víc.
  const id = plantAt(world, catalogue, context.x, context.y);
  active.state['offline'] = [];
  active.state['calm'] = 0;
  active.state['age'] = 0;
  if (id === null) return;

  takeOffline(world, active, id);
}

function advance(context: DisasterContext, active: ActiveDisaster): void {
  const { world, catalogue, balance } = context;
  const blackout = balance.disasters.blackout;

  const age = ((active.state['age'] as number | undefined) ?? 0) + 1;
  active.state['age'] = age;
  // Hodiny pro lištu v HUD. Zapisují se tady, ne v `start`, aby je dostala
  // i partie rozehraná dřív — a hlavně proto, že strop je v balancu a ten
  // `start` sice dostane, ale `isFinished` už ne.
  active.state['span'] = blackout.maxTicks;

  /*
   * Strop na délku. Vrátí všechno a tím katastrofu ukončí.
   *
   * Bez něj je blackout past bez východu a strop je jediné, co ji rozbije
   * spolehlivě: zatížení se počítá proti spotřebě celého města, i toho potmě,
   * takže dokud je většina sítě dole, neunese ji ani vrácená elektrárna.
   * Délka je v datech (`disasters.blackout.maxTicks`, P5).
   */
  if (blackout.maxTicks > 0 && age >= blackout.maxTicks) {
    for (const id of (active.state['offline'] as number[] | undefined) ?? []) {
      world.disasters.offlinePlants.delete(id);
    }
    active.state['offline'] = [];
    world.powerNetworkDirty = true;
    return;
  }

  // Spokojenost klesá až po pár tikách a kumulativně: krátký výpadek si nikdo
  // nevšimne, dlouhý se pozná.
  //
  // Starý postih se před novým **zahodí**. Postihy jsou záznamy s odpočtem, ne
  // stav — bez úklidu by dlouhý blackout nechal za sebou stovku záznamů, kterými
  // se pak prohrabuje každý dotaz každého systému.
  if (age >= blackout.noticeTicks) {
    const amount = Math.min(
      blackout.happinessMax,
      (age - blackout.noticeTicks + 1) * blackout.happinessPerTick,
    );
    if (amount > ((active.state['penalty'] as number | undefined) ?? 0)) {
      active.state['penalty'] = amount;
      clearModifiersOf(world, active.id);
      happinessPenalty(world, CITY_WIDE, amount, blackout.penaltyTicks, active.id);
    }
  }

  // Kaskáda se přepočítává každý druhý tik. Každý tik by z výpadku udělal
  // lavinu dřív, než by hráč stihl mrknout na mapu elektřiny.
  if (age % blackout.cascadeEvery !== 0) return;

  const { production, consumption } = networkLoad(world, catalogue, active);
  const load = production <= 0 ? Number.POSITIVE_INFINITY : consumption / production;

  /*
   * Kaskáda běží **jen dokud se nezačalo zotavovat**. Pak už se neodpojuje nic.
   *
   * Bez toho hra vyrábí neřešitelný stav a autor v něm skončil: 42 elektráren
   * dole, věk blackoutu skoro pět let. Kaskáda dojela na dno, po pár ticích
   * klidu se vrátila jedna elektrárna — a protože se zatížení počítá proti
   * spotřebě **celého** města, i toho potmě, hned zase vyšlo nad práh a tatáž
   * elektrárna šla znovu dolů. A s ní každá nová, kterou hráč mezitím postavil:
   * `biggestOnline` bere největší běžící, tedy zrovna tu čerstvou. Město tak
   * nemělo jak se z výpadku dostat ani za peníze.
   *
   * Zotavení je jednosměrné schválně. Kaskáda je moment poruchy, ne stav sítě.
   */
  const recovering = active.state['recovering'] === true;

  if (!recovering && load > blackout.overloadRatio) {
    const next = biggestOnline(world, catalogue, active);
    if (next !== null) {
      active.state['calm'] = 0;
      takeOffline(world, active, next);
      return;
    }
    // **Není co dál odpojovat.** Kaskáda dojela na dno a od téhle chvíle se
    // počítá klid — jinak by město s jedinou elektrárnou zůstalo tmavé
    // napořád: bez výroby je zatížení nekonečné a podmínka zotavení by
    // nikdy neplatila. Blackout, ze kterého není cesty ven, není katastrofa,
    // ale konec hry.
    active.state['recovering'] = true;
  } else if (!recovering && load >= blackout.recoveryRatio) {
    active.state['calm'] = 0;
    return;
  }

  // Odsud dál se **jen zotavuje**: pod prahem po `calmCycles` cyklech se
  // začne připojovat zpátky, jedna elektrárna za cyklus. Zotavení je pomalé
  // schválně — hráč má vidět, jak se město rozsvěcuje po částech, ne skokem.
  active.state['recovering'] = true;
  const calm = ((active.state['calm'] as number | undefined) ?? 0) + 1;
  active.state['calm'] = calm;
  if (calm < blackout.calmCycles) return;

  const offline = (active.state['offline'] as number[] | undefined) ?? [];
  const back = offline.pop();
  if (back === undefined) return;
  world.disasters.offlinePlants.delete(back);
  world.powerNetworkDirty = true;
}

/** Odpojí elektrárnu a poznamená si to. Síť se přepočítá příští tik. */
function takeOffline(world: WorldState, active: ActiveDisaster, id: number): void {
  const offline = (active.state['offline'] as number[] | undefined) ?? [];
  if (offline.includes(id)) return;
  offline.push(id);
  active.state['offline'] = offline;
  world.disasters.offlinePlants.add(id);
  world.powerNetworkDirty = true;
}

/** Výroba zbylých elektráren a spotřeba všeho, co je připojené. */
function networkLoad(
  world: WorldState,
  catalogue: BuildingCatalogue,
  active: ActiveDisaster,
): { production: number; consumption: number } {
  const offline = new Set((active.state['offline'] as number[] | undefined) ?? []);
  let production = 0;
  let consumption = 0;

  for (const [id, building] of world.buildings) {
    if (building.abandoned) continue;
    const definition = catalogue.get(building.definitionId);
    if (!definition) continue;
    if (!offline.has(id)) production += definition.power?.production ?? 0;
    consumption += definition.power?.consumption ?? 0;
  }
  return { production, consumption };
}

/** Nejvíc zatížená, tedy největší běžící elektrárna. Ta padne jako další. */
function biggestOnline(
  world: WorldState,
  catalogue: BuildingCatalogue,
  active: ActiveDisaster,
): number | null {
  const offline = new Set((active.state['offline'] as number[] | undefined) ?? []);
  let best: number | null = null;
  let bestOutput = 0;

  // Vzestupně podle id: při shodě výkonu rozhoduje stáří, ne pořadí v `Map`.
  for (const id of [...world.buildings.keys()].sort((a, b) => a - b)) {
    if (offline.has(id)) continue;
    const building = world.buildings.get(id);
    if (!building || building.abandoned) continue;
    const output = catalogue.get(building.definitionId)?.power?.production ?? 0;
    if (output <= 0 || output <= bestOutput) continue;
    best = id;
    bestOutput = output;
  }
  return best;
}

function plantAt(
  world: WorldState,
  catalogue: BuildingCatalogue,
  x: number,
  y: number,
): number | null {
  const tile = y * world.size + x;
  const id = world.layers.buildingId[tile] ?? 0;
  if (id === 0) return null;
  const building = world.buildings.get(id);
  if (!building) return null;
  const output = catalogue.get(building.definitionId)?.power?.production ?? 0;
  return output > 0 ? id : null;
}

/**
 * Vážený los elektrárny podle kapacity.
 *
 * Velká elektrárna vypadne spíš než malá — a to je přímý argument pro několik
 * menších místo jedné velké, což je jediná strukturální obrana proti blackoutu.
 */
function pickPlant(
  world: WorldState,
  catalogue: BuildingCatalogue,
): { x: number; y: number } | null {
  const targets: { x: number; y: number }[] = [];
  const weights: number[] = [];
  let total = 0;

  for (const id of [...world.buildings.keys()].sort((a, b) => a - b)) {
    const building = world.buildings.get(id);
    if (!building || building.abandoned) continue;
    if (world.disasters.offlinePlants.has(id)) continue;
    const output = catalogue.get(building.definitionId)?.power?.production ?? 0;
    if (output <= 0) continue;

    targets.push({ x: building.x, y: building.y });
    weights.push(output);
    total += output;
  }

  if (total <= 0) return null;

  let roll = world.rng.next() * total;
  for (let i = 0; i < targets.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll <= 0) return targets[i] ?? null;
  }
  return targets[targets.length - 1] ?? null;
}

/**
 * Uklidí po blackoutu.
 *
 * Volá plánovač při skončení. Bez tohohle by odpojené elektrárny zůstaly
 * odpojené navždycky — a hráč by neměl jak to zjistit ani spravit.
 */
export function restorePlants(world: WorldState): void {
  if (world.disasters.offlinePlants.size === 0) return;
  world.disasters.offlinePlants.clear();
  world.powerNetworkDirty = true;
}
