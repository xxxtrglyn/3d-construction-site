import { SITE } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { sleep, worldOf, type Player } from './helpers.ts';

export function helpersFor(getServer: () => RunningServer) {
  const S = (p: Player) => worldOf(getServer()).sessions.get(p.welcome.sessionId)!;
  const put = (p: Player, x: number, z: number, facing = 0) => {
    const s = S(p);
    s.worker = { ...s.worker, x, z, facing };
  };
  const host = async (p: Player): Promise<number> => {
    put(p, SITE.foreman.x, SITE.foreman.z + 1);
    p.send('foreman', { op: 'start', blueprint: 'clock-tower' });
    const r = await p.waitFor('foreman', (x) => x.result === 'assigned');
    return (r as { plot: number }).plot;
  };
  const dropAt = async (p: Player, x: number, z: number, type: string) => {
    put(p, x, z, 0);
    S(p).worker.carrying = type as never;
    p.send('drop', {});
    await sleep(250);
  };
  const plotState = (plot: number) => worldOf(getServer()).state.plots[plot]!;
  return { S, put, host, dropAt, plotState };
}
