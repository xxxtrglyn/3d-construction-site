import { test, expect } from '@playwright/test';
import { debug, openGame, state } from './helpers.ts';
import { closePlayers, openPlayer } from './mp-helpers.ts';
test('reduced motion and muted audio preserve refusal recovery and progress', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await openGame(page);
  await page.getByRole('button', { name: 'Toggle sound', exact: true }).click();
  expect(await debug(page, 'deliver', 'beam')).toBe('groundworkFirst');
  await expect(page.locator('.hud-toast')).toContainText('excavator');
  expect((await state(page)).tower.filledSlots).toBe(0);
  await debug(page, 'completeGroundwork');
  // paint is not in the Frame's recipe (beams + bricks): the shared needs text names what is needed
  expect(await debug(page, 'deliver', 'paint')).toBe('wrongPiece');
  await expect(page.locator('.hud-toast')).toContainText('needs beams and bricks');
  expect((await state(page)).tower.filledSlots).toBe(0);
  await debug(page, 'completeStage'); await debug(page, 'completeStage');
  await debug(page, 'deliver', 'panel'); // the Roof's one ordinary panel slot; the other 3 are crane-only
  expect(await debug(page, 'deliver', 'panel')).toBe('tooHigh');
  await expect(page.locator('.hud-toast')).toContainText('striped pad');
  expect(errors).toEqual([]);
});

// UI contract coverage complements the real server permission/capacity tests.
test.afterEach(closePlayers);
test('server refusal events remain local, actionable, and do not show success', async ({ browser }) => {
  const { page, errors } = await openPlayer(browser);
  const refusals = [
    [{ kind: 'binFull' }, 'keep the material'],
    [{ kind: 'mixerFull' }, 'ground'],
    [{ kind: 'notCrew' }, 'Join this crew'],
    [{ kind: 'tooHigh' }, 'striped pad'],
    [{ kind: 'wrongPiece', needed: ['beam'] }, 'needs beams'],
  ] as const;
  for (const [payload, expected] of refusals) {
    await page.evaluate(detail => {
      const game = (window as unknown as { __hht: { game: { conn: { events: EventTarget } } } }).__hht.game;
      game.conn.events.dispatchEvent(new CustomEvent('hint', { detail }));
    }, payload);
    await expect(page.locator('.hud-toast')).toContainText(expected);
    await expect(page.locator('.hud-toast')).not.toContainText('✓');
  }
  await page.evaluate(() => {
    const game = (window as unknown as { __hht: { game: { conn: { events: EventTarget } } } }).__hht.game;
    game.conn.events.dispatchEvent(new CustomEvent('machineResult', { detail: { result: 'busy' } }));
  });
  await expect(page.locator('.hud-toast')).toContainText('prepare supplies');
  expect(errors).toEqual([]);
});
