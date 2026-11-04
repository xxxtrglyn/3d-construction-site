import { describe, expect, it } from 'vitest';
import {
  MOVE, SIM_DT, SITE, WORKER_RADIUS, initialWorker, seededRng, stepWorker, towerBlocker, quantizeDir,
  type MoveInput, type SiteLayout, type WorkerState,
} from '../src/index.ts';

const still = (seq = 0): MoveInput => ({ seq, dx: 0, dz: 0, run: false, jump: false, act: false, alt: false });
const run = (n: number, s: WorkerState, f: (i: number) => MoveInput, site: SiteLayout = SITE): WorkerState[] => {
  const out: WorkerState[] = [];
  let st = s;
  for (let i = 0; i < n; i++) out.push((st = stepWorker(st, f(i), SIM_DT, site)));
  return out;
};
const randomInputs = (seed: number, n: number): MoveInput[] => {
  const rng = seededRng(seed);
  const out: MoveInput[] = [];
  let dir = { dx: 0, dz: 0 };
  for (let i = 0; i < n; i++) {
    if (i % 30 === 0) dir = quantizeDir(rng() * 2 - 1, rng() * 2 - 1);
    out.push({ seq: i & 0xffff, ...dir, run: rng() < 0.5, jump: rng() < 0.02, act: false, alt: false });
  }
  return out;
};
const insideBlocking = (s: WorkerState, site: SiteLayout): boolean => {
  const r = WORKER_RADIUS - 1e-6;
  for (const b of site.obstacles.boxes) {
    if (b.top <= s.y + 0.36) continue;
    const dx = s.x - b.x, dz = s.z - b.z;
    const lx = b.c * dx - b.s * dz, lz = b.s * dx + b.c * dz;
    const cx = Math.max(-b.hx, Math.min(b.hx, lx)), cz = Math.max(-b.hz, Math.min(b.hz, lz));
    if ((lx - cx) ** 2 + (lz - cz) ** 2 < r * r - 1e-6) return true;
  }
  for (const c of site.obstacles.cylinders) {
    if (c.top <= s.y + 0.36) continue;
    if ((s.x - c.x) ** 2 + (s.z - c.z) ** 2 < (c.r + r) ** 2 - 1e-6) return true;
  }
  return false;
};

describe('stepWorker', () => {
  it('is deterministic: identical inputs give bit-identical states', () => {
    const inputs = randomInputs(42, 3000);
    const a = run(3000, initialWorker(SITE.spawn), (i) => inputs[i]!);
    const b = run(3000, initialWorker(SITE.spawn), (i) => inputs[i]!);
    expect(a.at(-1)).toEqual(b.at(-1));
    for (let i = 0; i < a.length; i += 97) expect(a[i]).toEqual(b[i]);
  });

  it('caps horizontal speed (run 5.5 m/s, carrying a beam 15 % slower)', () => {
    const fwd = (seq: number): MoveInput => ({ seq, dx: 0, dz: 127, run: true, jump: false, act: false, alt: false });
    const free = run(240, { ...initialWorker({ x: -2, y: 0, z: -20 }) }, fwd);
    const heavy = run(240, { ...initialWorker({ x: -2, y: 0, z: -20 }), carrying: 'beam' }, fwd);
    for (const s of free) expect(Math.hypot(s.vx, s.vz)).toBeLessThanOrEqual(MOVE.runSpeed + 1e-9);
    for (const s of heavy) expect(Math.hypot(s.vx, s.vz)).toBeLessThanOrEqual(MOVE.runSpeed * 0.85 + 1e-9);
    expect(Math.hypot(free.at(-1)!.vx, free.at(-1)!.vz)).toBeCloseTo(MOVE.runSpeed, 6);
  });

  it('jump apex stays within 1.1 m and the worker lands again', () => {
    const states = run(120, initialWorker(SITE.spawn), (i) => ({ ...still(i), jump: i === 0 }));
    const apex = Math.max(...states.map((s) => s.y));
    expect(apex).toBeLessThanOrEqual(MOVE.jumpApex + 1e-6);
    expect(apex).toBeGreaterThan(MOVE.jumpApex * 0.9);
    expect(states.at(-1)!.grounded).toBe(true);
    expect(states.at(-1)!.y).toBe(0);
  });

  it('coyote time allows a jump shortly after leaving the ground; buffered jump fires on landing', () => {
    const airborne: WorkerState = { ...initialWorker(SITE.spawn), y: 0.5, grounded: false, coyote: 0.08 };
    const s = stepWorker(airborne, { ...still(), jump: true }, SIM_DT, SITE);
    expect(s.vy).toBeGreaterThan(5);
    const falling: WorkerState = { ...initialWorker(SITE.spawn), y: 0.05, vy: -3, grounded: false, coyote: 0 };
    const states = run(20, falling, (i) => ({ ...still(i), jump: i === 0 }));
    expect(states.some((st) => st.vy > 5)).toBe(true);
  });

  it('never leaves the play radius and never ends inside a blocking obstacle (100 000 random steps)', () => {
    const inputs = randomInputs(9, 100_000);
    let s = initialWorker(SITE.spawn);
    for (let i = 0; i < inputs.length; i++) {
      s = stepWorker(s, inputs[i]!, SIM_DT, SITE);
      expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(SITE.playRadius - WORKER_RADIUS + 1e-9);
      if (i % 10 === 0) expect(insideBlocking(s, SITE)).toBe(false);
    }
  });

  it('steps onto a 0.3 m box but is blocked by a 0.5 m box', () => {
    const mk = (top: number): SiteLayout => ({ ...SITE, obstacles: { boxes: [{ x: 0, z: 0, hx: 1, hz: 1, c: 1, s: 0, top }], cylinders: [] } });
    const fwd = (seq: number): MoveInput => ({ seq, dx: 127, dz: 0, run: false, jump: false, act: false, alt: false });
    const low = run(120, initialWorker({ x: -3, y: 0, z: 0 }), fwd, mk(0.3));
    expect(low.some((s) => s.y === 0.3 && Math.abs(s.x) < 0.5)).toBe(true);
    const high = run(120, initialWorker({ x: -3, y: 0, z: 0 }), fwd, mk(0.5));
    expect(Math.max(...high.map((s) => s.x))).toBeLessThanOrEqual(-1 - WORKER_RADIUS + 1e-9);
  });

  it('lands and stands on top of an obstacle when dropped onto it', () => {
    const site: SiteLayout = { ...SITE, obstacles: { boxes: [{ x: 0, z: 0, hx: 0.85, hz: 0.55, c: 1, s: 0, top: 1.27 }], cylinders: [] } };
    const states = run(60, { ...initialWorker({ x: 0, y: 2, z: 0 }), grounded: false, coyote: 0 }, still, site);
    expect(states.at(-1)!.y).toBe(1.27);
    expect(states.at(-1)!.grounded).toBe(true);
  });

  it('tower blockers stop the worker at the footprint', () => {
    const plot = SITE.plots[0]!;
    const blocker = towerBlocker(plot);
    const toward = quantizeDir(plot.x - 0, plot.z - 0);
    let s = initialWorker({ x: plot.x * 0.7, y: 0, z: plot.z * 0.7 });
    for (let i = 0; i < 600; i++) s = stepWorker(s, { seq: i, ...toward, run: true, jump: false, act: false, alt: false }, SIM_DT, SITE, [blocker]);
    const d = Math.hypot(s.x - plot.x, s.z - plot.z);
    expect(d).toBeGreaterThanOrEqual(plot.towerHalf + WORKER_RADIUS - 1e-6);
  });
});
