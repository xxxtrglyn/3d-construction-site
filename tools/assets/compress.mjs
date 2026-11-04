#!/usr/bin/env node
// Compress raw Blender exports with gltf-transform and write the hashed asset manifest.
// Input:  assets/build/raw/*.glb + assets/build/raw/assets.json (from tools/blender/export_assets.py)
// Output: packages/client/public/assets/<id>.<hash8>.glb + manifest.json (contracts/asset-manifest.schema.json)
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const ROOT = resolve(import.meta.dirname, '..', '..');
const RAW = join(ROOT, 'assets', 'build', 'raw');
const OUT = join(ROOT, 'packages', 'client', 'public', 'assets');

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const index = JSON.parse(readFileSync(join(RAW, 'assets.json'), 'utf8'));
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.glb')) rmSync(join(OUT, f));

const assets = [];
for (const a of index.assets) {
  const doc = await io.read(join(RAW, a.file));
  // keep named contract nodes: prune must not remove empties the client depends on
  await doc.transform(
    dedup(),
    weld(),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
    prune({ keepLeaves: true, keepAttributes: false }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const names = new Set(doc.getRoot().listNodes().map((n) => n.getName()));
  const missing = (a.nodes ?? []).filter((n) => !names.has(n));
  if (missing.length) throw new Error(`${a.id}: missing required nodes ${missing.join(', ')}`);
  const bytes = await io.writeBinary(doc);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const file = `${a.id}.${sha256.slice(0, 8)}.glb`;
  writeFileSync(join(OUT, file), bytes);
  assets.push({ id: a.id, file, bytes: bytes.byteLength, sha256, group: a.group, nodes: a.nodes ?? [] });
  console.log(`[compress] ${a.id.padEnd(22)} ${(a.bytes / 1024).toFixed(0).padStart(5)} KB -> ${(bytes.byteLength / 1024).toFixed(0).padStart(5)} KB  (${a.group})`);
}

const manifest = { version: 1, generatedAt: new Date().toISOString(), assets };
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const total = (g) => assets.filter((x) => x.group === g).reduce((s, x) => s + x.bytes, 0) / 1024;
console.log(`[compress] critical ${total('critical').toFixed(0)} KB, deferred ${total('deferred').toFixed(0)} KB -> ${OUT}/manifest.json`);
