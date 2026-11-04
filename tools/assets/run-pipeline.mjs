#!/usr/bin/env node
// `pnpm assets [-- <asset-id> ...]`: headless Blender export, then gltf-transform compression.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const ids = process.argv.slice(2).filter((a) => a !== '--');
const blender = process.env.BLENDER ?? 'blender';

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  for (const line of (r.stdout ?? '').split('\n')) if (/\[(export|compress)\]|Error|Traceback/.test(line)) console.log(line);
  if (r.status !== 0) {
    console.error(`${cmd} failed with exit code ${r.status}`);
    process.exit(r.status ?? 1);
  }
};

run(blender, ['--background', '--factory-startup', '--python', 'tools/blender/export_assets.py', '--', ...ids]);
run(process.execPath, ['tools/assets/compress.mjs']);
