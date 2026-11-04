import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Dist {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
}

export function dist(values: number[]): Dist {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 };
  const q = (p: number): number => v[Math.min(v.length - 1, Math.floor(p * v.length))] as number;
  const r = (x: number): number => Math.round(x * 1000) / 1000;
  return { avg: r(v.reduce((s, x) => s + x, 0) / v.length), p50: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(v.at(-1) as number), min: r(v[0] as number) };
}

/** Least-squares slope of y over x (per unit of x). */
export function slope(points: Array<[number, number]>): number {
  const n = points.length;
  if (n < 2) return 0;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) * (x - mx);
  }
  return den ? num / den : 0;
}

export interface BudgetRow {
  name: string;
  limit: number;
  actual: number;
  pass: boolean;
}

export function writeReport(root: string, report: Record<string, unknown>): string {
  const dir = join(root, 'reports', 'loadtest');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  return file;
}

export function printSummary(budgets: BudgetRow[], extra: Array<[string, string]>): void {
  const w = [26, 12, 12, 6];
  console.log(['budget', 'limit', 'actual', ''].map((c, i) => c.padEnd(w[i] as number)).join(' '));
  for (const b of budgets) console.log([b.name, String(b.limit), String(Math.round(b.actual * 100) / 100), b.pass ? 'ok' : 'FAIL'].map((c, i) => c.padEnd(w[i] as number)).join(' '));
  for (const [k, v] of extra) console.log(`${k.padEnd(26)} ${v}`);
}
