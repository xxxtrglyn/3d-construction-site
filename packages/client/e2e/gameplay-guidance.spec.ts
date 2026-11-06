import { test, expect } from '@playwright/test';
import { SITE, entryPoint, type MachineState, type MachineSpots } from '@hht/shared';
import { debug, openGame } from './helpers.ts';
import { closePlayers, openPlayer, send, me, dev } from './mp-helpers.ts';
test.afterEach(closePlayers);

test('solo guidance stays optional; machine help survives movement and six seconds', async ({ page }) => {
  const errors = await openGame(page);
  await expect(page.getByTestId('gameplay-guide')).toContainText('excavator');
  await page.getByTestId('toggle-guidance').click();
  await expect(page.getByTestId('gameplay-guide')).toBeHidden();
  await page.getByTestId('toggle-guidance').click();
  await expect(page.getByTestId('gameplay-guide')).toBeVisible();
  const entry = await page.evaluate(() => {
    const api = (window as unknown as { __hht: { machines(): MachineState[]; machineSpots(): MachineSpots } }).__hht;
    return { state: api.machines()[1]!, spots: api.machineSpots() };
  });
  const e = entryPoint(entry.state, entry.spots);
  await debug(page, 'teleport', e.x + .4, .2, e.z);
  await expect(page.locator('.net-prompt')).toContainText('Get in');
  await page.locator('#game').focus();
  await page.keyboard.press('KeyE');
  await expect(page.getByTestId('machine-hint')).toBeVisible();
  await page.keyboard.down('KeyW'); await page.waitForTimeout(200); await page.keyboard.up('KeyW');
  await page.waitForTimeout(6200);
  await expect(page.getByTestId('machine-hint')).toBeVisible();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await expect(page.getByTestId('machine-hint')).toBeHidden();
  await page.getByRole('button', { name: 'Machine help', exact: true }).click();
  await expect(page.getByTestId('machine-hint')).toBeVisible();
  await page.screenshot({ path: '../../reports/004-guidance-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '../../reports/004-guidance-mobile.png' });
  const bounds = await page.getByTestId('machine-hint').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

test('multiplayer guidance follows crew assignment, departure and reset', async ({ browser }) => {
  const { page, errors } = await openPlayer(browser);
  await expect(page.getByTestId('gameplay-guide')).toContainText('Foreman');
  await dev(page, 'teleport', SITE.foreman.x, 0, SITE.foreman.z + 1.2);
  await page.waitForTimeout(500);
  await send(page, 'foreman', { op: 'start', blueprint: 'clock-tower' });
  await expect.poll(async () => (await me(page)).crew?.plot).toBeGreaterThanOrEqual(0);
  await expect(page.getByTestId('gameplay-guide')).toContainText('excavator');
  await send(page, 'crew', { op: 'leave' });
  await expect(page.getByTestId('gameplay-guide')).toContainText('Foreman');
  await page.waitForTimeout(600);
  await dev(page, 'endShiftIn', 0);
  await page.getByRole('button', { name: 'Start the new shift', exact: true }).click();
  await expect(page.getByTestId('gameplay-guide')).toContainText('Foreman');
  expect(errors).toEqual([]);
});

test('help adapts to device bindings and old seen hints never count as learning', async ({ browser }) => {
  const { page, errors } = await openPlayer(browser);
  await expect(page.getByTestId('gameplay-guide')).toContainText('Foreman');
  await page.evaluate(() => {
    const game = (window as unknown as { __hht: { game: {
      profile: { update(v: unknown): void };
      machineHints: { onEnter(kind: string): void };
    } } }).__hht.game;
    game.profile.update({ seenMachineHints: ['forklift'], completedMachineHints: [] });
    game.machineHints.onEnter('forklift');
  });
  await expect(page.getByTestId('machine-hint')).toBeVisible();
  for (const [device, label] of [['touch', 'Action action'], ['gamepad', 'X / Square action'], ['keyboard', 'E action']]) {
    await page.evaluate(d => {
      (window as unknown as { __hht: { game: { actions: { lastDevice: string } } } }).__hht.game.actions.lastDevice = d!;
    }, device);
    await expect(page.getByTestId('machine-hint')).toContainText(label!);
  }
  await page.getByTestId('toggle-guidance').click();
  await expect(page.getByTestId('machine-hint')).toBeHidden();
  await page.getByRole('button', { name: 'Machine help', exact: true }).click();
  await expect(page.getByTestId('machine-hint')).toBeVisible();
  expect(errors).toEqual([]);
});
