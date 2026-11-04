import * as THREE from 'three';
import { ANIM, CLOCK_TOWER, EMOTE_IDS, HAT_COLOR_IDS, HAT_COLORS, PIECE_TYPE_IDS, SITE, seededRng, type PieceTypeId } from '@hht/shared';
import type { AssetStore } from '../assets/loader.ts';
import { Sfx } from '../audio/sfx.ts';
import { CrowdRenderer, setCarryHalfHeights, type CrowdEntry } from '../crowd/CrowdRenderer.ts';
import { LabelLayer, type LabelEntry } from '../crowd/labels.ts';
import { GameShell } from '../game/GameShell.ts';
import { NetWorld, drawRackDisplays } from '../game/netWorld.ts';
import type { PieceView, PlayerView, PlotView, WorldView } from '../net/connection.ts';
import { EntityBuffer, type Pose } from '../net/interpolation.ts';
import { Bloom } from '../render/bloom.ts';
import { configureOutlines } from '../render/outline.ts';
import type { QualitySettings } from '../render/quality.ts';
import type { RenderContext } from '../render/renderer.ts';
import { PieceRenderer } from '../world/pieceRenderer.ts';
import { SiteView } from '../world/site.ts';

const N = 100;
const POSES = ['idle', 'walk', 'run', 'air', 'cheer', 'wave'] as const;

/**
 * `?perf=crowd` (research R7, contracts/debug-api.md): offline worst-case multiplayer scene —
 * 100 animated workers fed as synthetic 20 Hz snapshots through the real interpolation and crowd
 * renderer, 12 towers at mixed stages (4 Masterpieces) through the real LOD code, a looping
 * celebration, nameplates and emote bubbles; fixed hero camera over the plaza.
 */
export class CrowdPerfScene extends GameShell {
  protected readonly assets: AssetStore;
  private readonly hudRoot: HTMLElement;
  protected world!: NetWorld;
  private crowd!: CrowdRenderer;
  private pieces!: PieceRenderer;
  private labels!: LabelLayer;
  private readonly buffers: EntityBuffer[] = [];
  private readonly walkers: Array<{ cx: number; cz: number; r: number; w: number; phase: number; carry: PieceTypeId | null; hat: string; anim: number }> = [];
  protected readonly state: WorldView;
  private readonly players = new Map<string, PlayerView>();
  private serverNow = 0;
  private snapAcc = 0;
  private celebrateAcc = 0;
  private readonly pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, anim: 0, carry: null, emoting: false };
  private readonly entries: CrowdEntry[] = [];

  constructor(ctx: RenderContext, assets: AssetStore, quality: QualitySettings, hudRoot: HTMLElement) {
    super(ctx, quality);
    this.assets = assets;
    this.hudRoot = hudRoot;
    const stages = [6, 6, 6, 6, 5, 4, 3, 2, 1, 0, 3, 5];
    const plots: PlotView[] = stages.map((s, i) => ({
      state: s === 6 ? 'finished' : 'building', blueprintId: CLOCK_TOWER.id, completedStages: s, filledSlots: s === 6 ? 0 : 1,
      hostName: `Host ${i + 1}`, hostSession: `h${i}`, joinMode: 'ask', crewSize: 1 + (i % 8), bin: Array.from({ length: i % 4 }, () => 'brick'), finishedAt: 0,
      groundDug: s === 0 ? 3 : 6, groundPoured: s === 0 ? 0 : 4, highFilled: 0, mixerBags: s === 0 ? 2 : 0, mixerMixUntil: 0,
      machineOps: ['', '', '', ''], hookType: '', palletTypes: [],
    }));
    const pieces = new Map<string, PieceView>();
    this.state = { worldId: 1, shift: { epoch: 1, endsAt: Date.now() + 3_600_000, towersCompleted: 4, phase: 'running' }, players: this.players, plots, pieces };
  }

  async build(): Promise<void> {
    const { scene, camera } = this.ctx;
    configureOutlines(this.quality.outlineWidthPx, this.quality.outlineDistance);
    const site = new SiteView(this.assets.get('site') as THREE.Object3D);
    site.setShadows(this.quality.tier === 'high');
    scene.add(site.root);
    this.world = new NetWorld(this.assets, this.hudRoot, new Sfx(), this.quality.particles, this.quality.tier === 'high');
    scene.add(this.world.group);
    this.crowd = new CrowdRenderer((this.assets.get('worker-lod1') ?? this.assets.get('worker')) as THREE.Object3D, 128, this.quality.outlines ? Math.min(15, this.quality.outlineDistance) : 0, this.quality.tier === 'high');
    scene.add(this.crowd.group);
    this.pieces = new PieceRenderer((this.assets.get('pieces-lod1') ?? this.assets.get('pieces')) as THREE.Group, 360);
    if (this.quality.tier !== 'high') this.pieces.group.traverse((o) => (o.castShadow = false));
    setCarryHalfHeights(this.pieces.halfHeight);
    scene.add(this.pieces.group);
    this.labels = new LabelLayer(this.hudRoot);
    const rng = seededRng(42);
    for (let i = 0; i < N; i++) {
      // most of the crowd mills around the plaza and the nearest yards, some walk to plots
      const a = rng() * Math.PI * 2;
      const ring = i < 60 ? 2 + rng() * 9 : 10 + rng() * 16;
      this.walkers.push({
        cx: Math.cos(a) * ring, cz: Math.sin(a) * ring, r: 0.8 + rng() * 3, w: (0.3 + rng() * 0.6) * (rng() < 0.5 ? -1 : 1), phase: rng() * 6,
        carry: rng() < 0.4 ? (PIECE_TYPE_IDS[Math.floor(rng() * PIECE_TYPE_IDS.length)] as PieceTypeId) : null,
        hat: HAT_COLORS[HAT_COLOR_IDS[i % HAT_COLOR_IDS.length]!], anim: i % 9 === 0 ? ANIM.emote : rng() < 0.6 ? ANIM.walk : ANIM.run,
      });
      this.buffers.push(new EntityBuffer());
      this.players.set(`p${i}`, { netId: i + 1, name: `Worker ${i + 1}`, hatColor: 'yellow', heldType: '', crewPlot: i % 13 === 0 ? i % 12 : -1, crewRole: '', away: false, machine: -1 });
    }
    if (this.quality.bloom) this.bloom = new Bloom(this.ctx.renderer, scene, camera);
    camera.position.set(4, 13, 21);
    camera.lookAt(new THREE.Vector3(0, 1.5, -4));
    this.serverNow = Date.now();
    for (let k = 0; k < 8; k++) this.pushSnapshot();
    this.resizeRenderer();
    window.addEventListener('resize', () => this.resizeRenderer());
  }

  private pushSnapshot(): void {
    this.serverNow += 50;
    const t = this.serverNow / 1000;
    this.walkers.forEach((w, i) => {
      const ang = w.phase + t * w.w;
      (this.buffers[i] as EntityBuffer).push(this.serverNow, {
        x: w.cx + Math.cos(ang) * w.r, y: 0, z: w.cz + Math.sin(ang) * w.r, yaw: ang + (w.w > 0 ? Math.PI : 0),
        anim: w.anim, carry: w.carry, emoting: w.anim === ANIM.emote,
      });
    });
  }

  protected step(dt: number): void {
    this.snapAcc += dt;
    while (this.snapAcc >= 0.05) {
      this.snapAcc -= 0.05;
      this.pushSnapshot();
    }
    this.celebrateAcc -= dt;
    if (this.celebrateAcc <= 0) {
      this.celebrateAcc = 6;
      this.world.onCelebrate({ plot: 0, until: Date.now() + 6000 }, Date.now());
    }
    const renderNow = this.serverNow - this.snapAcc * 1000;
    const cam = this.ctx.camera.position;
    this.entries.length = 0;
    const labels: LabelEntry[] = [];
    this.buffers.forEach((b, i) => {
      b.updateDelay(dt * 1000);
      if (!b.sample(renderNow, this.pose)) return;
      const w = this.walkers[i]!;
      const d = Math.hypot(this.pose.x - cam.x, this.pose.y - cam.y, this.pose.z - cam.z);
      this.entries.push({
        key: i + 1, x: this.pose.x, y: this.pose.y, z: this.pose.z, yaw: this.pose.yaw,
        pose: this.pose.anim === ANIM.emote ? (EMOTE_IDS[i % EMOTE_IDS.length] as never) : POSES[this.pose.anim] ?? 'walk',
        speed: this.pose.anim === ANIM.run ? 5.5 : 3, carry: w.carry, hatColor: w.hat, distance: d,
      });
      labels.push({ key: `p${i}`, x: this.pose.x, y: 0, z: this.pose.z, name: `Worker ${i + 1}`, flag: i % 13 === 0 ? i % 12 : -1, host: false, bubble: i % 9 === 0 ? 'Need bricks!' : null, bubbleKind: 'say', me: false, distance: Math.hypot(this.pose.x - 4, this.pose.z - 10) });
    });
    const focus = new THREE.Vector3(0, 0, 0);
    this.world.update(dt, this.state, focus, this.ctx.camera, -1, false);
    this.pieces.begin();
    drawRackDisplays(this.pieces);
    this.crowd.update(dt, this.entries, (type, m) => this.pieces.add(type, m));
    this.world.drawPieces(this.pieces, this.state, this.serverNow);
    this.drawExtra(dt, this.pieces);
    this.pieces.end();
    this.labels.update(this.ctx.camera, labels);
  }

  /** Hook for derived scenes (feature 003: machines) inside the piece renderer batch. */
  protected drawExtra(_dt: number, _pieces: PieceRenderer): void {}

  /** Assets the scene needs at full detail before measuring. */
  static readonly WAIT_FOR = ['fx', 'clock-tower-stage-6-merged', 'clock-tower-stage-5-merged'];
}
