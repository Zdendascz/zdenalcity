import { validateBalance } from '@/content/balance';
import type { Balance } from '@/content/balance';

/**
 * Skutečný vanilla balanc pro testy.
 *
 * Načítá se přímo z `content/vanilla/balance.json`, ne z ručně opsaných čísel —
 * testy tak ověřují chování s hodnotami, se kterými se hraje, a nemůžou se
 * s obsahem rozejít.
 */
const modules = import.meta.glob('../../content/vanilla/balance.json', {
  eager: true,
  import: 'default',
});

const raw = Object.values(modules)[0];
const result = validateBalance(raw);

if (!result.balance) {
  throw new Error(
    `content/vanilla/balance.json je nevalidní: ${result.issues
      .map((issue) => `${issue.field} — ${issue.message}`)
      .join(', ')}`,
  );
}

export const VANILLA_BALANCE: Balance = result.balance;
