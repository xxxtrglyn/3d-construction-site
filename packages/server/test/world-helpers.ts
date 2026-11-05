import { SITE, filledTotal, needsOf, type PieceTypeId, type TowerProgress } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { sleep, until, worldOf, type Player } from './helpers.ts';

export function helpersFor(getServer: () => RunningServer) {
  const S = (p: Player) => worldOf(getServer()).sessions.get(p.welcome.sessionId)!;
  const put = (p: Player, x: number, z: number, facing = 0) => {
    const s = S(p);
    s.worker = { ...s.worker, x, z, facing };
  };
  /** Finishes Groundwork on the server directly (no rate limits); feature 002 tests start building at stage 1. */
  const skipGroundwork = (plot: number) => {
    const sys = worldOf(getServer()).systems;
    const b = sys.plots[plot]!;
    b.progress = { ...b.progress, groundDug: 6, groundPoured: 4 };
    sys.saveBuilding(b);
    sys.syncPlot(plot);
  };
  const host = async (p: Player, opts: { groundwork?: boolean } = {}): Promise<number> => {
    put(p, SITE.foreman.x, SITE.foreman.z + 1);
    p.send('foreman', { op: 'start', blueprint: 'clock-tower' });
    const r = await p.waitFor('foreman', (x) => x.result === 'assigned');
    const plot = (r as { plot: number }).plot;
    if (!opts.groundwork) skipGroundwork(plot);
    return plot;
  };
  const dropAt = async (p: Player, x: number, z: number, type: string) => {
    put(p, x, z, 0);
    S(p).worker.carrying = type as never;
    p.send('drop', {});
    await sleep(250);
  };
  const plotState = (plot: number) => worldOf(getServer()).state.plots[plot]!;
  /** The server-side progress of a plot's building. */
  const progressOf = (plot: number): TowerProgress => worldOf(getServer()).systems.plots[plot]!.progress;
  /** feature 004: slots filled in the current stage, all materials (schema filledA + filledB). */
  const filledOf = (plot: number) => plotState(plot).filledA + plotState(plot).filledB;
  /** feature 004: the first recipe material of the current stage that still has an ordinary (hand) slot open. */
  const handNeed = (plot: number): PieceTypeId | null => needsOf(progressOf(plot)).find((n) => !n.done && !n.craneOnly)?.type ?? null;
  /**
   * feature 004: hand-delivers `count` pieces of the current stage's recipe into the plot's build zone
   * (default: every ordinary slot), always the first material that still has a hand slot, and waits for
   * each snap. Returns the types delivered, in order.
   */
  const deliverRecipe = async (p: Player, plot: number, count = Infinity): Promise<PieceTypeId[]> => {
    const d = SITE.plots[plot]!;
    const out: PieceTypeId[] = [];
    for (let i = 0; i < count; i++) {
      const type = handNeed(plot);
      if (!type) break;
      const before = { stage: progressOf(plot).completedStages, filled: filledTotal(progressOf(plot)) };
      await dropAt(p, d.x, d.z, type);
      await until(() => progressOf(plot).completedStages !== before.stage || filledTotal(progressOf(plot)) === before.filled + 1);
      out.push(type);
    }
    return out;
  };
  return { S, put, host, dropAt, plotState, skipGroundwork, progressOf, filledOf, handNeed, deliverRecipe };
}
