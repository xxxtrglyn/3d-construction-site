import * as THREE from 'three';
import { toonMaterial } from '../render/toonMaterial.ts';

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
}

const CAP = 96;

/** Pooled instanced puff clouds (snap, stage complete, drops). */
export class Puffs {
  readonly mesh: THREE.InstancedMesh;
  private readonly parts: Particle[] = [];
  private readonly tmp = new THREE.Object3D();

  constructor(geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(0.5, 1)) {
    this.mesh = new THREE.InstancedMesh(geometry, toonMaterial('white'), CAP);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.name = 'Puffs';
  }

  setGeometry(g: THREE.BufferGeometry): void {
    this.mesh.geometry = g;
  }

  emit(at: THREE.Vector3, count = 8, spread = 0.6, size = 0.45): void {
    for (let i = 0; i < count && this.parts.length < CAP; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * spread * (0.6 + Math.random()), 0.6 + Math.random() * 0.8, Math.sin(a) * spread * (0.6 + Math.random()));
      this.parts.push({ pos: at.clone().addScaledVector(v, 0.2), vel: v.multiplyScalar(2), life: 0, max: 0.5 + Math.random() * 0.35, size: size * (0.7 + Math.random() * 0.6) });
    }
  }

  update(dt: number): void {
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i] as Particle;
      p.life += dt;
      if (p.life >= p.max) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vel.multiplyScalar(1 - dt * 3);
      p.pos.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      const s = p.size * Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) * (1 - k * k);
      this.tmp.position.copy(p.pos);
      this.tmp.scale.setScalar(Math.max(0.001, s));
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(n++, this.tmp.matrix);
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
