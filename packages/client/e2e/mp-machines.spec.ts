import { expect, test, type Page } from '@playwright/test';
import { EXCAVATOR_REACH, FORK_REACH, SITE, entryPoint, machineId, openSlotRefs, parkedState, type MachineKind } from '@hht/shared';
import { closePlayers, dev as devRaw, me, mpEvents, openPlayer, plots, send, type NetWin } from './mp-helpers.ts';

// feature 003: machines in the shared world (two software-rendered pages per test)
test.describe.configure({ timeout: 180_000 });
test.afterEach(closePlayers);

type Plot = { groundDug: number; groundPoured: number; highFilled: number; mixerBags: number; hookType: string; palletTypes: string[]; filledSlots: number; filledA: number; filledB: number; completedStages: number; state: string };
type MachineInfo = { id: number; kind: MachineKind; x: number; z: number; yaw: number; p1: number; p2: number; p3: number; phase: string; operator: string };
const net = <T>(p: Page, fn: string, ...args: unknown[]): Promise<T> =>
  p.evaluate(([f, a]) => ((window as NetWin).__hht!.net as unknown as Record<string, (...x: unknown[]) => unknown>)[f as string]!(...(a as unknown[])) as T, [fn, args] as const);
const plot$ = async (p: Page, i: number) => (await plots(p))[i] as unknown as Plot;
const machine = async (p: Page, id: number) => (await net<MachineInfo[]>(p, 'machines')).find((m) => m.id === id)!;
const key = async (p: Page, k: string) => {
  await p.bringToFront(); // background tabs get throttled animation frames
  await p.locator('#game').focus();
  await p.keyboard.press(k);
};
const promptText = (p: Page) => p.locator('.net-prompt').textContent();
const rate = (p: Page) => p.waitForTimeout(560); // admin / machine intents are rate-limited
/** dev cheats share the admin rate bucket (2/s): pace them so none is dropped */
const lastDev = new WeakMap<Page, number>();
async function dev(p: Page, op: string, ...args: unknown[]): Promise<void> {
  const wait = 520 - (Date.now() - (lastDev.get(p) ?? 0));
  if (wait > 0) await p.waitForTimeout(wait);
  lastDev.set(p, Date.now());
  await devRaw(p, op, ...args);
}

/** One server serves the whole e2e run: start every machine test on a fresh shift (all plots free). */
async function freshWorld(p: Page): Promise<void> {
  const epoch = await p.evaluate(() => (window as unknown as { __hht: { net: { shift(): { epoch: number } } } }).__hht.net.shift().epoch);
  await dev(p, 'endShiftIn', 0);
  await expect.poll(() => p.evaluate(() => (window as unknown as { __hht: { net: { shift(): { epoch: number } } } }).__hht.net.shift().epoch), { timeout: 15_000 }).toBeGreaterThan(epoch);
  await expect.poll(async () => (await plots(p)).every((x) => x.state === 'free'), { timeout: 5000 }).toBe(true);
}

async function hostAPlot(p: Page, groundwork = false): Promise<number> {
  await dev(p, 'teleport', SITE.foreman.x, 0, SITE.foreman.z + 1.2);
  await p.waitForTimeout(400);
  await send(p, 'foreman', { op: 'start', blueprint: 'clock-tower' });
  await expect.poll(async () => (await me(p)).crew?.role, { timeout: 8000 }).toBe('host');
  const plot = (await me(p)).crew!.plot;
  if (!groundwork) {
    await rate(p);
    await dev(p, 'fillGround', plot);
    await expect.poll(async () => (await plot$(p, plot)).groundPoured, { timeout: 5000 }).toBe(4);
  }
  return plot;
}

async function joinCrew(host: Page, p: Page, plot: number): Promise<void> {
  await send(host, 'crew', { op: 'mode', mode: 'open' });
  await rate(host);
  await send(p, 'crew', { op: 'request', plot });
  await expect.poll(async () => (await me(p)).crew?.plot, { timeout: 8000 }).toBe(plot);
}

/** Walk up to a machine's cab and press E. */
async function getIn(p: Page, plot: number, kind: MachineKind): Promise<void> {
  const m = await machine(p, machineId(plot, kind));
  const e = entryPoint({ ...parkedState(m.id, SITE.machines[plot]!), x: m.x, z: m.z, yaw: m.yaw, p1: m.p1 }, SITE.machines[plot]!);
  await dev(p, 'teleport', e.x + 0.4, 0, e.z);
  await p.waitForTimeout(500);
  await expect.poll(() => promptText(p), { timeout: 4000 }).toContain('Get in');
  await key(p, 'KeyE');
  await expect.poll(() => net<number>(p, 'myMachine'), { timeout: 5000 }).toBe(m.id);
}

async function getOut(p: Page): Promise<void> {
  await key(p, 'Space');
  await expect.poll(() => net<number>(p, 'myMachine'), { timeout: 5000 }).toBe(-1);
  await rate(p);
}

/**
 * Software rendering runs the 60 Hz sim slower than real time (frames are clamped to 50 ms), so wait on
 * state, not time: the own machine is idle and holds `load`.
 */
async function idleWith(p: Page, id: number, load: string): Promise<void> {
  await expect.poll(async () => {
    const m = (await net<Array<MachineInfo & { load: { kind?: string } }>>(p, 'machines')).find((x) => x.id === id)!;
    return `${m.phase}:${m.load.kind ?? ''}`;
  }, { timeout: 40_000 }).toBe(`idle:${load}`);
}

/** Aim the crane hook (test shortcut for steering) at (x, z). */
async function aimHook(p: Page, plot: number, x: number, z: number): Promise<void> {
  const c = SITE.machines[plot]!.crane;
  await dev(p, 'machinePose', machineId(plot, 'crane'), { p1: Math.atan2(x - c.x, z - c.z), p2: Math.hypot(x - c.x, z - c.z) });
  await p.waitForTimeout(400);
}

/** Put a piece on the plot's hook pad (dropped by hand). */
async function pieceOnPad(p: Page, plot: number, type: string): Promise<void> {
  const pad = SITE.machines[plot]!.hookPad;
  await dev(p, 'teleport', pad.x, 0, pad.z);
  await p.waitForTimeout(300);
  await dev(p, 'give', type);
  await expect.poll(async () => (await me(p)).holding, { timeout: 4000 }).toBe(type);
  await key(p, 'KeyE');
  await expect.poll(async () => (await me(p)).holding, { timeout: 4000 }).toBeNull();
}

async function hookPiece(p: Page, plot: number): Promise<{ x: number; z: number }> {
  const pc = await p.evaluate(() => {
    const out: Array<{ x: number; z: number }> = [];
    ((window as NetWin).__hht as unknown as { game: { conn: { state: { pieces: { forEach(cb: (v: { x: number; z: number }) => void): void } } } } }).game.conn.state.pieces.forEach((v) => out.push({ x: v.x, z: v.z }));
    return out;
  });
  const pad = SITE.machines[plot]!.hookPad;
  const near = pc.sort((a, b) => Math.hypot(a.x - pad.x, a.z - pad.z) - Math.hypot(b.x - pad.x, b.z - pad.z))[0]!;
  await aimHook(p, plot, near.x, near.z);
  await key(p, 'KeyE');
  await idleWith(p, machineId(plot, 'crane'), 'hook');
  return near;
}

test('get in, drive, get out; the other player sees it move; outsiders: Crew only; crew: Someone is driving (US1)', async ({ browser }) => {
  const a = await openPlayer(browser);
  await freshWorld(a.page);
  const b = await openPlayer(browser);
  const plot = await hostAPlot(a.page);
  const id = machineId(plot, 'forklift');
  // b is not crew: Crew only
  const fork = await machine(b.page, id);
  await dev(b.page, 'teleport', fork.x + 0.6, 0, fork.z);
  await expect.poll(() => promptText(b.page), { timeout: 5000 }).toContain('Crew only');
  await expect(b.page.locator('.net-prompt')).toHaveClass(/disabled/);
  // a gets in and drives ~5 m
  await getIn(a.page, plot, 'forklift');
  expect(await net<string>(a.page, 'camera')).toBe('follow');
  await expect(a.page.getByTestId('machine-hint')).toBeVisible();
  // the control bar stays the whole time; Q switches follow ↔ driver camera
  await expect(a.page.getByTestId('machine-bar')).toContainText('Q camera');
  await key(a.page, 'KeyQ');
  await expect.poll(() => net<string>(a.page, 'camera'), { timeout: 3000 }).toBe('cab');
  await key(a.page, 'KeyQ');
  await expect.poll(() => net<string>(a.page, 'camera'), { timeout: 3000 }).toBe('follow');
  const start = await machine(a.page, id);
  await a.page.locator('#game').focus();
  await a.page.keyboard.down('KeyW');
  await expect.poll(async () => {
    const m = await machine(a.page, id);
    return Math.hypot(m.x - start.x, m.z - start.z);
  }, { timeout: 20_000 }).toBeGreaterThan(5);
  await a.page.keyboard.up('KeyW');
  const mine = await machine(a.page, id);
  // the other page sees the same machine there within 0.5 s (plus its interpolation delay)
  await expect.poll(async () => {
    const m = await machine(b.page, id);
    return Math.hypot(m.x - mine.x, m.z - mine.z);
  }, { timeout: 1500, intervals: [100] }).toBeLessThan(0.6);
  // b joins the crew while a drives: Someone is driving
  await joinCrew(a.page, b.page, plot);
  const now = await machine(b.page, id);
  await dev(b.page, 'teleport', now.x + 0.5, 0, now.z);
  await expect.poll(() => promptText(b.page), { timeout: 5000 }).toContain('Someone is driving');
  // Space gets out
  await getOut(a.page);
  await expect.poll(() => net<string>(a.page, 'camera'), { timeout: 3000 }).toBe('follow');
  await expect(a.page.getByTestId('machine-bar')).toBeHidden();
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('Groundwork end to end: 6 scoops, 4 bags, mix, 4 buckets → Frame unlocks; the cue points at the excavator, then cement supply (US2)', async ({ browser }) => {
  const a = await openPlayer(browser);
  await freshWorld(a.page);
  const plot = await hostAPlot(a.page, true);
  const sp = SITE.machines[plot]!;
  await expect.poll(() => net<{ plot: number; machine: string | null }>(a.page, 'cue'), { timeout: 4000 }).toMatchObject({ plot, machine: 'excavator' });
  expect((await plots(a.page))[plot]).toMatchObject({ groundDug: 0 });
  // a beam is refused: dig first
  await dev(a.page, 'teleport', SITE.plots[plot]!.x, 0, SITE.plots[plot]!.z + 0.4);
  await a.page.waitForTimeout(300);
  await dev(a.page, 'give', 'beam');
  await expect.poll(async () => (await me(a.page)).holding, { timeout: 4000 }).toBe('beam');
  await key(a.page, 'KeyE');
  await expect.poll(async () => (await mpEvents(a.page, 'hint')).map((e) => (e.detail as { kind: string }).kind), { timeout: 4000 }).toContain('groundworkFirst');
  await getIn(a.page, plot, 'excavator');
  await expect.poll(() => net<{ machine: string | null }>(a.page, 'cue'), { timeout: 3000 }).toMatchObject({ machine: null }); // hidden while someone is in it
  const exc = machineId(plot, 'excavator');
  const aim = async (x: number, z: number) => {
    const a2 = Math.atan2(x - sp.center.x, z - sp.center.z) + Math.PI;
    const bx = x + Math.sin(a2) * EXCAVATOR_REACH;
    const bz = z + Math.cos(a2) * EXCAVATOR_REACH;
    await dev(a.page, 'machinePose', exc, { x: bx, z: bz, yaw: Math.atan2(x - bx, z - bz) });
    await a.page.waitForTimeout(450);
  };
  for (let i = 1; i <= 6; i++) {
    await aim(sp.center.x, sp.center.z);
    await expect.poll(async () => (await net<{ text: string }>(a.page, 'machineLabel')).text, { timeout: 3000 }).toBe('Scoop');
    await key(a.page, 'KeyE');
    await idleWith(a.page, exc, 'dirt');
    await aim(sp.spoil.x, sp.spoil.z);
    await key(a.page, 'KeyE');
    await expect.poll(async () => (await plot$(a.page, plot)).groundDug, { timeout: 10_000 }).toBe(i);
    await idleWith(a.page, exc, 'none');
  }
  await getOut(a.page);
  await expect(a.page.getByTestId('gameplay-guide')).toContainText(/cement/i); // empty mixer needs supply first
  // 4 cement bags into the hopper
  for (let i = 1; i <= 4; i++) {
    await dev(a.page, 'teleport', sp.mixer.hopper.x, 0, sp.mixer.hopper.z);
    await a.page.waitForTimeout(250);
    await dev(a.page, 'give', 'cement');
    await expect.poll(async () => (await me(a.page)).holding, { timeout: 4000 }).toBe('cement');
    await key(a.page, 'KeyE');
    await expect.poll(async () => (await plot$(a.page, plot)).mixerBags, { timeout: 4000 }).toBe(i);
  }
  await getIn(a.page, plot, 'mixer');
  await expect.poll(() => net<string>(a.page, 'camera'), { timeout: 3000 }).toBe('mixer');
  await expect.poll(async () => (await net<{ text: string }>(a.page, 'machineLabel')).text, { timeout: 3000 }).toBe('Mix (4 bags)');
  await key(a.page, 'KeyE');
  await expect.poll(async () => (await plot$(a.page, plot)).mixerBags, { timeout: 15_000 }).toBe(0);
  const buckets = await a.page.evaluate(() => {
    let n = 0;
    ((window as NetWin).__hht as unknown as { game: { conn: { state: { pieces: { forEach(cb: (v: { type: string }) => void): void } } } } }).game.conn.state.pieces.forEach((v) => {
      if (v.type === 'concrete') n++;
    });
    return n;
  });
  expect(buckets).toBe(4);
  await getOut(a.page);
  // carry the 4 buckets into the pit (given here: picking each up is the 002 carry flow)
  const d = SITE.plots[plot]!;
  for (let i = 1; i <= 4; i++) {
    await dev(a.page, 'teleport', d.x, 0, d.z + 0.4);
    await a.page.waitForTimeout(250);
    await dev(a.page, 'give', 'concrete');
    await expect.poll(async () => (await me(a.page)).holding, { timeout: 4000 }).toBe('concrete');
    await key(a.page, 'KeyE');
    await expect.poll(async () => (await plot$(a.page, plot)).groundPoured, { timeout: 4000 }).toBe(i);
  }
  await expect.poll(async () => (await mpEvents(a.page, 'celebrate')).length, { timeout: 4000 }).toBeGreaterThan(0);
  // Frame unlocks
  await dev(a.page, 'give', 'beam');
  await expect.poll(async () => (await me(a.page)).holding, { timeout: 4000 }).toBe('beam');
  await key(a.page, 'KeyE');
  await expect.poll(async () => (await plot$(a.page, plot)).filledSlots, { timeout: 4000 }).toBe(1);
  expect(a.errors).toEqual([]);
});

test('crane: a hand panel at a high slot is refused; pad → grab → lit ring → release snaps; cameras; the bell finishes the Masterpiece (US3)', async ({ browser }) => {
  const a = await openPlayer(browser);
  await freshWorld(a.page);
  const plot = await hostAPlot(a.page);
  for (let st = 0; st < 2; st++) {
    await rate(a.page);
    await dev(a.page, 'fillStage', plot);
    await expect.poll(async () => (await plot$(a.page, plot)).completedStages, { timeout: 5000 }).toBe(st + 1);
  }
  const d = SITE.plots[plot]!;
  // Roof & Windows (004): panel×4 (3 high) + beam×2 — the one ordinary panel slot by hand, then tooHigh
  for (let i = 1; i <= 2; i++) {
    await dev(a.page, 'teleport', d.x, 0, d.z + 0.4);
    await a.page.waitForTimeout(250);
    await dev(a.page, 'give', 'panel');
    await expect.poll(async () => (await me(a.page)).holding, { timeout: 4000 }).toBe('panel');
    await key(a.page, 'KeyE');
    if (i === 1) await expect.poll(async () => (await plot$(a.page, plot)).filledA, { timeout: 4000 }).toBe(1);
  }
  await expect.poll(async () => (await mpEvents(a.page, 'hint')).map((e) => (e.detail as { kind: string }).kind), { timeout: 4000 }).toContain('tooHigh');
  expect((await plot$(a.page, plot)).filledA).toBe(1);
  // the crane lifts a panel from the pad into a high slot
  await pieceOnPad(a.page, plot, 'panel');
  await getIn(a.page, plot, 'crane');
  await expect.poll(() => net<string>(a.page, 'camera'), { timeout: 3000 }).toBe('hook');
  await key(a.page, 'KeyQ');
  await expect.poll(() => net<string>(a.page, 'camera'), { timeout: 3000 }).toBe('cab');
  await hookPiece(a.page, plot);
  await expect.poll(async () => (await plot$(a.page, plot)).hookType, { timeout: 5000 }).toBe('panel');
  const high = openSlotRefs(d, SITE.machines[plot]!, { blueprintId: 'clock-tower', groundDug: 6, groundPoured: 4, completedStages: 2, filled: [1, 0], highFilled: 0 }).find((s) => s.high)!;
  await aimHook(a.page, plot, high.x + 1.0, high.z);
  await expect.poll(() => net<{ high: boolean } | null>(a.page, 'snapRing'), { timeout: 3000 }).toMatchObject({ high: true });
  await key(a.page, 'KeyE');
  await expect.poll(async () => (await plot$(a.page, plot)).highFilled, { timeout: 15_000 }).toBe(1);
  expect((await mpEvents(a.page, 'snap')).some((e) => (e.detail as { via: string }).via === 'crane')).toBe(true);
  // re-entering resets to the hook camera
  await idleWith(a.page, machineId(plot, 'crane'), 'none');
  await getOut(a.page);
  await getIn(a.page, plot, 'crane');
  await expect.poll(() => net<string>(a.page, 'camera'), { timeout: 3000 }).toBe('hook');
  await getOut(a.page);
  // the rest of the tower by cheat, then the bell by crane
  for (let st = 2; st < 5; st++) {
    await rate(a.page);
    await dev(a.page, 'fillStage', plot);
    await expect.poll(async () => (await plot$(a.page, plot)).completedStages, { timeout: 5000 }).toBe(st + 1);
  }
  // the Masterpiece (004): the decor crate by hand, then the bell by crane
  await dev(a.page, 'teleport', d.x, 0, d.z + 0.4);
  await a.page.waitForTimeout(250);
  await dev(a.page, 'give', 'decor');
  await expect.poll(async () => (await me(a.page)).holding, { timeout: 4000 }).toBe('decor');
  await key(a.page, 'KeyE');
  await expect.poll(async () => (await plot$(a.page, plot)).filledB, { timeout: 4000 }).toBe(1);
  await pieceOnPad(a.page, plot, 'bell');
  await getIn(a.page, plot, 'crane');
  await hookPiece(a.page, plot);
  await expect.poll(async () => (await plot$(a.page, plot)).hookType, { timeout: 5000 }).toBe('bell');
  const bell = SITE.machines[plot]!.highSlots[5]![0]!;
  await aimHook(a.page, plot, bell.x, bell.z);
  await key(a.page, 'KeyE');
  await expect.poll(async () => (await plot$(a.page, plot)).state, { timeout: 15_000 }).toBe('finished');
  expect(a.errors).toEqual([]);
});

test('forklift: pallets sized to each material fill Walls & Floors (4 + 2 bricks, 2 beams); it stops at the plaza edge; a worker in the path is not pushed (US4)', async ({ browser }) => {
  const a = await openPlayer(browser);
  await freshWorld(a.page);
  const b = await openPlayer(browser);
  const plot = await hostAPlot(a.page);
  await rate(a.page);
  await dev(a.page, 'fillStage', plot);
  await expect.poll(async () => (await plot$(a.page, plot)).completedStages, { timeout: 5000 }).toBe(1);
  await getIn(a.page, plot, 'forklift');
  const id = machineId(plot, 'forklift');
  const forksAt = async (x: number, z: number, fx: number, fz: number) => {
    const yaw = Math.atan2(x - fx, z - fz);
    await dev(a.page, 'machinePose', id, { x: x - Math.sin(yaw) * FORK_REACH, z: z - Math.cos(yaw) * FORK_REACH, yaw, p3: 0 });
    await a.page.waitForTimeout(500);
  };
  const d = SITE.plots[plot]!;
  // Walls & Floors (004): brick×6 + beam×2 → pallets of 4 bricks, 2 bricks, 2 beams (FR-016)
  for (const [type, n, label] of [['brick', 4, 'Load 4 bricks'], ['brick', 2, 'Load 2 bricks'], ['beam', 2, 'Load 2 beams']] as const) {
    const rack = SITE.racks.find((r) => r.type === type)!;
    await forksAt(rack.x, rack.z, 0, 0);
    await expect.poll(async () => (await net<{ text: string }>(a.page, 'machineLabel')).text, { timeout: 3000 }).toBe(label);
    // the server ignores more than 4 action presses per 60 sim steps (003 anti-mashing); software rendering
    // runs the sim several times slower than real time, so give each trip's presses room
    await a.page.waitForTimeout(3000);
    await key(a.page, 'KeyE');
    await expect.poll(async () => (await plot$(a.page, plot)).palletTypes.length, { timeout: 4000 }).toBe(n);
    await forksAt(d.x, d.z, d.x + d.s * 4, d.z + d.c * 4);
    await a.page.waitForTimeout(3000);
    await key(a.page, 'KeyE');
    await expect.poll(async () => (await plot$(a.page, plot)).palletTypes.length, { timeout: 4000 }).toBe(0);
  }
  await expect.poll(async () => (await plot$(a.page, plot)).completedStages, { timeout: 5000 }).toBe(2);
  // drive at the plaza: it stops at the edge; b stands in the way and is not pushed
  const toward = { x: d.x * 0.5, z: d.z * 0.5 };
  await dev(a.page, 'machinePose', id, { x: toward.x, z: toward.z, yaw: Math.atan2(-toward.x, -toward.z), p3: 0 });
  const bx = toward.x * 0.85;
  const bz = toward.z * 0.85;
  await dev(b.page, 'teleport', bx, 0, bz);
  await b.page.waitForTimeout(600);
  await a.page.locator('#game').focus();
  await a.page.keyboard.down('KeyW');
  // it reaches the edge of the plaza's no-drive ring and stays there
  await expect.poll(async () => {
    const m = await machine(a.page, id);
    return Math.hypot(m.x, m.z);
  }, { timeout: 30_000 }).toBeLessThan(SITE.noDrive.plazaRadius + 1.2);
  await a.page.waitForTimeout(1500);
  await a.page.keyboard.up('KeyW');
  const m = await machine(a.page, id);
  expect(Math.hypot(m.x, m.z)).toBeGreaterThan(SITE.noDrive.plazaRadius + 0.8);
  const bp = (await me(b.page)).position;
  expect(Math.hypot(bp[0] - bx, bp[2] - bz)).toBeLessThan(0.05);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('a member in the crane holding a piece is removed by the Host: put out within 2 s, the piece is on the ground (US5)', async ({ browser }) => {
  const a = await openPlayer(browser);
  await freshWorld(a.page);
  const b = await openPlayer(browser);
  const plot = await hostAPlot(a.page);
  await joinCrew(a.page, b.page, plot);
  await pieceOnPad(b.page, plot, 'beam');
  await getIn(b.page, plot, 'crane');
  await hookPiece(b.page, plot);
  await expect.poll(async () => (await plot$(b.page, plot)).hookType, { timeout: 5000 }).toBe('beam');
  await expect.poll(async () => (await plot$(a.page, plot)).hookType, { timeout: 5000 }).toBe('beam');
  await rate(a.page);
  const t0 = Date.now();
  await send(a.page, 'crew', { op: 'remove', member: (await me(b.page)).sessionId });
  await expect.poll(() => net<number>(b.page, 'myMachine'), { timeout: 2500, intervals: [100] }).toBe(-1);
  expect(Date.now() - t0).toBeLessThan(2500);
  await expect.poll(async () => (await plot$(a.page, plot)).hookType, { timeout: 2000 }).toBe('');
  const loose = await a.page.evaluate(() => {
    let n = 0;
    ((window as NetWin).__hht as unknown as { game: { conn: { state: { pieces: { forEach(cb: (v: { type: string; state: string }) => void): void } } } } }).game.conn.state.pieces.forEach((v) => {
      if (v.type === 'beam' && v.state === 'loose') n++;
    });
    return n;
  });
  expect(loose).toBe(1);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('early cement: forklift helps while a teammate occupies excavation without advancing groundwork', async ({ browser }) => {
  const a = await openPlayer(browser);
  await freshWorld(a.page);
  const plot = await hostAPlot(a.page, true);
  const b = await openPlayer(browser, `e2e=1&w=${await net<number>(a.page, 'worldId')}`);
  await joinCrew(a.page, b.page, plot);
  await getIn(a.page, plot, 'excavator');
  await b.page.bringToFront();
  await expect(b.page.getByTestId('gameplay-guide')).toContainText(/cement/i);
  await getIn(b.page, plot, 'forklift');
  const id = machineId(plot, 'forklift');
  const rack = SITE.racks.find(r => r.type === 'cement')!;
  const yaw = Math.atan2(rack.x, rack.z);
  await dev(b.page, 'machinePose', id, { x: rack.x - Math.sin(yaw) * FORK_REACH, z: rack.z - Math.cos(yaw) * FORK_REACH, yaw, p3: 0 });
  await expect(b.page.locator('.net-prompt')).toContainText('Load 4');
  await key(b.page, 'KeyE');
  await expect.poll(async () => (await plot$(b.page, plot)).palletTypes.length).toBe(4);
  await expect(b.page.getByTestId('machine-hint')).toBeHidden();
  const hop = SITE.machines[plot]!.mixer.hopper;
  const center = SITE.machines[plot]!.center;
  const hy = Math.atan2(hop.x - center.x, hop.z - center.z);
  await dev(b.page, 'machinePose', id, { x: hop.x - Math.sin(hy) * FORK_REACH, z: hop.z - Math.cos(hy) * FORK_REACH, yaw: hy, p3: 0 });
  await expect(b.page.locator('.net-prompt')).toContainText('hopper');
  await key(b.page, 'KeyE');
  await expect.poll(async () => (await plot$(b.page, plot)).mixerBags).toBe(4);
  expect((await plot$(b.page, plot)).groundDug).toBe(0);
  expect((await plot$(b.page, plot)).groundPoured).toBe(0);
  expect(a.errors.concat(b.errors)).toEqual([]);
});

// A competing accepted server update is injected through the existing dev fixture.
// The operator still uses normal grab/release inputs; the stale preview must disappear.
test('crane preview clears when another client advances the stage before release', async ({ browser }) => {
  const a = await openPlayer(browser);
  await freshWorld(a.page);
  const plot = await hostAPlot(a.page);
  const b = await openPlayer(browser, `e2e=1&w=${await net<number>(a.page, 'worldId')}`);
  await joinCrew(a.page, b.page, plot);
  await pieceOnPad(a.page, plot, 'beam');
  await getIn(a.page, plot, 'crane');
  await hookPiece(a.page, plot);
  const target = openSlotRefs(SITE.plots[plot]!, SITE.machines[plot]!, { blueprintId: 'clock-tower', groundDug: 6, groundPoured: 4, completedStages: 0, filled: [0, 0], highFilled: 0 })[0]!;
  await aimHook(a.page, plot, target.x, target.z);
  await expect.poll(() => net<unknown>(a.page, 'snapRing')).not.toBeNull();
  await dev(b.page, 'fillStage', plot);
  await expect.poll(async () => (await plot$(a.page, plot)).completedStages).toBe(1);
  await expect.poll(() => net<unknown>(a.page, 'snapRing')).toBeNull();
  const before = (await mpEvents(a.page, 'snap')).length;
  await key(a.page, 'KeyE');
  await idleWith(a.page, machineId(plot, 'crane'), 'none');
  expect((await plot$(a.page, plot)).filledSlots).toBe(0);
  expect((await mpEvents(a.page, 'snap')).length).toBe(before);
  expect(a.errors.concat(b.errors)).toEqual([]);
});
