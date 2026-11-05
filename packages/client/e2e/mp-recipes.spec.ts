import { expect, test, type Page } from '@playwright/test';
import { SITE } from '@hht/shared';
import { closePlayers, dev as devRaw, me, mpEvents, openPlayer, plots, send, type NetWin } from './mp-helpers.ts';

// feature 004: mixed-material stages in the shared world (US1–US4)
test.describe.configure({ timeout: 300_000 }); // six paced hand deliveries in a software-rendered page
test.afterEach(closePlayers);

type Need = { type: string; left: number; done: boolean; craneOnly: boolean };
const net = <T>(p: Page, fn: string, ...args: unknown[]): Promise<T> =>
  p.evaluate(([f, a]) => ((window as NetWin).__hht!.net as unknown as Record<string, (...x: unknown[]) => unknown>)[f as string]!(...(a as unknown[])) as T, [fn, args] as const);
const plot$ = async (p: Page, i: number) => (await plots(p))[i]!;
const key = async (p: Page, k: string) => {
  await p.bringToFront();
  await p.locator('#game').focus();
  await p.keyboard.press(k);
};
const lastDev = new WeakMap<Page, number>();
/** dev cheats share the admin rate bucket (2/s): pace them */
async function dev(p: Page, op: string, ...args: unknown[]): Promise<void> {
  const wait = 520 - (Date.now() - (lastDev.get(p) ?? 0));
  if (wait > 0) await p.waitForTimeout(wait);
  lastDev.set(p, Date.now());
  await devRaw(p, op, ...args);
}

async function freshWorld(p: Page): Promise<void> {
  const epoch = await p.evaluate(() => (window as unknown as { __hht: { net: { shift(): { epoch: number } } } }).__hht.net.shift().epoch);
  await dev(p, 'endShiftIn', 0);
  await expect.poll(() => p.evaluate(() => (window as unknown as { __hht: { net: { shift(): { epoch: number } } } }).__hht.net.shift().epoch), { timeout: 15_000 }).toBeGreaterThan(epoch);
  await expect.poll(async () => (await plots(p)).every((x) => x.state === 'free'), { timeout: 5000 }).toBe(true);
}

/** Host a plot with Groundwork done (the Frame is current). */
async function hostFrame(p: Page): Promise<number> {
  await dev(p, 'teleport', SITE.foreman.x, 0, SITE.foreman.z + 1.2);
  await p.waitForTimeout(400);
  await send(p, 'foreman', { op: 'start', blueprint: 'clock-tower' });
  await expect.poll(async () => (await me(p)).crew?.role, { timeout: 8000 }).toBe('host');
  const plot = (await me(p)).crew!.plot;
  await dev(p, 'fillGround', plot);
  await expect.poll(async () => (await plot$(p, plot)).groundPoured, { timeout: 5000 }).toBe(4);
  return plot;
}

/** Stand in the build zone, take a piece from the dev cheat and drop it. */
async function deliverByHand(p: Page, plot: number, type: string): Promise<void> {
  const d = SITE.plots[plot]!;
  await dev(p, 'teleport', d.x + Math.sin(d.yaw) * 2.2, 0, d.z + Math.cos(d.yaw) * 2.2);
  await p.waitForTimeout(250);
  await dev(p, 'give', type);
  await expect.poll(async () => (await me(p)).holding, { timeout: 4000 }).toBe(type);
  await key(p, 'KeyE');
  await expect.poll(async () => (await me(p)).holding, { timeout: 4000 }).toBeNull();
}

const looseNear = (p: Page, type: string, x: number, z: number, r: number) =>
  p.evaluate(([t, px, pz, rr]) => {
    let n = 0;
    ((window as NetWin).__hht as unknown as { game: { conn: { state: { pieces: { forEach(cb: (v: { type: string; state: string; x: number; z: number }) => void): void } } } } })
      .game.conn.state.pieces.forEach((v) => { if (v.type === t && v.state === 'loose' && Math.hypot(v.x - (px as number), v.z - (pz as number)) <= (rr as number)) n++; });
    return n;
  }, [type, x, z, r] as const);

test('a Frame delivered in mixed order snaps into typed ghosts; sign, HUD and Foreman agree (US1, US2)', async ({ browser }) => {
  const a = await openPlayer(browser);
  await freshWorld(a.page);
  const plot = await hostFrame(a.page);
  // typed ghosts: 4 beams + 2 bricks, and the needs everywhere
  await expect.poll(() => net<Record<string, number>>(a.page, 'ghosts'), { timeout: 5000 }).toEqual({ beam: 4, brick: 2 });
  await expect(a.page.getByTestId('crew-needs')).toHaveAttribute('aria-label', 'Beams 4 · Bricks 2', { timeout: 5000 });
  const order = ['brick', 'beam', 'beam', 'brick', 'beam'];
  const expectAB = [[0, 1], [1, 1], [2, 1], [2, 2], [3, 2]];
  for (const [i, type] of order.entries()) {
    await deliverByHand(a.page, plot, type);
    await expect.poll(async () => { const p = await plot$(a.page, plot); return [p.filledA, p.filledB]; }, { timeout: 5000 }).toEqual(expectAB[i]);
  }
  // after 3 beams + 2 bricks: sign, HUD pill and debug needs all say "1 beam, bricks done"
  await expect.poll(() => net<Need[]>(a.page, 'needs'), { timeout: 5000 }).toEqual([
    expect.objectContaining({ type: 'beam', left: 1, done: false }), expect.objectContaining({ type: 'brick', left: 0, done: true }),
  ]);
  await expect(a.page.getByTestId('crew-needs')).toHaveAttribute('aria-label', 'Beams 1 · Bricks ✓', { timeout: 5000 });
  await expect.poll(() => net<Record<string, number>>(a.page, 'ghosts'), { timeout: 5000 }).toEqual({ beam: 1 });
  // the Foreman names what is left
  await dev(a.page, 'teleport', SITE.foreman.x, 0, SITE.foreman.z + 1.2);
  await a.page.waitForTimeout(400);
  await key(a.page, 'KeyE');
  await expect(a.page.getByTestId('foreman-needs')).toHaveText('“Frame: Just 1 beam to go!”', { timeout: 5000 });
  // walking away closes the dialog (the next delivery teleports into the build zone)
  // the last beam completes the Frame
  await deliverByHand(a.page, plot, 'beam');
  await expect.poll(async () => (await plot$(a.page, plot)).completedStages, { timeout: 5000 }).toBe(1);
  await expect(a.page.getByTestId('crew-needs')).toHaveAttribute('aria-label', 'Bricks 6 · Beams 2', { timeout: 5000 });
  expect(a.errors).toEqual([]);
});

test('wrong and surplus pieces are set down beside the plot with templated hints (US3)', async ({ browser }) => {
  const a = await openPlayer(browser);
  await freshWorld(a.page);
  const plot = await hostFrame(a.page);
  const d = SITE.plots[plot]!;
  await deliverByHand(a.page, plot, 'paint');
  await expect.poll(async () => (await mpEvents(a.page, 'hint')).map((e) => e.detail), { timeout: 5000 }).toContainEqual({ kind: 'wrongPiece', needed: ['beam', 'brick'] });
  await expect(a.page.locator('.hud-toast')).toContainText('The Frame needs beams and bricks now', { timeout: 3000 });
  await deliverByHand(a.page, plot, 'brick');
  await deliverByHand(a.page, plot, 'brick');
  await deliverByHand(a.page, plot, 'brick');
  await expect.poll(async () => (await mpEvents(a.page, 'hint')).map((e) => e.detail), { timeout: 5000 }).toContainEqual({ kind: 'surplus', type: 'brick', needed: ['beam'] });
  await expect(a.page.locator('.hud-toast')).toContainText('Enough bricks, the Frame needs beams now', { timeout: 3000 });
  const p = await plot$(a.page, plot);
  expect([p.filledA, p.filledB]).toEqual([0, 2]);
  // never consumed: both refused pieces lie on the ground just outside the build zone
  const r = d.buildZoneRadius + 2.5;
  await expect.poll(() => looseNear(a.page, 'paint', d.x, d.z, r), { timeout: 5000 }).toBe(1);
  await expect.poll(() => looseNear(a.page, 'brick', d.x, d.z, r), { timeout: 5000 }).toBe(1);
  expect(a.errors).toEqual([]);
});

test('the supply bin takes only what the plot still needs (US4, FR-018)', async ({ browser }) => {
  const a = await openPlayer(browser);
  await freshWorld(a.page);
  const b = await openPlayer(browser);
  const plot = await hostFrame(a.page);
  const d = SITE.plots[plot]!;
  // b is not crew: a drop at the bin donates
  const donate = async (type: string) => {
    await dev(b.page, 'teleport', d.bin.x + 0.4, 0, d.bin.z + 0.4);
    await b.page.waitForTimeout(250);
    await dev(b.page, 'give', type);
    await expect.poll(async () => (await me(b.page)).holding, { timeout: 4000 }).toBe(type);
    await key(b.page, 'KeyE');
    await expect.poll(async () => (await me(b.page)).holding, { timeout: 4000 }).toBeNull();
  };
  await donate('beam');
  await expect.poll(async () => (await plot$(a.page, plot)).bin, { timeout: 5000 }).toEqual(['beam']);
  await donate('paint');
  await expect.poll(async () => (await mpEvents(b.page, 'hint')).map((e) => e.detail), { timeout: 5000 }).toContainEqual({ kind: 'binNotNeeded', type: 'paint', needed: ['beam', 'brick'] });
  await expect(b.page.locator('.hud-toast')).toContainText('This plot has enough paint buckets', { timeout: 3000 });
  expect((await plot$(a.page, plot)).bin).toEqual(['beam']);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});
