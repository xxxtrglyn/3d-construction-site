import * as THREE from 'three';
import { glowMaterial, toonMaterial } from '../render/toonMaterial.ts';

function starShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

/** Five stars on the plot's wooden sign; lit = yellow, unlit = dark, masterpiece = glowing gold. */
export class StarSign {
  readonly group = new THREE.Group();
  private readonly stars: THREE.Mesh[] = [];
  private readonly lit = toonMaterial('yellow');
  private readonly unlit = toonMaterial('dark');
  private readonly gold = glowMaterial('star_sign_gold', new THREE.Color().setRGB(1, 0.75, 0.2), 3);

  constructor() {
    const geo = new THREE.ExtrudeGeometry(starShape(0.085), { depth: 0.03, bevelEnabled: false });
    geo.translate(0, 0, -0.015);
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(geo, this.unlit);
      m.position.set(-0.42 + 0.21 * i, 0, 0);
      m.castShadow = false;
      this.stars.push(m);
      this.group.add(m);
    }
    this.group.name = 'StarSign';
  }

  /** Attach in world space at the sign anchor, facing the anchor's forward (+Z of tower). */
  placeAt(anchorWorld: THREE.Vector3, facingYaw: number): void {
    this.group.position.copy(anchorWorld);
    this.group.rotation.set(0, facingYaw, 0);
  }

  set(stars: number, masterpiece: boolean): void {
    this.stars.forEach((m, i) => {
      m.material = i < stars ? (masterpiece ? this.gold : this.lit) : this.unlit;
    });
  }
}
