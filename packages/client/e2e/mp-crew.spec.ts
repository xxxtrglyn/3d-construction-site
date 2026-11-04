import { expect, test, type Page } from '@playwright/test';
import { SITE } from '@hht/shared';
import { dev, me, openPlayer, plots, send } from './mp-helpers.ts';
import { closePlayers } from './mp-helpers.ts';

// two software-rendered pages per test: allow time to load both
test.describe.configure({ timeout: 150_000 });
test.afterEach(closePlayers);

async function hostAPlot(p: Page): Promise<number> {
  await dev(p, 'teleport', SITE.foreman.x, 0, SITE.foreman.z + 1.2);
  await p.waitForTimeout(400);
  await send(p, 'foreman', { op: 'start', blueprint: 'clock-tower' });
  await expect.poll(async () => (await me(p)).crew?.role, { timeout: 8000 }).toBe('host');
  return (await me(p)).crew!.plot;
}

async function askAtSign(p: Page, plot: number): Promise<void> {
  const d = SITE.plots[plot]!;
  await dev(p, 'teleport', d.sign.x, 0, d.sign.z);
  await p.waitForTimeout(400);
  await p.locator('#game').focus();
  await p.keyboard.press('KeyE');
}

test('ask at the sign → Host approves with Y → shared flag and the member can build', async ({ browser }) => {
  const a = await openPlayer(browser);
  const b = await openPlayer(browser);
  const plot = await hostAPlot(a.page);
  await askAtSign(b.page, plot);
  await expect(a.page.getByTestId('request-cards').locator('.req-card')).toHaveCount(1, { timeout: 8000 });
  await a.page.locator('#game').focus();
  await a.page.keyboard.press('KeyY');
  await expect.poll(async () => (await me(b.page)).crew?.plot, { timeout: 8000 }).toBe(plot);
  expect((await me(b.page)).crew?.role).toBe('member');
  const d = SITE.plots[plot]!;
  await dev(b.page, 'teleport', d.x + Math.sin(d.yaw) * 2.2, 0, d.z + Math.cos(d.yaw) * 2.2);
  await b.page.waitForTimeout(300);
  await dev(b.page, 'give', 'beam');
  await expect.poll(async () => (await me(b.page)).holding, { timeout: 5000 }).toBe('beam');
  await b.page.locator('#game').focus();
  await b.page.keyboard.press('KeyE');
  await expect.poll(async () => (await plots(a.page))[plot]?.filledSlots, { timeout: 5000 }).toBe(1);
});

test('deny → asking again shows the cooldown', async ({ browser }) => {
  const a = await openPlayer(browser);
  const b = await openPlayer(browser);
  const plot = await hostAPlot(a.page);
  await askAtSign(b.page, plot);
  await expect(a.page.getByTestId('request-cards').locator('.req-card')).toHaveCount(1, { timeout: 8000 });
  await a.page.getByTestId('deny').click();
  await expect(b.page.locator('.hud-toast')).toHaveText(/not this time/, { timeout: 5000 });
  await b.page.waitForTimeout(500);
  await b.page.locator('#game').focus();
  await b.page.keyboard.press('KeyE');
  await expect(b.page.locator('.hud-toast')).toHaveText(/ask again in \d+s/, { timeout: 5000 });
});
