/**
 * @vitest-environment jsdom
 *
 * Město, které se minule nepodařilo načíst.
 *
 * Hráč o něj přišel kvůli chybě v loaderu, ne kvůli poškozenému souboru. Po
 * opravě ho má dostat zpátky jedním klepnutím — nemá tušit, že si ho může
 * stáhnout a nahrát jako soubor. Hlídá se i to, aby rozcestník nenabízel
 * otevření města, které se pořád nenačte, a aby hráč věděl, že otevření
 * nahradí město, které mezitím rozehrál.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { showHome } from '@/ui/home';
import type { HomeChoice, HomeOptions } from '@/ui/home';
import { I18n } from '@/ui/i18n';
import type { LocaleTables } from '@/ui/i18n';

async function openHome(
  options: Partial<HomeOptions>,
): Promise<{ i18n: I18n; parent: HTMLElement; choice: Promise<HomeChoice> }> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  const tables: Record<string, Record<string, string>> = {};
  for (const language of content.getLanguages()) tables[language] = content.getLocaleTable(language);
  const i18n = new I18n(tables as LocaleTables, 'cs');

  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const choice = showHome(parent, i18n, content.getBalance(), {
    canResume: false,
    readFile: () => Promise.resolve(new Uint8Array(0)),
    ...options,
  });
  return { i18n, parent, choice };
}

function buttonWithText(parent: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...parent.querySelectorAll('button')].find((node) => node.textContent === text);
}

const noop = (): void => {};

afterEach(() => {
  document.body.replaceChildren();
});

describe('poškozené město na rozcestníku', () => {
  it('když ho tahle verze přečte, nabídne jeho otevření', async () => {
    const { i18n, parent, choice } = await openHome({
      damaged: { download: noop, discard: noop, restorable: true },
    });

    const restore = buttonWithText(parent, i18n.t('ui.home.damagedRestore'));
    expect(restore).toBeDefined();
    restore?.click();

    await expect(choice).resolves.toEqual({ kind: 'damaged' });
  });

  it('město, které se pořád nenačte, otevřít nenabízí', async () => {
    const { i18n, parent } = await openHome({
      damaged: { download: noop, discard: noop, restorable: false },
    });

    expect(buttonWithText(parent, i18n.t('ui.home.damagedRestore'))).toBeUndefined();
    expect(buttonWithText(parent, i18n.t('ui.home.damagedDownload'))).toBeDefined();
    expect(parent.textContent).toContain(i18n.t('ui.home.damaged'));
  });

  it('upozorní, že otevření nahradí rozehrané město', async () => {
    const { i18n, parent } = await openHome({
      canResume: true,
      damaged: { download: noop, discard: noop, restorable: true },
    });

    expect(parent.textContent).toContain(i18n.t('ui.home.damagedRestoreReplaces'));
  });

  it('bez rozehraného města nemá co nahradit a neříká to', async () => {
    const { i18n, parent } = await openHome({
      canResume: false,
      damaged: { download: noop, discard: noop, restorable: true },
    });

    expect(parent.textContent).not.toContain(i18n.t('ui.home.damagedRestoreReplaces'));
  });
});
