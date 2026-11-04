import * as THREE from 'three';
import {
  ANIM, CLOSE, HAT_COLORS, LOAD_DIRT, LOAD_PALLET, MACHINE, NET, PIECE_TYPES, SITE, carryFromCode, exitSpot, initialWorker, isPieceTypeId,
  kindOfMachine, machineCtx, plotOfMachine, seatPose, seqDiff, towerBlocker, wrapAngle,
  type MachineCtx, type MachineKind, type MachineLoad, type MachineState, type ObstacleBox, type OwnMachine, type PieceTypeId,
  type ServerEvents, type Snapshot,
} from '@hht/shared';
import type { AssetStore } from '../assets/loader.ts';
import { Sfx } from '../audio/sfx.ts';
import { CrowdRenderer, carryMatrixFor, setCarryHalfHeights, type CrowdEntry } from '../crowd/CrowdRenderer.ts';
import type { CrowdPose } from '../crowd/animation.ts';
import { LabelLayer, type LabelEntry } from '../crowd/labels.ts';
import { Actions } from '../input/actions.ts';
import { pollGamepad } from '../input/gamepad.ts';
import { attachKeyboardMouse } from '../input/keyboardMouse.ts';
import { TouchControls } from '../input/touch.ts';
import { NetConnection } from '../net/connection.ts';
import { EntityBuffer, type Pose } from '../net/interpolation.ts';
import { matchmake } from '../net/matchmake.ts';
import { InputStream, MachinePredictor, Predictor } from '../net/prediction.ts';
import { MachineRenderer, type MachineDraw } from '../machines/MachineRenderer.ts';
import { MachineViews, type MachineViewPose } from '../machines/machineViews.ts';
import type { MachinePose } from '../machines/rig.ts';
import { FollowCamera } from '../player/followCamera.ts';
import { MachineCameras } from '../player/machineCameras.ts';
import { WorkerView, type WorkerPose } from '../player/workerView.ts';
import type { ProfileStore } from '../profile/guestProfile.ts';
import { Bloom } from '../render/bloom.ts';
import { configureOutlines } from '../render/outline.ts';
import type { QualitySettings } from '../render/quality.ts';
import type { RenderContext } from '../render/renderer.ts';
import { NetHud } from '../ui/netHud.ts';
import { showModal, type ModalHandle } from '../ui/screens.ts';
import { PieceRenderer } from '../world/pieceRenderer.ts';
import { SiteView } from '../world/site.ts';
import { GameShell } from './GameShell.ts';
import { drawRackDisplays } from './netWorld.ts';

const POSE_OF_ANIM: Record<number, CrowdPose> = { 0: 'idle', 1: 'walk', 2: 'run', 3: 'air', 4: 'cheer', 5: 'wave', 6: 'seated' };
const MACHINE_COUNT = SITE.machines.length * 4;

export interface Bubble {
  text: string;
  kind: 'say' | 'chat' | 'emote';
  until: number;
}

/**
 * The multiplayer game (feature 002): server-authoritative world, own worker predicted with the shared
 * kinematics, remote workers interpolated and drawn by the instanced crowd renderer.
 */
export class NetGame extends GameShell {
  conn: NetConnection;
  readonly assets: AssetStore;
  readonly profile: ProfileStore;
  readonly hudRoot: HTMLElement;
  readonly actions = new Actions();
  readonly sfx = new Sfx();
  readonly events = new EventTarget();
  site!: SiteView;
  worker!: WorkerView;
  camera!: FollowCamera;
  crowd!: CrowdRenderer;
  pieceRenderer!: PieceRenderer;
  labels!: LabelLayer;
  hud!: NetHud;
  touch: TouchControls | null = null;
  /** one seq'd input stream for the worker and the machine predictors (feature 003) */
  readonly stream = new InputStream();
  predictor: Predictor;
  /** the operated machine (feature 003), predicted like the worker; null while walking */
  machinePred: MachinePredictor | null = null;
  seatedId = -1;
  /** seq of a predicted jump-exit the server has not acknowledged yet (-1 = none) */
  private pendingExitSeq = -1;
  private exitFallbackAt = 0;
  /** while waiting for a `machine enter` answer, walking inputs are neutral */
  enteringUntil = 0;
  private readonly actTimes: number[] = [];
  readonly machineViews = new MachineViews();
  machines!: MachineRenderer;
  machineCams!: MachineCameras;
  /** this frame's machine poses (interpolated remotes, the predicted own machine) */
  readonly machinePoses: MachineViewPose[] = Array.from({ length: MACHINE_COUNT }, (_, id) => ({ id, kind: kindOfMachine(id), x: 0, z: 0, yaw: 0, p1: 0, p2: 0, p3: 0, phase: 'idle', operator: false, loadCode: 0 }));
  private readonly machineDraws: MachineDraw[] = [];
  readonly remotes = new Map<number, EntityBuffer>();
  me = '';
  myNetId = 0;
  blockers: ObstacleBox[] = [];
  private blockerKey = '';
  readonly bubbles = new Map<string, Bubble>();
  readonly muted = new Set<string>();
  readonly hidden = new Set<string>();
  private sendAcc = 0;
  private snapNext = false;
  private respawnHeld = 0;
  private modal: ModalHandle | null = null;
  private reconnecting = false;
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly ownPos = new THREE.Vector3();
  private readonly tmpPose: Pose = { x: 0, y: 0, z: 0, yaw: 0, anim: 0, carry: null, emoting: false };
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpS = new THREE.Vector3(1, 1, 1);
  private readonly crowdEntries: CrowdEntry[] = [];
  private readonly labelEntries: LabelEntry[] = [];
  private lastSnapshotPerf = 0;

  constructor(ctx: RenderContext, assets: AssetStore, profile: ProfileStore, quality: QualitySettings, hudRoot: HTMLElement, conn: NetConnection) {
    super(ctx, quality);
    this.assets = assets;
    this.profile = profile;
    this.hudRoot = hudRoot;
    this.conn = conn;
    this.predictor = new Predictor(initialWorker(SITE.spawn), SITE, this.stream);
    configureOutlines(quality.outlineWidthPx, quality.outlineDistance);
  }

  emit(type: string, detail?: unknown): void {
    this.events.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async build(): Promise<void> {
    const { scene, camera } = this.ctx;
    this.site = new SiteView(this.assets.get('site') as THREE.Object3D);
    scene.add(this.site.root);
    this.site.setShadows(this.quality.tier === 'high');
    const prof = this.profile.get();
    this.worker = new WorkerView(this.assets.get('worker') as THREE.Group, HAT_COLORS[prof.hatColor]);
    scene.add(this.worker.root);
    this.crowd = new CrowdRenderer((this.assets.get('worker-lod1') ?? this.assets.get('worker')) as THREE.Object3D, 128, this.quality.outlines ? Math.min(15, this.quality.outlineDistance) : 0, this.quality.tier === 'high');
    scene.add(this.crowd.group);
    this.pieceRenderer = new PieceRenderer((this.assets.get('pieces-lod1') ?? this.assets.get('pieces')) as THREE.Group, 360);
    if (this.quality.tier !== 'high') this.pieceRenderer.group.traverse((o) => (o.castShadow = false));
    setCarryHalfHeights(this.pieceRenderer.halfHeight);
    scene.add(this.pieceRenderer.group);
    this.camera = new FollowCamera(camera);
    this.camera.yaw = 0;
    this.machineCams = new MachineCameras(this.camera);
    this.machines = new MachineRenderer(this.assets, { outlines: this.quality.outlines, shadows: this.quality.tier === 'high', nearDist: 20 });
    scene.add(this.machines.group);
    // the machine models stream in after play starts (FR-038): placeholders until then
    window.setTimeout(() => this.machines.loadModels(), 1200);
    this.labels = new LabelLayer(this.hudRoot);
    this.hud = new NetHud(this.hudRoot, {
      onShuffleName: () => {
        const n = this.profile.shuffleName();
        this.conn.send('shuffleName', { name: n });
        this.hud.showToast(`You are now ${n}`);
      },
      onToggleMute: () => {
        const m = !this.profile.get().muted;
        this.profile.update({ muted: m });
        this.sfx.setMuted(m);
        return m;
      },
      onRespawn: () => this.conn.send('respawn', {}),
      onInvite: () => this.invite(),
      onPeople: () => this.emit('openPeople'),
      onToggleHideChat: () => {
        const v = !this.profile.get().hideAllChat;
        this.profile.update({ hideAllChat: v });
        return v;
      },
      onOpen: (open) => {
        if (open) this.actions.releaseAll();
      },
      onMachineHelp: () => this.emit('machineHelp'),
    }, prof.muted, prof.hideAllChat);
    this.sfx.setMuted(prof.muted);
    // feature 003: generated samples and the music stream in after play starts
    window.setTimeout(() => void this.sfx.loadSamples(), 800);
    this.sfx.startMusic();
    const canvas = this.ctx.renderer.domElement;
    attachKeyboardMouse(this.actions, canvas, () => this.sfx.unlock());
    canvas.addEventListener('hht-zoom', (e) => this.camera.zoom((e as CustomEvent<number>).detail));
    this.touch = new TouchControls(this.actions, canvas, this.hudRoot);
    canvas.addEventListener('touchstart', () => this.sfx.unlock(), { passive: true });
    if (this.quality.bloom) this.bloom = new Bloom(this.ctx.renderer, scene, camera);
    this.attach(this.conn);
    if (this.conn.redirected) this.hud.showToast('That site is full — you’ve been sent to a nearby one', 4);
    this.camera.snap(new THREE.Vector3(SITE.spawn.x, SITE.spawn.y, SITE.spawn.z));
    this.resizeRenderer();
    window.addEventListener('resize', () => this.resizeRenderer());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
      else this.resume();
    });
  }

  /** Binds a (new) connection: welcome, snapshots, events and close codes. */
  attach(conn: NetConnection): void {
    this.conn = conn;
    const w = conn.welcome;
    if (w) this.onWelcome(w);
    conn.onSnapshot = (s) => this.onSnapshot(s);
    conn.on('welcome', (w2) => this.onWelcome(w2));
    conn.on('correction', () => {
      this.snapNext = true;
    });
    conn.on('slowDown', () => this.hud.showToast('Whoa, slow down a little!', 1.6));
    conn.on('closed', (code) => this.onClosed(code));
    this.emit('attached', conn);
  }

  private onWelcome(w: ServerEvents['welcome']): void {
    this.me = w.sessionId;
    this.myNetId = w.netId;
    this.profile.update({ lastWorld: w.worldId });
    this.hud.setWho(w.name, w.worldId);
    if (w.name !== this.profile.get().name) this.profile.update({ name: w.name });
    this.snapNext = true;
    if (w.resumed) this.hud.showToast('Welcome back!');
  }

  private onSnapshot(s: Snapshot): void {
    this.lastSnapshotPerf = performance.now();
    for (const m of s.machines) this.machineViews.push(s.serverTime, m);
    if (this.ownMachineSnapshot(s)) {
      // seated (or a predicted exit not yet applied): the worker pose comes from the seat
    } else if (this.snapNext) {
      this.predictor.snapTo(s.own, s.ackSeq);
      this.snapNext = false;
    } else {
      this.predictor.state.carrying = s.own.carrying;
      this.predictor.reconcile(s.ackSeq, s.own, this.blockers);
    }
    for (const e of s.entities) {
      let b = this.remotes.get(e.netId);
      if (!b) {
        b = new EntityBuffer();
        this.remotes.set(e.netId, b);
      }
      b.push(s.serverTime, e);
    }
  }

  // ---------------------------------------------------------------- machines (feature 003)

  /** Handles the own-machine block. Returns true when the worker state must not be reconciled. */
  private ownMachineSnapshot(s: Snapshot): boolean {
    const om = s.ownMachine;
    if (this.machinePred) {
      if (om && om.id === this.seatedId) {
        this.machinePred.reconcile(s.ackSeq, this.ownToState(om));
        return true;
      }
      // the server put us out (idle, crew change, disconnect, shift reset) or seated us elsewhere
      this.leaveMachineMode();
      if (om) {
        this.enterMachineMode(om);
        return true;
      }
      this.predictor.snapTo(s.own);
      this.snapNext = false;
      return true;
    }
    if (this.pendingExitSeq >= 0) {
      if (seqDiff(s.ackSeq, this.pendingExitSeq) < 0) return true; // the server has not reached our exit yet
      this.pendingExitSeq = -1;
      if (!om) return false;
    }
    if (om) {
      this.enterMachineMode(om);
      return true;
    }
    return false;
  }

  /** Machine state from the own block; loads come from the code plus the schema (pallet types, mixer bags). */
  ownToState(om: OwnMachine): MachineState {
    const plot = this.conn.state.plots[plotOfMachine(om.id)];
    const kind = kindOfMachine(om.id);
    let load: MachineLoad = { kind: 'none' };
    if (kind === 'mixer') load = { kind: 'bags', count: plot?.mixerBags ?? 0 };
    else if (om.loadCode === LOAD_DIRT) load = { kind: 'dirt' };
    else if (om.loadCode === LOAD_PALLET) load = { kind: 'pallet', pieces: Array.from(plot?.palletTypes ?? []).filter(isPieceTypeId) };
    else if (om.loadCode > 0) {
      const piece = carryFromCode(om.loadCode);
      if (piece) load = { kind: 'hook', piece };
    }
    return { id: om.id, kind, x: om.x, z: om.z, yaw: om.yaw, p1: om.p1, p2: om.p2, p3: om.p3, phase: om.phase, phaseT: om.phaseT, load };
  }

  machineCtxFor(plot: number): MachineCtx {
    return machineCtx(SITE, plot, this.blockers, this.conn.state.plots[plot]?.completedStages ?? 0);
  }

  private enterMachineMode(om: OwnMachine): void {
    const state = this.ownToState(om);
    const plot = plotOfMachine(om.id);
    this.machinePred = new MachinePredictor(state, this.stream, () => this.machineCtxFor(plot));
    this.machinePred.snapTo(state);
    this.predictor.clearHistory();
    this.seatedId = om.id;
    this.enteringUntil = 0;
    this.actTimes.length = 0;
    this.machineCams.enter(state.kind);
    this.emit('machineEntered', state.kind);
  }

  private leaveMachineMode(): void {
    if (!this.machinePred) return;
    const kind = this.machinePred.state.kind;
    this.machinePred = null;
    this.seatedId = -1;
    this.machineCams.exit();
    this.emit('machineLeft', kind);
  }

  /** Jump in a machine: predicted get-out at this exact input step (the server applies the same step). */
  private exitMachine(): void {
    const mp = this.machinePred;
    if (!mp) return;
    const ctx = mp.context;
    const st = mp.state;
    this.pendingExitSeq = mp.exitInput();
    const e = exitSpot(st, ctx);
    this.leaveMachineMode();
    this.predictor.snapTo({ ...initialWorker({ x: e.x, y: 0, z: e.z }, e.yaw), carrying: null });
    this.camera.yaw = e.yaw + Math.PI;
    this.exitFallbackAt = performance.now() + 600;
  }

  /** Action presses beyond 4 per second are dropped (the server ignores them too). */
  private actOk(now: number): boolean {
    while (this.actTimes.length && (this.actTimes[0] as number) < now - 1000) this.actTimes.shift();
    if (this.actTimes.length >= MACHINE.actPerSecond) return false;
    this.actTimes.push(now);
    return true;
  }

  /** The own machine as rendered: interpolated between steps, with the correction offset. */
  private ownMachinePose(out: MachineViewPose): MachineViewPose {
    const p = this.machinePred as MachinePredictor;
    const k = p.alpha;
    const a = p.prev;
    const b = p.state;
    out.id = b.id;
    out.kind = b.kind;
    out.x = a.x + (b.x - a.x) * k + p.offset.x;
    out.z = a.z + (b.z - a.z) * k + p.offset.z;
    out.yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * k;
    out.p1 = b.kind === 'forklift' ? a.p1 + (b.p1 - a.p1) * k : a.p1 + wrapAngle(b.p1 - a.p1) * k;
    out.p2 = a.p2 + (b.p2 - a.p2) * k;
    out.p3 = a.p3 + (b.p3 - a.p3) * k;
    out.phase = b.phase;
    out.operator = true;
    out.loadCode = 0;
    return out;
  }

  /** Samples every machine for this frame into `machinePoses` and draws them. */
  private drawMachines(serverNow: number): void {
    const st = this.conn.state;
    const draws = this.machineDraws;
    draws.length = 0;
    for (let id = 0; id < MACHINE_COUNT; id++) {
      const pose = this.machinePoses[id] as MachineViewPose;
      if (id === this.seatedId && this.machinePred) this.ownMachinePose(pose);
      else this.machineViews.sample(id, serverNow, this.ownPos.x, this.ownPos.z, pose);
      const plot = plotOfMachine(id);
      const pv = st.plots[plot];
      const hookType = pv?.hookType ?? '';
      draws.push({
        pose, spots: SITE.machines[plot]!,
        hook: pose.kind === 'crane' && isPieceTypeId(hookType) ? hookType : null,
        pallet: pose.kind === 'forklift' && pv ? (Array.from(pv.palletTypes).filter(isPieceTypeId) as PieceTypeId[]) : [],
      });
    }
    const r = this.pieceRenderer;
    this.machines.draw(draws, this.ctx.camera.position, (t, m) => r.add(t, m), (t) => r.halfHeight.get(t) ?? 0.15);
  }

  /** Seat of a machine as currently drawn (remote operators sit in the interpolated machine). */
  seatOf(id: number): { x: number; y: number; z: number; yaw: number } | null {
    const pose = this.machinePoses[id];
    if (!pose) return null;
    return seatPose({ ...pose, phase: 'idle', phaseT: 0, load: { kind: 'none' } }, SITE.machines[plotOfMachine(id)]!);
  }

  get myMachineKind(): MachineKind | null {
    return this.machinePred?.state.kind ?? null;
  }

  private onClosed(code: number): void {
    if (this.reconnecting) return;
    if (code === CLOSE.protocol) {
      this.modal = showModal(this.hudRoot, 'A new version is ready', 'Tap to reload and keep building.', 'Reload', () => location.reload());
      return;
    }
    if (code === CLOSE.idle) {
      this.modal = showModal(this.hudRoot, 'Taking a break?', 'You were away for a while, so we saved your spot for someone else.', 'Tap to rejoin', () => void this.reconnect(true));
      return;
    }
    if (code === CLOSE.strikes) {
      this.modal = showModal(this.hudRoot, 'Disconnected', 'Too many actions too fast. You can rejoin in a moment.', 'Rejoin (30)', () => void this.reconnect(true));
      this.modal.setAction('Rejoin (30)', false);
      let left = 30;
      const t = window.setInterval(() => {
        left--;
        this.modal?.setAction(left > 0 ? `Rejoin (${left})` : 'Rejoin', left <= 0);
        if (left <= 0) window.clearInterval(t);
      }, 1000);
      return;
    }
    // world closing (4004), server restart (4005) or a drop the SDK could not recover: rejoin quietly
    void this.reconnect(false);
  }

  /** Matchmake again (lastWorld) with backoff 1, 2, 4, 8 s, then every 5 s; never reloads the page. */
  async reconnect(manual: boolean): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.modal?.close();
    this.modal = null;
    this.hud.setPrompt(null);
    this.hud.showToast('Reconnecting…', 30);
    const delays = manual ? [0, 1000, 2000, 4000, 8000] : [1000, 2000, 4000, 8000];
    for (let attempt = 0; ; attempt++) {
      await new Promise((r) => setTimeout(r, delays[attempt] ?? 5000));
      try {
        const mm = await matchmake(this.profile.get(), this.profile.get().lastWorld, 6000);
        const conn = new NetConnection(mm);
        await conn.connect(mm);
        this.remotes.clear();
        this.machineViews.clear();
        this.leaveMachineMode();
        this.pendingExitSeq = -1;
        this.attach(conn);
        this.reconnecting = false;
        this.hud.showToast(mm.redirected ? 'That site is full — you’ve been sent to a nearby one' : 'Back on site!', 2.5);
        return;
      } catch (e) {
        console.warn('[net] reconnect attempt failed', e);
      }
    }
  }

  private invite(): void {
    const url = `${location.origin}${location.pathname}?w=${this.conn.worldId}`;
    const done = (): void => this.hud.showToast('Link copied!');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => this.hud.showToast(url, 6));
    else this.hud.showToast(url, 6);
  }

  /** Tower blockers in plot order — identical on client and server (prediction must match). */
  private refreshBlockers(): void {
    const plots = this.conn.state.plots;
    let key = '';
    for (let i = 0; i < plots.length; i++) key += (plots[i] as { completedStages: number }).completedStages >= 1 ? '1' : '0';
    if (key === this.blockerKey) return;
    this.blockerKey = key;
    this.blockers = SITE.plots.filter((p) => key[p.index] === '1').map(towerBlocker);
  }

  // ---------------------------------------------------------------- loop

  override pause(): void {
    super.pause();
    this.actions.releaseAll();
  }

  protected override onFps(text: string): void {
    this.hud.setFps(text);
  }

  /** Hook for later stories (pieces, plots, UI panels). Return true to swallow the action button. */
  protected onAction(_held: boolean): boolean {
    return false;
  }

  /** Hook (feature 003): per-frame machine UI while seated (labels, hints). */
  protected onMachine(_dt: number, _blocked: boolean): void {}

  protected step(dt: number, now: number): void {
    const a = this.actions;
    pollGamepad(a);
    if (this.conn.closedCode !== null && !this.reconnecting) {
      a.endFrame();
      return;
    }
    if (a.wasPressed('menu')) this.hud.setMenu(!this.hud.menuOpen);
    const blocked = this.hud.menuOpen || this.uiCapturesInput();
    this.refreshBlockers();
    this.camera.orbit(a.look.x, a.look.y);
    this.camera.basis(this.fwd, this.right);
    let dx = 0;
    let dz = 0;
    const mp = this.machinePred;
    if (mp) {
      // in a machine the same inputs are re-mapped (contracts/controls.md): move drives, action acts,
      // jump gets out, toss switches the crane camera
      if (!blocked && a.wasPressed('jump')) this.exitMachine();
      else {
        const act = !blocked && a.wasPressed('action') && this.actOk(now);
        const alt = !blocked && a.wasPressed('toss');
        if (alt) this.machineCams.toggle();
        mp.update(dt, blocked ? 0 : a.move.x, blocked ? 0 : a.move.y, act, alt);
        if (act) this.emit('machineAct');
      }
    } else {
      const entering = this.enteringUntil > now;
      if (!blocked && !entering) {
        dx = this.fwd.x * a.move.y + this.right.x * a.move.x;
        dz = this.fwd.z * a.move.y + this.right.z * a.move.x;
        if (a.wasPressed('jump')) this.predictor.requestJump();
      }
      const before = this.predictor.state.grounded;
      this.predictor.update(dt, dx, dz, !blocked && !entering && a.run, this.blockers);
      if (before && !this.predictor.state.grounded && this.predictor.state.vy > 3) {
        this.worker.jumped();
        this.sfx.play('jump');
      }
    }
    // reliable fallback for the in-stream exit (sent only if the server still has us seated)
    if (this.exitFallbackAt && performance.now() > this.exitFallbackAt) {
      this.exitFallbackAt = 0;
      if ((this.conn.state.players.get(this.me)?.machine ?? -1) >= 0 && !this.machinePred) this.conn.send('machine', { op: 'exit' });
    }
    this.sendAcc += dt;
    if (this.sendAcc >= NET.tickMs / 1000) {
      this.sendAcc = 0;
      for (const b of this.stream.takeBatches()) this.conn.sendInputs(b);
    }
    // respawn: hold R 0.5 s
    this.respawnHeld = !blocked && a.isHeld('respawn') ? this.respawnHeld + dt : 0;
    if (this.respawnHeld >= 0.5) {
      this.respawnHeld = 0;
      this.conn.send('respawn', {});
    }
    if (!blocked && !this.machinePred) this.onAction(this.predictor.state.carrying !== null);
    if (this.machinePred) this.onMachine(dt, blocked);

    const serverNow = this.conn.clock.serverNow();
    // own worker visual (seated: in the predicted cab)
    const p = this.predictor;
    const k = p.alpha;
    let pose: WorkerPose;
    let hs = 0;
    let carry: PieceTypeId | null = null;
    if (this.machinePred) {
      const mpose = this.ownMachinePose(this.machinePoses[this.seatedId] as MachineViewPose);
      const seat = seatPose({ ...mpose, phase: 'idle', phaseT: 0, load: { kind: 'none' } }, SITE.machines[plotOfMachine(this.seatedId)]!);
      this.ownPos.set(seat.x, seat.y, seat.z);
      this.worker.root.rotation.y = seat.yaw;
      pose = 'seated';
    } else {
      this.ownPos.set(
        p.prev.x + (p.state.x - p.prev.x) * k + p.offset.x,
        p.prev.y + (p.state.y - p.prev.y) * k + p.offset.y,
        p.prev.z + (p.state.z - p.prev.z) * k + p.offset.z,
      );
      this.worker.root.rotation.y = p.state.facing;
      hs = Math.hypot(p.state.vx, p.state.vz);
      pose = this.ownPose(hs);
      carry = p.state.carrying;
    }
    this.worker.root.position.copy(this.ownPos);
    this.worker.update(dt, pose, hs, carry ? PIECE_TYPES[carry].carryPose : null);
    if (this.machinePred && this.machineCams.active) {
      const mpose = this.machinePoses[this.seatedId] as MachineViewPose;
      this.machineCams.update(dt, this.ctx.camera, mpose, SITE.machines[plotOfMachine(this.seatedId)]!, a.move);
    } else this.camera.update(dt, this.ownPos);
    this.followSun(this.ownPos);

    // remote workers
    const crowd = this.crowdEntries;
    crowd.length = 0;
    const labels = this.labelEntries;
    labels.length = 0;
    const camPos = this.ctx.camera.position;
    const st = this.conn.state;
    st.players.forEach((pl, pid) => {
      if (pid === this.me) {
        labels.push(this.label(pid, pl.name, pl.crewPlot, pl.crewRole === 'host', this.ownPos, 0, true, now));
        return;
      }
      if (pl.away || this.hidden.has(pid)) return;
      const buf = this.remotes.get(pl.netId);
      if (!buf || !buf.size) return;
      buf.updateDelay(dt * 1000);
      if (!buf.sample(serverNow, this.tmpPose)) return;
      const tp = this.tmpPose;
      // an operator sits in the machine as drawn this frame (no lag between the two)
      const seat = (pl.machine ?? -1) >= 0 ? this.seatOf(pl.machine) : null;
      if (seat) {
        tp.x = seat.x;
        tp.y = seat.y;
        tp.z = seat.z;
        tp.yaw = seat.yaw;
        tp.anim = ANIM.seated;
        tp.carry = null;
      }
      const d = Math.hypot(tp.x - camPos.x, tp.y - camPos.y, tp.z - camPos.z);
      crowd.push({
        key: pl.netId, x: tp.x, y: tp.y, z: tp.z, yaw: tp.yaw,
        pose: tp.anim === ANIM.emote ? this.emotePose(pid) : (POSE_OF_ANIM[tp.anim] ?? 'idle'),
        speed: tp.anim === ANIM.run ? 5.5 : tp.anim === ANIM.walk ? 3 : 0,
        carry: tp.carry, hatColor: HAT_COLORS[pl.hatColor as keyof typeof HAT_COLORS] ?? '#ffcc2e', distance: d,
      });
      labels.push(this.label(pid, pl.name, pl.crewPlot, pl.crewRole === 'host', this.tmpV3.set(tp.x, tp.y, tp.z), Math.hypot(tp.x - this.ownPos.x, tp.z - this.ownPos.z), false, now));
    });
    const r = this.pieceRenderer;
    r.begin();
    this.drawRacks();
    this.crowd.update(dt, crowd, (type, m) => r.add(type, m));
    this.drawMachines(serverNow);
    if (carry) {
      this.worker.root.updateMatrixWorld();
      r.add(carry, carryMatrixFor(carry, this.worker.root.matrixWorld, this.tmpM));
    }
    this.drawWorld(dt, now, serverNow);
    r.end();
    this.labels.update(this.ctx.camera, labels);
    this.afterStep(dt, now, serverNow);
    const shaky = this.conn.clock.rtt > 400 || (this.lastSnapshotPerf > 0 && performance.now() - this.lastSnapshotPerf > 500);
    let here = 0;
    st.players.forEach((pl) => {
      if (!pl.away) here++;
    });
    this.hud.setChip(here, this.conn.worldId, shaky);
    a.endFrame();
  }

  private readonly tmpV3 = new THREE.Vector3();

  /** True while a text box or dialog owns the keyboard (chat box, Foreman dialogue…). */
  protected uiCapturesInput(): boolean {
    return false;
  }

  /** Hook: extra world drawing (loose pieces, towers) inside the piece renderer batch. */
  protected drawWorld(_dt: number, _now: number, _serverNow: number): void {}

  /** Hook: per-frame UI updates after the world is drawn. */
  protected afterStep(_dt: number, _now: number, _serverNow: number): void {}

  protected ownPose(hs: number): WorkerPose {
    const s = this.predictor.state;
    return !s.grounded ? 'air' : hs > 4.2 ? 'run' : hs > 0.4 ? 'walk' : 'idle';
  }

  protected emotePose(_pid: string): CrowdPose {
    return 'wave';
  }

  private label(pid: string, name: string, crewPlot: number, host: boolean, pos: THREE.Vector3, distance: number, me: boolean, now: number): LabelEntry {
    const b = this.bubbles.get(pid);
    const showBubble = b && b.until > now && !this.muted.has(pid);
    return {
      key: pid, x: pos.x, y: pos.y, z: pos.z, name, flag: crewPlot, host,
      bubble: showBubble ? b.text : null, bubbleKind: b?.kind ?? 'say', me, distance,
    };
  }

  private drawRacks(): void {
    drawRackDisplays(this.pieceRenderer);
  }

  /** The 32 m shadow frustum follows the player across the 70 m site. */
  private followSun(focus: THREE.Vector3): void {
    const sun = this.ctx.sun;
    const off = sun.position.clone().sub(sun.target.position);
    sun.target.position.set(Math.round(focus.x), 0, Math.round(focus.z));
    sun.position.copy(sun.target.position).add(off);
    sun.target.updateMatrixWorld();
  }

  /** Own position (feet) as currently rendered. */
  get position(): THREE.Vector3 {
    return this.ownPos;
  }

  pieceLabel(type: PieceTypeId): string {
    return PIECE_TYPES[type].label;
  }
}
