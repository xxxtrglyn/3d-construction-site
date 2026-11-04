import { isValidGuestName } from './guestName.ts';

/**
 * Makes a guest name unique within a world: duplicates get a two-digit suffix ("Sunny Bolt 10", "… 11")
 * so the result always stays a valid generated name (≤ 20 chars, list words only).
 */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  const words = base.split(' ');
  const stem = `${words[0] ?? ''} ${words[1] ?? ''}`;
  if (!taken.has(stem) && isValidGuestName(stem)) return stem;
  for (let n = 10; n <= 99; n++) {
    const candidate = `${stem} ${n}`;
    if (!taken.has(candidate) && isValidGuestName(candidate)) return candidate;
  }
  return base;
}
