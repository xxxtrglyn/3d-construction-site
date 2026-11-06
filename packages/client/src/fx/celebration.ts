import { reducedMotion } from '../game/gameplayFeedback.ts';
import * as THREE from 'three';
import { PALETTE } from '../render/palette.gen.ts';

const COLORS = ['red', 'yellow', 'teal', 'pink', 'purple', 'white', 'gold'].map((k) =>
  new THREE.Color().setRGB(...((PALETTE[k] ?? [1, 1, 1]) as [number, number, number]), THREE.SRGBColorSpace),
);

interface Bit {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  max: number;
  kind: 'confetti' | 'spark' | 'ray';
  color: THREE.Color;
  scale: number;
}

/**
 * Masterpiece celebration: firework bursts (glowing rays), falling confetti and sparkles.
 * Instanced and pooled; counts scale with the quality tier.
 */
export class Celebration {
  readonly group = new THREE.Group();
  private readonly confetti: THREE.InstancedMesh;
  private readonly sparks: THREE.InstancedMesh;
  private readonly rays: THREE.InstancedMesh;
  private readonly bits: Bit[] = [];
  private readonly tmp = new THREE.Object3D();
  private time = 0;
  private active = 0;
  private nextBurst = 0;
  private center = new THREE.Vector3();
  onBurst: (() => void) | null = null;

  constructor(private readonly particles: number) {
    const cap = Math.round(600 * Math.max(0.3, particles));
    const glow = (hex: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(2.2), toneMapped: false });
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.055), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), cap);
    this.sparks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.09, 0), glow(0xffffff), Math.round(cap / 3));
    const rayGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 5);
    rayGeo.translate(0, 0.5, 0);
    this.rays = new THREE.InstancedMesh(rayGeo, glow(0xffffff), Math.round(cap / 2));
    for (const m of [this.confetti, this.sparks, this.rays]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3);
      this.group.add(m);
    }
    this.group.name = 'Celebration';
  }

  start(center: THREE.Vector3, seconds = 7): void {
    if (reducedMotion()) return;
    this.center.copy(center);
    this.active = seconds;
    this.nextBurst = 0;
  }

  stop(): void {
    this.active = 0;
    this.bits.length = 0;
  }

  get playing(): boolean {
    return this.active > 0 || this.bits.length > 0;
  }

  private burst(): void {
    const c = this.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 11 + Math.random() * 3, (Math.random() - 0.5) * 4));
    const color = COLORS[Math.floor(Math.random() * COLORS.length)] as THREE.Color;
    const n = Math.round(18 * Math.max(0.5, this.particles));
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(1 - y * y);
      const th = i * 2.399963;
      const dir = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
      this.bits.push({ pos: c.clone(), vel: dir.multiplyScalar(5.5), rot: new THREE.Euler(), spin: new THREE.Vector3(), life: 0, max: 0.9, kind: 'ray', color, scale: 1 });
    }
    for (let i = 0; i < n / 2; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.2) * 5, (Math.random() - 0.5) * 5);
      this.bits.push({ pos: c.clone(), vel: v, rot: new THREE.Euler(), spin: new THREE.Vector3(), life: 0, max: 1.4, kind: 'spark', color, scale: 1 });
    }
    this.onBurst?.();
  }

  private confettiRain(dt: number): void {
    const rate = 160 * this.particles;
    const count = Math.floor(rate * dt + Math.random());
    for (let i = 0; i < count; i++) {
      const pos = this.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 9, 9 + Math.random() * 5, (Math.random() - 0.5) * 9));
      this.bits.push({
        pos,
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, -1.5 - Math.random(), (Math.random() - 0.5) * 1.5),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        life: 0,
        max: 4,
        kind: 'confetti',
        color: COLORS[Math.floor(Math.random() * COLORS.length)] as THREE.Color,
        scale: 1,
      });
    }
  }

  update(dt: number): void {
    this.time += dt;
    if (this.active > 0) {
      this.active -= dt;
      this.nextBurst -= dt;
      if (this.nextBurst <= 0) {
        this.burst();
        this.nextBurst = 0.45 + Math.random() * 0.5;
      }
      this.confettiRain(dt);
    }
    const counts = { confetti: 0, spark: 0, ray: 0 };
    const meshes = { confetti: this.confetti, spark: this.sparks, ray: this.rays };
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i] as Bit;
      b.life += dt;
      if (b.life >= b.max) {
        this.bits.splice(i, 1);
        continue;
      }
      const mesh = meshes[b.kind];
      const idx = counts[b.kind];
      if (idx >= mesh.instanceMatrix.count) continue;
      const k = b.life / b.max;
      if (b.kind === 'confetti') {
        b.vel.x += Math.sin(this.time * 3 + i) * dt * 2;
        b.pos.addScaledVector(b.vel, dt);
        b.rot.x += b.spin.x * dt;
        b.rot.y += b.spin.y * dt;
        b.rot.z += b.spin.z * dt;
        this.tmp.position.copy(b.pos);
        this.tmp.rotation.copy(b.rot);
        this.tmp.scale.setScalar(1);
      } else if (b.kind === 'spark') {
        b.vel.y -= 3 * dt;
        b.pos.addScaledVector(b.vel, dt);
        this.tmp.position.copy(b.pos);
        this.tmp.rotation.set(this.time * 4, this.time * 3, 0);
        this.tmp.scale.setScalar(1 - k);
      } else {
        const ease = 1 - Math.pow(1 - k, 3);
        const dir = b.vel.clone().normalize();
        const head = b.pos.clone().addScaledVector(b.vel, ease * 0.32);
        const len = 0.9 * (1 - k) + 0.05;
        this.tmp.position.copy(head).addScaledVector(dir, -len * 0.5);
        this.tmp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        this.tmp.scale.set(1 - k * 0.5, len, 1 - k * 0.5);
      }
      if (b.kind !== 'ray') this.tmp.quaternion.setFromEuler(this.tmp.rotation);
      this.tmp.updateMatrix();
      mesh.setMatrixAt(idx, this.tmp.matrix);
      mesh.setColorAt(idx, b.color);
      counts[b.kind] = idx + 1;
    }
    for (const kind of ['confetti', 'spark', 'ray'] as const) {
      const m = meshes[kind];
      m.count = counts[kind];
      m.visible = m.count > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
