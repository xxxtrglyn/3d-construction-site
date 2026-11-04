import * as THREE from 'three';

/**
 * Inverted-hull ink outlines with screen-constant width.
 * Each outlined mesh gets a child mesh sharing its geometry, rendered BackSide and pushed out along
 * smoothed normals in clip space. Outlines fade out beyond `distance` meters.
 */
const uniforms = {
  uColor: { value: new THREE.Color().setRGB(0.165, 0.102, 0.102, THREE.SRGBColorSpace) },
  uWidth: { value: 1.6 },
  uResolution: { value: new THREE.Vector2(1280, 720) },
  uFadeStart: { value: 22 },
  uFadeEnd: { value: 28 },
};

const VERT = /* glsl */ `
#include <common>
attribute vec3 outlineNormal;
uniform float uWidth;
uniform vec2 uResolution;
uniform float uFadeStart;
uniform float uFadeEnd;
void main() {
  vec4 p = vec4( position, 1.0 );
  vec3 n = outlineNormal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
    n = mat3( instanceMatrix ) * n;
  #endif
  vec4 mv = modelViewMatrix * p;
  vec4 clip = projectionMatrix * mv;
  vec3 vn = normalize( normalMatrix * n );
  vec2 dir = ( projectionMatrix * vec4( vn, 0.0 ) ).xy;
  float len = length( dir );
  dir = len > 1e-5 ? dir / len : vec2( 0.0 );
  float fade = 1.0 - smoothstep( uFadeStart, uFadeEnd, -mv.z );
  clip.xy += dir * uWidth * fade * clip.w * 2.0 / uResolution;
  // push slightly back so the hull never covers the front surface
  clip.z += 0.0004 * clip.w;
  gl_Position = clip;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4( uColor, 1.0 );
  #include <colorspace_fragment>
}
`;

export const outlineMaterial = new THREE.ShaderMaterial({
  name: 'Outline',
  uniforms,
  vertexShader: VERT,
  fragmentShader: FRAG,
  side: THREE.BackSide,
});

export function configureOutlines(widthPx: number, distance: number): void {
  uniforms.uWidth.value = widthPx;
  uniforms.uFadeEnd.value = distance;
  uniforms.uFadeStart.value = Math.max(0, distance - 6);
}

export function setOutlineResolution(width: number, height: number): void {
  uniforms.uResolution.value.set(width, height);
}

/** Average normals of vertices sharing a position so the hull has no cracks at hard edges. */
export function ensureOutlineNormals(geometry: THREE.BufferGeometry): void {
  if (geometry.getAttribute('outlineNormal')) return;
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const count = pos.count;
  const out = new Float32Array(count * 3);
  const sums = new Map<string, [number, number, number]>();
  const keys: string[] = new Array(count);
  const q = 1e4;
  for (let i = 0; i < count; i++) {
    const k = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
    keys[i] = k;
    const nx = nor ? nor.getX(i) : 0;
    const ny = nor ? nor.getY(i) : 1;
    const nz = nor ? nor.getZ(i) : 0;
    const s = sums.get(k);
    if (s) {
      s[0] += nx;
      s[1] += ny;
      s[2] += nz;
    } else sums.set(k, [nx, ny, nz]);
  }
  for (let i = 0; i < count; i++) {
    const s = sums.get(keys[i] as string) as [number, number, number];
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    out[i * 3] = s[0] / l;
    out[i * 3 + 1] = s[1] / l;
    out[i * 3 + 2] = s[2] / l;
  }
  geometry.setAttribute('outlineNormal', new THREE.BufferAttribute(out, 3));
}

/** Add an outline child to a mesh (or instanced mesh). Returns the outline object. */
export function addOutline(mesh: THREE.Mesh): THREE.Mesh {
  ensureOutlineNormals(mesh.geometry);
  let outline: THREE.Mesh;
  if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
    const src = mesh as THREE.InstancedMesh;
    const inst = new THREE.InstancedMesh(src.geometry, outlineMaterial, src.instanceMatrix.count);
    inst.instanceMatrix = src.instanceMatrix;
    inst.count = src.count;
    inst.frustumCulled = false;
    outline = inst;
  } else {
    outline = new THREE.Mesh(mesh.geometry, outlineMaterial);
  }
  outline.name = `${mesh.name}__outline`;
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.userData.isOutline = true;
  outline.raycast = () => {};
  mesh.add(outline);
  return outline;
}

export function setOutlinesVisible(root: THREE.Object3D, visible: boolean): void {
  root.traverse((o) => {
    if (o.userData.isOutline) o.visible = visible;
  });
}
