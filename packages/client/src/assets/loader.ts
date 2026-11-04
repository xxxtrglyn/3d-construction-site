import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { addOutline } from '../render/outline.ts';
import { glowMaterial, toonMaterial, toonVcolMaterial } from '../render/toonMaterial.ts';

export interface ManifestAsset {
  id: string;
  file: string;
  bytes: number;
  sha256: string;
  group: 'critical' | 'deferred';
  nodes: string[];
}
export interface Manifest {
  version: 1;
  generatedAt: string;
  assets: ManifestAsset[];
}

export interface LoadOptions {
  outlines: boolean;
  /** palette names that never get outlines (ground surfaces) */
  noOutline?: ReadonlySet<string>;
  /** palette names that never cast shadows */
  noShadow?: ReadonlySet<string>;
}

const GROUND = new Set(['earth', 'grass', 'dirt', 'grass2']);

export class AssetStore {
  private manifest: Manifest | null = null;
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<THREE.Group>>();
  private readonly loaded = new Map<string, THREE.Group>();
  private readonly listeners = new Set<(id: string) => void>();

  constructor(private readonly base: string, private readonly opts: LoadOptions) {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  async init(): Promise<Manifest> {
    const res = await fetch(`${this.base}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`asset manifest missing (${res.status})`);
    this.manifest = (await res.json()) as Manifest;
    return this.manifest;
  }

  ids(group: 'critical' | 'deferred'): string[] {
    return (this.manifest?.assets ?? []).filter((a) => a.group === group).map((a) => a.id);
  }

  bytesOf(ids: readonly string[]): number {
    return ids.reduce((s, id) => s + (this.manifest?.assets.find((a) => a.id === id)?.bytes ?? 0), 0);
  }

  get(id: string): THREE.Group | undefined {
    return this.loaded.get(id);
  }

  onLoaded(fn: (id: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  load(id: string, onBytes?: (loaded: number) => void): Promise<THREE.Group> {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const entry = this.manifest?.assets.find((a) => a.id === id);
    if (!entry) return Promise.reject(new Error(`unknown asset ${id}`));
    const p = this.loader
      .loadAsync(`${this.base}${entry.file}`, (e) => onBytes?.(e.loaded))
      .then((gltf) => {
        const root = gltf.scene;
        root.name = id;
        this.prepare(root);
        for (const n of entry.nodes) {
          if (!root.getObjectByName(n)) console.warn(`[assets] ${id}: missing node ${n}`);
        }
        this.loaded.set(id, root);
        for (const l of this.listeners) l(id);
        return root;
      });
    this.cache.set(id, p);
    return p;
  }

  /** Swap glTF materials for toon/glow materials by name, set shadows, add outlines. */
  private prepare(root: THREE.Object3D): void {
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    for (const mesh of meshes) {
      const src = mesh.material as THREE.MeshStandardMaterial;
      const name = src.name ?? '';
      let palette = '';
      if (name.startsWith('G_')) {
        const strength = (src as THREE.MeshStandardMaterial).emissiveIntensity ?? 1;
        mesh.material = glowMaterial(name.slice(2), src.emissive.clone(), strength);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      } else if (name === 'T_vcol') {
        palette = 'vcol';
        mesh.material = toonVcolMaterial();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      } else {
        palette = name.startsWith('T_') ? name.slice(2) : 'white';
        mesh.material = toonMaterial(palette);
        mesh.castShadow = !(this.opts.noShadow ?? GROUND).has(palette);
        mesh.receiveShadow = true;
      }
      mesh.userData.palette = palette;
      const noOutline = this.opts.noOutline ?? GROUND;
      if (this.opts.outlines && !name.startsWith('G_') && !noOutline.has(palette)) addOutline(mesh);
    }
  }
}
