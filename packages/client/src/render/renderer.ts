import * as THREE from 'three';
import { setOutlineResolution } from './outline.ts';
import type { QualitySettings } from './quality.ts';

export class UnsupportedGraphicsError extends Error {}

export function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  resize(): void;
}

/** Sun direction from the reference renders (Blender rot 48°, 0, -28°), converted to Y-up. */
export const SUN_DIRECTION = new THREE.Vector3(0.349, -0.669, -0.656).normalize();
export const SKY_COLOR = new THREE.Color().setRGB(0.7, 0.86, 0.98, THREE.SRGBColorSpace);

export function createRenderContext(canvas: HTMLCanvasElement, quality: QualitySettings): RenderContext {
  if (!webgl2Available()) throw new UnsupportedGraphicsError('WebGL 2 is not available');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.background = SKY_COLOR.clone();

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 6, 14);

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const sc = sun.shadow.camera;
  sc.left = -16;
  sc.right = 16;
  sc.top = 16;
  sc.bottom = -16;
  sc.near = 1;
  sc.far = 80;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2.5;
  sun.position.copy(SUN_DIRECTION).multiplyScalar(-40);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);

  const resize = (): void => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    setOutlineResolution(w * pr, h * pr);
  };
  resize();
  return { renderer, scene, camera, sun, resize };
}
