import * as THREE from 'three';
import { HAT_COLORS, MOVE, PIECE_TYPES, INTERACT, type PieceTypeId } from '@hht/shared';
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
import { ghostMaterial } from '../render/ghost.ts';
import { configureOutlines, setOutlinesVisible } from '../render/outline.ts';
import type { QualitySettings } from '../render/quality.ts';
import type { RenderContext } from '../render/renderer.ts';
import { Hud } from '../ui/hud.ts';
import { LOT_HALF, OBSTACLES, PLAY_HALF, RACK_DISPLAY, RACK_HALF, readLayout, type Layout } from '../world/layout.ts';
import { PieceRenderer } from '../world/pieceRenderer.ts';
import { SlotMarkers } from '../world/slotMarkers.ts';
import { TowerView } from '../world/towerView.ts';
import { findTarget, type Target } from './interaction.ts';
import { PieceManager, type Piece } from './pieceManager.ts';
import { TowerPlot } from './towerPlot.ts';

export type GameEvent = 'snapped' | 'stageComplete' | 'masterpiece' | 'wrongPiece' | 'pickup' | 'drop' | 'toss' | 'ready';

const v3 = (): THREE.Vector3 => new THREE.Vector3();

export class Game {
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
  markers!: SlotMarkers;
  pieceRenderer!: PieceRenderer;
  puffs!: Puffs;
  celebration!: Celebration;
  hud!: Hud;
  touch: TouchControls | null = null;
  private bloom: Bloom | null = null;
  private towerCollider: RAPIER.Collider | null = null;
  private target: Target | null = null;
  private readonly targetRing: THREE.Mesh;
  private running = false;
  private raf = 0;
  private last = 0;
  private cheerTimer = 0;
  private respawnHeld = 0;
  private armDrop = false;
  private readonly frameTimes: number[] = [];
  private fpsTimer = 0;
  showFps = false;
  /** debug: freeze gameplay updates except rendering (perf scene) */
  frozen = false;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly fwd = v3();
  private readonly right = v3();

  constructor(
    readonly ctx: RenderContext,
    readonly assets: AssetStore,
    readonly profile: ProfileStore,
    private quality: QualitySettings,
    private readonly hudRoot: HTMLElement,
  ) {
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
    this.buildStaticColliders();

    const prof = this.profile.get();
    this.worker = new WorkerView(this.assets.get('worker') as THREE.Group, HAT_COLORS[prof.hatColor]);
    scene.add(this.worker.root);
    this.controller = new CharacterController(this.physics, this.layout.spawn);
    this.controller.facing = Math.PI; // face the tower (-Z)
    this.camera = new FollowCamera(camera);
    this.camera.yaw = 0;

    this.pieces = new PieceManager(this.physics);
    this.pieceRenderer = new PieceRenderer(this.assets.get('pieces') as THREE.Group);
    scene.add(this.pieceRenderer.group);

    this.markers = new SlotMarkers();
    scene.add(this.markers.group);
    this.tower = new TowerView(this.assets, this.layout.plot);
    scene.add(this.tower.group);
    this.plot = new TowerPlot(this.layout.plot, this.pieces, (i) => this.markers.slotPosition(i), {
      onSnap: (piece, result, progress) => this.onSnap(piece, result, progress.filledSlots),
      onWrong: (piece, needed) => this.onWrong(piece, needed),
      onStageComplete: () => this.onStageComplete(),
      onMasterpiece: () => this.onMasterpiece(),
    });
    this.puffs = new Puffs();
    scene.add(this.puffs.mesh);
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
    this.ctx.resize();
    if (this.bloom) {
      const r = this.ctx.renderer;
      const s = r.getSize(new THREE.Vector2());
      this.bloom.setSize(s.x, s.y, r.getPixelRatio());
    }
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
    const stage = this.plot.stage;
    this.markers.layout(this.layout.plot, stage?.slotCount ?? 0);
    this.markers.setFilled(pr.filledSlots, !this.plot.masterpiece);
    this.tower.sign.set(this.plot.stars, this.plot.masterpiece);
    this.hud.setStage(stage?.name ?? 'Masterpiece', this.plot.stars, this.plot.masterpiece);
    this.hud.setNeed(this.plot.needed, pr.filledSlots, stage?.slotCount ?? 0);
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

  private onSnap(piece: Piece | null, _result: string, filled: number): void {
    const stage = this.plot.stage;
    this.markers.setFilled(this.plot.progress.filledSlots, !this.plot.masterpiece);
    this.hud.setNeed(this.plot.needed, this.plot.progress.filledSlots, stage?.slotCount ?? 0);
    this.sfx.play('snap');
    const at = piece ? piece.position.clone() : this.layout.plot.clone().add(new THREE.Vector3(0, 0.5, 2.3));
    this.puffs.emit(at, 7, 0.5, 0.35);
    if (!this.profile.get().hintsDone.firstSnap) this.profile.update({ hintsDone: { firstPickup: true, firstSnap: true } });
    this.emit('snapped', { filled });
  }

  private onWrong(piece: Piece | null, needed: PieceTypeId | null): void {
    this.sfx.play('wrong');
    if (!needed) this.hud.showToast('The tower is finished! Press “Build again” to start over.');
    else if (piece?.type === 'cone') this.hud.showToast(`Cones are just for fun! The tower needs: ${PIECE_TYPES[needed].label}`);
    else this.hud.showToast(`Needs: ${PIECE_TYPES[needed].label}`);
    this.emit('wrongPiece', { needed });
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
    this.plot.reset();
    this.celebration.stop();
    this.hud.setCelebrate(false);
    this.cheerTimer = 0;
    this.applyStage();
    this.sfx.play('click');
  }

  respawn(): void {
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

  // ---------------------------------------------------------------- loop
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
    this.actions.releaseAll();
  }

  resume(): void {
    if (!this.running) this.start();
  }

  private frame(dt: number, now: number): void {
    const t0 = performance.now();
    if (!this.frozen) this.update(dt, now);
    else {
      this.celebration.update(dt);
      ghostMaterial.uniforms.uTime!.value += dt;
    }
    this.render(dt);
    this.recordFrame(dt, performance.now() - t0);
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
    const wish = menu || this.cheerTimer > 0
      ? v3()
      : v3().addScaledVector(this.fwd, a.move.y).addScaledVector(this.right, a.move.x).multiplyScalar(speed);
    if (!menu && a.wasPressed('jump')) this.controller.requestJump();

    this.physics.step(dt, (h) => this.controller.step(h, wish));
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

    // interaction
    this.target = held ? null : findTarget(this.controller.position, this.controller.facing, this.pieces.loose(), this.layout.racks);
    if (!menu) {
      if (!held && a.wasPressed('action')) {
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
    this.markers.update(dt);
    this.puffs.update(dt);
    this.celebration.update(dt);
    ghostMaterial.uniforms.uTime!.value += dt;
    this.cheerTimer = Math.max(0, this.cheerTimer - dt);

    // worker visual
    const alpha = this.physics.alpha;
    const pos = this.tmpV.lerpVectors(this.controller.prevPosition, this.controller.position, alpha);
    this.worker.root.position.copy(pos);
    this.worker.root.rotation.y = this.controller.facing;
    const hs = this.controller.horizontalSpeed;
    const pose = this.cheerTimer > 0 ? 'cheer' : !this.controller.grounded ? 'air' : hs > 4.2 ? 'run' : hs > 0.4 ? 'walk' : 'idle';
    const nowHeld = this.pieces.held();
    this.worker.update(dt, pose, hs, nowHeld ? PIECE_TYPES[nowHeld.type].carryPose : null);

    this.camera.update(dt, pos);
    this.drawPieces();

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
      const need = this.plot.needed ?? 'beam';
      const r = this.layout.racks.find((x) => x.type === need);
      if (r) arrow = r.top.clone().add(new THREE.Vector3(0, 2.0, 0));
    } else if (!prof.hintsDone.firstSnap && nowHeld) {
      arrow = this.markers.slotPosition(this.plot.progress.filledSlots).add(new THREE.Vector3(0, 1.4, 0));
    }
    const head = pos.clone().add(new THREE.Vector3(0, 1.75, 0));
    const needAt = this.layout.plot.clone().add(new THREE.Vector3(0, 2.9, 2.9));
    this.hud.layout(this.ctx.camera, head, needAt, arrow);
    a.endFrame();
  }

  private drawPieces(): void {
    const r = this.pieceRenderer;
    r.begin();
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

  private render(dt: number): void {
    const { renderer, scene, camera } = this.ctx;
    renderer.info.reset();
    if (this.bloom) this.bloom.render(dt);
    else renderer.render(scene, camera);
  }

  private recordFrame(dt: number, _cpuMs: number): void {
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 300) this.frameTimes.shift();
    if (this.showFps) {
      this.fpsTimer += dt;
      if (this.fpsTimer > 0.5) {
        this.fpsTimer = 0;
        const i = this.ctx.renderer.info;
        const med = this.medianFrameMs();
        this.hud.setFps(`${(1000 / med).toFixed(0)} fps (${med.toFixed(1)} ms)\ncalls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k`);
      }
    }
  }

  medianFrameMs(): number {
    if (!this.frameTimes.length) return 0;
    const s = [...this.frameTimes].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)] as number;
  }
}
