import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { openGame } from './helpers.ts';

const budgets = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../tools/assets/budgets.json'), 'utf8')) as {
  render: Record<'high' | 'low', { drawCalls: number; triangles: number }>;
};

for (const tier of ['high', 'low'] as const) {
  test(`perf reference scene within budget (${tier}) @perf`, async ({ page }) => {
    await openGame(page, `perf=1&q=${tier}`);
    await page.waitForFunction(() => (window as Window & { __hhtPerfReady?: boolean }).__hhtPerfReady === true, null, { timeout: 30_000 });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => (window as unknown as { __hht: { render(): Record<string, number> } }).__hht.render());
    console.log(`[perf:${tier}] drawCalls=${r.drawCalls} triangles=${r.triangles} frameMsMedian=${r.frameMsMedian?.toFixed(1)} (informational)`);
    expect(r.drawCalls).toBeLessThanOrEqual(budgets.render[tier].drawCalls);
    expect(r.triangles).toBeLessThanOrEqual(budgets.render[tier].triangles);
  });
}
