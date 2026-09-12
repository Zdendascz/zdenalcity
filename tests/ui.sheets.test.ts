/**
 * @vitest-environment jsdom
 *
 * Skupina panelů uprostřed obrazovky.
 *
 * Hlídá se to, co se v prohlížeči pozná až jako slitý text: dva otevřené
 * panely naráz. Karta parcely se položila přes otevřenou kasu, a protože má
 * panel 96% pozadí, prosvítal spodní skrz vrchní.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { closeOtherSheets, registerSheet } from '@/ui/sheets';

class Fake {
  hidden = false;

  hide(): void {
    this.hidden = true;
  }

  open(): void {
    this.hidden = false;
    closeOtherSheets(this);
  }
}

const first = new Fake();
const second = new Fake();
const third = new Fake();

beforeEach(() => {
  for (const sheet of [first, second, third]) sheet.hidden = false;
});

describe('skupina panelů', () => {
  it('otevření jednoho zavře ostatní', () => {
    registerSheet(first);
    registerSheet(second);
    registerSheet(third);

    second.open();

    expect(second.hidden).toBe(false);
    expect(first.hidden).toBe(true);
    expect(third.hidden).toBe(true);
  });

  it('Escape zavře všechny', () => {
    registerSheet(first);
    registerSheet(second);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(first.hidden).toBe(true);
    expect(second.hidden).toBe(true);
  });

  it('jiná klávesa panely nezavírá', () => {
    registerSheet(first);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

    expect(first.hidden).toBe(false);
  });
});
