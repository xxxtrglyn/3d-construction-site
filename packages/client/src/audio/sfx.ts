/**
 * WebAudio sound: procedural effects (no download) plus, since feature 003, original generated samples
 * (machines and the background music, tools/audio/generate-audio.mjs) streamed after play starts.
 * Everything goes through one master gain, so the existing sound toggle mutes it all (FR-041).
 */
export type SfxName = 'pickup' | 'drop' | 'toss' | 'snap' | 'wrong' | 'stage' | 'bell' | 'firework' | 'jump' | 'click';

/** Generated samples (public/audio/audio.json). */
export type SampleId =
  | 'music-site' | 'engine-diesel' | 'forklift-motor' | 'crane-winch' | 'mixer-drum'
  | 'hydraulic' | 'scoop-dirt' | 'dump-dirt' | 'hook-clank' | 'pallet-clunk' | 'concrete-pour' | 'mix-done';

interface SampleEntry {
  id: SampleId;
  file: string;
  volume: number;
  loop: boolean;
}

interface LoopVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  id: SampleId;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  muted = false;
  private samples = new Map<SampleId, SampleEntry>();
  private buffers = new Map<SampleId, AudioBuffer>();
  private loading = false;
  private base = 'audio/';
  private readonly loops = new Map<string, LoopVoice>();
  private music: AudioBufferSourceNode | null = null;
  private wantMusic = false;
  musicVolume = 0.55;

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.35;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(this.master);
    void this.decodeAll();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.35;
  }

  // ---------------------------------------------------------------- samples (feature 003)

  /** Reads the sample list; the files are fetched and decoded after the first user gesture. */
  async loadSamples(base = 'audio/'): Promise<void> {
    this.base = base;
    try {
      const res = await fetch(`${base}audio.json`, { cache: 'no-cache' });
      if (!res.ok) return;
      const m = (await res.json()) as { sounds: SampleEntry[] };
      for (const e of m.sounds) this.samples.set(e.id, e);
      void this.decodeAll();
    } catch {
      /* no samples: procedural sounds only */
    }
  }

  private async decodeAll(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.loading || !this.samples.size) return;
    this.loading = true;
    // music last: the short effects are needed first
    const order = [...this.samples.values()].sort((a, b) => (a.id === 'music-site' ? 1 : 0) - (b.id === 'music-site' ? 1 : 0));
    for (const e of order) {
      if (this.buffers.has(e.id)) continue;
      try {
        const res = await fetch(`${this.base}${e.file}`);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(e.id, buf);
        if (e.id === 'music-site' && this.wantMusic) this.startMusic();
      } catch {
        /* skip a broken sample */
      }
    }
    this.loading = false;
  }

  hasSample(id: SampleId): boolean {
    return this.buffers.has(id);
  }

  /** One-shot sample at `gain` (0..1, e.g. faded by distance). Falls back to a procedural click. */
  playSample(id: SampleId, gain = 1, rate = 1): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(id);
    if (!ctx || !this.master || this.muted || gain <= 0.01) return;
    if (!buf) {
      this.tone(320, 0.08, 'triangle', 0.15 * gain);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = (this.samples.get(id)?.volume ?? 1) * gain;
    src.connect(g).connect(this.master);
    src.start();
  }

  /**
   * A keyed looping voice (machine engines): `gain` 0 fades it out and stops it. Call every frame for
   * every active key; keys not refreshed keep their last gain.
   */
  setLoop(key: string, id: SampleId, gain: number, rate = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const v = this.loops.get(key);
    const vol = (this.samples.get(id)?.volume ?? 1) * Math.max(0, Math.min(1, gain));
    if (v && v.id !== id) this.stopLoop(key);
    if (vol <= 0.01) {
      if (v) this.stopLoop(key);
      return;
    }
    const cur = this.loops.get(key);
    if (cur) {
      cur.gain.gain.setTargetAtTime(vol, ctx.currentTime, 0.08);
      cur.src.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.1);
      return;
    }
    const buf = this.buffers.get(id);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(vol, ctx.currentTime, 0.08);
    src.connect(g).connect(this.master);
    src.start();
    this.loops.set(key, { src, gain: g, id });
  }

  stopLoop(key: string): void {
    const v = this.loops.get(key);
    if (!v || !this.ctx) return;
    this.loops.delete(key);
    v.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06);
    v.src.stop(this.ctx.currentTime + 0.3);
  }

  /** Stops every loop whose key is not in `keep`. */
  pruneLoops(keep: ReadonlySet<string>): void {
    for (const k of [...this.loops.keys()]) if (!keep.has(k)) this.stopLoop(k);
  }

  /** The background music loop (quiet; muted with everything else). */
  startMusic(): void {
    this.wantMusic = true;
    const ctx = this.ctx;
    const buf = this.buffers.get('music-site');
    if (!ctx || !buf || !this.musicGain || this.music) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.music = src;
  }

  get musicPlaying(): boolean {
    return this.music !== null;
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, at = 0, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain: number, at = 0, filterFreq = 1200): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start(ctx.currentTime + at);
  }

  play(name: SfxName): void {
    switch (name) {
      case 'pickup':
        this.tone(520, 0.09, 'triangle', 0.5, 0, 880);
        break;
      case 'drop':
        this.tone(160, 0.12, 'sine', 0.6, 0, 90);
        this.noise(0.06, 0.25, 0, 500);
        break;
      case 'toss':
        this.noise(0.22, 0.35, 0, 1800);
        break;
      case 'jump':
        this.tone(330, 0.1, 'square', 0.12, 0, 520);
        break;
      case 'snap':
        this.noise(0.1, 0.3, 0, 900);
        this.tone(988, 0.18, 'triangle', 0.35, 0.02);
        this.tone(1319, 0.22, 'triangle', 0.3, 0.08);
        break;
      case 'wrong':
        this.tone(180, 0.18, 'sawtooth', 0.15, 0, 140);
        this.tone(170, 0.18, 'sawtooth', 0.15, 0.12, 120);
        break;
      case 'stage':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.35, i * 0.09));
        break;
      case 'bell':
        [0, 0.9, 1.8].forEach((at) => {
          this.tone(660, 1.6, 'sine', 0.5, at);
          this.tone(1320, 1.2, 'sine', 0.18, at);
          this.tone(1980, 0.8, 'sine', 0.08, at);
        });
        break;
      case 'firework':
        this.tone(900, 0.35, 'sine', 0.12, 0, 1800);
        this.noise(0.5, 0.35, 0.35, 2500);
        break;
      case 'click':
        this.tone(700, 0.05, 'square', 0.1);
        break;
    }
  }
}
