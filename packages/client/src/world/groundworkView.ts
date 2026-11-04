import * as THREE from 'three';
import { CLOCK_TOWER, MACHINE, type MachineSpots, type PlotDef } from '@hht/shared';
import { toonVcolMaterial } from '../render/toonMaterial.ts';

/** What the view needs per plot (schema fields). */
export interface GroundworkState {
  active: boolean;
  groundDug: number;
  groundPoured: number;
  mixerBags: number;
  mixerMixUntil: number;
}

const DIRT = new THREE.Color().setRGB(0.86, 0.68, 0.46, THREE.SRGBColorSpace);
const DEEP = new THREE.Color().setRGB(0.36, 0.24, 0.16, THREE.SRGBColorSpace);
const MOUND = new THREE.Color().setRGB(0.66, 0.46, 0.3, THREE.SRGBColorSpace);
const CONCRETE = new THREE.Color().setRGB(0.72, 0.71, 0.69, THREE.SRGBColorSpace);

function whiteVcol(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

/**
 * Groundwork on every plot (FR-017): the pit gets visibly deeper with each scoop (one darker terrace
 * per scoop, 6 steps), the spoil heap grows, the footing fills by quadrants as concrete is poured, and
 * a bag counter floats over the crew's mixer. Instanced: 3 draw calls for all 12 plots.
 */
export class GroundworkView {
  readonly group = new THREE.Group();
  private readonly terraces: THREE.InstancedMesh;
  private readonly heaps: THREE.InstancedMesh;
  private readonly footing: THREE.InstancedMesh;
  private readonly labels: HTMLDivElement[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(private readonly plots: ReadonlyArray<{ def: PlotDef; spots: MachineSpots }>, private readonly hudRoot: HTMLElement | null) {
    this.group.name = 'Groundwork';
    const n = plots.length;
    const mat = toonVcolMaterial();
    this.terraces = new THREE.InstancedMesh(whiteVcol(new THREE.BoxGeometry(2, 0.02, 2)), mat, n * CLOCK_TOWER.groundwork.scoops);
    const heapGeo = whiteVcol(new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2));
    this.heaps = new THREE.InstancedMesh(heapGeo, mat, n);
    this.footing = new THREE.InstancedMesh(whiteVcol(new THREE.BoxGeometry(1, 0.1, 1)), mat, n * CLOCK_TOWER.groundwork.concrete);
    for (const im of [this.terraces, this.heaps, this.footing]) {
      im.count = 0;
      im.frustumCulled = false;
      im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
    }
    this.heaps.castShadow = true;
    if (hudRoot) {
      for (let i = 0; i < n; i++) {
        const el = document.createElement('div');
        el.className = 'lbl machine-bags';
        el.style.display = 'none';
        el.dataset.mixerPlot = String(i);
        hudRoot.appendChild(el);
        this.labels.push(el);
      }
    }
  }

  /** Per frame: `states[i]` for plot i; labels only for plots within 25 m of `me`. */
  update(states: ReadonlyArray<GroundworkState | null>, serverNow: number, camera: THREE.Camera | null, me: THREE.Vector3): void {
    let t = 0;
    let h = 0;
    let f = 0;
    const scoops = CLOCK_TOWER.groundwork.scoops;
    this.plots.forEach(({ def, spots }, i) => {
      const st = states[i];
      if (st?.active) {
        const yaw = Math.atan2(def.s, def.c); // plot yaw in three.js (rotation about +Y)
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
        for (let k = 0; k < st.groundDug; k++) {
          const half = spots.pit.half * (1 - 0.13 * k);
          this.m.compose(this.v.set(def.x, 0.011 + 0.002 * k, def.z), this.q, this.s.set(half, 1, half));
          this.terraces.setMatrixAt(t, this.m);
          this.terraces.setColorAt(t, this.c.copy(DIRT).lerp(DEEP, (k + 1) / scoops));
          t++;
        }
        for (let k = 0; k < st.groundPoured; k++) {
          const lx = k % 2 === 0 ? -0.6 : 0.6;
          const lz = k < 2 ? -0.6 : 0.6;
          this.m.compose(this.v.set(def.x + def.c * lx + def.s * lz, 0.04, def.z - def.s * lx + def.c * lz), this.q, this.s.set(1.15, 1, 1.15));
          this.footing.setMatrixAt(f, this.m);
          this.footing.setColorAt(f, CONCRETE);
          f++;
        }
      }
      // the spoil heap stays until the shift resets
      const dug = st ? st.groundDug : 0;
      if (dug > 0) {
        const r = spots.spoil.radius * (0.55 + 0.45 * (dug / scoops));
        this.m.compose(this.v.set(spots.spoil.x, 0, spots.spoil.z), this.q.identity(), this.s.set(r, 0.25 + 0.6 * (dug / scoops), r));
        this.heaps.setMatrixAt(h, this.m);
        this.heaps.setColorAt(h, MOUND);
        h++;
      }
      this.updateLabel(i, spots, st ?? null, serverNow, camera, me);
    });
    for (const [im, n] of [[this.terraces, t], [this.heaps, h], [this.footing, f]] as const) {
      im.count = n;
      im.visible = n > 0;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  private updateLabel(i: number, spots: MachineSpots, st: GroundworkState | null, serverNow: number, camera: THREE.Camera | null, me: THREE.Vector3): void {
    const el = this.labels[i];
    if (!el || !camera) return;
    const show = !!st?.active && (st.mixerBags > 0 || st.mixerMixUntil > serverNow) && Math.hypot(spots.mixer.x - me.x, spots.mixer.z - me.z) < 25;
    if (!show || !st) {
      if (el.style.display !== 'none') el.style.display = 'none';
      return;
    }
    this.v.set(spots.mixer.x, 2.6, spots.mixer.z).project(camera);
    if (this.v.z >= 1) {
      el.style.display = 'none';
      return;
    }
    const w = this.hudRoot?.clientWidth || window.innerWidth;
    const hh = this.hudRoot?.clientHeight || window.innerHeight;
    el.style.display = '';
    el.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * hh}px) translate(-50%, -100%)`;
    const mixing = st.mixerMixUntil > serverNow;
    const text = mixing ? `🌀 Mixing… ${Math.ceil((st.mixerMixUntil - serverNow) / 1000)}s` : `🧱 ${st.mixerBags}/${MACHINE.mixer.capacity} bags`;
    if (el.textContent !== text) el.textContent = text;
  }
}
