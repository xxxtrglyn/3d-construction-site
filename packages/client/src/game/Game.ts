import * as THREE from 'three';
import {
  CLOCK_TOWER, HAT_COLORS, MACHINE, MOVE, PIECE_TYPES, INTERACT, currentStage, entryPoint, groundworkDone, groundworkPart, needsOf, openSlotRefs, stageHandSlots, towerBlocker,
  type MachineKind, type PieceTypeId, type SiteLayout,
} from '@hht/shared';
import { MachineRenderer } from '../machines/MachineRenderer.ts';
import { SoloMachines } from '../machines/SoloMachines.ts';
import { MachineCameras } from '../player/machineCameras.ts';
import { MachineHints } from '../ui/machineHints.ts';
import { GroundworkView } from '../world/groundworkView.ts';
import { HighSlotRings } from '../world/highSlots.ts';
import { MachineCue } from '../world/machineCue.ts';
import type { SampleId } from '../audio/sfx.ts';
import type { AssetStore } from '../assets/loader.ts';
import { Sfx } from '../audio/sfx.ts';
import { Celebration } from '../fx/celebration.ts';
import { Puffs } from '../fx/puff.ts';
import { Actions } from '../input/actions.ts';
import { pollGamepad } from '../input/gamepad.ts';
import { attachKeyboardMouse } from '../input/keyboardMouse.ts';
import { TouchControls } from '../input/touch.ts';
import { Physics, RAPIER, initRapier } from '../physics/physics.ts';
import { CharacterController } from '../player/controller.ts';
import { FollowCamera } from '../player/followCamera.ts';
import { WorkerView } from '../player/workerView.ts';
import type { ProfileStore } from '../profile/guestProfile.ts';
import { Bloom } from '../render/bloom.ts';
import { GameShell } from './GameShell.ts';
import { ghostMaterial } from '../render/ghost.ts';
import { configureOutlines, setOutlinesVisible } from '../render/outline.ts';
import type { QualitySettings } from '../render/quality.ts';
import type { RenderContext } from '../render/renderer.ts';
import { Hud } from '../ui/hud.ts';
import { LOT_HALF, OBSTACLES, PLAY_HALF, RACK_DISPLAY, RACK_HALF, readLayout, soloSite, type Layout } from '../world/layout.ts';
import { PieceRenderer } from '../world/pieceRenderer.ts';
import { SlotGhosts } from '../world/slotGhosts.ts';
import { hintLine, pluralNoun } from '../ui/needsText.ts';
import { TowerView } from '../world/towerView.ts';
import { findTarget, type Target } from './interaction.ts';
import { PieceManager, type Piece } from './pieceManager.ts';
import { TowerPlot } from './towerPlot.ts';

export type GameEvent = 'snapped' | 'stageComplete' | 'masterpiece' | 'wrongPiece' | 'pickup' | 'drop' | 'toss' | 'ready' | 'ground' | 'machineEnter' | 'machineExit';

const MACHINE_NAME: Record<MachineKind, string> = { crane: 'the crane', excavator: 'the excavator', forklift: 'the forklift', mixer: 'the mixer' };
const ENGINE: Record<MachineKind, SampleId> = { crane: 'crane-winch', excavator: 'engine-diesel', forklift: 'forklift-motor', mixer: 'mixer-drum' };
const ACT_SOUND: Record<string, [SampleId, number]> = {
  scoop: ['scoop-dirt', 1], dump: ['dump-dirt', 1], dumpBack: ['dump-dirt', 0.6], hookGrab: ['hook-clank', 1], hookRelease: ['hydraulic', 0.9],
  palletLoad: ['pallet-clunk', 1], palletUnload: ['pallet-clunk', 0.9], mixStart: ['hydraulic', 0.7], mixDone: ['mix-done', 1], bagIn: ['pallet-clunk', 0.5],
};

const v3 = (): THREE.Vector3 => new THREE.Vector3();

export class Game extends GameShell {
  readonly events = new EventTarget();
  readonly actions = new Actions();
  readonly sfx = new Sfx();
  physics!: Physics;
  controller!: CharacterController;
  worker!: WorkerView;
  camera!: FollowCamera;
  layout!: Layout;
  pieces!: PieceManager;
  plot!: TowerPlot;
  tower!: TowerView;
  ghosts!: SlotGhosts;
  pieceRenderer!: PieceRenderer;
  puffs!: Puffs;
  celebration!: Celebration;
  hud!: Hud;
  touch: TouchControls | null = null;
  // feature 003: the solo lot's machines (same shared rules as multiplayer)
  site!: SiteLayout;
  machines!: SoloMachines;
  machineRenderer!: MachineRenderer;
  machineCams!: MachineCameras;
  machineHints!: MachineHints;
  groundwork!: GroundworkView;
  highSlots!: HighSlotRings;
  cue!: MachineCue;
  private machineTargetId = -1;
  private towerCollider: RAPIER.Collider | null = null;
  private target: Target | null = null;
  private readonly targetRing: THREE.Mesh;
  private cheerTimer = 0;
  private respawnHeld = 0;
  private armDrop = false;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly fwd = v3();
  private readonly right = v3();

  readonly assets: AssetStore;
  readonly profile: ProfileStore;
  private readonly hudRoot: HTMLElement;

  constructor(ctx: RenderContext, assets: AssetStore, profile: ProfileStore, quality: QualitySettings, hudRoot: HTMLElement) {
    super(ctx, quality);
    this.assets = assets;
    this.profile = profile;
    this.hudRoot = hudRoot;
    const ring = new THREE.TorusGeometry(0.42, 0.035, 6, 32);
    ring.rotateX(Math.PI / 2);
    this.targetRing = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false }));
    this.targetRing.visible = false;
    configureOutlines(quality.outlineWidthPx, quality.outlineDistance);
  }

  emit(type: GameEvent, detail?: unknown): void {
    this.events.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** Build the world from the critical assets; call after they are loaded and Rapier is initialized. */
  async build(): Promise<void> {
    await initRapier();
    const { scene, camera } = this.ctx;
    this.physics = new Physics();
    const lot = this.assets.get('lot') as THREE.Group;
    scene.add(lot);
    lot.traverse((o) => {
      o.userData.castShadowHigh = o.castShadow;
    });
    this.applyLotShadows();
    this.layout = readLayout(lot);
    this.site = soloSite(this.layout);
    this.buildStaticColliders();

    const prof = this.profile.get();
    this.worker = new WorkerView(this.assets.get('worker') as THREE.Group, HAT_COLORS[prof.hatColor]);
    scene.add(this.worker.root);
    this.controller = new CharacterController(this.physics, this.layout.spawn);
    this.controller.facing = Math.PI; // face the tower (-Z)
    this.camera = new FollowCamera(camera);
    this.camera.yaw = 0;
    this.machineCams = new MachineCameras(this.camera);

    this.pieces = new PieceManager(this.physics);
    this.pieceRenderer = new PieceRenderer(this.assets.get('pieces') as THREE.Group);
    scene.add(this.pieceRenderer.group);

    this.ghosts = new SlotGhosts(this.assets.get('pieces') as THREE.Group);
    scene.add(this.ghosts.group);
    this.tower = new TowerView(this.assets, this.layout.plot);
    scene.add(this.tower.group);
    this.plot = new TowerPlot(this.layout.plot, this.pieces, (i) => this.slotPosition(i), {
      onSnap: (piece, result, progress) => this.onSnap(piece, result, progress.filled.reduce((a, b) => a + b, 0)),
      onWrong: (piece, needed, reason, type) => this.onWrong(piece, needed, reason, type),
      onGround: (progress, done) => this.onGround(progress.groundDug, progress.groundPoured, done),
      onStageComplete: () => this.onStageComplete(),
      onMasterpiece: () => this.onMasterpiece(),
    });
    this.puffs = new Puffs();
    scene.add(this.puffs.mesh);
    // feature 003: machines, Groundwork visuals, high-slot rings and the cue
    this.machines = new SoloMachines(this.site, this.pieces, this.plot, { act: (kind, act) => this.onMachineAct(kind, act) });
    // only 4 machines in solo: full detail at any distance on the lot
    this.machineRenderer = new MachineRenderer(this.assets, { outlines: this.quality.outlines, shadows: this.quality.tier === 'high', nearDist: 60 });
    scene.add(this.machineRenderer.group);
    window.setTimeout(() => this.machineRenderer.loadModels(), 1200);
    this.groundwork = new GroundworkView([{ def: this.site.plots[0]!, spots: this.layout.machines }], this.hudRoot);
    this.highSlots = new HighSlotRings(8);
    this.cue = new MachineCue();
    scene.add(this.groundwork.group, this.highSlots.group, this.cue.group);
    const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.celebration = new Celebration(this.quality.particles * (reducedMotion ? 0.25 : 1));
    this.celebration.onBurst = () => this.sfx.play('firework');
    scene.add(this.celebration.group);
    scene.add(this.targetRing);
    this.assets.onLoaded((id) => {
      if (id === 'fx') {
        const puff = this.assets.get('fx')?.getObjectByName('Fx_puff');
        const mesh = puff?.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
        if (mesh) this.puffs.setGeometry(mesh.geometry);
      }
    });

    this.hud = new Hud(this.hudRoot, {
      onShuffleName: () => {
        const n = this.profile.shuffleName();
        this.hud.setName(n);
        return n;
      },
      onToggleMute: () => {
        const m = !this.profile.get().muted;
        this.profile.update({ muted: m });
        this.sfx.setMuted(m);
        return m;
      },
      onRespawn: () => this.respawn(),
      onBuildAgain: () => this.buildAgain(),
      onOpen: (open) => {
        if (open) this.actions.releaseAll();
      },
    }, prof.muted);
    this.hud.setName(prof.name);
    this.hud.setWho(prof.name);
    this.sfx.setMuted(prof.muted);
    this.machineHints = new MachineHints(this.hudRoot, this.profile);
    window.setTimeout(() => void this.sfx.loadSamples(), 800);
    this.sfx.startMusic();

    const canvas = this.ctx.renderer.domElement;
    attachKeyboardMouse(this.actions, canvas, () => this.sfx.unlock());
    canvas.addEventListener('hht-zoom', (e) => this.camera.zoom((e as CustomEvent<number>).detail));
    this.touch = new TouchControls(this.actions, canvas, this.hudRoot);
    canvas.addEventListener('touchstart', () => this.sfx.unlock(), { passive: true });

    if (this.quality.bloom) this.bloom = new Bloom(this.ctx.renderer, scene, camera);
    this.applyStage(true);
    this.camera.snap(this.controller.position);
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
      else this.resume();
    });
  }

  private buildStaticColliders(): void {
    const p = this.physics;
    p.fixedBox(0, -0.25, 0, LOT_HALF, 0.25, LOT_HALF);
    const wallH = 3;
    p.fixedBox(0, wallH, PLAY_HALF + 0.25, LOT_HALF, wallH, 0.25);
    p.fixedBox(0, wallH, -PLAY_HALF - 0.25, LOT_HALF, wallH, 0.25);
    p.fixedBox(PLAY_HALF + 0.25, wallH, 0, 0.25, wallH, LOT_HALF);
    p.fixedBox(-PLAY_HALF - 0.25, wallH, 0, 0.25, wallH, LOT_HALF);
    for (const b of OBSTACLES.boxes) p.fixedBox(b.x, b.y, b.z, b.hx, b.hy, b.hz, b.rotY);
    for (const c of OBSTACLES.cylinders) p.fixedCylinder(c.x, c.y, c.z, c.hh, c.r);
    for (const r of this.layout.racks) {
      if (r.type === 'cone') continue;
      p.fixedBox(r.top.x, RACK_HALF.y, r.top.z, RACK_HALF.x, RACK_HALF.y, RACK_HALF.z, r.yaw);
    }
    // foundation step (walkable)
    p.fixedBox(this.layout.plot.x, 0.08, this.layout.plot.z, 1.72, 0.08, 1.72);
  }

  private onResize(): void {
    this.resizeRenderer();
  }

  /** low tier: scenery stops casting shadows (saves ~25k shadow-pass triangles) */
  private applyLotShadows(): void {
    const lot = this.assets.get('lot');
    lot?.traverse((o) => {
      o.castShadow = this.quality.tier === 'high' ? !!o.userData.castShadowHigh : false;
    });
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.applyLotShadows();
    configureOutlines(q.outlineWidthPx, q.outlineDistance);
    setOutlinesVisible(this.ctx.scene, q.outlines);
    this.bloom = q.bloom ? (this.bloom ?? new Bloom(this.ctx.renderer, this.ctx.scene, this.ctx.camera)) : null;
    this.onResize();
  }

  // ---------------------------------------------------------------- tower & stages
  private applyStage(initial = false): void {
    const pr = this.plot.progress;
    this.tower.show(pr.completedStages);
    // feature 003: the pit shows instead of the foundation during Groundwork
    this.tower.group.visible = !this.plot.inGroundwork;
    const stage = this.plot.stage;
    this.updateGhosts();
    this.tower.sign.set(this.plot.stars, this.plot.masterpiece);
    this.hud.setStage(this.plot.inGroundwork ? 'Groundwork' : (stage?.name ?? 'Masterpiece'), this.plot.stars, this.plot.masterpiece);
    this.updateNeed();
    if (this.machines) this.machines.blockers = pr.completedStages >= 1 ? [towerBlocker(this.site.plots[0]!)] : [];
    if (this.towerCollider) {
      this.physics.removeCollider(this.towerCollider);
      this.towerCollider = null;
    }
    if (pr.completedStages >= 1) {
      const c = this.layout.plot;
      this.towerCollider = this.physics.fixedBox(c.x, 3.6, c.z, 1.36, 3.6, 1.36);
    }
    this.camera.obstacles = pr.completedStages >= 1 ? [this.plot.footprint()] : [];
    if (!initial) this.ensureWorkerOutsideTower();
  }

  private ensureWorkerOutsideTower(): void {
    if (this.plot.progress.completedStages < 1) return;
    const c = this.layout.plot;
    const p = this.controller.position;
    if (Math.abs(p.x - c.x) < 1.5 && Math.abs(p.z - c.z) < 1.5) {
      this.controller.teleport(new THREE.Vector3(c.x, 0.2, c.z + 2.4));
    }
  }

  /** The HUD's "what next" line: Groundwork parts name the machine (003 FR-022); stages show per-material chips (004 FR-013). */
  private updateNeed(): void {
    const pr = this.plot.progress;
    const part = groundworkPart(pr);
    if (part === 'dig') return this.hud.setNeedText(`🚜 Dig ${pr.groundDug}/${CLOCK_TOWER.groundwork.scoops}: use the excavator`);
    if (part === 'concrete') return this.hud.setNeedText(`🥣 Concrete ${pr.groundPoured}/${CLOCK_TOWER.groundwork.concrete}: use the mixer`);
    this.hud.setNeeds(needsOf(pr));
  }

  /** feature 004: arc position of hand slot `i` of the current stage (the shared typed layout). */
  private slotPosition(i: number): THREE.Vector3 {
    const st = this.plot.stage;
    const s = st ? stageHandSlots(this.site.plots[0]!, st)[i] : undefined;
    return s ? new THREE.Vector3(s.x, this.layout.plot.y + s.y, s.z) : this.layout.plot.clone();
  }

  /** feature 004 (FR-011): ghosts of the open ordinary slots, typed by material. */
  private updateGhosts(): void {
    const pr = this.plot.progress;
    if (this.plot.masterpiece || this.plot.inGroundwork) return this.ghosts.set([]);
    this.ghosts.set(openSlotRefs(this.site.plots[0]!, this.layout.machines, pr).filter((s) => !s.high));
  }

  private onGround(dug: number, poured: number, done: boolean): void {
    if (done) {
      this.applyStage();
      this.sfx.play('stage');
      this.celebration.start(this.layout.plot, 2.5);
      this.hud.showToast('★ Groundwork done! The Frame stage is unlocked', 3.5);
    } else {
      this.updateNeed();
      if (poured > 0) this.sfx.playSample('concrete-pour', 0.8);
      if (dug === CLOCK_TOWER.groundwork.scoops && poured === 0) this.hud.showToast('The pit is dug! Now pour the footing: use the mixer', 3.2);
    }
    this.emit('ground', { dug, poured, done });
  }

  private onMachineAct(kind: MachineKind, act: string): void {
    const snd = ACT_SOUND[act];
    if (snd) this.sfx.playSample(snd[0], snd[1]);
    if (act === 'mixerFull') this.hud.showToast('Mixer is full');
    if (act === 'mixDone') this.puffs.emit(new THREE.Vector3(this.layout.machines.mixer.chute.x, 0.6, this.layout.machines.mixer.chute.z), 8, 0.5, 0.35);
    void kind;
  }

  private onSnap(piece: Piece | null, _result: string, filled: number): void {
    this.updateGhosts();
    this.updateNeed();
    this.sfx.play('snap');
    const at = piece ? piece.position.clone() : this.layout.plot.clone().add(new THREE.Vector3(0, 0.5, 2.3));
    this.puffs.emit(at, 7, 0.5, 0.35);
    if (!this.profile.get().hintsDone.firstSnap) this.profile.update({ hintsDone: { firstPickup: true, firstSnap: true } });
    this.emit('snapped', { filled });
  }

  private onWrong(piece: Piece | null, needed: PieceTypeId[], reason: string, type: PieceTypeId): void {
    this.sfx.play('wrong');
    const stage = this.plot.stage?.name ?? null;
    if (reason === 'groundworkFirst') this.hud.showToast(groundworkPart(this.plot.progress) === 'dig' ? 'Dig the foundation first' : 'Pour the footing first', 2.6);
    else if (reason === 'tooHigh') this.hud.showToast('Too high: use the crane', 2.6);
    else if (this.plot.masterpiece) this.hud.showToast('The tower is finished! Press “Build again” to start over.');
    else if (type === 'cone') this.hud.showToast(`Cones are just for fun! The tower needs ${needed.map(pluralNoun).join(' and ')}`);
    else if (reason === 'surplus') this.hud.showToast(hintLine({ kind: 'surplus', type, needed }, stage) ?? '');
    else this.hud.showToast(hintLine({ kind: 'wrongPiece', needed }, stage) ?? '');
    this.emit('wrongPiece', { needed, reason, type });
  }

  private onStageComplete(): void {
    this.applyStage();
    this.sfx.play('stage');
    const c = this.layout.plot;
    for (let i = 0; i < 6; i++) this.puffs.emit(new THREE.Vector3(c.x + Math.cos(i) * 1.6, 0.4 + i * 0.6, c.z + Math.sin(i) * 1.6), 6, 0.9, 0.6);
    this.hud.showToast(`★ Stage complete: ${this.plot.stage ? `next up ${this.plot.stage.name}` : 'Masterpiece!'}`);
    this.emit('stageComplete', { completedStages: this.plot.progress.completedStages, stars: this.plot.stars });
  }

  private onMasterpiece(): void {
    this.applyStage();
    this.sfx.play('bell');
    this.celebration.start(this.layout.plot, 7);
    this.cheerTimer = 5;
    this.hud.setCelebrate(true);
    this.emit('masterpiece', { stars: this.plot.stars });
  }

  buildAgain(): void {
    if (this.machines.seated >= 0) this.exitMachine();
    this.machines.reset();
    this.plot.reset();
    this.celebration.stop();
    this.hud.setCelebrate(false);
    this.cheerTimer = 0;
    this.applyStage();
    this.sfx.play('click');
  }

  respawn(): void {
    if (this.machines.seated >= 0) this.exitMachine();
    const held = this.pieces.held();
    if (held) this.pieces.remove(held);
    this.controller.teleport(this.layout.spawn, Math.PI);
    this.camera.yaw = 0;
    this.touch?.setHolding(false);
  }

  // ---------------------------------------------------------------- holding
  giveHeld(type: PieceTypeId): Piece {
    const old = this.pieces.held();
    if (old) this.pieces.remove(old);
    const p = this.pieces.create(type, 'held', this.controller.position);
    this.touch?.setHolding(true);
    return p;
  }

  private heldMatrix(type: PieceTypeId, out: THREE.Matrix4): THREE.Matrix4 {
    const pose = PIECE_TYPES[type].carryPose;
    const local = new THREE.Vector3();
    const rot = new THREE.Euler();
    const hh = this.pieceRenderer.halfHeight.get(type) ?? 0.15;
    if (pose === 'shoulder') {
      local.set(-0.3, 0.84, 0.05);
      rot.set(0, Math.PI / 2, 0);
    } else if (pose === 'hug') {
      local.set(0, 0.42 + hh * 0.5, 0.4);
    } else {
      local.set(0, 0.36 + hh, 0.42);
    }
    const root = this.worker.root;
    root.updateMatrixWorld();
    this.tmpQ.setFromEuler(rot);
    out.compose(local, this.tmpQ, new THREE.Vector3(1, 1, 1));
    return out.premultiply(root.matrixWorld);
  }

  private dropOrToss(toss: boolean): void {
    const held = this.pieces.held();
    if (!held) return;
    // release from where the worker is now, not where it was last drawn (a teleport or a slow frame in between)
    this.worker.root.position.copy(this.controller.position);
    this.worker.root.rotation.y = this.controller.facing;
    const m = this.heldMatrix(held.type, this.tmpM);
    const pos = v3().setFromMatrixPosition(m);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const f = this.controller.facing;
    const dir = new THREE.Vector3(Math.sin(f), 0, Math.cos(f));
    let vel: THREE.Vector3;
    if (toss) {
      const k = 1 / Math.sqrt(PIECE_TYPES[held.type].mass);
      vel = dir.multiplyScalar(9 * k + 2).add(new THREE.Vector3(0, 4.2, 0)).add(this.controller.velocity.clone().setY(0).multiplyScalar(0.5));
      this.worker.tossed();
      this.sfx.play('toss');
    } else {
      pos.addScaledVector(dir, 0.25);
      vel = dir.multiplyScalar(0.6).add(new THREE.Vector3(0, 0.5, 0));
      this.sfx.play('drop');
    }
    this.pieces.release(held, pos, q, vel);
    this.touch?.setHolding(false);
    this.emit(toss ? 'toss' : 'drop', { type: held.type });
  }

  private tryPickup(): void {
    if (this.pieces.held() || !this.target) return;
    const t = this.target;
    if (t.kind === 'piece') {
      if (!this.pieces.pickUp(t.piece)) return;
    } else {
      this.pieces.create(t.rack.type, 'held', this.controller.position);
    }
    const type = t.kind === 'piece' ? t.piece.type : t.rack.type;
    this.sfx.play('pickup');
    this.touch?.setHolding(true);
    if (!this.profile.get().hintsDone.firstPickup) this.profile.update({ hintsDone: { firstPickup: true, firstSnap: false } });
    this.emit('pickup', { type });
  }

  // ---------------------------------------------------------------- machines (feature 003)

  /** The nearest machine whose cab is within reach (solo: every machine is yours). */
  private nearestMachine(): number {
    const p = this.controller.position;
    let best = -1;
    let bd: number = MACHINE.enterRange;
    this.machines.states.forEach((s, i) => {
      const e = entryPoint(s, this.layout.machines);
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  enterMachine(id: number): void {
    if (this.pieces.held()) {
      this.hud.showToast('Hands full — put it down first');
      return;
    }
    const kind = this.machines.kindAt(id);
    this.machines.enter(id);
    this.controller.collider.setEnabled(false);
    this.machineCams.enter(kind);
    this.machineHints.onEnter(kind);
    this.sfx.playSample('hydraulic', 0.6);
    this.emit('machineEnter', { kind });
  }

  exitMachine(): void {
    const at = this.machines.exit();
    if (!at) return;
    this.controller.collider.setEnabled(true);
    this.controller.teleport(new THREE.Vector3(at.x, 0.05, at.z), at.yaw);
    this.camera.yaw = at.yaw + Math.PI;
    this.machineCams.exit();
    this.machineHints.leave();
    this.touch?.setMachineMode(null);
    this.sfx.pruneLoops(new Set());
    this.emit('machineExit');
  }

  // ---------------------------------------------------------------- loop
  override pause(): void {
    super.pause();
    this.actions.releaseAll();
  }

  protected step(dt: number, now: number): void {
    this.update(dt, now);
  }

  protected override frozenStep(dt: number): void {
    this.celebration.update(dt);
    ghostMaterial.uniforms.uTime!.value += dt;
  }

  protected override onFps(text: string): void {
    this.hud.setFps(text);
  }

  private update(dt: number, now: number): void {
    const a = this.actions;
    pollGamepad(a);
    if (a.wasPressed('menu')) this.hud.setMenu(!this.hud.menuOpen, this.profile.get().name);
    const menu = this.hud.menuOpen;

    // camera orbit
    this.camera.orbit(a.look.x, a.look.y);

    // movement intent (camera-relative)
    this.camera.basis(this.fwd, this.right);
    const held = this.pieces.held();
    const heavy = held && (held.type === 'beam' || held.type === 'bell');
    const speed = (a.run ? MOVE.runSpeed : MOVE.walkSpeed) * (heavy ? 1 - MOVE.carrySlowdown : 1);
    const seated = this.machines.seated >= 0;
    const wish = menu || this.cheerTimer > 0 || seated
      ? v3()
      : v3().addScaledVector(this.fwd, a.move.y).addScaledVector(this.right, a.move.x).multiplyScalar(speed);
    // feature 003: in a machine the same buttons are re-mapped (move drives, action acts, jump exits, toss = crane camera)
    if (seated && !menu) {
      if (a.wasPressed('jump')) this.exitMachine();
      else {
        if (a.wasPressed('action')) this.machines.pressAct(now);
        if (a.wasPressed('toss')) this.machineCams.toggle();
      }
    } else if (!menu && a.wasPressed('jump')) this.controller.requestJump();
    const nowSeated = this.machines.seated >= 0;
    this.machines.update(dt, nowSeated && !menu ? a.move.x : 0, nowSeated && !menu ? a.move.y : 0, now);

    this.physics.step(dt, (h) => {
      if (!nowSeated) this.controller.step(h, wish);
    });
    if (this.controller.justJumped) {
      this.worker.jumped();
      this.sfx.play('jump');
    }

    // respawn: hold R 0.5 s, or fall off
    this.respawnHeld = a.isHeld('respawn') ? this.respawnHeld + dt : 0;
    if (this.respawnHeld >= 0.5 || this.controller.position.y < -5) {
      this.respawnHeld = 0;
      this.respawn();
    }

    // interaction ("Get in" comes before picking up)
    this.machineTargetId = held || nowSeated ? -1 : this.nearestMachine();
    this.target = held || nowSeated || this.machineTargetId >= 0 ? null : findTarget(this.controller.position, this.controller.facing, this.pieces.loose(), this.layout.racks);
    if (nowSeated) {
      const l = this.machines.label();
      this.hud.setPrompt(l.text, 'E', l.disabled);
      this.touch?.setMachineMode({ action: l.text, disabled: l.disabled, toss: 'Camera' });
      this.machineHints.update(Math.abs(a.move.x) + Math.abs(a.move.y) > 0.1 || a.wasPressed('action'), a.lastDevice);
    } else if (this.machineTargetId >= 0) this.hud.setPrompt(`Get in ${MACHINE_NAME[this.machines.kindAt(this.machineTargetId)]}`);
    else this.hud.setPrompt(null);
    if (!menu && !nowSeated && !seated) {
      if (!held && a.wasPressed('action') && this.machineTargetId >= 0) {
        this.enterMachine(this.machineTargetId);
        this.armDrop = false;
      } else if (!held && a.wasPressed('action')) {
        this.tryPickup();
        this.armDrop = false;
      } else if (held) {
        // drop/toss only on a press that started while already holding (not the pick-up press)
        if (a.wasPressed('action')) this.armDrop = true;
        const releasedAfter = a.releasedAfter('action');
        if (a.wasPressed('toss')) {
          this.dropOrToss(true);
          this.armDrop = false;
        } else if (this.armDrop && releasedAfter !== null) {
          this.dropOrToss(releasedAfter >= INTERACT.tossHoldSeconds);
          this.armDrop = false;
        }
      }
    }

    this.pieces.update(dt);
    this.plot.update(dt);
    this.ghosts.update(dt);
    this.puffs.update(dt);
    this.celebration.update(dt);
    ghostMaterial.uniforms.uTime!.value += dt;
    this.cheerTimer = Math.max(0, this.cheerTimer - dt);

    // worker visual (seated: in the cab)
    const alpha = this.physics.alpha;
    const pos = this.tmpV.lerpVectors(this.controller.prevPosition, this.controller.position, alpha);
    const seat = this.machines.seat();
    if (seat) pos.set(seat.x, seat.y, seat.z);
    this.worker.root.position.copy(pos);
    this.worker.root.rotation.y = seat ? seat.yaw : this.controller.facing;
    const hs = seat ? 0 : this.controller.horizontalSpeed;
    const pose = seat ? 'seated' : this.cheerTimer > 0 ? 'cheer' : !this.controller.grounded ? 'air' : hs > 4.2 ? 'run' : hs > 0.4 ? 'walk' : 'idle';
    const nowHeld = this.pieces.held();
    this.worker.update(dt, pose, hs, nowHeld ? PIECE_TYPES[nowHeld.type].carryPose : null);

    if (seat && this.machineCams.active) this.machineCams.update(dt, this.ctx.camera, this.machines.states[this.machines.seated]!, this.layout.machines, a.move);
    else this.camera.update(dt, pos);
    this.drawPieces();
    this.updateMachineViews(dt, now);

    // target highlight
    if (this.target && !nowHeld) {
      this.targetRing.visible = true;
      this.targetRing.position.set(this.target.point.x, Math.max(0.05, this.target.point.y - (this.target.kind === 'rack' ? 0.08 : 0.15)), this.target.point.z);
      this.targetRing.scale.setScalar(this.target.kind === 'rack' ? 1.8 : 1 + 0.06 * Math.sin(now / 120));
    } else this.targetRing.visible = false;

    // hud
    const prof = this.profile.get();
    let arrow: THREE.Vector3 | null = null;
    if (!prof.hintsDone.firstPickup) {
      // the material with the most ordinary slots left (004)
      const need = needsOf(this.plot.progress).filter((n) => !n.craneOnly && !n.done).sort((a, b) => b.left - a.left)[0]?.type ?? this.plot.needed ?? 'beam';
      const r = this.layout.racks.find((x) => x.type === need);
      if (r) arrow = r.top.clone().add(new THREE.Vector3(0, 2.0, 0));
    } else if (!prof.hintsDone.firstSnap && nowHeld) {
      arrow = this.slotPosition(this.plot.handSlotIndex(nowHeld.type)).add(new THREE.Vector3(0, 1.4, 0));
    }
    const head = pos.clone().add(new THREE.Vector3(0, 1.75, 0));
    const needAt = this.layout.plot.clone().add(new THREE.Vector3(0, 2.9, 2.9));
    this.hud.layout(this.ctx.camera, head, needAt, arrow);
    a.endFrame();
  }

  /** Groundwork pit, high-slot rings (lit while the hook would snap), the cue and engine sounds. */
  private updateMachineViews(dt: number, now: number): void {
    const pr = this.plot.progress;
    const spots = this.layout.machines;
    this.groundwork.update([{ active: !groundworkDone(pr), groundDug: pr.groundDug, groundPoured: pr.groundPoured, mixerBags: this.machines.mixerBags, mixerMixUntil: this.machines.mixerMixUntil ? Date.now() + (this.machines.mixerMixUntil - now) : 0 }], Date.now(), this.ctx.camera, this.controller.position);
    const seatedCrane = this.machines.seated === 0;
    this.highSlots.update(dt, [{ progress: this.plot.masterpiece ? null : pr, spots }], seatedCrane ? this.machines.snapSlot() : null);
    this.cue.update(dt, 0, pr, (k) => this.machines.seated >= 0 && this.machines.kindAt(this.machines.seated) === k, (k) => {
      const s = this.machines.states[['crane', 'excavator', 'forklift', 'mixer'].indexOf(k)]!;
      return k === 'crane' ? { x: spots.crane.x, z: spots.crane.z, top: spots.crane.cabHeight + 0.8 } : { x: s.x, z: s.z, top: 2.3 };
    });
    const i = this.machines.seated;
    if (i >= 0) {
      const s = this.machines.states[i]!;
      const a = this.actions;
      const moving = Math.abs(a.move.x) > 0.1 || Math.abs(a.move.y) > 0.1;
      const g = s.kind === 'crane' ? (moving || s.phase !== 'idle' ? 0.7 : 0) : s.kind === 'mixer' ? (this.machines.mixerMixUntil ? 0.85 : 0) : moving ? 0.85 : 0.45;
      this.sfx.setLoop('solo-machine', ENGINE[s.kind], g);
    } else this.sfx.setLoop('solo-machine', 'engine-diesel', 0);
    void currentStage;
  }

  private drawPieces(): void {
    const r = this.pieceRenderer;
    r.begin();
    // feature 003: the four machines (hooked and pallet pieces go into this batch)
    const spots = this.layout.machines;
    const crane = this.machines.states[0]!;
    const fork = this.machines.states[2]!;
    this.machineRenderer.draw(
      this.machines.states.map((s) => ({ pose: s, spots, hook: s === crane && crane.load.kind === 'hook' ? crane.load.piece : null, pallet: s === fork && fork.load.kind === 'pallet' ? fork.load.pieces : [] })),
      this.ctx.camera.position, (t, m) => r.add(t, m), (t) => r.halfHeight.get(t) ?? 0.15,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    // rack displays
    for (const rack of this.layout.racks) {
      const n = RACK_DISPLAY[rack.type];
      const hh = r.halfHeight.get(rack.type) ?? 0.15;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rack.yaw);
      for (let i = 0; i < n; i++) {
        const local = rack.type === 'cone'
          ? new THREE.Vector3(Math.cos(i * 1.3) * 0.35 * (i ? 1 : 0), hh, Math.sin(i * 1.3) * 0.35 * (i ? 1 : 0))
          : rack.type === 'beam'
            ? new THREE.Vector3(0, hh + i * hh * 2.05, (i % 2) * 0.05)
            : new THREE.Vector3((i % 2 === 0 ? -0.33 : 0.33), hh + Math.floor(i / 2) * hh * 2.05, 0);
        local.applyQuaternion(q).add(rack.top);
        m.compose(local, q, s);
        r.add(rack.type, m);
      }
    }
    // world pieces
    for (const p of this.pieces.pieces.values()) {
      if (p.state === 'held') {
        r.add(p.type, this.heldMatrix(p.type, m));
        continue;
      }
      const scale = p.fade > 0 ? Math.max(0.001, 1 - p.fade) : 1;
      s.setScalar(scale);
      m.compose(p.position, p.quaternion, s);
      r.add(p.type, m);
      s.setScalar(1);
    }
    r.end();
  }
}
