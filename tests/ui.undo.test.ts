/**
 * @vitest-environment jsdom
 *
 * Nabídka „Zpět".
 *
 * Vrací se **snímek města**, ne opačný příkaz, takže se hlídá to, co by se
 * dalo splést: že nabídka drží jen poslední krok, že po vypršení už nic
 * nevrací a že kliknutí pošle právě ten snímek, který k tahu patří.
 */
import { describe, expect, it, vi } from 'vitest';
import { I18n } from '@/ui/i18n';
import type { LocaleTables } from '@/ui/i18n';
import { UndoBar } from '@/ui/undoBar';

const TABLES = {
  cs: {
    'ui.undo.button': 'Zpět',
    'ui.undo.demolished': 'Zbouráno',
    'ui.undo.built': 'Postaveno',
  },
} as unknown as LocaleTables;

function bar(lifetimeMs = 5000): {
  node: HTMLElement;
  undo: UndoBar;
  restored: Uint8Array[];
} {
  const node = document.createElement('div');
  document.body.appendChild(node);
  const restored: Uint8Array[] = [];
  const undo = new UndoBar(node, new I18n(TABLES, 'cs'), (bytes) => restored.push(bytes), lifetimeMs);
  return { node, undo, restored };
}

function click(node: HTMLElement): void {
  node.querySelector('button')?.click();
}

describe('nabídka Zpět', () => {
  it('ukáže, co se stalo, a vrátí ten snímek', () => {
    const { node, undo, restored } = bar();
    undo.show('ui.undo.demolished', new Uint8Array([1, 2, 3]));

    expect(undo.isVisible()).toBe(true);
    expect(node.textContent).toContain('Zbouráno');
    expect(node.textContent).toContain('Zpět');

    click(node);

    expect(restored).toHaveLength(1);
    expect([...(restored[0] ?? [])]).toEqual([1, 2, 3]);
    // Po vrácení nabídka zmizí: dvakrát vrátit totéž nejde.
    expect(undo.isVisible()).toBe(false);
  });

  it('drží jen poslední krok', () => {
    const { node, undo, restored } = bar();
    undo.show('ui.undo.built', new Uint8Array([1]));
    undo.show('ui.undo.demolished', new Uint8Array([2]));

    click(node);

    expect([...(restored[0] ?? [])]).toEqual([2]);
    expect(node.textContent).toContain('Zbouráno');
  });

  it('po pěti sekundách zmizí a už nevrací nic', () => {
    vi.useFakeTimers();
    try {
      const { node, undo, restored } = bar(5000);
      undo.show('ui.undo.demolished', new Uint8Array([9]));

      vi.advanceTimersByTime(5001);

      expect(undo.isVisible()).toBe(false);
      click(node);
      expect(restored).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
