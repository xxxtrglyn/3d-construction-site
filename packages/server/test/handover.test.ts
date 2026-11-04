import { afterEach, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until } from './helpers.ts';
import { helpersFor } from './world-helpers.ts';

let server: RunningServer;
const { S, put, host, plotState } = helpersFor(() => server);
afterEach(async () => {
  await server?.close();
});

async function crewOfThree(): Promise<{ a: Awaited<ReturnType<typeof joinPlayer>>; b: Awaited<ReturnType<typeof joinPlayer>>; c: Awaited<ReturnType<typeof joinPlayer>>; plot: number }> {
  const a = await joinPlayer(server);
  const b = await joinPlayer(server);
  const c = await joinPlayer(server);
  const plot = await host(a);
  await sleep(550);
  a.send('crew', { op: 'mode', mode: 'open' });
  await until(() => plotState(plot).joinMode === 'open');
  b.send('crew', { op: 'request', plot });
  await b.waitFor('requestResult', (r) => r.result === 'joined');
  await sleep(20);
  c.send('crew', { op: 'request', plot });
  await c.waitFor('requestResult', (r) => r.result === 'joined');
  return { a, b, c, plot };
}

describe('the building survives its Host', () => {
  it('Host away too long → the longest-serving member becomes Host', async () => {
    server = await boot({ timers: { hostAwayS: 1, reconnectGraceS: 10 } });
    const { a, b, c } = await crewOfThree();
    await a.leave(false);
    await b.waitFor('crewNotice', (n) => n.kind === 'newHost' && n.who === b.welcome.sessionId, 5000);
    expect(S(b).crewRole).toBe('host');
    await b.leave();
    await c.leave();
  });

  it('the Host returning within the grace keeps the role', async () => {
    server = await boot({ timers: { hostAwayS: 30, reconnectGraceS: 30 } });
    const { a, b, c } = await crewOfThree();
    await a.leave(false);
    await until(() => S(a).state === 'away');
    const back = await joinPlayer(server, { key: a.key });
    expect(back.welcome.resumed).toBe(true);
    expect(S(back).crewRole).toBe('host');
    for (const p of [back, b, c]) await p.leave();
  });

  it('an idle Host hands over to an active member', async () => {
    server = await boot({ timers: { hostIdleS: 1 } });
    const { a, b, c } = await crewOfThree();
    S(a).lastActiveAt = Date.now() - 5000;
    S(b).lastActiveAt = Date.now();
    await b.waitFor('crewNotice', (n) => n.kind === 'newHost', 4000);
    expect(S(b).crewRole).toBe('host');
    for (const p of [a, b, c]) await p.leave();
  });

  it('a pending request moves to the new Host', async () => {
    server = await boot();
    const { a, b, c, plot } = await crewOfThree();
    await sleep(550);
    a.send('crew', { op: 'mode', mode: 'ask' });
    await until(() => plotState(plot).joinMode === 'ask');
    const d = await joinPlayer(server);
    d.send('crew', { op: 'request', plot });
    await a.waitFor('request', (r) => r.op === 'incoming');
    await sleep(550);
    a.send('crew', { op: 'handover', to: b.welcome.sessionId });
    const card = await b.waitFor('request', (r) => r.op === 'incoming');
    expect(card).toMatchObject({ requester: d.welcome.sessionId });
    for (const p of [a, b, c, d]) await p.leave();
  });

  it('an empty crew → unattended after the timeout → adopted through the Foreman with progress kept', async () => {
    server = await boot({ timers: { unattendedAfterS: 1 } });
    const a = await joinPlayer(server);
    const plot = await host(a);
    a.send('dev', { op: 'fillStage', plot });
    await until(() => plotState(plot).completedStages === 1);
    await sleep(550);
    a.send('crew', { op: 'leave' });
    await until(() => plotState(plot).state === 'unattended', 4000);
    const z = await joinPlayer(server);
    put(z, 0, -2);
    z.send('foreman', { op: 'adopt', plot: (plot + 1) % 12 });
    expect((await z.waitFor('foreman')).result).toBe('notAvailable');
    await sleep(550);
    z.send('foreman', { op: 'adopt', plot });
    expect(await z.waitFor('foreman', (r) => r.result === 'adopted')).toEqual({ result: 'adopted', plot });
    expect(plotState(plot).state).toBe('building');
    expect(plotState(plot).completedStages).toBe(1);
    expect(S(z).crewRole).toBe('host');
    await a.leave();
    await z.leave();
  });
});
