import { expect, test } from '@playwright/test';
import { debug, events, openGame, recordEvents, state } from './helpers.ts';

test('a matching piece dropped in the build zone snaps; a wrong one is refused', async ({ page }) => {
  await openGame(page);
  await debug(page, 'completeGroundwork'); // feature 003: Groundwork is covered by solo-machines.spec.ts
  await recordEvents(page);
  await page.locator('#game').focus();
  // stand in the build zone in front of the tower (plot center z = -2.5)
  await debug(page, 'teleport', 0, 0.2, -0.2);
  await page.waitForTimeout(250);
  await debug(page, 'give', 'beam');
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(60);
  await page.keyboard.up('KeyE');
  await expect.poll(async () => (await state(page)).tower.filledSlots, { timeout: 5_000 }).toBe(1);

  await debug(page, 'give', 'brick');
  await page.keyboard.press('KeyE');
  await expect.poll(() => events(page), { timeout: 5_000 }).toContain('wrongPiece');
  const s = await state(page);
  expect(s.tower).toMatchObject({ completedStages: 0, filledSlots: 1 });
  expect(await events(page)).toEqual(expect.arrayContaining(['drop', 'snapped', 'wrongPiece']));
});

test('a tossed piece flies and can be picked up again', async ({ page }) => {
  await openGame(page);
  await page.locator('#game').focus();
  await debug(page, 'teleport', -5, 0.2, 6);
  await page.waitForTimeout(200);
  await debug(page, 'give', 'cone');
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(1500);
  const s = await state(page);
  expect(s.worker.holding).toBeNull();
  expect(s.loosePieces).toBe(1);
});
