import { PerformanceObserver, monitorEventLoopDelay } from 'node:perf_hooks';

type IntervalHistogram = ReturnType<typeof monitorEventLoopDelay>;

/** Fixed-size ring of samples with summary statistics. */
export class Ring {
  private readonly buf: Float64Array;
  private n = 0;
  private i = 0;
  constructor(size = 1200) {
    this.buf = new Float64Array(size);
  }
  push(v: number): void {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.buf.length;
    if (this.n < this.buf.length) this.n++;
  }
  values(): number[] {
    return Array.from(this.buf.subarray(0, this.n));
  }
  clear(): void {
    this.n = 0;
    this.i = 0;
  }
  stats(): { avg: number; p50: number; p95: number; p99: number; max: number; min: number } {
    const v = this.values().sort((a, b) => a - b);
    if (!v.length) return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 };
    const q = (p: number): number => v[Math.min(v.length - 1, Math.floor(p * v.length))] as number;
    return { avg: v.reduce((s, x) => s + x, 0) / v.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: v.at(-1) as number, min: v[0] as number };
  }
}

export interface WorldMetrics {
  worldId: number;
  players: () => number;
  tickMs: Ring;
  encodeMs: Ring;
  sqliteMs: Ring;
  /** per-second samples of the average bytes sent per client */
  bytesPerClientPerS: Ring;
  ticks: Ring;
  /** feature 003: machine-record bytes per client per second, and the running count this second */
  machineBytesPerClientPerS: Ring;
  machineBytesAcc: number;
}

/** Process-wide metrics: event-loop delay, GC pauses, heap; plus per-world rings. */
export class Metrics {
  readonly worlds = new Map<number, WorldMetrics>();
  private readonly eld: IntervalHistogram;
  private readonly gc = new Ring(2000);
  private gcCount = 0;
  private heapPeak = 0;
  private readonly started = Date.now();
  private readonly obs: PerformanceObserver;
  private readonly heapTimer: NodeJS.Timeout;

  constructor() {
    this.eld = monitorEventLoopDelay({ resolution: 10 });
    this.eld.enable();
    this.obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        this.gc.push(e.duration);
        this.gcCount++;
      }
    });
    this.obs.observe({ entryTypes: ['gc'] });
    this.heapTimer = setInterval(() => {
      this.heapPeak = Math.max(this.heapPeak, process.memoryUsage().heapUsed);
    }, 1000);
    this.heapTimer.unref();
  }

  world(worldId: number, players: () => number): WorldMetrics {
    // 24 000 samples = 20 min of 20 Hz ticks (load tests read the whole run)
    const m: WorldMetrics = { worldId, players, tickMs: new Ring(24_000), encodeMs: new Ring(24_000), sqliteMs: new Ring(24_000), bytesPerClientPerS: new Ring(1200), ticks: new Ring(1200), machineBytesPerClientPerS: new Ring(1200), machineBytesAcc: 0 };
    this.worlds.set(worldId, m);
    return m;
  }

  dropWorld(worldId: number): void {
    this.worlds.delete(worldId);
  }

  snapshot(): Record<string, unknown> {
    const mem = process.memoryUsage();
    this.heapPeak = Math.max(this.heapPeak, mem.heapUsed);
    const mb = (b: number): number => Math.round((b / 1048576) * 10) / 10;
    const ms = (ns: number): number => Math.round((ns / 1e6) * 100) / 100;
    return {
      uptimeS: Math.round((Date.now() - this.started) / 1000),
      worlds: [...this.worlds.values()].map((w) => ({
        worldId: w.worldId,
        players: w.players(),
        tickMs: w.tickMs.stats(),
        encodeMs: w.encodeMs.stats(),
        sqliteMs: w.sqliteMs.stats(),
        bytesPerClientPerS: w.bytesPerClientPerS.stats(),
        machineBytesPerClientPerS: w.machineBytesPerClientPerS.stats(),
        ticksPerS: w.ticks.stats(),
      })),
      eventLoopDelayMs: { p50: ms(this.eld.percentile(50)), p99: ms(this.eld.percentile(99)), max: ms(this.eld.max) },
      heapMb: { used: mb(mem.heapUsed), peak: mb(this.heapPeak) },
      rssMb: mb(mem.rss),
      gcPauseMs: { ...this.gc.stats(), count: this.gcCount },
    };
  }

  close(): void {
    this.eld.disable();
    this.obs.disconnect();
    clearInterval(this.heapTimer);
  }
}
