import * as THREE from 'three';

/** Translucent blue "blueprint" material for the next stage preview (matches the mockup). */
export const ghostMaterial = new THREE.ShaderMaterial({
  name: 'Ghost_Blueprint',
  transparent: true,
  depthWrite: false,
  uniforms: {
    uColor: { value: new THREE.Color().setRGB(0.45, 0.85, 1.0, THREE.SRGBColorSpace) },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vNormalV;
    varying vec3 vViewDir;
    void main() {
      vec4 mv = modelViewMatrix * vec4( position, 1.0 );
      vNormalV = normalize( normalMatrix * normal );
      vViewDir = normalize( -mv.xyz );
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uTime;
    varying vec3 vNormalV;
    varying vec3 vViewDir;
    void main() {
      float rim = 1.0 - abs( dot( normalize( vNormalV ), normalize( vViewDir ) ) );
      float pulse = 0.85 + 0.15 * sin( uTime * 2.5 );
      float a = ( 0.18 + 0.55 * pow( rim, 2.0 ) ) * pulse;
      gl_FragColor = vec4( uColor * ( 0.9 + rim * 0.6 ), a );
      #include <colorspace_fragment>
    }`,
});

/** Clone a stage model as a ghost (shared geometry, no shadows, no outlines). */
export function makeGhost(source: THREE.Object3D): THREE.Object3D {
  const g = source.clone(true);
  const remove: THREE.Object3D[] = [];
  g.traverse((o) => {
    if (o.userData.isOutline) {
      remove.push(o);
      return;
    }
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.material = ghostMaterial;
      m.castShadow = false;
      m.receiveShadow = false;
      m.renderOrder = 10;
    }
  });
  for (const o of remove) o.removeFromParent();
  g.name = `${source.name}__ghost`;
  return g;
}
