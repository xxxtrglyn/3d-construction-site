import { expect, test } from '@playwright/test';
import { debug, events, openGame, recordEvents, state } from './helpers.ts';

test('masterpiece celebrates and "Build again" resets the plot', async ({ page }) => {
  await openGame(page);
  await recordEvents(page);
  await debug(page, 'completeAll');
  const s = await state(page);
  expect(s.tower).toMatchObject({ completedStages: 6, stars: 5, isMasterpiece: true });
  expect(await events(page)).toContain('masterpiece');
  const button = page.locator('.hud-celebrate .hud-btn');
  await expect(button).toBeVisible();
  await button.click();
  const r = await state(page);
  expect(r.tower).toMatchObject({ completedStages: 0, filledSlots: 0, isMasterpiece: false });
  expect(r.loosePieces).toBe(0);
});
