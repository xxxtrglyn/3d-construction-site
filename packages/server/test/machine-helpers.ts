import { SITE, entryPoint, machineId, type MachineKind, type MoveInput } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { sleep, until, worldOf, type Player } from './helpers.ts';
import { helpersFor } from './world-helpers.ts';

/** Feature 003 test helpers: getting in, driving with the input stream, reading machines on the server. */
export function machineHelpersFor(getServer: () => RunningServer) {
  const h = helpersFor(getServer);
  const sys = () => worldOf(getServer()).systems;
  const rec = (plot: number, kind: MachineKind) => sys().machines.recs[machineId(plot, kind)]!;
  /** Stand at the machine's entry point. */
  const goTo = (p: Player, plot: number, kind: MachineKind, dx = 0.5) => {
    const e = entryPoint(rec(plot, kind).state, SITE.machines[plot]!);
    h.put(p, e.x + dx, e.z);
  };
  const enter = async (p: Player, plot: number, kind: MachineKind) => {
    goTo(p, plot, kind);
    const id = machineId(plot, kind);
    p.send('machine', { op: 'enter', id });
    return (await p.waitFor('machineResult', (r) => r.id === id)).result;
  };
  /** Sends inputs within the 60/s budget (6 every 100 ms) and waits until the server applied them. */
  const steps = async (p: Player, list: Array<Partial<MoveInput>>) => {
    for (let k = 0; k < list.length; k += 6) {
      p.move(list.slice(k, k + 6));
      await sleep(100);
    }
    const last = (p.seq - 1) & 0xffff;
    await until(() => h.S(p).lastSeq === last, 4000);
  };
  const hold = (n: number, i: Partial<MoveInput>): Array<Partial<MoveInput>> => Array.from({ length: n }, () => ({ ...i }));
  /** One action press followed by `after` neutral steps. */
  const press = (after = 0): Array<Partial<MoveInput>> => [{ act: true }, ...hold(after, {})];
  return { ...h, sys, rec, goTo, enter, steps, hold, press };
}
