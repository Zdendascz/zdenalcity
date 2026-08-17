import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

/**
 * Negativní test hranic P1/P2.
 *
 * Smysl: samo o sobě nestačí, že `npm run lint` prochází — to by platilo
 * i kdyby se pravidla v eslint.config.js rozbila překlepem. Tenhle test
 * pouští ESLint programově na kód, který hranice **porušuje**, a ověřuje,
 * že chyba opravdu vznikne.
 *
 * Kontrolní případ na konci ověřuje opak: mimo `src/sim/` stejný import
 * projít musí, jinak by test procházel i při pravidle zakazujícím všechno.
 */

const eslint = new ESLint();

/** Vrátí ID pravidel, která se na daném (virtuálním) souboru spustila. */
async function ruleIdsFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? '');
}

describe('P1 — simulace nezná renderer', () => {
  it('zakáže import Pixi v src/sim/', async () => {
    const ruleIds = await ruleIdsFor(
      `import { Application } from 'pixi.js';\nexport const a = Application;\n`,
      'src/sim/__probe.ts',
    );
    expect(ruleIds).toContain('no-restricted-imports');
  });

  it('zakáže import ze src/render/ v src/sim/', async () => {
    const ruleIds = await ruleIdsFor(
      `import { camera } from '../render/camera';\nexport const a = camera;\n`,
      'src/sim/__probe.ts',
    );
    expect(ruleIds).toContain('no-restricted-imports');
  });

  it('zakáže DOM globály v src/sim/', async () => {
    const ruleIds = await ruleIdsFor(
      `export const w = window.innerWidth;\n`,
      'src/sim/__probe.ts',
    );
    expect(ruleIds).toContain('no-restricted-globals');
  });
});

describe('P2 — determinismus', () => {
  it('zakáže Math.random() v src/sim/', async () => {
    const ruleIds = await ruleIdsFor(
      `export const r = Math.random();\n`,
      'src/sim/__probe.ts',
    );
    expect(ruleIds).toContain('no-restricted-properties');
  });

  it('zakáže Date.now() v src/sim/', async () => {
    const ruleIds = await ruleIdsFor(
      `export const t = Date.now();\n`,
      'src/sim/__probe.ts',
    );
    expect(ruleIds).toContain('no-restricted-properties');
  });

  it('zakáže new Date() v src/sim/', async () => {
    const ruleIds = await ruleIdsFor(
      `export const d = new Date();\n`,
      'src/sim/__probe.ts',
    );
    expect(ruleIds).toContain('no-restricted-syntax');
  });
});

describe('kontrolní případ — hranice platí jen pro sim/save/content', () => {
  it('povolí import Pixi v src/render/', async () => {
    const ruleIds = await ruleIdsFor(
      `import { Application } from 'pixi.js';\nexport const a = Application;\n`,
      'src/render/__probe.ts',
    );
    expect(ruleIds).not.toContain('no-restricted-imports');
  });

  it('povolí Math.random() v src/render/', async () => {
    const ruleIds = await ruleIdsFor(
      `export const r = Math.random();\n`,
      'src/render/__probe.ts',
    );
    expect(ruleIds).not.toContain('no-restricted-properties');
  });
});
