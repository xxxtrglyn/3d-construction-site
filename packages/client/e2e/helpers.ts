import { expect, type Page } from '@playwright/test';

export interface HhtState {
  worker: { position: [number, number, number]; grounded: boolean; holding: string | null };
  tower: { completedStages: number; filledSlots: number; stars: number; isMasterpiece: boolean };
  loosePieces: number;
  profile: { name: string; hatColor: string; muted: boolean };
}

type Win = Window & { __hht?: { ready: Promise<void>; state(): HhtState; render(): Record<string, number>; debug: Record<string, (...a: unknown[]) => unknown>; events: EventTarget } };

/** Open the game with the e2e debug API and wait until the worker is playable. */
export async function openGame(page: Page, query = 'e2e=1'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text());
  });
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => !!(window as Win).__hht, null, { timeout: 45_000 });
  await page.evaluate(() => (window as Win).__hht!.ready);
  await expect(page.locator('#loader')).toHaveCount(0, { timeout: 10_000 });
  return errors;
}

export const state = (page: Page): Promise<HhtState> => page.evaluate(() => (window as Win).__hht!.state());

export async function debug(page: Page, fn: string, ...args: unknown[]): Promise<unknown> {
  return page.evaluate(([f, a]) => (window as Win).__hht!.debug[f as string]!(...(a as unknown[])), [fn, args] as const);
}

/** Collect debug-API events fired while `action` runs. */
export async function recordEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as Win & { __events?: string[] };
    w.__events = [];
    for (const e of ['snapped', 'stageComplete', 'masterpiece', 'wrongPiece', 'pickup', 'drop', 'toss']) {
      w.__hht!.events.addEventListener(e, () => w.__events!.push(e));
    }
  });
}

export const events = (page: Page): Promise<string[]> => page.evaluate(() => (window as Window & { __events?: string[] }).__events ?? []);
