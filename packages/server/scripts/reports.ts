/**
 * `pnpm reports [--since 7d] [--world 1]` — owner review of chat reports (FR-067).
 * Reads chat_report from HHT_DB (default data/hht.sqlite). Messages are shown as written (unmasked).
 */
import { existsSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/persistence/db.ts';
import { listReports } from '../src/persistence/repo.ts';

const args = process.argv.slice(2);
const arg = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const since = arg('since') ?? '7d';
const m = /^(\d+)([dhm])$/.exec(since);
if (!m) {
  console.error('usage: pnpm reports [--since 7d|24h|90m] [--world N]');
  process.exit(2);
}
const ms = Number(m[1]) * ({ d: 86_400_000, h: 3_600_000, m: 60_000 } as const)[m[2] as 'd' | 'h' | 'm'];
const world = arg('world') ? Number(arg('world')) : undefined;
const cfg = loadConfig();
if (cfg.db !== ':memory:' && !existsSync(cfg.db)) {
  console.log(`No database at ${cfg.db} yet — no reports.`);
  process.exit(0);
}
const db = openDb(cfg.db);
const rows = listReports(db, Date.now() - ms, world);
db.close();
if (!rows.length) {
  console.log(`No chat reports in the last ${since}${world ? ` (world ${world})` : ''}.`);
  process.exit(0);
}
const byTarget = new Map<string, number>();
for (const r of rows) byTarget.set(r.reportedKeyHash, (byTarget.get(r.reportedKeyHash) ?? 0) + 1);
console.log(`${rows.length} chat report(s) in the last ${since}${world ? ` (world ${world})` : ''}:\n`);
for (const r of rows) {
  const when = new Date(r.createdAt).toISOString().replace('T', ' ').slice(0, 19);
  console.log(`#${r.id}  ${when}  world ${r.worldId} shift ${r.epoch}  reported: ${r.reportedName} [${r.reportedKeyHash.slice(0, 8)}] (${byTarget.get(r.reportedKeyHash)} report(s))  by [${r.reporterKeyHash.slice(0, 8)}]`);
  if (!r.messages.length) console.log('    (no recent messages)');
  for (const msg of r.messages) console.log(`    ${new Date(msg.at).toISOString().slice(11, 19)} [${msg.channel}] ${msg.text}`);
}
