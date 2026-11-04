import * as THREE from 'three';
import {
  CLOCK_TOWER, PIECE_TYPES, SITE, arcPosition, currentStage, isPieceTypeId, starsOf,
  type PieceTypeId, type PlotDef, type ServerEvents,
} from '@hht/shared';
import type { AssetStore } from '../assets/loader.ts';
import type { Sfx } from '../audio/sfx.ts';
import { Celebration } from '../fx/celebration.ts';
import { Puffs } from '../fx/puff.ts';
import type { PieceView, PlotView, WorldView } from '../net/connection.ts';
import { flagHtml } from '../ui/flags.ts';
import { escapeHtml } from '../crowd/labels.ts';
import type { PieceRenderer } from '../world/pieceRenderer.ts';

const ON_Y = THREE.Object3D.DEFAULT_UP;
/** LOD0 (merged) towers: at most this many, within this distance (research R7). */
const NEAR_TOWERS = 2;
const NEAR_DIST = 30;
const LABEL_DIST = 32;

/** One plot's tower: stage-0 foundation, merged LOD0 when near, single-mesh LOD1 otherwise. */
class TowerSlot {
  readonly group = new THREE.Group();
  private shownKey = '';
  private obj: THREE.Object3D | null = null;
  readonly def: PlotDef;

  constructor(def: PlotDef) {
    this.def = def;
    this.group.position.set(def.x, 0, def.z);
    this.group.rotation.y = def.yaw;
    this.group.name = `Plot_${def.index}`;
  }

  /** `stage` = completed stages (0..6) or -1 for a free plot. */
  set(assets: AssetStore, stage: number, near: boolean): void {
    let id: string | null = null;
    if (stage === 0) id = 'clock-tower-stage-0';
    else if (stage > 0) {
      const merged = `clock-tower-stage-${stage}-merged`;
      const lod1 = `clock-tower-lod1-${stage}`;
      if (near) {
        if (assets.get(merged)) id = merged;
        else {
          void assets.load(merged).catch(() => undefined);
          id = assets.get(lod1) ? lod1 : null;
        }
      } else id = assets.get(lod1) ? lod1 : null;
      if (!id && assets.get(`clock-tower-stage-${stage}`)) id = `clock-tower-stage-${stage}`;
    }
    const key = id ?? '';
    if (key === this.shownKey) return;
    if (id && !assets.get(id)) return; // keep the previous model until the new one has loaded
    if (this.obj) this.group.remove(this.obj);
    this.obj = null;
    this.shownKey = key;
    if (id) {
      const src = assets.get(id) as THREE.Object3D;
      this.obj = src.clone(true); // shares geometry and materials across plots
      this.group.add(this.obj);
    }
  }
}

interface PlotLabel {
  el: HTMLDivElement;
  html: string;
}

/**
 * The shared world of buildings: 12 tower slots with LODs, plot signs and supply bins, the Foreman,
 * loose and flying pieces, bin contents, and plot effects (snap puffs, stage sparkles, Masterpiece).
 */
export class NetWorld {
  readonly group = new THREE.Group();
  private readonly towers: TowerSlot[];
  private readonly labels: PlotLabel[] = [];
  private readonly puffs = new Puffs();
  private readonly celebrations: Celebration[];
  private readonly celebratingPlot: number[] = [];
  private foreman: THREE.Object3D | null = null;
  private foremanParts: Record<string, THREE.Object3D> = {};
  private t = 0;
  private readonly v = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly tmp = new THREE.Vector3();
  private readonly assets: AssetStore;
  private readonly hudRoot: HTMLElement;
  private readonly sfx: Sfx;
  binTop = 0.16;

  constructor(assets: AssetStore, hudRoot: HTMLElement, sfx: Sfx, particles: number) {
    this.assets = assets;
    this.hudRoot = hudRoot;
    this.sfx = sfx;
    this.group.name = 'NetWorld';
    this.towers = SITE.plots.map((d) => new TowerSlot(d));
    for (const t of this.towers) this.group.add(t.group);
    this.celebrations = [new Celebration(particles), new Celebration(particles)];
    for (const c of this.celebrations) {
      c.onBurst = () => this.sfx.play('firework');
      this.group.add(c.group);
      this.celebratingPlot.push(-1);
    }
    this.group.add(this.puffs.mesh);
    assets.onLoaded((id) => {
      if (id === 'fx') {
        const puff = assets.get('fx')?.getObjectByName('Fx_puff');
        const mesh = puff?.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
        if (mesh) this.puffs.setGeometry(mesh.geometry);
      }
    });
    this.placeProps();
    for (let i = 0; i < SITE.plots.length; i++) {
      const el = document.createElement('div');
      el.className = 'lbl plotlbl';
      el.style.display = 'none';
      el.dataset.plot = String(i);
      hudRoot.appendChild(el);
      this.labels.push({ el, html: '' });
    }
  }

  private placeProps(): void {
    const props = this.assets.get('props-mp');
    const sign = props?.getObjectByName('PlotSign');
    const bin = props?.getObjectByName('SupplyBin');
    const binTop = props?.getObjectByName('SupplyBin_Top');
    if (binTop) this.binTop = binTop.position.y;
    for (const d of SITE.plots) {
      if (sign) {
        const s = sign.clone(true);
        s.position.set(d.sign.x, 0, d.sign.z);
        s.rotation.set(0, d.yaw, 0);
        this.group.add(s);
      }
      if (bin) {
        const b = bin.clone(true);
        b.position.set(d.bin.x, 0, d.bin.z);
        b.rotation.set(0, d.yaw, 0);
        this.group.add(b);
      }
    }
    const fa = this.assets.get('foreman');
    if (fa) {
      this.foreman = fa.clone(true);
      this.foreman.position.set(SITE.foreman.x, 0, SITE.foreman.z);
      this.foreman.rotation.y = SITE.foreman.yaw;
      for (const n of ['Head', 'Arm_L', 'Arm_R', 'Body']) {
        const o = this.foreman.getObjectByName(n);
        if (o) {
          o.userData.rest = o.position.clone();
          this.foremanParts[n] = o;
        }
      }
      this.group.add(this.foreman);
    }
  }

  /** Per-frame: tower LODs, Foreman idle, labels, effects. */
  update(dt: number, state: WorldView, me: THREE.Vector3, camera: THREE.Camera, myPlot: number, talking: boolean): void {
    this.t += dt;
    const plots = state.plots;
    const order = this.towers
      .map((t) => ({ t, d: Math.hypot(t.def.x - me.x, t.def.z - me.z) }))
      .sort((a, b) => a.d - b.d);
    const near = new Set(order.filter((o) => o.d <= NEAR_DIST).slice(0, NEAR_TOWERS).map((o) => o.t.def.index));
    for (const { t } of order) {
      const p = plots[t.def.index];
      t.set(this.assets, p && p.state !== 'free' ? p.completedStages : -1, near.has(t.def.index));
    }
    this.animateForeman(me, talking);
    this.puffs.update(dt);
    for (const c of this.celebrations) c.update(dt);
    this.updateLabels(state, me, camera, myPlot);
  }

  private animateForeman(me: THREE.Vector3, talking: boolean): void {
    if (!this.foreman) return;
    const d = Math.hypot(me.x - SITE.foreman.x, me.z - SITE.foreman.z);
    const head = this.foremanParts.Head;
    const armR = this.foremanParts.Arm_R;
    if (head) {
      const rest = head.userData.rest as THREE.Vector3;
      head.position.y = rest.y + (talking ? Math.abs(Math.sin(this.t * 9)) * 0.04 : Math.sin(this.t * 2) * 0.012);
      // look at the player when near
      head.rotation.y = d < 8 ? THREE.MathUtils.clamp(Math.atan2(me.x - SITE.foreman.x, me.z - SITE.foreman.z) - SITE.foreman.yaw, -0.7, 0.7) : 0;
    }
    if (armR) armR.rotation.x = d < 6 ? -2.6 + Math.sin(this.t * 8) * 0.35 : -0.1 + Math.sin(this.t * 1.5) * 0.05;
  }

  private updateLabels(state: WorldView, me: THREE.Vector3, camera: THREE.Camera, myPlot: number): void {
    const w = this.hudRoot.clientWidth || window.innerWidth;
    const h = this.hudRoot.clientHeight || window.innerHeight;
    for (const d of SITE.plots) {
      const lab = this.labels[d.index] as PlotLabel;
      const p = state.plots[d.index];
      const dist = Math.hypot(d.sign.x - me.x, d.sign.z - me.z);
      if (!p || dist > LABEL_DIST) {
        if (lab.el.style.display !== 'none') lab.el.style.display = 'none';
        continue;
      }
      this.v.set(d.sign.x, 2.35, d.sign.z).project(camera);
      if (this.v.z >= 1 || this.v.z <= -1) {
        lab.el.style.display = 'none';
        continue;
      }
      lab.el.style.display = '';
      lab.el.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px) translate(-50%, -100%)`;
      const html = plotLabelHtml(d.index, p, d.index === myPlot);
      if (html !== lab.html) {
        lab.el.innerHTML = html;
        lab.html = html;
      }
    }
  }

  /** Loose and flying pieces, plus bin contents, into the piece renderer batch. */
  drawPieces(r: PieceRenderer, state: WorldView, serverNow: number): void {
    state.pieces.forEach((p: PieceView) => {
      if (!isPieceTypeId(p.type)) return;
      const type = p.type;
      const hh = r.halfHeight.get(type) ?? 0.15;
      if (p.state === 'flying') {
        const pos = arcPosition({ ox: p.ox, oy: p.oy, oz: p.oz, vx: p.vx, vy: p.vy, vz: p.vz, t0: p.t0, landAt: p.landAt, lx: p.x, lz: p.z }, serverNow);
        const spin = (serverNow - p.t0) / 140;
        this.q.setFromEuler(new THREE.Euler(spin, spin * 0.6, 0));
        this.m.compose(this.v.set(pos.x, pos.y + hh, pos.z), this.q, this.s);
      } else {
        this.q.setFromAxisAngle(ON_Y, (p.x * 7.13 + p.z * 3.7) % (Math.PI * 2));
        this.m.compose(this.v.set(p.x, hh, p.z), this.q, this.s);
      }
      r.add(type, this.m);
    });
    // bin contents (stacked inside each supply bin)
    for (const d of SITE.plots) {
      const p = state.plots[d.index];
      if (!p || !p.bin.length) continue;
      const bin = Array.from(p.bin);
      for (let i = 0; i < bin.length; i++) {
        const t = bin[i];
        if (!t || !isPieceTypeId(t)) continue;
        const hh = r.halfHeight.get(t) ?? 0.15;
        const col = i % 2;
        const row = Math.floor(i / 2);
        this.tmp.set((col - 0.5) * 0.36, this.binTop + hh * 0.7 + Math.floor(row / 2) * hh * 1.4, ((row % 2) - 0.5) * 0.36);
        this.tmp.applyAxisAngle(ON_Y, d.yaw).add(this.v.set(d.bin.x, 0, d.bin.z));
        this.q.setFromAxisAngle(ON_Y, d.yaw + i * 0.4);
        this.s.setScalar(0.7);
        this.m.compose(this.tmp, this.q, this.s);
        r.add(t, this.m);
        this.s.setScalar(1);
      }
    }
  }

  // ---------------------------------------------------------------- events → effects

  onSnap(e: ServerEvents['snap'], near: boolean): void {
    const d = SITE.plots[e.plot];
    if (!d) return;
    const at = new THREE.Vector3(d.x, 0.8, d.z);
    if (e.result === 'snapped') {
      this.puffs.emit(at.setY(0.6 + Math.random() * 2), 7, 0.6, 0.35);
      if (near) this.sfx.play('snap');
    } else {
      for (let i = 0; i < 6; i++) this.puffs.emit(new THREE.Vector3(d.x + Math.cos(i) * 1.6, 0.4 + i * 0.6, d.z + Math.sin(i) * 1.6), 6, 0.9, 0.6);
      if (near) this.sfx.play(e.result === 'masterpiece' ? 'bell' : 'stage');
    }
  }

  onCelebrate(e: ServerEvents['celebrate'], serverNow: number): void {
    const d = SITE.plots[e.plot];
    if (!d) return;
    let i = this.celebratingPlot.indexOf(e.plot);
    if (i < 0) i = this.celebrations.findIndex((c) => !c.playing);
    if (i < 0) i = 0;
    this.celebratingPlot[i] = e.plot;
    (this.celebrations[i] as Celebration).start(new THREE.Vector3(d.x, 0, d.z), Math.max(2, (e.until - serverNow) / 1000));
  }

  puffAt(p: THREE.Vector3, n = 6): void {
    this.puffs.emit(p, n, 0.5, 0.35);
  }
}

const PIECE_DOT: Record<string, string> = { beam: '#eb5a3d', brick: '#d9614a', panel: '#38a8b3', paint: '#9e73e6', decor: '#ff8cb8', bell: '#ffc74d' };

function plotLabelHtml(i: number, p: PlotView, mine: boolean): string {
  if (p.state === 'free') return `<div class="tag">Free plot · talk to the Foreman</div>`;
  const progress = { blueprintId: CLOCK_TOWER.id, completedStages: p.completedStages, filledSlots: p.filledSlots };
  const stars = starsOf(progress);
  const starStr = `<span class="stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span>`;
  const host = escapeHtml(p.hostName);
  if (p.state === 'finished') return `<div class="tag">${flagHtml(i, 16)} ★ Masterpiece · built by ${host}’s crew</div>`;
  if (p.state === 'unattended') return `<div class="tag">${flagHtml(i, 16)} Unfinished tower ${starStr} · adopt it at the Foreman</div>`;
  const stage = currentStage(progress);
  const need = stage ? `<span class="dot" style="background:${PIECE_DOT[stage.pieceType] ?? '#ccc'}"></span>${PIECE_TYPES[stage.pieceType as PieceTypeId].label} ${p.filledSlots}/${stage.slotCount}` : '';
  const mode = p.joinMode === 'open' ? '🟢 Open' : p.joinMode === 'solo' ? '🔒 Solo' : '✋ Ask';
  return `<div class="tag${mine ? ' mine' : ''}">${flagHtml(i, 16)} 👑 ${host} ${starStr}</div><div class="tag sub">${need} · 👥 ${p.crewSize}/8 · ${mode}</div>`;
}
