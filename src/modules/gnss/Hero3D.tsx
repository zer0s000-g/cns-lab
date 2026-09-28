/**
 * The GNSS hero: a small Earth on a stand with the GPS constellation around it.
 * Every pose is read from the unchanged GnssEngine each frame; nothing here
 * computes physics.
 *
 * Frame: the scene is the receiver's local East-North-Up frame (east = +x,
 * north = −z, up = +y), built with the same `ecefToEnu` the engine uses for
 * azimuth and elevation. So the lines of sight here point exactly where the
 * sky plot draws the satellites, and the sky dome over the receiver is the
 * sky plot bent back into a hemisphere.
 *
 * Scale: the Earth and the orbits are to scale with each other (one Earth
 * radius = R_U units). Satellites, the receiver and the ground things next to
 * it (buildings, jammer, GBAS station) are drawn larger than life; the page
 * labels this.
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { StoreApi } from 'zustand'
import { ELEVATION_MASK_DEG, GPS_CONSTELLATION, GPS_PLANES, IONO_SHELL_HEIGHT_M, circularOrbitEci, earthRotationAngleRad } from '@/core/gnss'
import { WGS84_A_M, ecefToEnu, geodeticToEcef, toRad, type Vec3 } from '@/core/geometry'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { Callout3D } from '@/stage/Callout3D'
import { AircraftModel } from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'
import { LAND, WATER, type Ring } from '../satcom/coastlines'
import { BUILDINGS, JAMMER, SBAS_GEO_LON_DEG, type GnssEngine } from './engine'
import type { GnssState } from './store'
import { R_U, SKY_DOME_U, STAND_FLOOR_Y } from './heroScale'

/** Scene units per metre. */
const K = R_U / WGS84_A_M
const MAX_SATS = GPS_CONSTELLATION.length
const MAX_SPHERES = 6
/** Ground things next to the receiver, drawn this far away (not to scale). */
const NEAR_U = 0.62
const Y = new THREE.Vector3(0, 1, 0)

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/** ENU (m) → scene axes: east +x, up +y, north −z. */
const enuToScene = (e: Vec3, out: THREE.Vector3) => out.set(e.x, e.z, -e.y)

/**
 * ECEF (m) → scene matrix for the current receiver: the receiver's ENU frame,
 * scaled, with the Earth's centre at the origin.
 */
function siteMatrix(e: GnssEngine, out: THREE.Matrix4) {
  const rx = e.receiverEcef
  const geo = e.receiverGeo
  const v = new THREE.Vector3()
  const c = enuToScene(ecefToEnu({ x: 0, y: 0, z: 0 }, rx, geo), new THREE.Vector3())
  const col3 = (p: Vec3) => enuToScene(ecefToEnu(p, rx, geo), v).sub(c).multiplyScalar(K / 1e6).clone()
  const X = col3({ x: 1e6, y: 0, z: 0 })
  const Yc = col3({ x: 0, y: 1e6, z: 0 })
  const Z = col3({ x: 0, y: 0, z: 1e6 })
  return out.set(X.x, Yc.x, Z.x, 0, X.y, Yc.y, Z.y, 0, X.z, Yc.z, Z.z, 0, 0, 0, 0, 1)
}

/** Local direction for an azimuth / elevation (degrees): the sky plot's frame. */
function skyDir(azDeg: number, elDeg: number, out = new THREE.Vector3()) {
  const a = toRad(azDeg)
  const el = toRad(elDeg)
  return out.set(Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el))
}

/** A point on the ground `d` units from the receiver on a bearing, following the curve of the small Earth. */
function groundPoint(bearingDeg: number, d: number): [number, number, number] {
  const drop = R_U - Math.sqrt(R_U * R_U - d * d)
  const a = toRad(bearingDeg)
  return [Math.sin(a) * d, -drop, -Math.cos(a) * d]
}

// ---------------------------------------------------------------------------
// Earth texture (drawn at runtime from tokens; nothing is downloaded)
// ---------------------------------------------------------------------------

function earthTexture(t: ThemeTokens) {
  const W = 1024
  const H = 512
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = String(t['stage-water'])
  ctx.fillRect(0, 0, W, H)
  const px = (lat: number, lon: number): [number, number] => [((lon + 180) / 360) * W, ((90 - lat) / 180) * H]
  const path = (ring: Ring) => {
    ctx.beginPath()
    ring.forEach(([la, lo], k) => {
      const [x, y] = px(la, lo)
      if (k === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
  }
  ctx.lineWidth = 1.5
  ctx.strokeStyle = String(t['stage-line'])
  for (const r of LAND) {
    path(r)
    ctx.fillStyle = String(t['stage-terrain'])
    ctx.fill()
    ctx.stroke()
  }
  for (const r of WATER) {
    path(r)
    ctx.fillStyle = String(t['stage-water'])
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Latitude / longitude grid in ECEF metres, just above the surface. */
function gridGeometry() {
  const pts: number[] = []
  const seg = (a: Vec3, b: Vec3) => pts.push(a.x * 1.003, a.y * 1.003, a.z * 1.003, b.x * 1.003, b.y * 1.003, b.z * 1.003)
  for (let lat = -60; lat <= 60; lat += 30) for (let lon = 0; lon < 360; lon += 5) seg(geodeticToEcef({ lat, lon }), geodeticToEcef({ lat, lon: lon + 5 }))
  for (let lon = 0; lon < 360; lon += 30) for (let lat = -85; lat < 85; lat += 5) seg(geodeticToEcef({ lat, lon }), geodeticToEcef({ lat: lat + 5, lon }))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

/** The six GPS orbit rings in ECI metres (they stay fixed in space while the Earth turns). */
function ringGeometries() {
  return GPS_PLANES.map((plane) => {
    const raan = GPS_CONSTELLATION.find((s) => s.plane === plane)!.raanDeg
    const pts: number[] = []
    for (let k = 0; k < 160; k++) {
      const p = circularOrbitEci(raan, (k * 360) / 160, 0)
      pts.push(p.x, p.y, p.z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  })
}

/** The sky dome over the receiver: horizon, 30° and 60° rings, and spokes every 30°. */
function domeGeometry(r: number) {
  const pts: number[] = []
  const v = new THREE.Vector3()
  const w = new THREE.Vector3()
  for (const el of [0, 30, 60]) {
    for (let az = 0; az < 360; az += 5) {
      skyDir(az, el, v).multiplyScalar(r)
      skyDir(az + 5, el, w).multiplyScalar(r)
      pts.push(v.x, v.y, v.z, w.x, w.y, w.z)
    }
  }
  for (let az = 0; az < 360; az += 30) {
    for (let el = 0; el < 90; el += 5) {
      skyDir(az, el, v).multiplyScalar(r)
      skyDir(az, el + 5, w).multiplyScalar(r)
      pts.push(v.x, v.y, v.z, w.x, w.y, w.z)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

/** A patch of the sky dome between two azimuths and two elevations (degrees). */
function skyPatch(r: number, az1: number, az2: number, el1: number, el2: number) {
  // three's sphere: x = −cos φ sin θ, z = sin φ sin θ. Azimuth a (from north, clockwise) is φ = −a − 90°.
  return new THREE.SphereGeometry(r, 48, 8, toRad(-az2 - 90), toRad(az2 - az1), toRad(90 - el2), toRad(el2 - el1))
}

function dynamicSegments(n: number) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3))
  g.setDrawRange(0, 0)
  return g
}

// ---------------------------------------------------------------------------

export function GnssHero({ t, engine, store }: { t: ThemeTokens; engine: GnssEngine; store: StoreApi<GnssState> }) {
  const earthGroup = useRef<THREE.Group>(null)
  const ringGroup = useRef<THREE.Group>(null)
  const local = useRef<THREE.Group>(null)
  const axisRod = useRef<THREE.Mesh>(null)
  const bodies = useRef<THREE.InstancedMesh>(null)
  const panels = useRef<THREE.InstancedMesh>(null)
  const dots = useRef<THREE.InstancedMesh>(null)
  const geoSat = useRef<THREE.Group>(null)
  const spheres = useRef<(THREE.Mesh | null)[]>([])
  const iono = useRef<THREE.Mesh>(null)
  const ground = useRef<THREE.Group>(null)
  const air = useRef<THREE.Group>(null)
  const buildings = useRef<THREE.Group>(null)
  const jammer = useRef<THREE.Group>(null)
  const jamRings = useRef<(THREE.Mesh | null)[]>([])
  const spoofRing = useRef<THREE.Mesh>(null)
  const gbas = useRef<THREE.Group>(null)
  const gbasRing = useRef<THREE.Mesh>(null)
  const satLabels = useRef<(HTMLDivElement | null)[]>([])
  const satLabelGroups = useRef<(THREE.Group | null)[]>([])
  const satLabelText = useRef<(HTMLSpanElement | null)[]>([])
  const geoLabel = useRef<HTMLSpanElement>(null)
  const jamLabel = useRef<HTMLDivElement>(null)
  const jamText = useRef<HTMLSpanElement>(null)
  const spoofLabel = useRef<HTMLDivElement>(null)
  const spoofText = useRef<HTMLSpanElement>(null)
  const gbasLabel = useRef<HTMLDivElement>(null)
  const gbasText = useRef<HTMLSpanElement>(null)
  const ionoLabel = useRef<HTMLDivElement>(null)
  const rxText = useRef<HTMLSpanElement>(null)
  const orbitTag = useRef<THREE.Group>(null)
  const buildLabel = useRef<HTMLDivElement>(null)

  // Scene rotation about the Earth's axis when the view does not turn with the Earth.
  const off = useRef(0)
  const prevTheta = useRef<number | null>(null)
  const recentered = useRef(store.getState().view.recenter)
  const recentering = useRef(false)

  const tex = useMemo(() => earthTexture(t), [t])
  const grid = useMemo(() => gridGeometry(), [])
  const rings = useMemo(() => ringGeometries(), [])
  const dome = useMemo(() => domeGeometry(SKY_DOME_U), [])
  const maskRing = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let az = 0; az <= 360; az += 4) pts.push(skyDir(az, ELEVATION_MASK_DEG).multiplyScalar(SKY_DOME_U))
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [])
  const maskLine = useMemo(() => {
    const l = new THREE.Line(maskRing, new THREE.LineDashedMaterial({ color: col(t, 'stage-line'), dashSize: 0.04, gapSize: 0.035, transparent: true, opacity: 0.55 }))
    l.computeLineDistances()
    l.userData.noPenPlot = true
    return l
  }, [maskRing, t])
  const blockedLow = useMemo(() => skyPatch(SKY_DOME_U * 0.985, 0, 360, 0, BUILDINGS.minElDeg), [])
  const blockedSector = useMemo(() => skyPatch(SKY_DOME_U * 0.985, BUILDINGS.fromAzDeg, BUILDINGS.toAzDeg, BUILDINGS.minElDeg, BUILDINGS.sectorElDeg), [])
  const lines = useMemo(() => ({ used: dynamicSegments(MAX_SATS), other: dynamicSegments(MAX_SATS), fault: dynamicSegments(4), sbas: dynamicSegments(1) }), [])

  const mats = useMemo(
    () => ({
      earth: new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: col(t, 'stage-paint'), emissiveIntensity: 0.6, roughness: 0.92, metalness: 0.02 }),
      body: new THREE.MeshBasicMaterial({ toneMapped: false }),
      panel: new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.5 }),
      dot: new THREE.MeshBasicMaterial({ toneMapped: false }),
      used: new THREE.LineBasicMaterial({ color: col(t, 'stage-signal'), transparent: true, opacity: 0.9, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false }),
      other: new THREE.LineBasicMaterial({ color: col(t, 'stage-line'), transparent: true, opacity: 0.22, depthWrite: false }),
      fault: new THREE.LineBasicMaterial({ color: col(t, 'stage-alert'), transparent: true, opacity: 0.95, toneMapped: false }),
      sbas: new THREE.LineBasicMaterial({ color: col(t, 'stage-brass'), transparent: true, opacity: 0.95, toneMapped: false }),
      sphere: new THREE.MeshBasicMaterial({ color: col(t, 'stage-brass'), transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }),
      iono: new THREE.MeshBasicMaterial({ color: col(t, 'stage-glass'), transparent: true, opacity: 0.05, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending, toneMapped: false }),
      blocked: new THREE.MeshBasicMaterial({ color: col(t, 'stage-metal'), transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
      pulse: new THREE.MeshBasicMaterial({ color: col(t, 'stage-alert'), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      jam: [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: col(t, 'stage-alert'), transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })),
      brassPulse: new THREE.MeshBasicMaterial({ color: col(t, 'stage-brass'), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    }),
    [t, tex],
  )
  useLayoutEffect(
    () => () => {
      tex.dispose()
      Object.values(mats)
        .flat()
        .forEach((m) => m.dispose())
      ;(maskLine.material as THREE.Material).dispose()
    },
    [mats, tex, maskLine],
  )

  const colors = useMemo(
    () => ({
      used: col(t, 'stage-signal'),
      free: col(t, 'stage-paint'),
      dim: col(t, 'stage-metal'),
      fault: col(t, 'stage-alert'),
      brass: col(t, 'stage-brass'),
      dimBrass: col(t, 'stage-metal-dark'),
      glass: col(t, 'stage-glass'),
    }),
    [t],
  )

  const tmp = useMemo(
    () => ({
      F: new THREE.Matrix4(),
      R: new THREE.Matrix4(),
      M: new THREE.Matrix4(),
      Z: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
      axis: new THREE.Vector3(),
      rx: new THREE.Vector3(),
      p: new THREE.Vector3(),
      d: new THREE.Vector3(),
      o: new THREE.Object3D(),
    }),
    [],
  )

  useFrame((state, dtReal) => {
    const e = engine
    const view = store.getState().view
    const th = earthRotationAngleRad(e.timeS)
    const dTh = prevTheta.current === null ? 0 : th - prevTheta.current
    prevTheta.current = th
    if (view.recenter !== recentered.current) {
      recentered.current = view.recenter
      recentering.current = true
    }
    // Following: the receiver stays on top. Not following: the stars stay still and the Earth turns.
    if (!view.followEarth) off.current += dTh
    if (view.followEarth || recentering.current) {
      off.current *= Math.exp(-Math.min(dtReal, 0.1) / 0.35)
      if (Math.abs(off.current) < 1e-4) {
        off.current = 0
        recentering.current = false
      }
    }

    const { F, R, M, Z, q, axis, rx, p, d, o } = tmp
    siteMatrix(e, F)
    axis.set(F.elements[8], F.elements[9], F.elements[10]).normalize() // image of the ECEF z axis: the Earth's axis
    R.makeRotationAxis(axis, off.current)
    q.setFromRotationMatrix(R)
    M.multiplyMatrices(R, F)
    // Earth-fixed things (ECEF metres).
    if (earthGroup.current) {
      earthGroup.current.matrix.copy(M)
      earthGroup.current.matrixWorldNeedsUpdate = true
    }
    // Orbit rings (ECI metres): ECI → ECEF is a turn of −θ about z.
    if (ringGroup.current) {
      Z.makeRotationZ(-th)
      ringGroup.current.matrix.multiplyMatrices(M, Z)
      ringGroup.current.matrixWorldNeedsUpdate = true
    }
    if (axisRod.current) axisRod.current.quaternion.setFromUnitVectors(Y, axis)
    // Pin the orbit tag to the point of plane A that is furthest to the right (east) right now.
    if (orbitTag.current && ringGroup.current) {
      const a = rings[0].getAttribute('position') as THREE.BufferAttribute
      let best = -Infinity
      for (let k = 0; k < a.count; k += 4) {
        p.fromBufferAttribute(a, k).applyMatrix4(ringGroup.current.matrix)
        const score = p.x - 0.4 * Math.abs(p.y)
        if (score > best) {
          best = score
          d.copy(p)
        }
      }
      orbitTag.current.position.copy(d)
    }

    // Receiver and everything next to it, in its local ENU frame.
    const place = (v: Vec3, out: THREE.Vector3) => out.set(v.x, v.y, v.z).applyMatrix4(M)
    place(e.receiverEcef, rx)
    if (local.current) {
      local.current.position.copy(rx)
      local.current.quaternion.copy(q)
    }
    const site = e.settings.site
    if (ground.current) ground.current.visible = site === 'ground'
    if (air.current) air.current.visible = site !== 'ground'
    const blockedNow = e.env.blocked && site === 'ground'
    if (buildings.current) buildings.current.visible = blockedNow
    if (buildLabel.current) buildLabel.current.style.display = blockedNow ? '' : 'none'

    // Satellites, the dome dots and the lines of sight.
    const uPos = lines.used.getAttribute('position') as THREE.BufferAttribute
    const oPos = lines.other.getAttribute('position') as THREE.BufferAttribute
    const fPos = lines.fault.getAttribute('position') as THREE.BufferAttribute
    let nu = 0
    let no = 0
    let nf = 0
    let ns = 0
    e.sats.forEach((s, i) => {
      place(s.ecef, p)
      const received = s.status === 'ok'
      const c = s.faulty ? colors.fault : s.used ? colors.used : received ? colors.free : colors.dim
      o.position.copy(p)
      o.lookAt(0, 0, 0)
      o.scale.setScalar(s.used || s.faulty ? 1.2 : received ? 1 : 0.8)
      o.updateMatrix()
      bodies.current?.setMatrixAt(i, o.matrix)
      bodies.current?.setColorAt(i, c)
      panels.current?.setMatrixAt(i, o.matrix)
      panels.current?.setColorAt(i, received ? colors.brass : colors.dimBrass)
      // Where the line of sight pierces the sky dome: the sky plot position.
      if (s.elDeg >= 0) {
        skyDir(s.azDeg, s.elDeg, d).multiplyScalar(SKY_DOME_U).applyQuaternion(q).add(rx)
        o.position.copy(d)
        o.scale.setScalar(s.used ? 1.25 : 1)
      } else {
        o.position.copy(rx)
        o.scale.setScalar(0)
      }
      o.rotation.set(0, 0, 0)
      o.updateMatrix()
      dots.current?.setMatrixAt(i, o.matrix)
      dots.current?.setColorAt(i, c)
      if (s.used && s.faulty && nf < 4) {
        fPos.setXYZ(2 * nf, rx.x, rx.y, rx.z)
        fPos.setXYZ(2 * nf + 1, p.x, p.y, p.z)
        nf++
      } else if (s.used) {
        uPos.setXYZ(2 * nu, rx.x, rx.y, rx.z)
        uPos.setXYZ(2 * nu + 1, p.x, p.y, p.z)
        nu++
      } else if (received) {
        oPos.setXYZ(2 * no, rx.x, rx.y, rx.z)
        oPos.setXYZ(2 * no + 1, p.x, p.y, p.z)
        no++
      }
      // Distance spheres: centred on the satellite, radius = its measured range.
      if (s.used) {
        const sp = spheres.current[ns]
        if (sp) {
          sp.visible = view.showSpheres && ns < MAX_SPHERES
          sp.position.copy(p)
          sp.scale.setScalar(Math.max(1e-3, s.rangeM * K))
        }
        ns++
      }
      // Satellite name tags for the ones in use.
      const lg = satLabelGroups.current[i]
      const el = satLabels.current[i]
      if (lg) lg.position.copy(p)
      if (el) {
        const show = s.used || s.faulty
        el.style.display = show ? '' : 'none'
        const txt = satLabelText.current[i]
        const want = s.faulty ? `${s.id} · FAULT` : s.id
        if (txt && txt.textContent !== want) txt.textContent = want
      }
    })
    for (let j = ns; j < MAX_SPHERES; j++) {
      const sp = spheres.current[j]
      if (sp) sp.visible = false
    }
    for (const m of [bodies.current, panels.current, dots.current]) {
      if (!m) continue
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    uPos.needsUpdate = true
    oPos.needsUpdate = true
    fPos.needsUpdate = true
    lines.used.setDrawRange(0, 2 * nu)
    lines.other.setDrawRange(0, 2 * no)
    lines.fault.setDrawRange(0, 2 * nf)

    // SBAS geostationary satellite and its link.
    place(e.geo.ecef, p)
    if (geoSat.current) {
      geoSat.current.position.copy(p)
      geoSat.current.lookAt(0, 0, 0)
    }
    const aug = e.augmentation
    const sPos = lines.sbas.getAttribute('position') as THREE.BufferAttribute
    sPos.setXYZ(0, rx.x, rx.y, rx.z)
    sPos.setXYZ(1, p.x, p.y, p.z)
    sPos.needsUpdate = true
    lines.sbas.setDrawRange(0, aug === 'sbas' ? 2 : 0)
    if (geoLabel.current) {
      const want = aug === 'sbas' ? 'SBAS GEO · SENDING CORRECTIONS' : e.settings.sbas && !e.geo.tracked ? 'SBAS GEO · SIGNAL LOST' : `SBAS GEO · ${SBAS_GEO_LON_DEG}°E`
      if (geoLabel.current.textContent !== want) geoLabel.current.textContent = want
    }

    // Ionosphere shell: brighter and red in a storm.
    const storm = e.env.ionoStorm
    mats.iono.color.copy(storm ? colors.fault : colors.glass)
    mats.iono.opacity = storm ? 0.16 + 0.05 * Math.sin(state.clock.elapsedTime * 2.4) : 0.05
    if (ionoLabel.current) ionoLabel.current.style.display = storm ? '' : 'none'

    // Jammer, spoofing and GBAS (next to the receiver, not to scale).
    const pulse = (state.clock.elapsedTime * 0.6) % 1
    const js = e.result.jsDb
    if (jammer.current) jammer.current.visible = e.env.jamming
    if (jamLabel.current) jamLabel.current.style.display = e.env.jamming ? '' : 'none'
    jamRings.current.forEach((m, k) => {
      if (!m) return
      const f = (pulse + k / 3) % 1
      m.visible = e.env.jamming && js !== null
      m.scale.setScalar(0.05 + f * 0.9)
      ;(m.material as THREE.MeshBasicMaterial).opacity = (1 - f) * 0.7
    })
    if (jamText.current) {
      const want = `JAMMER · ${e.settings.jammerKm} KM SOUTH${js !== null ? ` · +${Math.round(js)} DB` : ' · HIDDEN BY THE HORIZON'}`
      if (jamText.current.textContent !== want) jamText.current.textContent = want
    }
    if (spoofRing.current) {
      spoofRing.current.visible = e.env.spoofing
      spoofRing.current.scale.setScalar(0.15 + pulse * 0.5)
      ;(spoofRing.current.material as THREE.MeshBasicMaterial).opacity = (1 - pulse) * 0.8
    }
    if (spoofLabel.current) spoofLabel.current.style.display = e.env.spoofing ? '' : 'none'
    if (spoofText.current) {
      const km = e.result.spoofOffsetM / 1000
      const want = `FAKE SIGNALS · POSITION PULLED ${km < 1 ? `${Math.round(km * 1000)} M` : `${km.toFixed(1)} KM`} NE`
      if (spoofText.current.textContent !== want) spoofText.current.textContent = want
    }
    const gb = e.settings.gbas
    if (gbas.current) gbas.current.visible = gb
    if (gbasLabel.current) gbasLabel.current.style.display = gb ? '' : 'none'
    if (gbasRing.current) {
      gbasRing.current.visible = gb && aug === 'gbas'
      gbasRing.current.scale.setScalar(0.05 + pulse * 0.7)
      ;(gbasRing.current.material as THREE.MeshBasicMaterial).opacity = (1 - pulse) * 0.7
    }
    if (gbasText.current) {
      const want = aug === 'gbas' ? 'GBAS STATION · SENDING CORRECTIONS' : 'GBAS STATION · OUT OF RANGE UP HERE'
      if (gbasText.current.textContent !== want) gbasText.current.textContent = want
    }
    if (rxText.current) {
      const r = e.result
      const want = `RECEIVER · ${r.usedIds.length} IN USE${r.kind === 'none' ? ' · NO POSITION' : ''}`
      if (rxText.current.textContent !== want) rxText.current.textContent = want
    }
  })

  const lineColor = useMemo(() => col(t, 'stage-line'), [t])
  const jam = groundPoint(JAMMER.bearingDeg, NEAR_U)
  const gbasPos = groundPoint(80, NEAR_U * 0.7)
  // Buildings in the blocked sector: their tops subtend the blocked elevation seen from the receiver.
  const blocks = useMemo(() => {
    const out: { pos: [number, number, number]; h: number; w: number; rot: number }[] = []
    const d = 0.34
    for (let az = BUILDINGS.fromAzDeg + 12; az < BUILDINGS.toAzDeg; az += 26) {
      const [x, y, z] = groundPoint(az, d)
      const h = d * Math.tan(toRad(BUILDINGS.sectorElDeg))
      out.push({ pos: [x, y + h / 2, z], h, w: 0.13, rot: -toRad(az) })
    }
    return out
  }, [])

  return (
    <group>
      <StudioFloor t={t} y={STAND_FLOOR_Y} shadowScale={16} />
      {/* Desk-globe stand: a column and a base under the Earth. */}
      <PenPlot color={lineColor}>
        <mesh position={[0, (STAND_FLOOR_Y - R_U) / 2, 0]}>
          <cylinderGeometry args={[0.07, 0.11, -STAND_FLOOR_Y - R_U, 20]} />
          <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.35} metalness={0.8} />
        </mesh>
        <mesh position={[0, STAND_FLOOR_Y + 0.06, 0]}>
          <cylinderGeometry args={[1.1, 1.25, 0.12, 48]} />
          <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.5} metalness={0.6} />
        </mesh>
      </PenPlot>
      <mesh ref={axisRod} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.012, 0.012, R_U * 2.36, 8]} />
        <meshBasicMaterial color={col(t, 'stage-brass')} toneMapped={false} />
      </mesh>

      {/* Earth-fixed: the Earth, its grid, the SBAS satellite (geostationary: fixed over the equator). */}
      <group ref={earthGroup} matrixAutoUpdate={false}>
        <mesh rotation-x={Math.PI / 2} material={mats.earth} userData={{ noPenPlot: true }}>
          <sphereGeometry args={[WGS84_A_M, 72, 48]} />
        </mesh>
        <lineSegments geometry={grid} userData={{ noPenPlot: true }}>
          <lineBasicMaterial color={col(t, 'stage-line')} transparent opacity={0.16} depthWrite={false} />
        </lineSegments>
        <mesh ref={iono} material={mats.iono} userData={{ noPenPlot: true }}>
          <sphereGeometry args={[WGS84_A_M + IONO_SHELL_HEIGHT_M, 64, 40]} />
        </mesh>
      </group>
      <group ref={ringGroup} matrixAutoUpdate={false}>
        {rings.map((g, k) => (
          <lineLoop key={k} geometry={g} userData={{ noPenPlot: true }}>
            <lineBasicMaterial color={col(t, 'stage-line')} transparent opacity={0.26} depthWrite={false} />
          </lineLoop>
        ))}
      </group>
      <group ref={orbitTag}>
        <Callout3D position={[0, 0, 0]} lead={16}>
          GPS ORBIT · 20,200 KM UP
        </Callout3D>
      </group>

      {/* GPS satellites: body (colour = state) and solar wings (brass). */}
      <instancedMesh ref={bodies} args={[undefined, undefined, MAX_SATS]} material={mats.body} frustumCulled={false} userData={{ noPenPlot: true }}>
        <boxGeometry args={[0.09, 0.09, 0.13]} />
      </instancedMesh>
      <instancedMesh ref={panels} args={[undefined, undefined, MAX_SATS]} material={mats.panel} frustumCulled={false} userData={{ noPenPlot: true }}>
        <boxGeometry args={[0.46, 0.008, 0.07]} />
      </instancedMesh>
      {GPS_CONSTELLATION.map((s, i) => (
        <group key={s.id} ref={(g) => void (satLabelGroups.current[i] = g)}>
          <Callout3D position={[0.08, 0.06, 0]} lead={10} rootRef={(el) => void (satLabels.current[i] = el)}>
            <span ref={(el) => void (satLabelText.current[i] = el)}>{s.id}</span>
          </Callout3D>
        </group>
      ))}
      {Array.from({ length: MAX_SPHERES }, (_, j) => (
        <mesh key={j} ref={(m) => void (spheres.current[j] = m)} visible={false} material={mats.sphere} userData={{ noPenPlot: true }}>
          <sphereGeometry args={[1, 48, 32]} />
        </mesh>
      ))}

      {/* Lines of sight: in use (cyan), received but not used (faint), faulty (red), SBAS (brass). */}
      <lineSegments geometry={lines.used} material={mats.used} frustumCulled={false} userData={{ noPenPlot: true }} />
      <lineSegments geometry={lines.other} material={mats.other} frustumCulled={false} userData={{ noPenPlot: true }} />
      <lineSegments geometry={lines.fault} material={mats.fault} frustumCulled={false} userData={{ noPenPlot: true }} />
      <lineSegments geometry={lines.sbas} material={mats.sbas} frustumCulled={false} userData={{ noPenPlot: true }} />

      <group ref={geoSat}>
        <PenPlot color={lineColor}>
          <mesh>
            <boxGeometry args={[0.16, 0.16, 0.22]} />
            <meshStandardMaterial color={col(t, 'stage-paint')} roughness={0.4} metalness={0.5} />
          </mesh>
          <mesh>
            <boxGeometry args={[0.8, 0.01, 0.12]} />
            <meshStandardMaterial color={col(t, 'stage-brass')} roughness={0.4} metalness={0.5} />
          </mesh>
        </PenPlot>
        <Callout3D position={[0.12, 0.1, 0]} tone="brass">
          <span ref={geoLabel}>SBAS GEO</span>
        </Callout3D>
      </group>

      <instancedMesh ref={dots} args={[undefined, undefined, MAX_SATS]} material={mats.dot} frustumCulled={false} userData={{ noPenPlot: true }}>
        <sphereGeometry args={[0.022, 10, 8]} />
      </instancedMesh>

      {/* The receiver's own frame: east +x, up +y, north −z. */}
      <group ref={local}>
        <lineSegments geometry={dome} userData={{ noPenPlot: true }}>
          <lineBasicMaterial color={col(t, 'stage-signal')} transparent opacity={0.28} depthWrite={false} toneMapped={false} />
        </lineSegments>
        <primitive object={maskLine} />
        <mesh rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
          <circleGeometry args={[SKY_DOME_U, 64]} />
          <meshBasicMaterial color={col(t, 'stage-signal')} transparent opacity={0.07} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        {(['N', 'E', 'S', 'W'] as const).map((n, k) => {
          const v = skyDir(k * 90, 0).multiplyScalar(SKY_DOME_U * 1.12)
          return (
            <Html key={n} position={[v.x, 0.02, v.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
              <span aria-hidden className="hud-label text-[10px] text-foreground/75">
                {n}
              </span>
            </Html>
          )
        })}

        <group ref={buildings}>
          <mesh geometry={blockedLow} material={mats.blocked} userData={{ noPenPlot: true }} />
          <mesh geometry={blockedSector} material={mats.blocked} userData={{ noPenPlot: true }} />
          <PenPlot color={lineColor}>
            {blocks.map((b, k) => (
              <mesh key={k} position={b.pos} rotation-y={b.rot}>
                <boxGeometry args={[b.w, b.h, 0.08]} />
                <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.8} />
              </mesh>
            ))}
          </PenPlot>
          <Callout3D position={groundPoint(265, 0.42).map((v, k) => (k === 1 ? v + 0.3 : v)) as [number, number, number]} side="left" lead={14} rootRef={buildLabel}>
            BUILDINGS HIDE THE SKY
          </Callout3D>
        </group>

        {/* Receiver: an antenna on the runway, or an aircraft. */}
        <PenPlot color={lineColor}>
          <group ref={ground}>
            <mesh position={[0, 0.05, 0]}>
              <cylinderGeometry args={[0.012, 0.016, 0.1, 10]} />
              <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.4} metalness={0.7} />
            </mesh>
            <mesh position={[0, 0.11, 0]}>
              <cylinderGeometry args={[0.05, 0.055, 0.025, 24]} />
              <meshStandardMaterial color={col(t, 'stage-paint')} roughness={0.5} />
            </mesh>
          </group>
          <group ref={air} position={[0, 0.06, 0]} scale={0.55}>
            <AircraftModel t={t} />
          </group>
          <group ref={jammer} position={jam}>
            <mesh position={[0, 0.09, 0]}>
              <cylinderGeometry args={[0.01, 0.014, 0.18, 8]} />
              <meshStandardMaterial color={col(t, 'stage-metal')} />
            </mesh>
          </group>
          <group ref={gbas} position={gbasPos}>
            <mesh position={[0, 0.07, 0]}>
              <cylinderGeometry args={[0.008, 0.01, 0.14, 8]} />
              <meshStandardMaterial color={col(t, 'stage-metal')} />
            </mesh>
            <mesh position={[0.03, 0.02, 0]}>
              <boxGeometry args={[0.05, 0.04, 0.04]} />
              <meshStandardMaterial color={col(t, 'stage-paint')} />
            </mesh>
          </group>
        </PenPlot>
        {Array.from({ length: 3 }, (_, k) => (
          <mesh key={k} ref={(m) => void (jamRings.current[k] = m)} position={[jam[0], jam[1] + 0.01, jam[2]]} rotation-x={-Math.PI / 2} visible={false} material={mats.jam[k]} userData={{ noPenPlot: true }}>
            <ringGeometry args={[0.92, 1, 48]} />
          </mesh>
        ))}
        <mesh ref={spoofRing} position={[0, 0.015, 0]} rotation-x={-Math.PI / 2} visible={false} material={mats.pulse} userData={{ noPenPlot: true }}>
          <ringGeometry args={[0.9, 1, 48]} />
        </mesh>
        <mesh ref={gbasRing} position={[gbasPos[0], gbasPos[1] + 0.012, gbasPos[2]]} rotation-x={-Math.PI / 2} visible={false} material={mats.brassPulse} userData={{ noPenPlot: true }}>
          <ringGeometry args={[0.9, 1, 48]} />
        </mesh>

        <Callout3D position={[0.04, 0.16, 0]} tone="signal" lead={22}>
          <span ref={rxText}>RECEIVER</span>
        </Callout3D>
        <Callout3D position={[jam[0], jam[1] + 0.2, jam[2]]} tone="alert" lead={12} rootRef={jamLabel}>
          <span ref={jamText}>JAMMER</span>
        </Callout3D>
        <Callout3D position={[0.05, -0.02, 0.1]} tone="alert" lead={12} side="left" rootRef={spoofLabel}>
          <span ref={spoofText}>FAKE SIGNALS</span>
        </Callout3D>
        <Callout3D position={[gbasPos[0], gbasPos[1] + 0.16, gbasPos[2]]} tone="brass" lead={12} rootRef={gbasLabel}>
          <span ref={gbasText}>GBAS STATION</span>
        </Callout3D>
        <Callout3D position={[-0.9, 0.12, 0.2]} tone="alert" side="left" lead={14} rootRef={ionoLabel}>
          IONOSPHERIC STORM · SIGNALS DELAYED
        </Callout3D>
      </group>
    </group>
  )
}

export default GnssHero
