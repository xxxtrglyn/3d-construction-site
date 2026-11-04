import { parentPort, workerData } from 'node:worker_threads';
import { Bot } from './bot.ts';

/** Runs a slice of the bots in a worker thread so they do not share the server's event loop. */
const { base, from, count, seed, rampMs } = workerData as { base: string; from: number; count: number; seed: number; rampMs: number };
const bots: Bot[] = [];
const port = parentPort!;

async function main(): Promise<void> {
  for (let i = 0; i < count; i++) {
    const b = new Bot(from + i, base, seed + from + i);
    bots.push(b);
    b.start().catch((e) => port.postMessage({ type: 'error', id: from + i, message: String(e) }));
    await new Promise((r) => setTimeout(r, rampMs));
  }
}

const timer = setInterval(() => {
  port.postMessage({ type: 'stats', stats: bots.map((b) => ({ ...b.stats, behaviors: { ...b.stats.behaviors }, rtts: [...b.stats.rtts] })) });
}, 1000);

port.on('message', async (m: { type: string }) => {
  if (m.type === 'views') {
    port.postMessage({ type: 'views', views: bots.filter((b) => b.stats.connected).slice(0, 3).map((b) => b.plotView()) });
  } else if (m.type === 'stop') {
    clearInterval(timer);
    port.postMessage({ type: 'stats', stats: bots.map((b) => ({ ...b.stats, behaviors: { ...b.stats.behaviors }, rtts: [...b.stats.rtts] })) });
    await Promise.all(bots.map((b) => b.leave()));
    port.postMessage({ type: 'stopped' });
  }
});

void main();
