import { expect, test } from '@playwright/test';
import { me, openPlayer, players } from './mp-helpers.ts';
import { closePlayers } from './mp-helpers.ts';

// two software-rendered pages per test: allow time to load both
test.describe.configure({ timeout: 150_000 });
test.afterEach(closePlayers);

test('two devices share one world and see each other move', async ({ browser }) => {
  const a = await openPlayer(browser);
  const b = await openPlayer(browser);
  const ma = await me(a.page);
  const mb = await me(b.page);
  expect(await a.page.evaluate(() => (window as never as { __hht: { net: { worldId(): number } } }).__hht.net.worldId())).toBe(await b.page.evaluate(() => (window as never as { __hht: { net: { worldId(): number } } }).__hht.net.worldId()));
  await expect.poll(async () => (await players(b.page)).find((p) => p.sessionId === ma.sessionId)?.drawn, { timeout: 10_000 }).toBe(true);
  const seenByB = (await players(b.page)).find((p) => p.sessionId === ma.sessionId)!;
  expect(seenByB.name).toBe(ma.name);
  // A walks forward; B sees A's position change
  const start = await b.page.evaluate((sid) => (window as never as { __hht: { net: { remotePosition(s: string): number[] | null } } }).__hht.net.remotePosition(sid), ma.sessionId);
  await a.page.locator('#game').focus();
  await a.page.keyboard.down('KeyW');
  await expect.poll(async () => {
    const p = await b.page.evaluate((sid) => (window as never as { __hht: { net: { remotePosition(s: string): number[] | null } } }).__hht.net.remotePosition(sid), ma.sessionId);
    return p && start ? Math.hypot(p[0]! - start[0]!, p[2]! - start[2]!) : 0;
  }, { timeout: 12_000 }).toBeGreaterThan(0.5);
  await a.page.keyboard.up('KeyW');
  await expect(b.page.getByTestId('count')).toHaveText(/^[2-9]\d*$/);
  expect(mb.sessionId).not.toBe(ma.sessionId);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});
