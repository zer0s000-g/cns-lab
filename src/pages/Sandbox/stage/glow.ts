import * as THREE from 'three'

let tex: THREE.DataTexture | null = null

/**
 * A small round glow mask for lamps drawn as points: full intensity in the
 * centre fading to nothing at the edge. It carries no colour of its own
 * (every channel is the same falloff); the lamp colour comes from the point
 * colours, which are theme tokens.
 */
export function glowTexture(): THREE.DataTexture {
  if (tex) return tex
  const n = 64
  const data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2)
      // A bright core with a soft halo.
      const a = r >= 1 ? 0 : Math.min(1, Math.exp(-r * r * 9) * 1.2 + Math.max(0, 1 - r) * 0.25)
      const v = Math.round(a * 255)
      const i = (y * n + x) * 4
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = v
    }
  }
  tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat)
  tex.needsUpdate = true
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  return tex
}
