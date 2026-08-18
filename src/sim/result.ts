/**
 * Výsledek hráčského příkazu.
 *
 * Simulace nesmí mlčet. Když příkaz neprojde, musí říct **proč** — jinak hráč
 * kliká a nic se neděje bez vysvětlení. Důvod je lokalizační klíč, ne text:
 * v `sim/` není ani jedno uživatelsky viditelné slovo (§10).
 */

export interface CommandRejection {
  ok: false;
  /** Lokalizační klíč, např. `error.needsRoad`. */
  reason: string;
  params?: Record<string, string | number>;
}

export type CommandResult = { ok: true } | CommandRejection;

export const OK: CommandResult = { ok: true };

export function reject(
  reason: string,
  params?: Record<string, string | number>,
): CommandRejection {
  return params ? { ok: false, reason, params } : { ok: false, reason };
}
