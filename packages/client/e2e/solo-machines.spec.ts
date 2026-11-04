import { expect, test, type Page } from '@playwright/test';
import { EXCAVATOR_REACH, entryPoint, type MachineKind, type MachineSpots, type MachineState } from '@hht/shared';
import { debug, openGame, state } from './helpers.ts';

// feature 003: the solo lot has all four machines, Groundwork and the high slots (FR-042, FR-043)
test.describe.configure({ timeout: 240_000 });

type SoloWin = Window & { __hht: Record<string, (...a: unknown[]) => unknown> };
const api = <T>(p: Page, fn: string): Promise<T> => p.evaluate((f) => (window as unknown as SoloWin).__hht[f]!() as T, fn);
const machines = (p: Page) => api<Array<MachineState & { operator: string }>>(p, 'machines');
const KINDS: MachineKind[] = ['crane', 'excavator', 'forklift', 'mixer'];
const key = async (p: Page, k: string) => {
  await p.bringToFront();
  await p.locator('#game').focus();
  await p.keyboard.press(k);
};
/** Software rendering runs the sim slower than real time: wait for the machine to be idle with `load`. */
const idleWith = async (p: Page, kind: MachineKind, load: string) => {
  await expect.poll(async () => {
    const m = (await machines(p))[KINDS.indexOf(kind)]!;
    return `${m.phase}:${m.load.kind}`;
  }, { timeout: 40_000 }).toBe(`idle:${load}`);
};

async function getIn(p: Page, kind: MachineKind, spots: MachineSpots): Promise<void> {
  const m = (await machines(p))[KINDS.indexOf(kind)]!;
  const e = entryPoint(m, spots);
  await debug(p, 'teleport', e.x + 0.4, 0.2, e.z);
  await p.waitForTimeout(400);
  await expect(p.locator('.net-prompt')).toContainText('Get in', { timeout: 5000 });
  await key(p, 'KeyE');
  await expect.poll(() => api<number>(p, 'myMachine'), { timeout: 5000 }).toBe(KINDS.indexOf(kind));
}

async function getOut(p: Page): Promise<void> {
  await key(p, 'Space');
  await expect.poll(() => api<number>(p, 'myMachine'), { timeout: 5000 }).toBe(-1);
}

async function dropAt(p: Page, type: string, x: number, z: number): Promise<void> {
  await debug(p, 'teleport', x, 0.2, z);
  await p.waitForTimeout(250);
  await debug(p, 'give', type);
  await key(p, 'KeyE');
  await expect.poll(async () => (await state(p)).worker.holding, { timeout: 4000 }).toBeNull();
}

async function lift(p: Page, spots: MachineSpots, type: string, to: { x: number; z: number }): Promise<void> {
  await dropAt(p, type, spots.hookPad.x, spots.hookPad.z - 0.25);
  await p.waitForTimeout(800); // let it settle on the pad
  const loose = await api<Array<{ type: string; x: number; z: number }>>(p, 'loosePieces');
  const piece = loose.find((l) => l.type === type)!;
  await getIn(p, 'crane', spots);
  const c = spots.crane;
  const aim = async (x: number, z: number) => debug(p, 'machinePose', 'crane', { p1: Math.atan2(x - c.x, z - c.z), p2: Math.hypot(x - c.x, z - c.z) });
  await aim(piece.x, piece.z);
  await key(p, 'KeyE');
  await idleWith(p, 'crane', 'hook');
  await aim(to.x + 0.6, to.z);
  await expect.poll(() => api<unknown>(p, 'snapRing'), { timeout: 3000 }).not.toBeNull();
  await key(p, 'KeyE');
  await idleWith(p, 'crane', 'none');
  await getOut(p);
}

test('solo: Groundwork with the excavator and the mixer, the crane lifts a roof panel and the bell; no server traffic', async ({ page }) => {
  const net: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/|\/ws/.test(r.url())) net.push(r.url());
  });
  const errors = await openGame(page);
  const spots = await api<MachineSpots>(page, 'machineSpots');
  expect((await state(page) as unknown as { plot: { groundwork: { dug: number } } }).plot.groundwork.dug).toBe(0);
  await expect.poll(() => api<{ machine: string | null }>(page, 'cue'), { timeout: 3000 }).toMatchObject({ machine: 'excavator' });
  // the excavator digs 6 scoops
  await getIn(page, 'excavator', spots);
  const aim = async (x: number, z: number) => {
    const a = Math.atan2(x - spots.center.x, z - spots.center.z) + Math.PI;
    const bx = x + Math.sin(a) * EXCAVATOR_REACH;
    const bz = z + Math.cos(a) * EXCAVATOR_REACH;
    await debug(page, 'machinePose', 'excavator', { x: bx, z: bz, yaw: Math.atan2(x - bx, z - bz) });
  };
  for (let i = 1; i <= 6; i++) {
    await aim(spots.center.x, spots.center.z);
    await key(page, 'KeyE');
    await idleWith(page, 'excavator', 'dirt');
    await aim(spots.spoil.x, spots.spoil.z);
    await key(page, 'KeyE');
    await expect.poll(async () => (await state(page) as unknown as { plot: { groundwork: { dug: number } } }).plot.groundwork.dug, { timeout: 20_000 }).toBe(i);
    await idleWith(page, 'excavator', 'none');
  }
  await getOut(page);
  await expect.poll(() => api<{ machine: string | null }>(page, 'cue'), { timeout: 3000 }).toMatchObject({ machine: 'mixer' });
  // 4 cement bags into the hopper, then mix
  for (let i = 1; i <= 4; i++) {
    await dropAt(page, 'cement', spots.mixer.hopper.x, spots.mixer.hopper.z);
    await expect.poll(async () => (await state(page) as unknown as { plot: { mixerBags: number } }).plot.mixerBags, { timeout: 6000 }).toBe(i);
  }
  await getIn(page, 'mixer', spots);
  await key(page, 'KeyE');
  await expect.poll(async () => (await state(page) as unknown as { plot: { mixerBags: number } }).plot.mixerBags, { timeout: 15_000 }).toBe(0);
  await getOut(page);
  // pour 4 buckets (carried by hand: given here)
  const p0 = { x: spots.center.x, z: spots.center.z + 2.4 };
  for (let i = 1; i <= 4; i++) {
    await dropAt(page, 'concrete', p0.x, p0.z);
    await expect.poll(async () => (await state(page) as unknown as { plot: { groundwork: { poured: number } } }).plot.groundwork.poured, { timeout: 6000 }).toBe(i);
  }
  expect((await state(page) as unknown as { plot: { groundwork: { done: boolean } } }).plot.groundwork.done).toBe(true);
  // hand stages by debug shortcut; Roof & Windows: 3 hand panels, then the crane for a roof slot
  await debug(page, 'completeStage');
  await debug(page, 'completeStage');
  for (let i = 0; i < 3; i++) await debug(page, 'deliver', 'panel');
  expect(await debug(page, 'deliver', 'panel')).toBe('tooHigh');
  const roof = spots.highSlots[2]![0]!;
  await lift(page, spots, 'panel', roof);
  await expect.poll(async () => (await state(page) as unknown as { plot: { highFilled: number } }).plot.highFilled, { timeout: 5000 }).toBe(1);
  // finish to the Masterpiece stage; the bell goes up by crane
  for (let i = 0; i < 3; i++) await debug(page, 'completeStage');
  expect((await state(page)).tower.completedStages).toBe(5);
  await lift(page, spots, 'bell', spots.highSlots[5]![0]!);
  await expect.poll(async () => (await state(page)).tower.isMasterpiece, { timeout: 5000 }).toBe(true);
  expect(net).toEqual([]);
  expect(errors).toEqual([]);
});
