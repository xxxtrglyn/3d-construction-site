import { afterEach, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until } from './helpers.ts';
import { helpersFor } from './world-helpers.ts';
import { SITE } from '@hht/shared';

let server: RunningServer;
const { S, host, dropAt, plotState } = helpersFor(() => server);
afterEach(async () => {
  await server?.close();
});

describe('crews and join modes', () => {
  it('Ask: request → Host card → approve → joined; the member can snap', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    const plot = await host(a);
    b.send('crew', { op: 'request', plot });
    const card = await a.waitFor('request', (r) => r.op === 'incoming');
    expect(card).toMatchObject({ requester: b.welcome.sessionId, name: b.welcome.name });
    expect((await b.waitFor('requestResult')).result).toBe('pending');
    a.send('crew', { op: 'answer', requester: b.welcome.sessionId, approve: true });
    await b.waitFor('requestResult', (r) => r.result === 'joined');
    await a.waitFor('crewNotice', (n) => n.kind === 'joined');
    expect(S(b).crewPlot).toBe(plot);
    expect(S(b).crewRole).toBe('member');
    const d = SITE.plots[plot]!;
    await dropAt(b, d.x, d.z, 'beam');
    await until(() => plotState(plot).filledSlots === 1);
    await a.leave();
    await b.leave();
  });

  it('deny → cooldown with retryAt; requests expire after the timeout', async () => {
    server = await boot({ timers: { requestExpireS: 1, denyCooldownS: 60 } });
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    const c = await joinPlayer(server);
    const plot = await host(a);
    b.send('crew', { op: 'request', plot });
    await a.waitFor('request');
    a.send('crew', { op: 'answer', requester: b.welcome.sessionId, approve: false });
    await b.waitFor('requestResult', (r) => r.result === 'denied');
    await sleep(5500); // request bucket refill (1 per 5 s)
    b.send('crew', { op: 'request', plot });
    const cd = await b.waitFor('requestResult', (r) => r.result === 'cooldown');
    expect(cd.retryAt).toBeGreaterThan(Date.now());
    c.send('crew', { op: 'request', plot });
    await c.waitFor('requestResult', (r) => r.result === 'pending');
    await c.waitFor('requestResult', (r) => r.result === 'expired', 4000);
    await a.waitFor('request', (r) => r.op === 'withdrawn');
    for (const p of [a, b, c]) await p.leave();
  }, 20_000);

  it('Open joins at once; Solo is closed; the 9th member gets full', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const plot = await host(a);
    await sleep(550);
    a.send('crew', { op: 'mode', mode: 'open' });
    await until(() => plotState(plot).joinMode === 'open');
    const members = [];
    for (let i = 0; i < 7; i++) {
      const p = await joinPlayer(server);
      p.send('crew', { op: 'request', plot });
      await p.waitFor('requestResult', (r) => r.result === 'joined');
      members.push(p);
    }
    expect(plotState(plot).crewSize).toBe(8);
    const ninth = await joinPlayer(server);
    ninth.send('crew', { op: 'request', plot });
    expect((await ninth.waitFor('requestResult')).result).toBe('full');
    await sleep(550);
    a.send('crew', { op: 'mode', mode: 'solo' });
    await until(() => plotState(plot).joinMode === 'solo');
    const tenth = await joinPlayer(server);
    tenth.send('crew', { op: 'request', plot });
    expect((await tenth.waitFor('requestResult')).result).toBe('closed');
    for (const p of [a, ...members, ninth, tenth]) await p.leave();
  });

  it('remove, hand over, and only the Host may answer/mode/remove', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    const c = await joinPlayer(server);
    const plot = await host(a);
    await sleep(550);
    a.send('crew', { op: 'mode', mode: 'open' });
    await until(() => plotState(plot).joinMode === 'open');
    b.send('crew', { op: 'request', plot });
    await b.waitFor('requestResult', (r) => r.result === 'joined');
    c.send('crew', { op: 'request', plot });
    await c.waitFor('requestResult', (r) => r.result === 'joined');
    // a member trying Host-only ops gets a strike and nothing happens
    b.send('crew', { op: 'mode', mode: 'solo' });
    b.send('crew', { op: 'remove', member: c.welcome.sessionId });
    await sleep(200);
    expect(plotState(plot).joinMode).toBe('open');
    expect(S(c).crewPlot).toBe(plot);
    expect(S(b).strikes.times.length).toBe(2);
    await sleep(550);
    a.send('crew', { op: 'remove', member: c.welcome.sessionId });
    await c.waitFor('crewNotice', (n) => n.kind === 'removed');
    expect(S(c).crewPlot).toBe(-1);
    await sleep(550);
    a.send('crew', { op: 'handover', to: b.welcome.sessionId });
    await b.waitFor('crewNotice', (n) => n.kind === 'newHost');
    expect(S(b).crewRole).toBe('host');
    expect(S(a).crewRole).toBe('member');
    const rows = server.ctx.db.sql.prepare('SELECT role FROM crew_member WHERE world_id = 1 ORDER BY joined_at').all();
    expect(rows).toEqual([{ role: 'member' }, { role: 'host' }]);
    for (const p of [a, b, c]) await p.leave();
  });
});
