import { expect, test } from '@playwright/test';
import { SITE } from '@hht/shared';
import { dev, me, openPlayer, plots } from './mp-helpers.ts';
import { closePlayers } from './mp-helpers.ts';

// two software-rendered pages per test: allow time to load both
test.describe.configure({ timeout: 150_000 });
test.afterEach(closePlayers);

test('Foreman → Host → a delivered beam is seen by another player', async ({ browser }) => {
  const a = await openPlayer(browser);
  const b = await openPlayer(browser);
  await dev(a.page, 'teleport', SITE.foreman.x, 0, SITE.foreman.z + 1.2);
  await a.page.waitForTimeout(400);
  await a.page.locator('#game').focus();
  await a.page.keyboard.press('KeyE');
  await expect(a.page.getByTestId('foreman-dialog')).toBeVisible();
  await a.page.getByTestId('foreman-start').click();
  await a.page.getByTestId('foreman-build').click();
  await expect.poll(async () => (await me(a.page)).crew?.role, { timeout: 8000 }).toBe('host');
  const plot = (await me(a.page)).crew!.plot;
  await expect.poll(async () => (await plots(b.page))[plot]?.state, { timeout: 8000 }).toBe('building');
  expect((await plots(b.page))[plot]!.hostName).toBe((await me(a.page)).name);
  // deliver a beam into the build zone
  const d = SITE.plots[plot]!;
  await dev(a.page, 'teleport', d.x + Math.sin(d.yaw) * 2.2, 0, d.z + Math.cos(d.yaw) * 2.2);
  await a.page.waitForTimeout(300);
  await dev(a.page, 'give', 'beam');
  await expect.poll(async () => (await me(a.page)).holding, { timeout: 5000 }).toBe('beam');
  await a.page.locator('#game').focus();
  await a.page.keyboard.press('KeyE');
  await expect.poll(async () => (await plots(b.page))[plot]?.filledSlots, { timeout: 5000 }).toBe(1);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});
