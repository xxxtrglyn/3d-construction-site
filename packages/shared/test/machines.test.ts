import recorded from './fixtures/machine-inputs.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import {
  CLOCK_TOWER, MACHINE, MACHINE_KINDS, MACHINE_RADIUS, SIM_DT, SITE,
  atPit, atSpoil, canEnter, deliver, dist2, dsin, dcos, entryPoint, exitSpot, hookPos, hookRestY, inNoDrive, inYard, initialProgress,
  kindOfMachine, machineCtx, machineError, machineId, neededMachine, openSlotRefs, parkedState, plotOfMachine, rackAtForks, seatPose,
  setDownSpot, snapTarget, stepMachine, toolTip, towerBlocker, wrapAngle,
  type MachineCtx, type MachineKind, type MachineState, type MoveInput, type TowerProgress,
} from '../src/index.ts';

const fixture = recorded as unknown as { steps: Array<[number, number, number]> };
const input = (dx: number, dz: number, act = false, seq = 0): MoveInput => ({ seq, dx, dz, run: false, jump: false, act, alt: false });
const ctxFor = (plot: number, completedStages = 0): MachineCtx => machineCtx(SITE, plot, completedStages >= 1 ? [towerBlocker(SITE.plots[plot]!)] : [], completedStages);
const run = (s: MachineState, ctx: MachineCtx, steps: Array<[number, number, number]>, each?: (s: MachineState, i: number) => void) => {
  const states: MachineState[] = [];
  steps.forEach(([dx, dz, act], i) => {
    s = stepMachine(s, input(dx, dz, act === 1, i), SIM_DT, ctx).state;
    states.push(s);
    each?.(s, i);
  });
  return states;
};
const hold = (n: number, dx: number, dz: number): Array<[number, number, number]> => Array.from({ length: n }, () => [dx, dz, 0]);
const ready = (): TowerProgress => ({ ...initialProgress(), groundDug: 6, groundPoured: 4 });

describe('identity', () => {
  it('ids are plot × 4 + kind (crane, excavator, forklift, mixer)', () => {
    expect(MACHINE_KINDS).toEqual(['crane', 'excavator', 'forklift', 'mixer']);
    expect(machineId(11, 'mixer')).toBe(47);
    expect(plotOfMachine(46)).toBe(11);
    expect(kindOfMachine(46)).toBe('forklift');
  });
  it('the polynomial sine matches Math.sin to 1e-9 and wraps exactly', () => {
    for (let a = -20; a <= 20; a += 0.0137) {
      expect(Math.abs(dsin(a) - Math.sin(a))).toBeLessThan(1e-9);
      expect(Math.abs(dcos(a) - Math.cos(a))).toBeLessThan(1e-9);
    }
    expect(Math.abs(wrapAngle(7))).toBeLessThanOrEqual(Math.PI);
  });
});

describe('stepMachine determinism', () => {
  it('replaying the recorded input log gives bit-identical state sequences (all kinds)', () => {
    for (const kind of MACHINE_KINDS) {
      const id = machineId(3, kind);
      const ctx = ctxFor(3);
      let start = parkedState(id, ctx.spots);
      if (kind === 'mixer') start = { ...start, load: { kind: 'bags', count: 3 } };
      const a = run(start, ctx, fixture.steps);
      const b = run(start, ctx, fixture.steps);
      expect(a.length).toBe(fixture.steps.length);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      for (let i = 0; i < a.length; i++) for (const k of ['x', 'z', 'yaw', 'p1', 'p2', 'p3', 'phaseT'] as const) expect(Object.is(a[i]![k], b[i]![k])).toBe(true);
    }
  });
  it('the replay actually moves the rigs', () => {
    const ctx = ctxFor(3);
    const exc = run(parkedState(machineId(3, 'excavator'), ctx.spots), ctx, fixture.steps).at(-1)!;
    expect(dist2(exc.x, exc.z, ctx.spots.parking.excavator.x, ctx.spots.parking.excavator.z)).toBeGreaterThan(0.25);
    const crane = run(parkedState(machineId(3, 'crane'), ctx.spots), ctx, fixture.steps).at(-1)!;
    expect(Math.abs(crane.p1 - ctx.spots.crane.yaw) + Math.abs(crane.p2 - 4)).toBeGreaterThan(0.1);
  });
});

describe('limits per kind', () => {
  it('the excavator never leaves its yard and never enters static obstacles', () => {
    for (const plot of [0, 5, 9]) {
      const ctx = ctxFor(plot, 1);
      const r = MACHINE_RADIUS.excavator;
      const pattern: Array<[number, number, number]> = [...hold(300, 0, 127), ...hold(90, 127, 0), ...hold(400, 0, 127), ...hold(50, -127, 60), ...hold(400, 0, -127), ...fixture.steps];
      run(parkedState(machineId(plot, 'excavator'), ctx.spots), ctx, pattern, (s) => {
        expect(inYard(ctx.spots, s.x, s.z, r - 1e-6)).toBe(true);
        const tower = towerBlocker(SITE.plots[plot]!);
        expect(Math.max(Math.abs(s.x - tower.x), Math.abs(s.z - tower.z))).toBeGreaterThan(tower.hx * 0.7);
      });
    }
  });
  it('the forklift stops at the plaza, at other yards and at rack boxes; it is faster than running', () => {
    const plot = 0;
    const ctx = ctxFor(plot);
    let s = parkedState(machineId(plot, 'forklift'), ctx.spots);
    // full throttle for 6 s straight at the plaza
    let top = 0;
    s = run(s, ctx, hold(360, 0, 127), (st) => {
      top = Math.max(top, st.p3);
      expect(inNoDrive(SITE, st.x, st.z, plot, MACHINE_RADIUS.forklift - 1e-6)).toBe(false);
    }).at(-1)!;
    expect(top).toBeGreaterThan(5.5);
    expect(Math.hypot(s.x, s.z)).toBeGreaterThanOrEqual(SITE.noDrive.plazaRadius + MACHINE_RADIUS.forklift - 1e-6);
    // a long random drive never enters a no-drive region or penetrates a rack box
    run(s, ctx, [...fixture.steps, ...fixture.steps].map(([dx, dz, a]) => [dx, Math.abs(dz) < 40 ? 127 : dz, a]), (st) => {
      expect(inNoDrive(SITE, st.x, st.z, plot, MACHINE_RADIUS.forklift - 1e-3)).toBe(false);
      for (const b of SITE.obstacles.boxes) {
        const dx = st.x - b.x;
        const dz = st.z - b.z;
        const lx = Math.abs(b.c * dx - b.s * dz);
        const lz = Math.abs(b.s * dx + b.c * dz);
        expect(lx < b.hx && lz < b.hz).toBe(false);
      }
    });
  });
  it('the crane hook stays between reachMin and reachMax and inside its yard; the crane body never moves', () => {
    for (const plot of [0, 4, 7, 11]) {
      const ctx = ctxFor(plot);
      const c = ctx.spots.crane;
      const pattern: Array<[number, number, number]> = [...hold(200, 0, 127), ...hold(400, 127, 0), ...hold(200, 0, -127), ...hold(500, -127, 127), ...fixture.steps];
      run(parkedState(machineId(plot, 'crane'), ctx.spots), ctx, pattern, (s) => {
        expect(s.x).toBe(c.x);
        expect(s.z).toBe(c.z);
        expect(s.p2).toBeGreaterThanOrEqual(c.reachMin - 1e-9);
        expect(s.p2).toBeLessThanOrEqual(c.reachMax + 1e-9);
        const h = hookPos(s, ctx.spots);
        expect(inYard(ctx.spots, h.x, h.z, -1e-6)).toBe(true);
        expect(SITE.plots.every((p) => p.index === plot || dist2(h.x, h.z, p.x, p.z) > 36)).toBe(true);
      });
    }
  });
  it('the mixer never moves', () => {
    const ctx = ctxFor(2);
    const start = { ...parkedState(machineId(2, 'mixer'), ctx.spots), load: { kind: 'bags' as const, count: 2 } };
    run(start, ctx, fixture.steps, (s) => {
      expect([s.x, s.z, s.yaw]).toEqual([start.x, start.z, start.yaw]);
    });
  });
});

describe('phases', () => {
  it('crane: an act edge lowers the hook, then it rises; input is ignored meanwhile; hookDown fires at the bottom', () => {
    const ctx = ctxFor(0);
    let s = parkedState(machineId(0, 'crane'), ctx.spots);
    const r0 = stepMachine(s, input(0, 0, true), SIM_DT, ctx);
    expect(r0.state.phase).toBe('lowering');
    s = r0.state;
    const actions: string[] = [];
    let minY = Infinity;
    for (let i = 0; i < 130; i++) {
      const before = s;
      const r = stepMachine(s, input(127, 127, i === 10), SIM_DT, ctx);
      s = r.state;
      if (r.action) actions.push(`${r.action}@${i}`);
      minY = Math.min(minY, s.p3);
      if (s.phase !== 'idle') {
        expect(s.p1).toBe(before.p1);
        expect(s.p2).toBe(before.p2);
      }
    }
    expect(actions[0]).toMatch(/^hookDown@(58|59|60)$/);
    expect(actions[1]).toMatch(/^hookUp@/);
    expect(minY).toBeCloseTo(0.9, 5);
    expect(s.phase).toBe('idle');
    expect(s.p3).toBeCloseTo(hookRestY(ctx.spots), 5);
  });
  it('crane: over a standing tower the hook stops above the tower top', () => {
    const ctx = ctxFor(0, 2);
    let s = parkedState(machineId(0, 'crane'), ctx.spots); // the parked jib points at the tower centre
    s = stepMachine(s, input(0, 0, true), SIM_DT, ctx).state;
    let minY = Infinity;
    for (let i = 0; i < 61; i++) {
      s = stepMachine(s, input(0, 0), SIM_DT, ctx).state;
      minY = Math.min(minY, s.p3);
    }
    expect(minY).toBeCloseTo(ctx.towerTop + 0.6, 5);
  });
  it('excavator: scoops only near the pit, dumps anywhere with a full bucket', () => {
    const ctx = ctxFor(0);
    const sp = ctx.spots;
    const far = parkedState(machineId(0, 'excavator'), sp);
    expect(atPit(far, sp)).toBe(false);
    expect(stepMachine(far, input(0, 0, true), SIM_DT, ctx).action).toBeNull();
    // face the pit from 3 m away: the bucket tip reaches it
    const yaw = Math.atan2(sp.center.x - far.x, sp.center.z - far.z);
    const d = Math.hypot(sp.center.x - far.x, sp.center.z - far.z);
    const near = { ...far, yaw, x: sp.center.x - Math.sin(yaw) * 3.2, z: sp.center.z - Math.cos(yaw) * 3.2 };
    expect(d).toBeGreaterThan(3);
    expect(atPit(near, sp)).toBe(true);
    const r = stepMachine(near, input(0, 0, true), SIM_DT, ctx);
    expect(r.action).toBe('scoop');
    expect(r.state.phase).toBe('lowering');
    const full = { ...far, load: { kind: 'dirt' as const } };
    expect(stepMachine(full, input(0, 0, true), SIM_DT, ctx).action).toBe('dump');
    // the spoil check uses the bucket tip
    const ys = Math.atan2(sp.spoil.x - far.x, sp.spoil.z - far.z);
    const atHeap = { ...far, yaw: ys, x: sp.spoil.x - Math.sin(ys) * 2.3, z: sp.spoil.z - Math.cos(ys) * 2.3 };
    expect(atSpoil(atHeap, sp)).toBe(true);
    expect(atSpoil(near, sp)).toBe(false);
  });
  it('forklift: A/D alone turns it on the spot (same direction as steering while rolling); the pivot fades at speed', () => {
    const ctx = ctxFor(0);
    const s = parkedState(machineId(0, 'forklift'), ctx.spots);
    const right = run(s, ctx, hold(60, 127, 0)).at(-1)!;
    expect(Math.hypot(right.x - s.x, right.z - s.z)).toBeLessThan(1e-9);
    const turned = Math.atan2(Math.sin(right.yaw - s.yaw), Math.cos(right.yaw - s.yaw));
    expect(turned).toBeCloseTo(-MACHINE.forklift.pivotRate, 1); // 1 s of D: −1.6 rad, clockwise like steering right
    const left = run(s, ctx, hold(60, -127, 0)).at(-1)!;
    expect(Math.atan2(Math.sin(left.yaw - s.yaw), Math.cos(left.yaw - s.yaw))).toBeCloseTo(MACHINE.forklift.pivotRate, 1);
    // at full speed the turn is plain car steering (no extra pivot)
    const fast = { ...s, p3: MACHINE.forklift.speed };
    const one = stepMachine(fast, input(127, 127), SIM_DT, ctx).state;
    const expected = ((MACHINE.forklift.speed * -MACHINE.forklift.steerMax) / 1.3) * SIM_DT;
    expect(Math.atan2(Math.sin(one.yaw - s.yaw), Math.cos(one.yaw - s.yaw))).toBeCloseTo(expected, 4);
  });
  it('forklift: loads only at a rack, unloads when loaded', () => {
    const ctx = ctxFor(0);
    const s = parkedState(machineId(0, 'forklift'), ctx.spots);
    expect(stepMachine(s, input(0, 0, true), SIM_DT, ctx).action).toBeNull();
    const rack = SITE.racks.find((r) => r.type === 'cement')!;
    const yaw = Math.atan2(rack.x - s.x, rack.z - s.z);
    const atRack = { ...s, yaw, x: rack.x - Math.sin(yaw) * 2.4, z: rack.z - Math.cos(yaw) * 2.4 };
    expect(rackAtForks(atRack, SITE)).toBe(rack.index);
    expect(Math.hypot(toolTip(atRack).x - rack.x, toolTip(atRack).z - rack.z)).toBeLessThan(1.85);
    expect(stepMachine(atRack, input(0, 0, true), SIM_DT, ctx).action).toBe('loadPallet');
    expect(stepMachine({ ...s, load: { kind: 'pallet', pieces: ['brick'] } }, input(0, 0, true), SIM_DT, ctx).action).toBe('unloadPallet');
  });
  it('mixer: mixes only with bags', () => {
    const ctx = ctxFor(0);
    const s = parkedState(machineId(0, 'mixer'), ctx.spots);
    expect(stepMachine(s, input(0, 0, true), SIM_DT, ctx).action).toBeNull();
    const r = stepMachine({ ...s, load: { kind: 'bags', count: 3 } }, input(0, 0, true), SIM_DT, ctx);
    expect(r.action).toBe('mix');
    expect(r.state.phase).toBe('working');
    expect(r.state.phaseT).toBe(MACHINE.mixer.mixS);
  });
  it('machineError ignores the authoritative load and flags phase mismatches', () => {
    const s = parkedState(machineId(0, 'excavator'), SITE.machines[0]!);
    expect(machineError(s, { ...s, load: { kind: 'dirt' } })).toBe(0);
    expect(machineError(s, { ...s, phase: 'lowering' })).toBe(1);
    expect(machineError(s, { ...s, x: s.x + 0.1 })).toBeCloseTo(0.1, 9);
  });
});

describe('function rules', () => {
  const plot = 0;
  const def = SITE.plots[plot]!;
  const spots = SITE.machines[plot]!;
  const toStage = (n: number, filled = 0, highFilled = 0): TowerProgress => ({ ...ready(), completedStages: n - 1, filledSlots: filled, highFilled });

  it('snapTarget: within 1.5 m horizontal, nearest of several, matching type, open slots only, high and hand slots', () => {
    const p = toStage(3, 2, 1); // Roof & Windows: 1 hand + 1 high filled
    const slots = openSlotRefs(def, spots, p);
    expect(slots.filter((s) => !s.high)).toHaveLength(2);
    expect(slots.filter((s) => s.high)).toHaveLength(2);
    expect(slots.every((s) => s.type === 'panel')).toBe(true);
    const high = slots.find((s) => s.high)!;
    expect(snapTarget({ x: high.x + 1.2, z: high.z }, 'panel', slots.filter((s) => s.high))).toEqual(high);
    expect(snapTarget({ x: high.x + 1.6, z: high.z + 0.5 }, 'panel', [high])).toBeNull();
    expect(snapTarget({ x: high.x, z: high.z }, 'bell', slots)).toBeNull();
    // nearest of several
    const hand = slots.find((s) => !s.high)!;
    const t = snapTarget({ x: hand.x, z: hand.z }, 'panel', slots);
    expect(t).toEqual(hand);
    // the filled high slot (index 0) is not offered
    expect(slots.some((s) => s.high && s.index === 0)).toBe(false);
    const bell = openSlotRefs(def, spots, toStage(6));
    expect(bell).toEqual([expect.objectContaining({ high: true, type: 'bell', y: 9.3 })]);
  });
  it('the footing slots are offered while pouring; nothing while digging', () => {
    expect(openSlotRefs(def, spots, initialProgress())).toEqual([]);
    const pouring = { ...initialProgress(), groundDug: 6, groundPoured: 1 };
    const f = openSlotRefs(def, spots, pouring);
    expect(f).toHaveLength(3);
    expect(f.every((s) => s.type === 'concrete' && !s.high)).toBe(true);
    expect(f.every((s) => Math.hypot(s.x - def.x, s.z - def.z) < def.towerHalf)).toBe(true);
  });
  it('a crane delivery into a ring slot is a normal deliver() (high counts only via the crane)', () => {
    const p = toStage(3, 3, 0);
    expect(deliver(p, 'panel', 'hand').result).toBe('tooHigh');
    expect(deliver(p, 'panel', 'crane', { high: true }).progress.highFilled).toBe(1);
  });
  it('canEnter: the full matrix', () => {
    const m = { state: parkedState(machineId(plot, 'forklift'), spots), operator: '' };
    const e = entryPoint(m.state, spots);
    const crew = { crewPlot: plot, carrying: null, x: e.x + 1, z: e.z };
    expect(canEnter(m, { hasBuilding: true }, crew, spots)).toBe('entered');
    expect(canEnter(m, { hasBuilding: false }, crew, spots)).toBe('notBuilding');
    expect(canEnter(m, { hasBuilding: true }, { ...crew, crewPlot: -1 }, spots)).toBe('notCrew');
    expect(canEnter(m, { hasBuilding: true }, { ...crew, crewPlot: 1 }, spots)).toBe('notCrew');
    expect(canEnter({ ...m, operator: 'abc' }, { hasBuilding: true }, crew, spots)).toBe('busy');
    expect(canEnter({ ...m, operator: 'abc' }, { hasBuilding: true }, { ...crew, crewPlot: -1 }, spots)).toBe('notCrew');
    expect(canEnter(m, { hasBuilding: true }, { ...crew, carrying: 'brick' }, spots)).toBe('handsFull');
    expect(canEnter(m, { hasBuilding: true }, { ...crew, x: e.x + 1.7 }, spots)).toBe('tooFar');
    expect(canEnter(m, { hasBuilding: true }, { ...crew, x: e.x + 1.7 }, spots, 0.3)).toBe('entered');
    // the crane is entered at the mast base
    const crane = { state: parkedState(machineId(plot, 'crane'), spots), operator: '' };
    expect(canEnter(crane, { hasBuilding: true }, { ...crew, x: spots.crane.x + 1.2, z: spots.crane.z }, spots)).toBe('entered');
  });
  it('setDownSpot: never in the pit or a bin, within 2 m, else the hook pad', () => {
    const ctx = ctxFor(plot, 1);
    const inPit = setDownSpot(def.x, def.z + 0.2, ctx);
    expect(Math.max(Math.abs(inPit.x - def.x), Math.abs(inPit.z - def.z))).toBeGreaterThan(def.towerHalf);
    expect(Math.hypot(inPit.x - def.x, inPit.z - def.z - 0.2)).toBeLessThanOrEqual(def.towerHalf * Math.SQRT2 + 2.01);
    const atBin = setDownSpot(def.bin.x, def.bin.z, ctx);
    expect(Math.hypot(atBin.x - def.bin.x, atBin.z - def.bin.z)).toBeGreaterThanOrEqual(def.bin.radius + 0.3);
    expect(Math.hypot(atBin.x - def.bin.x, atBin.z - def.bin.z)).toBeLessThanOrEqual(2.01);
    const open = setDownSpot(spots.hookPad.x, spots.hookPad.z, ctx);
    expect(open).toEqual({ x: spots.hookPad.x, z: spots.hookPad.z });
  });
  it('neededMachine: excavator while digging, mixer while pouring, crane while high slots are open', () => {
    expect(neededMachine(initialProgress())).toBe('excavator');
    expect(neededMachine({ ...initialProgress(), groundDug: 6 })).toBe('mixer');
    expect(neededMachine(ready())).toBeNull();
    expect(neededMachine(toStage(3))).toBe('crane');
    expect(neededMachine(toStage(3, 4, 3))).toBeNull();
    expect(neededMachine(toStage(6))).toBe('crane');
    expect(neededMachine({ ...ready(), completedStages: 6 })).toBeNull();
    void CLOCK_TOWER;
  });
  it('seatPose and exitSpot: the seat follows the rig; the exit spot is free ground near the cab', () => {
    const ctx = ctxFor(plot, 1);
    for (const kind of MACHINE_KINDS as readonly MachineKind[]) {
      const s = parkedState(machineId(plot, kind), spots);
      const seat = seatPose(s, spots);
      if (kind === 'crane') expect(seat.y).toBeGreaterThan(12);
      else expect(Math.hypot(seat.x - s.x, seat.z - s.z)).toBeLessThan(1.5);
      const ex = exitSpot(s, ctx);
      const bx = kind === 'crane' ? spots.crane.x : s.x;
      const bz = kind === 'crane' ? spots.crane.z : s.z;
      expect(Math.hypot(ex.x - bx, ex.z - bz)).toBeLessThan(4);
      expect(Math.hypot(ex.x, ex.z)).toBeLessThan(SITE.playRadius);
    }
    const moved = { ...parkedState(machineId(plot, 'excavator'), spots), yaw: 1 };
    expect(seatPose(moved, spots).yaw).toBe(1);
  });
});
