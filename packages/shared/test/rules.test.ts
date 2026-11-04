import { describe, expect, it } from 'vitest';
import {
  CLOCK_TOWER, CREW, PIECE_GRAVITY, addToBin, arcPosition, assignPlot, becomesUnattended, canBin, dropPoint, hostOf,
  nextEpoch, nextHost, removeMember, requestJoin, segmentHitsCircle, setHost, shiftPhase, shouldHandOver, takeFromBin, tossArc,
  type BinEntry, type CrewMember, type CrewRecord, type MemberStatus, type PlotRecord,
} from '../src/index.ts';

describe('toss arcs', () => {
  it('solves the ground hit in closed form and lands at y = 0', () => {
    const a = tossArc({ x: 1, y: 0.8, z: 2 }, 0, 'brick', 0.5, 1000);
    const end = arcPosition(a, a.landAt);
    expect(end.y).toBeCloseTo(0, 6);
    expect(end.x).toBeCloseTo(a.lx, 9);
    expect(end.z).toBeCloseTo(a.lz, 9);
    const mid = arcPosition(a, (a.t0 + a.landAt) / 2);
    expect(mid.y).toBeGreaterThan(0.8);
    const t = (a.landAt - a.t0) / 1000;
    expect(a.oy + a.vy * t - 0.5 * PIECE_GRAVITY * t * t).toBeCloseTo(0, 6);
  });
  it('heavier pieces fly shorter; carrier speed is clamped', () => {
    const light = tossArc({ x: 0, y: 0.8, z: 0 }, 0, 'paint', 1, 0);
    const heavy = tossArc({ x: 0, y: 0.8, z: 0 }, 0, 'bell', 1, 0);
    expect(Math.hypot(heavy.lx, heavy.lz)).toBeLessThan(Math.hypot(light.lx, light.lz));
    const fast = tossArc({ x: 0, y: 0.8, z: 0 }, 0, 'paint', 1, 0, { vx: 0, vz: 500 });
    expect(fast.vz - light.vz).toBeLessThanOrEqual(1.5 + 1e-9);
  });
  it('drop point is 0.6 m ahead; swept test catches a segment crossing a zone', () => {
    const d = dropPoint(0, 0, Math.PI / 2);
    expect(d.x).toBeCloseTo(0.6, 9);
    expect(segmentHitsCircle(-5, 0, 5, 0, 0, 0.5, 1)).toBe(true);
    expect(segmentHitsCircle(-5, 3, 5, 3, 0, 0, 1)).toBe(false);
  });
});

describe('plots', () => {
  const P = (state: PlotRecord['state'], finishedAt: number | null = null): PlotRecord => ({ state, finishedAt, emptySince: null });
  it('assigns the lowest free plot', () => {
    expect(assignPlot([P('building'), P('free'), P('free')], 0, 600_000)).toEqual({ index: 1, retire: false });
  });
  it('retires the oldest finished plot shown ≥ 10 min, else all plots are busy', () => {
    const plots = [P('finished', 1000), P('finished', 500), P('building')];
    expect(assignPlot(plots, 500 + 599_999, 600_000)).toBe('allPlotsBusy');
    expect(assignPlot(plots, 500 + 600_000, 600_000)).toEqual({ index: 1, retire: true });
  });
  it('a building empty for 3 min becomes unattended', () => {
    expect(becomesUnattended({ state: 'building', finishedAt: null, emptySince: 0 }, 179_999, 180_000)).toBe(false);
    expect(becomesUnattended({ state: 'building', finishedAt: null, emptySince: 0 }, 180_000, 180_000)).toBe(true);
    expect(becomesUnattended({ state: 'building', finishedAt: null, emptySince: null }, 1e9, 180_000)).toBe(false);
  });
});

describe('crews', () => {
  const m = (key: string, joinedAt: number, role: 'host' | 'member' = 'member'): CrewMember => ({ keyHash: key, pid: key, name: key, hatColor: 'teal', joinedAt, role });
  const crew = (n: number, joinMode: CrewRecord['joinMode'] = 'ask'): CrewRecord => ({ joinMode, members: Array.from({ length: n }, (_, i) => m(`k${i}`, i, i === 0 ? 'host' : 'member')) });
  const ok = { alreadyInCrew: false, cooldownUntil: 0, hiddenByHost: false, now: 1000 };
  it('join modes: open → joined, ask → pending, solo → closed', () => {
    expect(requestJoin(crew(2, 'open'), ok)).toBe('joined');
    expect(requestJoin(crew(2, 'ask'), ok)).toBe('pending');
    expect(requestJoin(crew(2, 'solo'), ok)).toBe('closed');
  });
  it('full at 8 including the Host; cooldown; already in a crew; hidden → busy', () => {
    expect(requestJoin(crew(CREW.maxSize), ok)).toBe('full');
    expect(requestJoin(crew(CREW.maxSize - 1), ok)).toBe('pending');
    expect(requestJoin(crew(2), { ...ok, cooldownUntil: 1001 })).toBe('cooldown');
    expect(requestJoin(crew(2), { ...ok, alreadyInCrew: true })).toBe('alreadyInCrew');
    expect(requestJoin(crew(2), { ...ok, hiddenByHost: true })).toBe('busy');
  });
  it('next Host is the oldest active member, else the oldest member', () => {
    const c = crew(4);
    const status = (s: Record<string, MemberStatus>) => (x: CrewMember): MemberStatus => s[x.keyHash] ?? 'active';
    const host = hostOf(c)!;
    expect(nextHost(c, status({ k1: 'away' }), host)?.keyHash).toBe('k2');
    expect(nextHost(c, status({ k1: 'away', k2: 'idle', k3: 'away' }), host)?.keyHash).toBe('k1');
  });
  it('hands over when the Host is away too long or idle while others are active', () => {
    const c = crew(3);
    const s = (h: MemberStatus, o: MemberStatus) => (x: CrewMember): MemberStatus => (x.role === 'host' ? h : o);
    expect(shouldHandOver(c, s('active', 'active'), false)).toBe(false);
    expect(shouldHandOver(c, s('away', 'active'), true)).toBe(true);
    expect(shouldHandOver(c, s('idle', 'active'), false)).toBe(true);
    expect(shouldHandOver(c, s('idle', 'idle'), false)).toBe(false);
    expect(shouldHandOver(crew(1), s('idle', 'active'), true)).toBe(false);
  });
  it('setHost and removeMember', () => {
    const c = crew(3);
    setHost(c, c.members[2]!);
    expect(hostOf(c)?.keyHash).toBe('k2');
    expect(c.members.filter((x) => x.role === 'host')).toHaveLength(1);
    removeMember(c, c.members[1]!);
    expect(c.members.map((x) => x.keyHash)).toEqual(['k0', 'k2']);
  });
});

describe('supply bins', () => {
  it('accepts blueprint piece types only, up to 10', () => {
    expect(canBin('brick', CLOCK_TOWER)).toBe(true);
    expect(canBin('cone', CLOCK_TOWER)).toBe(false);
    const bin: BinEntry[] = [];
    for (let i = 0; i < 10; i++) expect(addToBin(bin, { type: 'brick', donorKeyHash: 'd', donorPid: null })).toBe(true);
    expect(addToBin(bin, { type: 'brick', donorKeyHash: 'd', donorPid: null })).toBe(false);
  });
  it('take prefers the needed type and returns the donor', () => {
    const bin: BinEntry[] = [{ type: 'beam', donorKeyHash: 'a', donorPid: 'pa' }, { type: 'brick', donorKeyHash: 'b', donorPid: 'pb' }, { type: 'paint', donorKeyHash: 'c', donorPid: null }];
    expect(takeFromBin(bin, 'beam')?.donorKeyHash).toBe('a');
    expect(takeFromBin(bin, 'bell')?.type).toBe('paint');
    expect(bin).toHaveLength(1);
    expect(takeFromBin([], 'beam')).toBeUndefined();
  });
});

describe('shift phases', () => {
  const end = 3_600_000;
  it('running → warning (≤ 5 min) → countdown (≤ 30 s) → resetting', () => {
    expect(shiftPhase(0, end, false)).toBe('running');
    expect(shiftPhase(end - 300_000, end, false)).toBe('warning');
    expect(shiftPhase(end - 30_000, end, false)).toBe('countdown');
    expect(shiftPhase(end, end, false)).toBe('resetting');
    expect(shiftPhase(end + 10_000, end, false)).toBe('resetting');
  });
  it('waits for a celebration before resetting; epochs advance by one', () => {
    expect(shiftPhase(end + 1000, end, true)).toBe('countdown');
    expect(nextEpoch(7)).toBe(8);
  });
});
