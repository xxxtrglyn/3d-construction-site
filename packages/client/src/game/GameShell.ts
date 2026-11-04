import * as THREE from 'three';
import type { Bloom } from '../render/bloom.ts';
import type { QualitySettings } from '../render/quality.ts';
import type { RenderContext } from '../render/renderer.ts';

/**
 * Frame loop, render and frame statistics shared by the solo game (001) and the multiplayer game (002).
 * Subclasses implement `step()` (gameplay update) and may provide a bloom pass and an fps sink.
 */
export abstract class GameShell {
  readonly ctx: RenderContext;
  protected quality: QualitySettings;
  protected bloom: Bloom | null = null;
  showFps = false;
  /** debug: freeze gameplay updates except rendering (perf scenes) */
  frozen = false;
  private running = false;
  private raf = 0;
  private last = 0;
  private readonly frameTimes: number[] = [];
  private fpsTimer = 0;

  constructor(ctx: RenderContext, quality: QualitySettings) {
    this.ctx = ctx;
    this.quality = quality;
  }

  /** One gameplay update (dt in seconds, clamped to 50 ms). */
  protected abstract step(dt: number, now: number): void;
  /** Called while frozen (perf scenes): keep effects animating. */
  protected frozenStep(_dt: number): void {}
  /** Receives the fps overlay text when `showFps` is on. */
  protected onFps(_text: string): void {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number): void => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt, now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resume(): void {
    if (!this.running) this.start();
  }

  get isRunning(): boolean {
    return this.running;
  }

  private frame(dt: number, now: number): void {
    if (!this.frozen) this.step(dt, now);
    else this.frozenStep(dt);
    this.render(dt);
    this.recordFrame(dt);
  }

  protected render(dt: number): void {
    const { renderer, scene, camera } = this.ctx;
    renderer.info.reset();
    if (this.bloom) this.bloom.render(dt);
    else renderer.render(scene, camera);
  }

  protected resizeRenderer(): void {
    this.ctx.resize();
    if (this.bloom) {
      const r = this.ctx.renderer;
      const s = r.getSize(new THREE.Vector2());
      this.bloom.setSize(s.x, s.y, r.getPixelRatio());
    }
  }

  private recordFrame(dt: number): void {
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 300) this.frameTimes.shift();
    if (this.showFps) {
      this.fpsTimer += dt;
      if (this.fpsTimer > 0.5) {
        this.fpsTimer = 0;
        const i = this.ctx.renderer.info;
        const med = this.medianFrameMs();
        this.onFps(`${(1000 / med).toFixed(0)} fps (${med.toFixed(1)} ms)\ncalls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k`);
      }
    }
  }

  medianFrameMs(): number {
    if (!this.frameTimes.length) return 0;
    const s = [...this.frameTimes].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)] as number;
  }
}
