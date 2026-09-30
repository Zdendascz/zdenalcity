/**
 * @vitest-environment jsdom
 *
 * Audit rozhraní (T135): věci, které se rozbily potichu a nikdo si jich
 * nevšiml, protože hra dál běžela.
 *
 * - ikony rychlosti se jmenovaly podle pořadí karty v archu, ne podle násobku,
 *   takže 4× ukazovala čtyři šipky a 8× žádný obrázek;
 * - v obsahu ležely ikony, které nic nepoužívá;
 * - překlad hledal klíče přes prototyp, takže město „constructor" se v nabídce
 *   „Pokračovat v …" vypsalo jako zdroják funkce.
 */
import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { SPEEDS } from '@/sim/simHost';

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

describe('ikony rychlosti', () => {
  it('každý násobek má obrázek pod svým jménem', async () => {
    const icons = (await vanilla()).getIcons();
    for (const speed of SPEEDS) {
      const name = speed === 0 ? 'speed-pause' : `speed-${speed}`;
      expect(icons[name], name).toBeDefined();
    }
  });

  it('obrázek pro neexistující rychlost v obsahu neleží', async () => {
    const icons = (await vanilla()).getIcons();
    expect(icons['speed-3']).toBeUndefined();
  });
});

describe('nepoužité ikony', () => {
  it('ikony bez tlačítka a bez funkce jsou pryč', async () => {
    const icons = (await vanilla()).getIcons();
    // `author` a `share` nahradily `home-author` a `home-share`; splátka úvěru
    // ve hře není.
    for (const name of ['author', 'share', 'loan-repay']) {
      expect(icons[name], name).toBeUndefined();
    }
  });
});
