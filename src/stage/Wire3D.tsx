/**
 * A thin glowing tube between two points that move every frame (bearing lines,
 * slant ranges, radials, reflection legs). The shape is bent in the vertex
 * shader, so moving it costs three uniform writes and no geometry rebuilds.
 */
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

export interface WireHandle {
  /** Set both ends (scene units) and the height of the arch at mid-span. */
  set: (a: THREE.Vector3 | [number, number, number], b: THREE.Vector3 | [number, number, number], peak?: number) => void
  setVisible: (v: boolean) => void
  setOpacity: (o: number) => void
}

const vertexShader = `
  uniform vec3 uA; uniform vec3 uB; uniform float uPeak; uniform float uR;
  varying float vS; varying float vLen;
  void main(){
    float s = position.y + 0.5;
    vec3 d = uB - uA;
    float len = max(length(d), 1e-4);
    vec3 dir = d / len;
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 perp = cross(dir, up);
    perp = length(perp) < 1e-3 ? vec3(1.0, 0.0, 0.0) : normalize(perp);
    vec3 nrm = normalize(cross(perp, dir));
    vec3 base = uA + d * s + up * uPeak * sin(3.14159265 * s);
    vec3 p = base + (perp * position.x + nrm * position.z) * uR;
    vS = s; vLen = len;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`

const fragmentShader = `
  uniform vec3 uColor; uniform float uOpacity; uniform float uDash;
  varying float vS; varying float vLen;
  void main(){
    if (uDash > 0.0 && fract(vS * vLen / uDash) > 0.55) discard;
    gl_FragColor = vec4(uColor * uOpacity, uOpacity);
  }`

export const Wire3D = forwardRef<
  WireHandle,
  { color: THREE.Color; radius?: number; dash?: number; opacity?: number; additive?: boolean; segments?: number }
>(function Wire3D({ color, radius = 0.01, dash = 0, opacity = 1, additive = true, segments = 48 }, ref) {
  const mesh = useRef<THREE.Mesh>(null)
  // A unit cylinder along y; its radius-1 cross-section is scaled by uR in the shader.
  const geo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 6, segments, true), [segments])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          uA: { value: new THREE.Vector3() },
          uB: { value: new THREE.Vector3(0, 0, -1) },
          uPeak: { value: 0 },
          uR: { value: radius },
          uColor: { value: color },
          uOpacity: { value: opacity },
          uDash: { value: dash },
        },
        vertexShader,
        fragmentShader,
      }),
    [color, radius, dash, opacity, additive],
  )
  useLayoutEffect(
    () => () => {
      mat.dispose()
      geo.dispose()
    },
    [mat, geo],
  )
  useImperativeHandle(
    ref,
    () => ({
      set: (a, b, peak = 0) => {
        const u = mat.uniforms
        if (Array.isArray(a)) (u.uA.value as THREE.Vector3).set(...a)
        else (u.uA.value as THREE.Vector3).copy(a)
        if (Array.isArray(b)) (u.uB.value as THREE.Vector3).set(...b)
        else (u.uB.value as THREE.Vector3).copy(b)
        u.uPeak.value = peak
      },
      setVisible: (v) => {
        if (mesh.current) mesh.current.visible = v
      },
      setOpacity: (o) => {
        mat.uniforms.uOpacity.value = o
      },
    }),
    [mat],
  )
  // The real shape comes from the shader, so the default bounds are meaningless.
  return <mesh ref={mesh} geometry={geo} material={mat} frustumCulled={false} visible={false} userData={{ noPenPlot: true }} />
})
