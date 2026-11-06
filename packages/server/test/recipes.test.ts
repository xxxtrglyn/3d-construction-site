import { afterEach, describe, expect, it } from 'vitest';
import { CLOCK_TOWER, SITE, filledTotal, type PieceTypeId } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until, worldOf, type Player } from './helpers.ts';
import { helpersFor } from './world-helpers.ts';

/** Feature 004: mixed-material stages on the server (FR-006, FR-009, SC-007). */
let server: RunningServer;
const { S, put, host, dropAt, plotState, progressOf, deliverRecipe } = helpersFor(() => server);
afterEach(async () => {
  await server?.close();
});

const sys = () => worldOf(server).systems;
const FRAME = CLOCK_TOWER.stages[0]!;
const hints = (p: Player) => p.events.filter((e) => e.type === 'hint').map((e) => e.payload);
const snapsOf = (p: Player) => p.events.filter((e) => e.type === 'snap');
/** The single loose piece that is not one of `known` (piece ids). */
const newPieces = (known: Set<number>) => [...sys().pieces.values()].filter((p) => !known.has(p.id));
/** Asserts a piece lies loose on the ground just outside the plot's build zone. */
const expectBeside = (plot: number, pc: { x: number; z: number; state: string }) => {
  const d = SITE.plots[plot]!;
  expect(pc.state).toBe('loose');
  const dist = Math.hypot(pc.x - d.x, pc.z - d.z);
  expect(dist).toBeGreaterThan(d.buildZoneRadius);
  expect(dist).toBeLessThan(d.buildZoneRadius + 2);
};
/** Host `a` with `b` as a crew member (open join mode). */
const crewOfTwo = async (a: Player, b: Player): Promise<number> => {
  const plot = await host(a);
  await sleep(550);
  a.send('crew', { op: 'mode', mode: 'open' });
  await until(() => plotState(plot).joinMode === 'open');
  b.send('crew', { op: 'request', plot });
  await b.waitFor('requestResult', (r) => r.result === 'joined');
  return plot;
};

describe('mixed-material stages (feature 004)', () => {
  it('two crew members drop the last needed brick of the Frame in the same tick: exactly one snaps, the other is surplus and lands beside the plot (FR-009)', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    const plot = await crewOfTwo(a, b);
    const brick = FRAME.recipe.findIndex((r) => r.type === 'brick');
    const bricks = FRAME.recipe[brick]!.count;
    // all bricks but one (beams stay open, so the stage cannot complete)
    for (let i = 0; i < bricks - 1; i++) await dropAt(a, SITE.plots[plot]!.x, SITE.plots[plot]!.z, 'brick');
    await until(() => (progressOf(plot).filled[brick] ?? 0) === bricks - 1);
    expect(sys().pieces.size).toBe(0);
    const snapsBefore = snapsOf(a).length;
    // both carry a brick in the build zone and drop it at once
    const d = SITE.plots[plot]!;
    put(a, d.x, d.z, 0);
    put(b, d.x + 0.4, d.z, 0);
    S(a).worker.carrying = 'brick';
    S(b).worker.carrying = 'brick';
    a.send('drop', {});
    b.send('drop', {});
    await until(() => snapsOf(a).length === snapsBefore + 1 && sys().pieces.size === 1);
    await sleep(200);
    // exactly one snapped; the material never overfills
    expect(snapsOf(a)).toHaveLength(snapsBefore + 1);
    expect(snapsOf(a).at(-1)!.payload).toMatchObject({ plot, pieceType: 'brick', via: 'hand', result: 'snapped' });
    expect(progressOf(plot).filled[brick]).toBe(bricks);
    expect(progressOf(plot).completedStages).toBe(0);
    for (let i = 0; i < FRAME.recipe.length; i++) expect(progressOf(plot).filled[i]).toBeLessThanOrEqual(FRAME.recipe[i]!.count);
    expect(sys().audit.overfilledSlots).toBe(0);
    // the other brick is surplus: loose beside the plot, with a hint to its owner only
    const [extra] = [...sys().pieces.values()];
    expect(extra!.type).toBe('brick');
    expectBeside(plot, extra!);
    const surplus = { kind: 'surplus', type: 'brick', needed: ['beam'] };
    const got = [a, b].filter((p) => hints(p).length > 0);
    expect(got).toHaveLength(1);
    expect(hints(got[0]!)).toEqual([surplus]);
    expect(extra!.actorPid).toBe(got[0]!.welcome.sessionId);
    expect(S(a).worker.carrying).toBeNull();
    expect(S(b).worker.carrying).toBeNull();
    await a.leave();
    await b.leave();
  });

  it('refusals: a paint in the Frame is wrongPiece (needed in recipe order), a 3rd brick is surplus; both are pushed out and filled is unchanged; no piece is ever consumed (SC-007)', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const o = await joinPlayer(server);
    const plot = await host(a);
    const d = SITE.plots[plot]!;
    // piece conservation: every piece put into the world is loose, in a bin, or a snapped delivery
    let injected = 0;
    const known = new Set<number>();
    const deliveries = () => FRAME.slotCount * Math.min(1, progressOf(plot).completedStages) + filledTotal(progressOf(plot));
    const conserved = () => {
      for (const p of sys().pieces.values()) expect(['loose', 'flying']).toContain(p.state);
      expect(sys().pieces.size + deliveries() + plotState(plot).bin.length).toBe(injected);
      expect(snapsOf(a)).toHaveLength(deliveries());
    };
    const drop = async (p: Player, x: number, z: number, type: PieceTypeId) => {
      for (const pc of sys().pieces.values()) known.add(pc.id);
      injected++;
      await dropAt(p, x, z, type);
    };
    const pushedOut = (type: PieceTypeId) => {
      const fresh = newPieces(known);
      expect(fresh).toHaveLength(1);
      expect(fresh[0]!.type).toBe(type);
      expectBeside(plot, fresh[0]!);
    };

    // (b) paint in the Frame: wrongPiece listing every material still needed, in recipe order
    await drop(a, d.x, d.z, 'paint');
    expect(await a.waitFor('hint')).toEqual({ kind: 'wrongPiece', needed: ['beam', 'brick'] });
    pushedOut('paint');
    expect(progressOf(plot).filled).toEqual([0, 0]);
    expect(plotState(plot)).toMatchObject({ filledA: 0, filledB: 0 });
    conserved();

    // (c) the 2 bricks snap, a 3rd is surplus
    await drop(a, d.x, d.z, 'brick');
    await drop(a, d.x, d.z, 'brick');
    await until(() => plotState(plot).filledB === 2);
    conserved();
    await drop(a, d.x, d.z, 'brick');
    expect(await a.waitFor('hint', (h) => h.kind === 'surplus')).toEqual({ kind: 'surplus', type: 'brick', needed: ['beam'] });
    pushedOut('brick');
    expect(progressOf(plot).filled).toEqual([0, 2]);
    conserved();

    // the bin: a brick is no longer needed anywhere in the Frame; a beam is
    await drop(o, d.bin.x, d.bin.z, 'brick');
    expect(await o.waitFor('hint', (h) => h.kind === 'binNotNeeded')).toEqual({ kind: 'binNotNeeded', type: 'brick', needed: ['beam'] });
    const refused = newPieces(known);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ type: 'brick', state: 'loose' });
    conserved();
    await drop(o, d.bin.x, d.bin.z, 'beam');
    await until(() => plotState(plot).bin.length === 1);
    conserved();

    // with only beams left, the wrongPiece hint names just the beam
    await drop(a, d.x, d.z, 'paint');
    expect(await a.waitFor('hint', (h) => h.kind === 'wrongPiece' && h.needed.length === 1)).toEqual({ kind: 'wrongPiece', needed: ['beam'] });
    pushedOut('paint');
    conserved();

    // the 4 beams finish the Frame (snaps counted against the injected pieces)
    for (let i = 0; i < 4; i++) {
      for (const pc of sys().pieces.values()) known.add(pc.id);
      injected++;
      await deliverRecipe(a, plot, 1);
    }
    await until(() => plotState(plot).completedStages === 1);
    expect(progressOf(plot).filled).toEqual(CLOCK_TOWER.stages[1]!.recipe.map(() => 0));
    conserved();
    // Walls & Floors: the hint follows the new recipe order
    await drop(a, d.x, d.z, 'paint');
    expect(await a.waitFor('hint', (h) => h.kind === 'wrongPiece' && h.needed.length === 2 && h.needed[0] === 'brick')).toEqual({ kind: 'wrongPiece', needed: ['brick', 'beam'] });
    conserved();
    expect(hints(o)).toHaveLength(1);
    expect(sys().audit.overfilledSlots).toBe(0);
    expect(sys().audit.nonCrewSnaps).toBe(0);
    await a.leave();
    await o.leave();
  }, 20_000);

  it('dev fillMaterial fills one material\'s ordinary slots; fillStage fills every recipe material', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const plot = await host(a);
    await sleep(550);
    a.send('dev', { op: 'fillMaterial', plot, type: 'beam' });
    await until(() => plotState(plot).filledA === 4);
    expect(progressOf(plot)).toMatchObject({ completedStages: 0, filled: [4, 0] });
    await sleep(550);
    a.send('dev', { op: 'fillStage', plot });
    await until(() => plotState(plot).completedStages === 1);
    expect(progressOf(plot).filled).toEqual([0, 0]);
    // Roof & Windows: fillMaterial leaves the crane-only panel slots open
    await sleep(550);
    a.send('dev', { op: 'fillStage', plot });
    await until(() => plotState(plot).completedStages === 2);
    await sleep(550);
    a.send('dev', { op: 'fillMaterial', plot, type: 'panel' });
    await until(() => plotState(plot).filledA === 1);
    await sleep(300);
    expect(progressOf(plot)).toMatchObject({ completedStages: 2, filled: [1, 0], highFilled: 0 });
    await a.leave();
  });
});
