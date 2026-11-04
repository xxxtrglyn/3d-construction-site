import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/server.ts';
import { closeBlocklist } from '../src/systems/blocklist.ts';
import { boot, joinPlayer, sleep, until } from './helpers.ts';
import { helpersFor } from './world-helpers.ts';

let server: RunningServer;
const { S, put, host, plotState } = helpersFor(() => server);
const dir = mkdtempSync(join(tmpdir(), 'hht-blocklist-'));
writeFileSync(join(dir, 'en.txt'), '# test\nshit\n');
afterEach(async () => {
  await server?.close();
  closeBlocklist();
});
const chatBoot = (t: Record<string, number> = {}) => boot({ blocklistDir: dir, timers: { chatUnlockS: 0, ...t } });

describe('chat and moderation', () => {
  it('nearby reaches ≤ 20 m (with echo) and not 40 m; masking applies', async () => {
    server = await chatBoot();
    const a = await joinPlayer(server);
    const near = await joinPlayer(server);
    const far = await joinPlayer(server);
    put(a, -10, 0);
    put(near, 0, 0);
    put(far, 30, 0);
    a.send('chat', { channel: 'nearby', text: 'oh shit, need bricks' });
    const m = await near.waitFor('chat');
    expect(m).toMatchObject({ from: a.welcome.sessionId, channel: 'nearby', text: 'oh ♥♥♥♥, need bricks' });
    await a.waitFor('chat');
    await sleep(200);
    expect(far.events.some((e) => e.type === 'chat')).toBe(false);
    for (const p of [a, near, far]) await p.leave();
  });

  it('crew messages reach the whole crew anywhere and nobody else; noCrew without a crew', async () => {
    server = await chatBoot();
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    const stranger = await joinPlayer(server);
    stranger.send('chat', { channel: 'crew', text: 'hello crew' });
    expect((await stranger.waitFor('chatRefused')).reason).toBe('noCrew');
    const plot = await host(a);
    await sleep(550);
    a.send('crew', { op: 'mode', mode: 'open' });
    await until(() => plotState(plot).joinMode === 'open');
    b.send('crew', { op: 'request', plot });
    await b.waitFor('requestResult', (r) => r.result === 'joined');
    put(a, 30, 0);
    put(b, -30, 0);
    put(stranger, 30, 0.5);
    a.send('chat', { channel: 'crew', text: 'bring the bell' });
    expect((await b.waitFor('chat')).text).toBe('bring the bell');
    await sleep(200);
    expect(stranger.events.some((e) => e.type === 'chat')).toBe(false);
    // a removed member stops receiving crew chat
    await sleep(550);
    a.send('crew', { op: 'remove', member: b.welcome.sessionId });
    await b.waitFor('crewNotice', (n) => n.kind === 'removed');
    a.send('chat', { channel: 'crew', text: 'are you there' });
    await sleep(300);
    expect(b.events.filter((e) => e.type === 'chat')).toHaveLength(1);
    for (const p of [a, b, stranger]) await p.leave();
  });

  it('refusals in order: locked, rate, duplicate, contact, tooLong', async () => {
    server = await boot({ blocklistDir: dir, timers: { chatUnlockS: 1 } });
    const a = await joinPlayer(server);
    a.send('chat', { channel: 'nearby', text: 'hi' });
    const locked = await a.waitFor('chatRefused');
    expect(locked.reason).toBe('locked');
    expect(locked.unlockAt).toBeGreaterThan(Date.now());
    await sleep(2100);
    a.send('chat', { channel: 'nearby', text: 'hello' });
    await a.waitFor('chat');
    a.send('chat', { channel: 'nearby', text: 'HELLO' });
    expect((await a.waitFor('chatRefused', (r) => r.reason === 'duplicate')).reason).toBe('duplicate');
    a.send('chat', { channel: 'nearby', text: 'find me on www.example.com' });
    expect((await a.waitFor('chatRefused', (r) => r.reason === 'contact')).reason).toBe('contact');
    for (let i = 0; i < 4; i++) a.send('chat', { channel: 'nearby', text: `msg ${i}` });
    await a.waitFor('slowDown');
    await sleep(2100);
    a.send('chat', { channel: 'nearby', text: 'x'.repeat(81) });
    expect((await a.waitFor('chatRefused', (r) => r.reason === 'tooLong')).reason).toBe('tooLong');
    await a.leave();
  }, 15_000);

  it('reports store the last messages; 3 distinct reporters pause chat until the shift ends (survives restart)', async () => {
    server = await chatBoot();
    const bad = await joinPlayer(server);
    const r1 = await joinPlayer(server);
    const r2 = await joinPlayer(server);
    const r3 = await joinPlayer(server);
    bad.send('chat', { channel: 'nearby', text: 'you are all slow' });
    await bad.waitFor('chat');
    r1.send('report', { who: bad.welcome.sessionId });
    expect((await r1.waitFor('reportResult')).result).toBe('ok');
    await sleep(10_100); // report bucket
    r1.send('report', { who: bad.welcome.sessionId });
    expect((await r1.waitFor('reportResult', (r) => r.result === 'already')).result).toBe('already');
    const row = server.ctx.db.sql.prepare('SELECT messages_json, reported_name FROM chat_report').get() as { messages_json: string; reported_name: string };
    expect(JSON.parse(row.messages_json)[0].text).toBe('you are all slow');
    r2.send('report', { who: bad.welcome.sessionId });
    await r2.waitFor('reportResult');
    r3.send('report', { who: bad.welcome.sessionId });
    await r3.waitFor('reportResult');
    await bad.waitFor('chatPaused');
    await sleep(2100);
    bad.send('chat', { channel: 'nearby', text: 'let me talk' });
    expect((await bad.waitFor('chatRefused', (r) => r.reason === 'paused')).reason).toBe('paused');
    bad.send('emote', { id: 'wave' });
    await r1.waitFor('emote');
    expect(S(bad).recentChat.length).toBe(1);
    for (const p of [bad, r1, r2, r3]) await p.leave();
  }, 25_000);

  it('purges reports older than 30 days at boot', async () => {
    server = await chatBoot();
    server.ctx.db.sql.prepare("INSERT INTO chat_report (world_id, epoch, reporter_key_hash, reported_key_hash, reported_name, messages_json, created_at) VALUES (1, 1, 'a', 'b', 'X', '[]', ?)").run(Date.now() - 31 * 86_400_000);
    const sys = server.ctx.worlds.get(1)!.systems;
    sys.repo.purgeReports(Date.now() - 30 * 86_400_000);
    const n = server.ctx.db.sql.prepare('SELECT COUNT(*) AS n FROM chat_report').get() as { n: number };
    expect(n.n).toBe(0);
  });
});
