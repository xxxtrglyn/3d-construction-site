/**
 * `pnpm loadtest [--duration 300] [--bots 100] [--soak 1800] [--url http://host:2567] [--selftest]`
 * Headless 100-bot load test (constitution VI, research R12). Boots an in-process server unless
 * --url is given, runs bots in 4 worker threads, samples metrics every second, checks consistency
 * and asserts the `net` budgets from tools/assets/budgets.json. Writes reports/loadtest/<ts>.json.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { CLOCK_TOWER } from '@hht/shared';
import { loadConfig } from '../src/config.ts';
import { startServer, type RunningServer } from '../src/server.ts';
import type { BotStats } from './bot.ts';
import { dist, printSummary, slope, writeReport, type BudgetRow } from './report.ts';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const args = process.argv.slice(2);
const arg = (name: string, d?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1] : 'true') : d;
};
const soak = arg('soak') ? Number(arg('soak')) : 0;
const duration = soak || Number(arg('duration', '300'));
const botCount = Number(arg('bots', '100'));
const url = arg('url');
const selftest = arg('selftest') === 'true';
const mode = soak ? 'soak' : duration <= 90 ? 'quick' : 'full';
const WORKERS = 4;
const WARMUP_S = Math.min(20, Math.max(5, duration * 0.1));
const budgets = JSON.parse(readFileSync(resolve(ROOT, 'tools/assets/budgets.json'), 'utf8')).net as Record<string, number>;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  let server: RunningServer | null = null;
  let base = url ?? '';
  if (!url) {
    server = await startServer(loadConfig({ HHT_DB: ':memory:', HHT_METRICS: '1', HHT_MM_PER_MIN: '100000' }, { port: 0, maxPlayers: Math.max(100, botCount), injectTickMs: selftest ? 30 : 0 }));
    base = `http://127.0.0.1:${server.port}`;
  }
  console.log(`[loadtest] ${botCount} bots × ${duration}s against ${base} (${mode}${selftest ? ', self-test: +30 ms per tick' : ''})`);
  const startedAt = new Date().toISOString();
  const latest: BotStats[][] = Array.from({ length: WORKERS }, () => []);
  const errors: string[] = [];
  let viewsResolve: ((v: unknown[]) => void) | null = null;
  const viewsCollected: unknown[] = [];
  const workers: Worker[] = [];
  const per = Math.ceil(botCount / WORKERS);
  for (let w = 0; w < WORKERS; w++) {
    const from = w * per;
    const count = Math.max(0, Math.min(per, botCount - from));
    const worker = new Worker(new URL('./bot-worker.ts', import.meta.url), { workerData: { base, from, count, seed: 1234, rampMs: 40 } });
    worker.on('message', (m: { type: string; stats?: BotStats[]; message?: string; views?: unknown[] }) => {
      if (m.type === 'stats' && m.stats) latest[w] = m.stats;
      else if (m.type === 'error') errors.push(m.message ?? '');
      else if (m.type === 'views' && m.views) {
        viewsCollected.push(...m.views);
        if (viewsCollected.length >= WORKERS * 3 || viewsCollected.length >= botCount) viewsResolve?.(viewsCollected);
      }
    });
    worker.on('error', (e) => errors.push(String(e)));
    workers.push(worker);
  }

  // per-second samples
  const bytesPerBot: number[] = [];
  const heap: Array<[number, number]> = [];
  // Soak: the raw heapUsed samples follow V8's GC sawtooth, so a least-squares fit over them is
  // noise. Once a minute, force a full GC (node --expose-gc) and record the retained heap; the slope
  // is fitted to that, after a 3-minute settle (startup allocations are freed first).
  const forceGc = (globalThis as { gc?: () => void }).gc;
  const retained: Array<[number, number]> = [];
  const RETAINED_FROM_S = 180;
  let lastBytes = new Map<number, number>();
  const t0 = Date.now();
  let peakHeap = 0;
  const startHeap = process.memoryUsage().heapUsed / 1048576;
  for (let s = 1; s <= duration; s++) {
    await sleep(1000);
    const all = latest.flat();
    const now = (Date.now() - t0) / 1000;
    if (now > WARMUP_S) {
      all.forEach((b, i) => {
        const prev = lastBytes.get(i);
        if (prev !== undefined && b.connected) bytesPerBot.push(b.bytesIn - prev);
      });
    }
    lastBytes = new Map(all.map((b, i) => [i, b.bytesIn]));
    const mem = server ? process.memoryUsage().heapUsed / 1048576 : 0;
    peakHeap = Math.max(peakHeap, mem);
    if (s % 5 === 0) heap.push([now / 60, mem]);
    if (server && soak && forceGc && s % 60 === 0) {
      forceGc();
      if (s >= RETAINED_FROM_S) retained.push([now / 60, process.memoryUsage().heapUsed / 1048576]);
    }
    if (s % 30 === 0 || s === duration) {
      const w1 = server?.ctx.worlds.get(1);
      console.log(`[loadtest] t=${s}s bots=${all.filter((b) => b.connected).length} players=${w1?.sessions.size ?? '?'} tick p99=${w1 ? w1.metricsRef.tickMs.stats().p99.toFixed(2) : '?'}ms heap=${mem.toFixed(0)}MB`);
    }
  }

  // freeze bot actions, let the world settle, then compare views (SC-008)
  const viewsP = new Promise<unknown[]>((r) => (viewsResolve = r));
  await sleep(1500);
  for (const w of workers) w.postMessage({ type: 'views' });
  const views = (await Promise.race([viewsP, sleep(5000).then(() => viewsCollected)])) as Array<Array<{ completedStages: number; filledSlots: number; crewSize: number; state: string }>>;

  const all = latest.flat();
  const world = server?.ctx.worlds.get(1);
  const metricsSnap = server ? server.ctx.metrics.snapshot() : ((await (await fetch(`${base}/api/metrics`)).json()) as Record<string, unknown>);
  const wm = (metricsSnap.worlds as Array<Record<string, unknown>>)[0] ?? {};
  const tickStats = world ? dist(world.metricsRef.tickMs.values().slice(Math.round(WARMUP_S * 20))) : (wm.tickMs as ReturnType<typeof dist>);
  const encodeStats = world ? dist(world.metricsRef.encodeMs.values()) : (wm.encodeMs as ReturnType<typeof dist>);
  const sqliteStats = world ? dist(world.metricsRef.sqliteMs.values()) : (wm.sqliteMs as ReturnType<typeof dist>);
  const tickRates = world ? world.metricsRef.ticks.values().slice(Math.round(WARMUP_S)) : [];
  const ticksPerS = tickRates.length ? tickRates.reduce((s, x) => s + x, 0) / tickRates.length : 20;
  let divergent = 0;
  if (world) {
    const truth = Array.from(world.state.plots, (p) => ({ completedStages: p.completedStages, filledSlots: p.filledSlots, crewSize: p.crewSize, state: p.state }));
    for (const v of views) if (JSON.stringify(v) !== JSON.stringify(truth)) divergent++;
  }
  let overfilled = 0;
  if (world) {
    for (const p of world.state.plots) {
      const st = CLOCK_TOWER.stages[p.completedStages];
      if (p.completedStages > 6 || (st && p.filledSlots >= st.slotCount)) overfilled++;
    }
  }
  const consistency = {
    duplicatePieces: world ? Math.abs(world.state.pieces.size - world.systems.pieces.size) : 0,
    doubleFilledSlots: overfilled + (world?.systems.audit.overfilledSlots ?? 0),
    nonCrewSnaps: world?.systems.audit.nonCrewSnaps ?? 0,
    divergentViews: divergent,
    chatOutsideChannel: all.reduce((s, b) => s + b.chatOutsideChannel, 0),
  };
  const behaviors: Record<string, number> = {};
  for (const b of all) for (const [k, v] of Object.entries(b.behaviors)) behaviors[k] = (behaviors[k] ?? 0) + v;
  const bytes = dist(bytesPerBot);
  const rawHeapSlope = slope(heap);
  const heapSlope = retained.length >= 3 ? slope(retained) : rawHeapSlope;
  const heapSlopeBasis = retained.length >= 3 ? 'retained after full GC, 1/min' : 'raw heapUsed (no --expose-gc)';
  const rows: BudgetRow[] = [
    { name: 'ticksPerS.avg', limit: budgets.ticksPerSMin as number, actual: ticksPerS, pass: ticksPerS >= (budgets.ticksPerSMin as number) },
    { name: 'tickMs.avg', limit: budgets.tickMsAvg as number, actual: tickStats.avg, pass: tickStats.avg <= (budgets.tickMsAvg as number) },
    { name: 'tickMs.p99', limit: budgets.tickMsP99 as number, actual: tickStats.p99, pass: tickStats.p99 <= (budgets.tickMsP99 as number) },
    { name: 'bytesInPerS.avg', limit: budgets.bytesInPerSAvg as number, actual: bytes.avg, pass: bytes.avg <= (budgets.bytesInPerSAvg as number) },
  ];
  if (server) rows.push({ name: 'heapMb.peak', limit: budgets.heapMbPeak as number, actual: peakHeap, pass: peakHeap <= (budgets.heapMbPeak as number) });
  if (server && soak) rows.push({ name: 'heapSlopeMbPerMin', limit: budgets.heapSlopeMbPerMin as number, actual: heapSlope, pass: heapSlope <= (budgets.heapSlopeMbPerMin as number) });
  for (const [k, v] of Object.entries(consistency)) rows.push({ name: `consistency.${k}`, limit: 0, actual: v, pass: v === 0 });
  const connected = all.filter((b) => b.connected).length;
  rows.push({ name: 'bots.connected', limit: botCount, actual: connected, pass: connected === botCount });
  const pass = rows.every((r) => r.pass);
  let gitCommit = '';
  try {
    gitCommit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  } catch {
    /* not a git checkout */
  }
  const report = {
    version: 1, startedAt, durationS: duration, mode, gitCommit,
    bots: { count: botCount, connected, disconnects: all.reduce((s, b) => s + b.disconnects, 0), chatRechecked: all.reduce((s, b) => s + b.chatRechecked, 0), behaviors, errors: errors.slice(0, 10) },
    server: { tickMs: tickStats, encodeMs: encodeStats, sqliteMs: sqliteStats, eventLoopDelayMs: metricsSnap.eventLoopDelayMs, gcPauseMs: metricsSnap.gcPauseMs, ticksPerS, heapMb: { start: startHeap, peak: peakHeap, end: process.memoryUsage().heapUsed / 1048576, slopeMbPerMin: heapSlope, slopeBasis: heapSlopeBasis, rawSlopeMbPerMin: rawHeapSlope, retained }, rssMb: metricsSnap.rssMb },
    clients: { bytesInPerS: bytes, rttMs: dist(all.flatMap((b) => b.rtts)) },
    consistency,
    budgets: rows,
    pass,
  };
  const file = writeReport(ROOT, report);
  printSummary(rows, [['behaviors', JSON.stringify(behaviors)], ['bytes/bot/s (p95/max)', `${bytes.p95} / ${bytes.max}`], ...(soak ? [['heap slope basis', `${heapSlopeBasis} (raw fit ${rawHeapSlope.toFixed(2)} MB/min)`] as [string, string]] : []), ['chat rechecks (ordering race)', String(all.reduce((s, b) => s + b.chatRechecked, 0))], ['report', file]]);
  for (const w of workers) w.postMessage({ type: 'stop' });
  await sleep(1500);
  for (const w of workers) await w.terminate();
  await server?.close();
  if (selftest) {
    const caught = !rows.find((r) => r.name === 'tickMs.p99')?.pass;
    console.log(caught ? '[loadtest] self-test OK: the slow tick was detected (tickMs.p99)' : '[loadtest] self-test FAILED: the slow tick was not detected');
    process.exit(caught ? 0 : 1);
  }
  console.log(pass ? '[loadtest] PASS' : '[loadtest] FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
