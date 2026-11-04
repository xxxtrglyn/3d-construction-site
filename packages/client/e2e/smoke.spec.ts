import { expect, test } from '@playwright/test';
import { openGame, state } from './helpers.ts';

test('loads without login and the worker moves with the keyboard', async ({ page }) => {
  const errors = await openGame(page);
  const before = await state(page);
  expect(before.profile.name.length).toBeGreaterThanOrEqual(3);
  await page.locator('#game').focus();
  // headless browsers render in software (low fps), so hold the key until the worker has moved
  await page.keyboard.down('KeyW');
  const moved = async (): Promise<number> => {
    const now = await state(page);
    return Math.hypot(now.worker.position[0] - before.worker.position[0], now.worker.position[2] - before.worker.position[2]);
  };
  await expect.poll(moved, { timeout: 8_000 }).toBeGreaterThan(0.8);
  await page.keyboard.up('KeyW');
  expect(errors).toEqual([]);
});

test('remembers the guest name and hat color after reload', async ({ page }) => {
  await openGame(page);
  const first = (await state(page)).profile;
  await page.reload();
  await page.waitForFunction(() => !!(window as Window & { __hht?: unknown }).__hht);
  await page.evaluate(() => (window as unknown as { __hht: { ready: Promise<void> } }).__hht.ready);
  const second = (await state(page)).profile;
  expect(second.name).toBe(first.name);
  expect(second.hatColor).toBe(first.hatColor);
});
