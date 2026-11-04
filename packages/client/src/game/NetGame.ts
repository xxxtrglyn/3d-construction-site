import * as THREE from 'three';
import {
  ANIM, CLOSE, HAT_COLORS, NET, PIECE_TYPES, SITE, initialWorker, towerBlocker,
  type ObstacleBox, type PieceTypeId, type ServerEvents, type Snapshot,
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
import { Predictor } from '../net/prediction.ts';
import { FollowCamera } from '../player/followCamera.ts';
import { WorkerView, type WorkerPose } from '../player/workerView.ts';
import type { ProfileStore } from '../profile/guestProfile.ts';
import { Bloom } from '../render/bloom.ts';
import { configureOutlines } from '../render/outline.ts';
import type { QualitySettings } from '../render/quality.ts';
import type { RenderContext } from '../render/renderer.ts';
import { NetHud } from '../ui/netHud.ts';
import { showModal, type ModalHandle } from '../ui/screens.ts';
import { RACK_DISPLAY } from '../world/layout.ts';
import { PieceRenderer } from '../world/pieceRenderer.ts';
import { SiteView } from '../world/site.ts';
import { GameShell } from './GameShell.ts';

const POSE_OF_ANIM: Record<number, CrowdPose> = { 0: 'idle', 1: 'walk', 2: 'run', 3: 'air', 4: 'cheer', 5: 'wave' };

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
  predictor: Predictor;
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
    this.predictor = new Predictor(initialWorker(SITE.spawn), SITE);
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
    this.crowd = new CrowdRenderer(this.assets.get('worker') as THREE.Object3D, 128, this.quality.outlines ? this.quality.outlineDistance : 0);
    scene.add(this.crowd.group);
    this.pieceRenderer = new PieceRenderer(this.assets.get('pieces') as THREE.Group, 360);
    setCarryHalfHeights(this.pieceRenderer.halfHeight);
    scene.add(this.pieceRenderer.group);
    this.camera = new FollowCamera(camera);
    this.camera.yaw = 0;
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
    }, prof.muted, prof.hideAllChat);
    this.sfx.setMuted(prof.muted);
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
    if (this.snapNext) {
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
    if (!blocked) {
      dx = this.fwd.x * a.move.y + this.right.x * a.move.x;
      dz = this.fwd.z * a.move.y + this.right.z * a.move.x;
      if (a.wasPressed('jump')) this.predictor.requestJump();
    }
    const before = this.predictor.state.grounded;
    this.predictor.update(dt, dx, dz, !blocked && a.run, this.blockers);
    if (before && !this.predictor.state.grounded && this.predictor.state.vy > 3) {
      this.worker.jumped();
      this.sfx.play('jump');
    }
    this.sendAcc += dt;
    if (this.sendAcc >= NET.tickMs / 1000) {
      this.sendAcc = 0;
      for (const b of this.predictor.takeBatches()) this.conn.sendInputs(b);
    }
    // respawn: hold R 0.5 s
    this.respawnHeld = !blocked && a.isHeld('respawn') ? this.respawnHeld + dt : 0;
    if (this.respawnHeld >= 0.5) {
      this.respawnHeld = 0;
      this.conn.send('respawn', {});
    }
    if (!blocked) this.onAction(this.predictor.state.carrying !== null);

    // own worker visual
    const p = this.predictor;
    const k = p.alpha;
    this.ownPos.set(
      p.prev.x + (p.state.x - p.prev.x) * k + p.offset.x,
      p.prev.y + (p.state.y - p.prev.y) * k + p.offset.y,
      p.prev.z + (p.state.z - p.prev.z) * k + p.offset.z,
    );
    this.worker.root.position.copy(this.ownPos);
    this.worker.root.rotation.y = p.state.facing;
    const hs = Math.hypot(p.state.vx, p.state.vz);
    const pose: WorkerPose = this.ownPose(hs);
    const carry = p.state.carrying;
    this.worker.update(dt, pose, hs, carry ? PIECE_TYPES[carry].carryPose : null);
    this.camera.update(dt, this.ownPos);
    this.followSun(this.ownPos);

    // remote workers
    const serverNow = this.conn.clock.serverNow();
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
    const r = this.pieceRenderer;
    const m = this.tmpM;
    const q = this.tmpQ;
    const s = this.tmpS.set(1, 1, 1);
    for (const rack of this.site.racks) {
      const type = rack.def.type;
      const n = RACK_DISPLAY[type];
      const hh = r.halfHeight.get(type) ?? 0.15;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rack.def.yaw);
      for (let i = 0; i < n; i++) {
        const local = type === 'cone'
          ? new THREE.Vector3(Math.cos(i * 1.3) * 0.35 * (i ? 1 : 0), hh, Math.sin(i * 1.3) * 0.35 * (i ? 1 : 0))
          : type === 'beam'
            ? new THREE.Vector3(0, hh + i * hh * 2.05, (i % 2) * 0.05)
            : new THREE.Vector3(i % 2 === 0 ? -0.33 : 0.33, hh + Math.floor(i / 2) * hh * 2.05, 0);
        local.applyQuaternion(q).add(rack.top);
        m.compose(local, q, s);
        r.add(type, m);
      }
    }
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
