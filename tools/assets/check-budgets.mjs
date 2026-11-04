#!/usr/bin/env node
// Fails (exit 1) when the critical payload, the JS bundle or any asset exceeds its budget.
// Also validates manifest.json against specs/001-single-player-prototype/contracts/asset-manifest.schema.json.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..', '..');
const budgets = JSON.parse(readFileSync(join(ROOT, 'tools/assets/budgets.json'), 'utf8'));
const manifestPath = join(ROOT, 'packages/client/public/assets/manifest.json');
const dist = join(ROOT, 'packages/client/dist');
const failures = [];
const rows = [];
const kb = (b) => `${(b / 1024).toFixed(0)} KB`;

// --- manifest schema (minimal validator for our schema's constraints) ---
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const schemaErrors = [];
if (manifest.version !== 1) schemaErrors.push('version must be 1');
if (typeof manifest.generatedAt !== 'string' || Number.isNaN(Date.parse(manifest.generatedAt))) schemaErrors.push('generatedAt must be a date-time');
if (!Array.isArray(manifest.assets)) schemaErrors.push('assets must be an array');
const allowed = new Set(['id', 'file', 'bytes', 'sha256', 'group', 'nodes']);
for (const a of manifest.assets ?? []) {
  const where = `asset ${a.id ?? '?'}`;
  for (const k of Object.keys(a)) if (!allowed.has(k)) schemaErrors.push(`${where}: unexpected property ${k}`);
  if (!/^[a-z0-9-]+$/.test(a.id ?? '')) schemaErrors.push(`${where}: bad id`);
  if (!/^[a-z0-9-]+\.[0-9a-f]{8}\.glb$/.test(a.file ?? '')) schemaErrors.push(`${where}: bad file name ${a.file}`);
  if (!Number.isInteger(a.bytes) || a.bytes < 1) schemaErrors.push(`${where}: bytes must be a positive integer`);
  if (!/^[0-9a-f]{64}$/.test(a.sha256 ?? '')) schemaErrors.push(`${where}: bad sha256`);
  if (!['critical', 'deferred'].includes(a.group)) schemaErrors.push(`${where}: bad group`);
  const file = join(ROOT, 'packages/client/public/assets', a.file ?? '');
  if (!existsSync(file)) schemaErrors.push(`${where}: file missing (${a.file})`);
  else if (statSync(file).size !== a.bytes) schemaErrors.push(`${where}: size mismatch`);
}
for (const e of schemaErrors) failures.push(`manifest: ${e}`);

// --- per-asset + critical total ---
let critical = 0;
for (const a of manifest.assets ?? []) {
  const limit = budgets.perAsset[a.id];
  const ok = limit === undefined ? false : a.bytes <= limit;
  if (limit === undefined) failures.push(`asset ${a.id}: no budget defined in tools/assets/budgets.json`);
  else if (!ok) failures.push(`asset ${a.id}: ${kb(a.bytes)} exceeds budget ${kb(limit)}`);
  if (a.group === 'critical') critical += a.bytes;
  rows.push([a.id, a.group, kb(a.bytes), limit ? kb(limit) : '—', ok ? 'ok' : 'FAIL']);
}

// --- JS bundle (gzip) from the production build ---
let js = 0;
if (existsSync(dist)) {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const files = walk(dist).filter((f) => /\.(js|css|html|wasm)$/.test(f) && !/debug/i.test(f));
  for (const f of files) js += gzipSync(readFileSync(f), { level: 9 }).byteLength;
  const ok = js <= budgets.jsGzip;
  if (!ok) failures.push(`JS/CSS/HTML bundle: ${kb(js)} gzip exceeds budget ${kb(budgets.jsGzip)}`);
  rows.push(['(code bundle)', 'critical', kb(js), kb(budgets.jsGzip), ok ? 'ok' : 'FAIL']);
  critical += js;
} else {
  console.warn('[budgets] packages/client/dist not found — run `pnpm build` first to include the JS bundle');
}
const okTotal = critical <= budgets.criticalTotal;
if (!okTotal) failures.push(`critical payload ${kb(critical)} exceeds ${kb(budgets.criticalTotal)}`);
rows.push(['CRITICAL TOTAL', '', kb(critical), kb(budgets.criticalTotal), okTotal ? 'ok' : 'FAIL']);

const w = [22, 9, 9, 9, 5];
console.log(['asset', 'group', 'size', 'budget', ''].map((c, i) => c.padEnd(w[i])).join(' '));
for (const r of rows) console.log(r.map((c, i) => String(c).padEnd(w[i])).join(' '));
if (critical > budgets.criticalTarget) console.warn(`[budgets] note: critical payload above the ${kb(budgets.criticalTarget)} target`);
if (failures.length) {
  console.error('\n[budgets] FAILED:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('\n[budgets] all budgets pass');
