/** Procedural WebAudio sound effects (no audio files to download). */
export type SfxName = 'pickup' | 'drop' | 'toss' | 'snap' | 'wrong' | 'stage' | 'bell' | 'firework' | 'jump' | 'click';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

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
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.35;
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
