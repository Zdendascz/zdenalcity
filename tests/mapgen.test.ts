import { describe, expect, it } from 'vitest';
import { countViolations, MAX_HEIGHT, tileBaseHeight, tileCorners } from '@/sim/heights';
import { generateTerrain } from '@/sim/mapgen';
import { index, inBounds, MAP_SIZE, TERRAIN } from '@/sim/layers';
import { VANILLA_BALANCE } from './support/balance';

/** FNV-1a přes vrstvu terénu — golden hash mapy. */
function hashTerrain(terrain: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const value of terrain) hash = Math.imul(hash ^ value, 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function share(terrain: Uint8Array, type: number): number {
  let count = 0;
  for (const value of terrain) if (value === type) count++;
  return count / terrain.length;
}

/** Je souš jedna souvislá plocha? Průchod do šířky z první nevodní dlaždice. */
function landIsConnected(terrain: Uint8Array): boolean {
  const start = terrain.findIndex((value) => value !== TERRAIN.water);
  if (start < 0) return false;

  const seen = new Uint8Array(terrain.length);
  const stack = [start];
  seen[start] = 1;
  let reached = 0;

  while (stack.length > 0) {
    const tile = stack.pop();
    if (tile === undefined) break;
    reached++;

    const x = tile % MAP_SIZE;
    const y = (tile - x) / MAP_SIZE;
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const next = index(nx, ny);
      if (seen[next] === 1 || terrain[next] === TERRAIN.water) continue;
      seen[next] = 1;
      stack.push(next);
    }
  }

  let land = 0;
  for (const value of terrain) if (value !== TERRAIN.water) land++;
  return reached === land;
}

describe('generátor mapy', () => {
  it('stejný seed dá identickou mapu (P2)', () => {
    const a = generateTerrain(12345, VANILLA_BALANCE);
    const b = generateTerrain(12345, VANILLA_BALANCE);

    expect(hashTerrain(a.terrain)).toBe(hashTerrain(b.terrain));
    expect([...a.height]).toEqual([...b.height]);
  });

  it('jiný seed dá jinou mapu (kontrolní případ)', () => {
    const a = generateTerrain(1, VANILLA_BALANCE);
    const b = generateTerrain(2, VANILLA_BALANCE);
    expect(hashTerrain(a.terrain)).not.toBe(hashTerrain(b.terrain));
  });

  it('hash mapy se nemění bez zásahu do generátoru', () => {
    // Golden test: kdyby se změnil šum, prahy nebo pořadí kroků, tohle spadne
    // a je to vědomé rozhodnutí, ne překvapení.
    expect(hashTerrain(generateTerrain(483928492, VANILLA_BALANCE).terrain)).toMatchSnapshot();
  });

  it('souš je souvislá na 200 náhodných seedech (R7)', { timeout: 30000 }, () => {
    // Ostrov bez mostu — a mosty jsou až 3b — znamená kus mapy, kam se hráč
    // nikdy nedostane. Proto je to invariant, ne přání.
    for (let seed = 1; seed <= 200; seed++) {
      const { terrain } = generateTerrain(seed * 7919, VANILLA_BALANCE);
      expect(landIsConnected(terrain), `seed ${seed * 7919}`).toBe(true);
    }
  });

  it('zastoupení terénů drží rozumné meze na 200 seedech', { timeout: 30000 }, () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { terrain } = generateTerrain(seed * 104729, VANILLA_BALANCE);
      const water = share(terrain, TERRAIN.water);
      const buildable =
        share(terrain, TERRAIN.grass) + share(terrain, TERRAIN.sand) + share(terrain, TERRAIN.forest);

      expect(water, `seed ${seed}: voda`).toBeLessThan(0.6);
      // Bez místa na stavbu není co hrát.
      expect(buildable, `seed ${seed}: stavitelné`).toBeGreaterThan(0.3);
    }
  });

  it('moře nezmizí, ani když generátor kvůli ostrovům ubírá vodu', { timeout: 30000 }, () => {
    // Souvislost souše se řeší zaplavením ostrovů a v krajním případě snížením
    // hladiny. Kdyby to sahalo moc hluboko, vznikla by mapa bez vody — a bonus
    // ceny půdy u vody by neměl kde platit.
    for (let seed = 1; seed <= 200; seed++) {
      const { terrain } = generateTerrain(seed * 7919, VANILLA_BALANCE);
      const water = share(terrain, TERRAIN.water);

      // Nahoře je strop nastavená hladina plus utopené ostrovy, dole pojistka,
      // že snižování hladiny nesmí moře vysušit úplně.
      const drowned = 1 - VANILLA_BALANCE.map.minLandShare;
      expect(water, `seed ${seed}: voda`).toBeGreaterThan(0.05);
      expect(water, `seed ${seed}: voda`).toBeLessThanOrEqual(
        VANILLA_BALANCE.map.seaLevel + drowned,
      );
    }
  });

  it('vygeneruje všech šest terénů aspoň někde', { timeout: 20000 }, () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      for (const value of generateTerrain(seed * 31, VANILLA_BALANCE).terrain) seen.add(value);
    }
    expect([...seen].sort()).toEqual(Object.values(TERRAIN).sort());
  });

  it('les roste jen na souši a písek jen u vody', () => {
    const { terrain } = generateTerrain(777, VANILLA_BALANCE);

    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        if (terrain[index(x, y)] !== TERRAIN.sand) continue;

        // Písek vzniká pásem od vody, takže někde v okolí voda být musí.
        let waterNear = false;
        for (let dy = -VANILLA_BALANCE.map.beachWidth; dy <= VANILLA_BALANCE.map.beachWidth; dy++) {
          for (let dx = -VANILLA_BALANCE.map.beachWidth; dx <= VANILLA_BALANCE.map.beachWidth; dx++) {
            if (!inBounds(x + dx, y + dy)) continue;
            if (terrain[index(x + dx, y + dy)] === TERRAIN.water) waterNear = true;
          }
        }
        expect(waterNear, `písek na ${x},${y} bez vody v okolí`).toBe(true);
      }
    }
  });
});

describe('patra terénu (§7 fáze 3)', () => {
  it('invariant sousedních rohů platí na 200 seedech', { timeout: 30000 }, () => {
    // Kdyby ho generátor porušil, vznikla by svislá stěna: renderer ji neumí
    // nakreslit a picking trefit. Proto se to hlídá na celé sadě, ne na jedné.
    for (let seed = 1; seed <= 200; seed++) {
      const { cornerHeight } = generateTerrain(seed * 7919, VANILLA_BALANCE);
      expect(countViolations(cornerHeight), `seed ${seed * 7919}`).toBe(0);
    }
  });

  it('drží se v mezích balancu, ale mapa není placka', () => {
    const { cornerHeight } = generateTerrain(4242, VANILLA_BALANCE);
    const highest = Math.max(...cornerHeight);

    expect(highest).toBeLessThanOrEqual(VANILLA_BALANCE.map.maxHeight);
    expect(VANILLA_BALANCE.map.maxHeight).toBeLessThanOrEqual(MAX_HEIGHT);
    expect(highest).toBeGreaterThan(1);
    expect(new Set(cornerHeight).size).toBeGreaterThan(2);
  });

  it('voda leží na nule, souš stoupá od pobřeží', () => {
    const { terrain, cornerHeight } = generateTerrain(31337, VANILLA_BALANCE);

    let land = 0;
    let raisedLand = 0;
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const base = tileBaseHeight(cornerHeight, x, y);
        if (terrain[index(x, y)] === TERRAIN.water) {
          // Moře na kopci by byl vodopád visící ve vzduchu. Kontroluje se
          // **nejvyšší** roh, ne nejnižší: kdyby stačil jeden roh dole, mohla
          // by být hladina nakloněná a nikdo by si toho nevšiml.
          const highest = Math.max(...tileCorners(cornerHeight, x, y));
          expect(highest, `voda na ${x},${y} má roh ve výšce ${highest}`).toBe(0);
          continue;
        }
        land++;
        if (base > 0) raisedLand++;
      }
    }

    expect(land).toBeGreaterThan(0);
    expect(raisedLand / land).toBeGreaterThan(0.1);
  });

  it('stejný seed dá i stejná patra (P2)', () => {
    const a = generateTerrain(9001, VANILLA_BALANCE);
    const b = generateTerrain(9001, VANILLA_BALANCE);
    expect(a.cornerHeight).toEqual(b.cornerHeight);
  });
});

describe('řeky (R7)', () => {
  /** Vanilla má řeky vypnuté, dokud nebudou mosty — test si je zapne sám. */
  const WITH_RIVERS = {
    ...VANILLA_BALANCE,
    map: { ...VANILLA_BALANCE.map, rivers: 2 },
  };

  it('vanilla je zatím nemá, protože chybí mosty (T33)', () => {
    expect(VANILLA_BALANCE.map.rivers).toBe(0);

    const bare = generateTerrain(555, VANILLA_BALANCE);
    const wet = generateTerrain(555, WITH_RIVERS);
    let bareWater = 0;
    let wetWater = 0;
    for (const value of bare.terrain) if (value === TERRAIN.water) bareWater++;
    for (const value of wet.terrain) if (value === TERRAIN.water) wetWater++;

    expect(wetWater).toBeGreaterThan(bareWater);
  });

  it('koryto teče z kopce dolů a invariant zůstane celý', { timeout: 20000 }, () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { terrain, cornerHeight } = generateTerrain(seed * 1009, WITH_RIVERS);
      expect(countViolations(cornerHeight), `seed ${seed}`).toBe(0);

      // Voda nikde neleží výš než souš kolem ní o víc než patro — jinak by
      // řeka viditelně tekla po hřebeni.
      for (let y = 1; y < MAP_SIZE - 1; y++) {
        for (let x = 1; x < MAP_SIZE - 1; x++) {
          if (terrain[index(x, y)] !== TERRAIN.water) continue;
          const base = tileBaseHeight(cornerHeight, x, y);
          for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
            const neighbour = tileBaseHeight(cornerHeight, x + dx, y + dy);
            expect(Math.abs(base - neighbour), `seed ${seed} na ${x},${y}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('řeka někam doteče — do moře nebo za okraj mapy', { timeout: 20000 }, () => {
    // Slepá stružka končící uprostřed pole vypadá jako chyba generátoru.
    // Porovnává se s mapou bez řek, takže se rozliší, co je koryto a co moře.
    for (let seed = 1; seed <= 15; seed++) {
      const bare = generateTerrain(seed * 2003, VANILLA_BALANCE).terrain;
      const wet = generateTerrain(seed * 2003, WITH_RIVERS).terrain;

      const river: number[] = [];
      for (let tile = 0; tile < wet.length; tile++) {
        if (wet[tile] === TERRAIN.water && bare[tile] !== TERRAIN.water) river.push(tile);
      }
      expect(river.length, `seed ${seed}: žádná řeka nevznikla`).toBeGreaterThan(0);

      // Průchod korytem: kam až se z něj po vodě dojde.
      const seen = new Set(river);
      const stack = [...river];
      let reachesSea = false;
      while (stack.length > 0 && !reachesSea) {
        const tile = stack.pop();
        if (tile === undefined) break;
        const x = tile % MAP_SIZE;
        const y = (tile - x) / MAP_SIZE;

        if (x === 0 || y === 0 || x === MAP_SIZE - 1 || y === MAP_SIZE - 1) reachesSea = true;
        if (bare[tile] === TERRAIN.water) reachesSea = true;

        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          if (!inBounds(x + dx, y + dy)) continue;
          const at = index(x + dx, y + dy);
          if (seen.has(at) || wet[at] !== TERRAIN.water) continue;
          seen.add(at);
          stack.push(at);
        }
      }

      expect(reachesSea, `seed ${seed}: koryto končí ve vzduchoprázdnu`).toBe(true);
    }
  });
});
