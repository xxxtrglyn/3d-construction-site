#!/usr/bin/env node
// `ELEVENLABS_API_KEY=… node tools/audio/generate-audio.mjs [--force] [id …]`
// Generates the original background music and sample sound effects with the ElevenLabs API into
// packages/client/public/audio/ (served as deferred files, never in the critical payload) and writes
// audio.json, which the client's Sfx reads after play starts. The key is read from the environment
// only — never commit it. Existing files are kept unless --force (or their id) is given.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'packages/client/public/audio');
const KEY = process.env.ELEVENLABS_API_KEY;
const API = 'https://api.elevenlabs.io/v1';

/** Every prompt asks for an original sound; nothing references existing games, songs or artists. */
export const SOUNDS = [
  { id: 'music-site', kind: 'music', loop: true, volume: 0.32, ms: 90_000,
    prompt: 'Cheerful, cozy instrumental background loop for a cute toy-like construction-site sandbox game: bouncy marimba, plucky ukulele, light glockenspiel, soft brushed drums and warm round bass. Playful, calm and sunny, major key, around 100 BPM, gentle enough to play for a long time, seamless loop, no vocals.' },
  { id: 'engine-diesel', kind: 'sfx', loop: true, volume: 0.5, s: 4, prompt: 'small cartoon diesel excavator engine idling, steady chugging rumble, toy-like, loopable' },
  { id: 'forklift-motor', kind: 'sfx', loop: true, volume: 0.45, s: 3, prompt: 'small electric forklift motor hum with a light rising whine, steady, loopable' },
  { id: 'crane-winch', kind: 'sfx', loop: true, volume: 0.45, s: 3, prompt: 'tower crane winch motor and cable drum whirring steadily, light mechanical, loopable' },
  { id: 'mixer-drum', kind: 'sfx', loop: true, volume: 0.5, s: 4, prompt: 'small cement mixer drum turning, churning gravel and slurry rumble, loopable' },
  { id: 'hydraulic', kind: 'sfx', loop: false, volume: 0.6, s: 1.0, prompt: 'short hydraulic arm hiss followed by a soft clunk, cartoon construction machine' },
  { id: 'scoop-dirt', kind: 'sfx', loop: false, volume: 0.7, s: 1.0, prompt: 'excavator bucket scooping into soft dirt, crunchy soil scrape' },
  { id: 'dump-dirt', kind: 'sfx', loop: false, volume: 0.7, s: 1.2, prompt: 'bucket of dirt and small gravel dumped onto a heap, soft rumble and patter' },
  { id: 'hook-clank', kind: 'sfx', loop: false, volume: 0.6, s: 0.8, prompt: 'metal crane hook latching onto a load, short chain clank' },
  { id: 'pallet-clunk', kind: 'sfx', loop: false, volume: 0.6, s: 0.9, prompt: 'forklift forks lifting a wooden pallet, wooden clunk with a short metal scrape' },
  { id: 'concrete-pour', kind: 'sfx', loop: false, volume: 0.65, s: 1.2, prompt: 'thick wet concrete poured from a bucket, heavy slosh and splat' },
  { id: 'mix-done', kind: 'sfx', loop: false, volume: 0.5, s: 0.8, prompt: 'cheerful cartoon double ding chime, task complete, bright and short' },
];

async function generate(s) {
  const url = s.kind === 'music' ? `${API}/music?output_format=mp3_44100_64` : `${API}/sound-generation?output_format=mp3_44100_64`;
  const body = s.kind === 'music'
    ? { prompt: s.prompt, music_length_ms: s.ms, force_instrumental: true }
    : { text: s.prompt, duration_seconds: s.s, prompt_influence: 0.6, loop: s.loop };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'xi-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const text = await res.text().catch(() => '');
    // older API versions reject the optional `loop` / `force_instrumental` fields: retry without them
    if (res.status === 422 || res.status === 400) {
      delete body.loop;
      delete body.force_instrumental;
    }
    console.warn(`[audio] ${s.id}: HTTP ${res.status} ${text.slice(0, 200)} (attempt ${attempt})`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`[audio] ${s.id}: generation failed`);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const only = args.filter((a) => !a.startsWith('--'));
  mkdirSync(OUT, { recursive: true });
  const manifestPath = join(OUT, 'audio.json');
  const prev = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { sounds: [] };
  const byId = new Map(prev.sounds.map((x) => [x.id, x]));
  for (const s of SOUNDS) {
    const file = `${s.id}.mp3`;
    const path = join(OUT, file);
    const want = force || only.includes(s.id) || !existsSync(path);
    if (want && (!only.length || only.includes(s.id))) {
      if (!KEY) throw new Error('set ELEVENLABS_API_KEY to generate audio');
      const buf = await generate(s);
      writeFileSync(path, buf);
      console.log(`[audio] ${s.id.padEnd(16)} ${(buf.byteLength / 1024).toFixed(0)} KB`);
    }
    if (!existsSync(path)) continue;
    const buf = readFileSync(path);
    byId.set(s.id, { id: s.id, file, kind: s.kind, loop: s.loop, volume: s.volume, bytes: buf.byteLength, sha256: createHash('sha256').update(buf).digest('hex').slice(0, 16), source: 'ElevenLabs (generated, original)' });
  }
  const sounds = SOUNDS.map((s) => byId.get(s.id)).filter(Boolean);
  writeFileSync(manifestPath, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), sounds }, null, 2) + '\n');
  console.log(`[audio] ${sounds.length} sounds, ${(sounds.reduce((n, x) => n + x.bytes, 0) / 1024).toFixed(0)} KB total → ${manifestPath}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
