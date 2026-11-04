import * as THREE from 'three';
import { PALETTE } from './palette.gen.ts';

/** Cool shadow tint from the approved Blender toon ramp (shadow = lit × tint, linear space). */
export const SHADOW_TINT = new THREE.Vector3(0.5, 0.52, 0.66);
/** Ramp band on (N·L × shadow): eased transition like the Blender ColorRamp (0.28 → 0.48 of its scale). */
export const RAMP = { lo: 0.1, hi: 0.32 } as const;

const shared = {
  uShadowTint: { value: SHADOW_TINT },
  uRampLo: { value: RAMP.lo as number },
  uRampHi: { value: RAMP.hi as number },
};

const TOON_PARS = /* glsl */ `
varying vec3 vViewPosition;
uniform vec3 uShadowTint;
uniform float uRampLo;
uniform float uRampHi;
float gToonLit = 0.0;
struct ToonMaterial { vec3 diffuseColor; };
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal,
    const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  float dotNL = max( dot( geometryNormal, directLight.direction ), 0.0 );
  float s = max( max( directLight.color.r, directLight.color.g ), directLight.color.b );
  gToonLit = max( gToonLit, dotNL * s );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal,
    const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {}
#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;

const OUTGOING = 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;';

const BRICK_PARS = /* glsl */ `
varying vec3 vBrickPos;
float brickHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
vec3 brickColor( vec3 p ) {
  // running bond in world space; tower is exported at 1.6× so bricks are 0.26 × 0.12 m × 1.6
  const vec2 size = vec2( 0.416, 0.192 );
  float u = p.x + p.z;
  float row = floor( p.y / size.y );
  float x = u / size.x + 0.5 * mod( row, 2.0 );
  vec2 cell = vec2( floor( x ), row );
  vec2 f = vec2( fract( x ) * size.x, fract( p.y / size.y ) * size.y );
  float m = 0.019;
  float mortar = step( f.x, m ) + step( f.y, m );
  vec3 c1 = vec3( 0.704, 0.133, 0.060 );
  vec3 c2 = vec3( 0.579, 0.088, 0.043 );
  vec3 brick = mix( c1, c2, step( 0.5, brickHash( cell ) ) );
  return mix( brick, vec3( 0.893, 0.718, 0.534 ), clamp( mortar, 0.0, 1.0 ) );
}
`;

export interface ToonOptions {
  brick?: boolean;
  /** shadow tint multiplier override (e.g. ground slightly warmer) */
  tint?: THREE.Vector3;
}

function patch(mat: THREE.MeshToonMaterial, opts: ToonOptions): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uShadowTint = opts.tint ? { value: opts.tint } : shared.uShadowTint;
    shader.uniforms.uRampLo = shared.uRampLo;
    shader.uniforms.uRampHi = shared.uRampHi;
    let frag = shader.fragmentShader.replace('#include <lights_toon_pars_fragment>', TOON_PARS + (opts.brick ? BRICK_PARS : ''));
    const base = opts.brick ? 'brickColor( vBrickPos )' : 'diffuseColor.rgb';
    frag = frag.replace(
      OUTGOING,
      `float toonLit = smoothstep( uRampLo, uRampHi, gToonLit );
       vec3 toonBase = ${base};
       vec3 outgoingLight = mix( toonBase * uShadowTint, toonBase, toonLit ) + totalEmissiveRadiance;`,
    );
    shader.fragmentShader = frag;
    if (opts.brick) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBrickPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vBrickPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    }
  };
  mat.customProgramCacheKey = () => (opts.brick ? 'hht-toon-brick' : opts.tint ? `hht-toon-${opts.tint.toArray().join()}` : 'hht-toon');
}

const cache = new Map<string, THREE.Material>();

export function srgbColor(rgb: readonly [number, number, number]): THREE.Color {
  return new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
}

/** Toon material for a palette entry (material names T_<palette>). */
export function toonMaterial(paletteName: string, opts: ToonOptions = {}): THREE.MeshToonMaterial {
  const key = `T_${paletteName}${opts.brick ? ':brick' : ''}`;
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshToonMaterial;
  const rgb = PALETTE[paletteName] ?? [1, 0, 1];
  const mat = new THREE.MeshToonMaterial({ color: srgbColor(rgb), name: key });
  patch(mat, { ...opts, brick: opts.brick ?? paletteName === 'brickwall' });
  cache.set(key, mat);
  return mat;
}

/** Toon material that takes its colors from vertex colors (merged tower LODs, material T_vcol). */
export function toonVcolMaterial(): THREE.MeshToonMaterial {
  const hit = cache.get('T_vcol');
  if (hit) return hit as THREE.MeshToonMaterial;
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, name: 'T_vcol' });
  patch(mat, {});
  mat.customProgramCacheKey = () => 'hht-toon-vcol';
  cache.set('T_vcol', mat);
  return mat;
}

/** Toon material from an arbitrary color (runtime tints like the hard hat). */
export function toonFromColor(color: THREE.ColorRepresentation, name = 'T_custom'): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ color, name });
  patch(mat, {});
  return mat;
}

/** Unlit glow material (G_<name>): emissive color × strength, so bloom picks it up on the high tier. */
export function glowMaterial(name: string, linearColor: THREE.Color, strength: number): THREE.MeshBasicMaterial {
  const key = `G_${name}`;
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshBasicMaterial;
  const c = linearColor.clone().multiplyScalar(Math.max(1, strength * 0.55));
  const mat = new THREE.MeshBasicMaterial({ color: c, name: key, toneMapped: false });
  cache.set(key, mat);
  return mat;
}
