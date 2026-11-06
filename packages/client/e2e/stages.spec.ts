import { expect, test } from '@playwright/test';
import { debug, openGame, state } from './helpers.ts';

test('the tower progresses through the stages and gains stars', async ({ page }) => {
  const errors = await openGame(page);
  const stars: number[] = [];
  // feature 004: after each stage the HUD shows the next stage's two materials (contracts/needs-display.md)
  const next = ['Bricks 6 · Beams 2', 'Panels 4 · Beams 2', 'Paint buckets 3 · Panels 1', 'Decor crates 3 · Paint buckets 2', 'Golden bells 1 🏗️ · Decor crates 1'];
  const chips: string[] = [];
  for (let i = 0; i < 5; i++) {
    await debug(page, 'completeStage');
    stars.push((await state(page)).tower.stars);
    chips.push((await page.getByTestId('hud-needs').getAttribute('aria-label')) ?? '');
  }
  expect(stars).toEqual([1, 2, 3, 4, 5]);
  expect(chips).toEqual(next);
  expect((await state(page)).tower.completedStages).toBe(5);
  // deferred stage models stream in without errors
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});
