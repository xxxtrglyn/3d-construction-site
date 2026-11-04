import { expect, test } from '@playwright/test';
import { debug, openGame, state } from './helpers.ts';

test('the tower progresses through the stages and gains stars', async ({ page }) => {
  const errors = await openGame(page);
  const stars: number[] = [];
  for (let i = 0; i < 5; i++) {
    await debug(page, 'completeStage');
    stars.push((await state(page)).tower.stars);
  }
  expect(stars).toEqual([1, 2, 3, 4, 5]);
  expect((await state(page)).tower.completedStages).toBe(5);
  // deferred stage models stream in without errors
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});
