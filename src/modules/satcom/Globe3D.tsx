import { useEffect, useMemo, useRef, type ComponentRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { Scene3D, tc } from '@/components/sim/Scene3D'
import { toRad, type LatLon, type Vec3 } from '@/core/geometry'
import { coverageHalfAngleDeg, ecefToThree, GEO_MASK_DEG, GEO_RADIUS_M, LEO, LEO_RADIUS_M, orbitTrackEcef, routePointAt, sphericalToEcef } from '@/core/satcom'
import { EARTH_RADIUS_M, ftToMetres } from '@/core/units'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { alphaOf } from '@/lib/color'
import { LAND, WATER, type Ring } from './coastlines'
import { GEO_SATS, LEO_GATEWAY, type SatcomEngine } from './engine'
import { useSatcom, useSatcomState, type GlobeView } from './state'

const V = (a: [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2])
const three = (v: Vec3) => V(ecefToThree(v))
const surface = (p: LatLon, r = 1) => V(ecefToThree(sphericalToEcef(p))).multiplyScalar(r)
const UP = new THREE.Vector3(0, 1, 0)

export interface GlobeLabels {
  aircraft: RefObject<HTMLDivElement | null>
  sat: RefObject<HTMLDivElement | null>
  station: RefObject<HTMLDivElement | null>
  pole: RefObject<HTMLDivElement | null>
}

/** The rotatable Earth. Everything drawn here is read from the engine every frame. */
export function Globe3D({ className, labels, label }: { className?: string; labels: GlobeLabels; label: string }) {
  const { engine } = useSatcom()
  const constellation = useSatcomState((s) => s.constellation)
  const routeId = useSatcomState((s) => s.routeId)
  const view = useSatcomState((s) => s.view)
  const follow = useSatcomState((s) => s.follow)
  const setFollow = useSatcomState((s) => s.setFollow)
  const showFootprints = useSatcomState((s) => s.showFootprints)
  return (
    <Scene3D className={className} camera={{ position: [0, 3, 16], fov: 40 }} label={label}>
      {(t) => (
        <>
          <GlobeScene key={`${constellation}-${routeId}`} t={t} engine={engine} labels={labels} showFootprints={showFootprints} />
          <CameraRig engine={engine} view={view} follow={follow} setFollow={setFollow} />
        </>
      )}
    </Scene3D>
  )
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

function CameraRig({ engine, view, follow, setFollow }: { engine: SatcomEngine; view: GlobeView; follow: boolean; setFollow: (v: boolean) => void }) {
  const { camera, size, gl } = useThree()
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const fovHalf = toRad(40 / 2)
  const aspect = size.width / Math.max(1, size.height)
  // Near: the Earth fills most of the view. Orbit: the whole GEO ring (6.6 Earth radii) fits, seen from a little above the equator.
  const distance = view === 'near' ? 1.1 / Math.tan(fovHalf) / Math.min(1, aspect) + 0.3 : Math.max(13.5, 7.2 / Math.tan(fovHalf) / Math.min(aspect, 1.9)) + 1

  // Change the distance when the view preset changes, keeping the direction.
  useEffect(() => {
    const dir = camera.position.clone().normalize()
    camera.position.copy(dir.multiplyScalar(distance))
    camera.lookAt(0, 0, 0)
    controls.current?.update()
  }, [camera, distance])

  // Any drag on the globe hands the camera to the learner.
  useEffect(() => {
    const el = gl.domElement
    const stop = () => setFollow(false)
    el.addEventListener('pointerdown', stop)
    return () => el.removeEventListener('pointerdown', stop)
  }, [gl, setFollow])

  useFrame((_, delta) => {
    if (!follow) return
    const p = engine.routePoint.pos
    const lat = view === 'orbit' ? 16 + 0.15 * Math.max(-40, Math.min(40, p.lat)) : Math.max(-70, Math.min(70, p.lat)) + 8
    const target = surface({ lat: Math.min(80, lat), lon: p.lon })
    const cur = camera.position.clone()
    const r = cur.length()
    cur.normalize().lerp(target.normalize(), 1 - Math.exp(-Math.min(delta, 0.1) * 2.5)).normalize()
    camera.position.copy(cur.multiplyScalar(r))
    camera.lookAt(0, 0, 0)
    controls.current?.update()
  })

  return <OrbitControls ref={controls} enablePan={false} minDistance={1.35} maxDistance={30} rotateSpeed={0.5} zoomSpeed={0.7} enableDamping={false} />
}

// ---------------------------------------------------------------------------
// Earth texture (drawn at runtime from the theme tokens: nothing is downloaded)
// ---------------------------------------------------------------------------

function buildEarthTexture(t: ThemeTokens): THREE.CanvasTexture {
  const W = 2048
  const H = 1024
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = t['sim-water']
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
  ctx.lineJoin = 'round'
  ctx.lineWidth = 2
  for (const r of LAND) {
    path(r)
    ctx.fillStyle = t['sim-land']
    ctx.fill()
    ctx.strokeStyle = t['sim-neutral']
    ctx.stroke()
  }
  for (const r of WATER) {
    path(r)
    ctx.fillStyle = t['sim-water']
    ctx.fill()
    ctx.strokeStyle = t['sim-neutral']
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function gridLines(t: ThemeTokens): THREE.LineSegments {
  const pts: number[] = []
  const r = 1.0015
  const push = (a: THREE.Vector3, b: THREE.Vector3) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z)
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -180; lon < 180; lon += 4) push(surface({ lat, lon }, r), surface({ lat, lon: lon + 4 }, r))
  }
  for (let lon = -180; lon < 180; lon += 30) {
    for (let lat = -88; lat < 88; lat += 4) push(surface({ lat, lon }, r), surface({ lat: lat + 4, lon }, r))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: tc(t, 'sim-grid-strong'), transparent: true, opacity: 0.7 }))
}

/** A unit circle around +y at Earth-centre angle `halfDeg`, radius slightly above the surface. */
function ringGeometry(halfDeg: number, r = 1.004, n = 96): THREE.BufferGeometry {
  const h = toRad(halfDeg)
  const pts: THREE.Vector3[] = []
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2
    pts.push(new THREE.Vector3(Math.sin(h) * Math.cos(a) * r, Math.cos(h) * r, Math.sin(h) * Math.sin(a) * r))
  }
  return new THREE.BufferGeometry().setFromPoints(pts)
}

function capGeometry(halfDeg: number, r = 1.003): THREE.SphereGeometry {
  return new THREE.SphereGeometry(r, 64, 12, 0, Math.PI * 2, 0, toRad(halfDeg))
}

function dynamicLine(maxPoints: number, material: THREE.LineBasicMaterial | THREE.LineDashedMaterial): THREE.Line {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3))
  g.setDrawRange(0, 0)
  const l = new THREE.Line(g, material)
  l.frustumCulled = false
  return l
}

function setLine(line: THREE.Line, pts: THREE.Vector3[]) {
  const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute
  const n = Math.min(pts.length, attr.count)
  for (let k = 0; k < n; k++) attr.setXYZ(k, pts[k].x, pts[k].y, pts[k].z)
  attr.needsUpdate = true
  line.geometry.setDrawRange(0, n)
  if (line.material instanceof THREE.LineDashedMaterial) line.computeLineDistances()
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

function GlobeScene({ t, engine, labels, showFootprints }: { t: ThemeTokens; engine: SatcomEngine; labels: GlobeLabels; showFootprints: boolean }) {
  const geo = engine.constellation === 'geo'
  const light = useRef<THREE.DirectionalLight>(null)
  const { camera, size } = useThree()

  const objs = useMemo(() => {
    const root = new THREE.Group()
    const earthTex = buildEarthTexture(t)
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshStandardMaterial({ map: earthTex, roughness: 1, metalness: 0 }))
    root.add(earth)
    root.add(gridLines(t))

    // Route: the whole route, and the part already flown.
    const route = engine.route
    const total = engine.routeLengthNm
    const N = 240
    const routePts: THREE.Vector3[] = []
    for (let k = 0; k <= N; k++) routePts.push(surface(routePointAt(route, (k / N) * total).pos, 1.006))
    const routeAll = new THREE.Line(new THREE.BufferGeometry().setFromPoints(routePts), new THREE.LineDashedMaterial({ color: tc(t, 'sim-ink'), dashSize: 0.02, gapSize: 0.015 }))
    routeAll.computeLineDistances()
    const routeFlown = new THREE.Line(new THREE.BufferGeometry().setFromPoints(routePts), new THREE.LineBasicMaterial({ color: tc(t, 'sim-signal') }))
    root.add(routeAll, routeFlown)
    // End points.
    const endMat = new THREE.MeshStandardMaterial({ color: tc(t, 'sim-ink') })
    for (const w of [route.waypoints[0], route.waypoints[route.waypoints.length - 1]]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), endMat)
      m.position.copy(surface(w.pos, 1.004))
      root.add(m)
    }

    // Aircraft: a small arrow tangent to the surface, pointing along its heading.
    const aircraft = new THREE.Group()
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.075, 16), new THREE.MeshStandardMaterial({ color: tc(t, 'primary') }))
    body.rotation.x = -Math.PI / 2 // cone points along −z
    aircraft.add(body)
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.045, 32), new THREE.MeshBasicMaterial({ color: tc(t, 'primary'), side: THREE.DoubleSide, transparent: true, opacity: 0.8 }))
    halo.rotation.x = -Math.PI / 2
    aircraft.add(halo)
    root.add(aircraft)

    // Satellites.
    const satMat = new THREE.MeshStandardMaterial({ color: tc(t, 'sim-ink') })
    const panelMat = new THREE.MeshStandardMaterial({ color: tc(t, 'sim-signal-2'), side: THREE.DoubleSide })
    const geoMeshes: THREE.Group[] = []
    let leoMesh: THREE.InstancedMesh | null = null
    if (geo) {
      for (let i = 0; i < GEO_SATS.length; i++) {
        const g = new THREE.Group()
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), satMat))
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.01, 0.12), panelMat)
        g.add(panel)
        root.add(g)
        geoMeshes.push(g)
      }
    } else {
      leoMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 10, 8), new THREE.MeshStandardMaterial(), engine.leoSats.length) // default white base: the per-satellite token colours are set with setColorAt
      leoMesh.frustumCulled = false
      root.add(leoMesh)
    }
    const highlight = new THREE.Mesh(new THREE.SphereGeometry(geo ? 0.14 : 0.032, 20, 14), new THREE.MeshBasicMaterial({ color: tc(t, 'primary'), wireframe: true, transparent: true, opacity: 0.9 }))
    root.add(highlight)

    // Orbits.
    const orbitMat = new THREE.LineBasicMaterial({ color: tc(t, 'sim-neutral'), transparent: true, opacity: 0.55 })
    const orbitLines: THREE.Line[] = []
    if (geo) {
      const pts: THREE.Vector3[] = []
      for (let k = 0; k <= 180; k++) pts.push(three({ x: GEO_RADIUS_M * Math.cos((k / 180) * 2 * Math.PI), y: GEO_RADIUS_M * Math.sin((k / 180) * 2 * Math.PI), z: 0 }))
      root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), orbitMat))
    } else {
      for (let k = 0; k < LEO.planes; k++) {
        const l = dynamicLine(97, orbitMat)
        orbitLines.push(l)
        root.add(l)
      }
    }

    // Coverage footprints: a cap and an edge ring per satellite, rotated to its sub-satellite point.
    const coverage = alphaOf(t['sim-coverage'])
    const capMat = new THREE.MeshBasicMaterial({ color: tc(t, 'sim-coverage'), transparent: true, opacity: Math.min(0.4, coverage * 1.8), depthWrite: false, side: THREE.DoubleSide })
    const edgeMat = new THREE.LineBasicMaterial({ color: tc(t, 'sim-signal'), transparent: true, opacity: geo ? 0.85 : 0.4 })
    // Drawn for an observer at the route's cruise height, so the edge is exactly where the aircraft's link would end.
    const obsR = EARTH_RADIUS_M + ftToMetres(engine.route.cruiseAltitudeFt)
    const half = geo ? coverageHalfAngleDeg(GEO_RADIUS_M, GEO_MASK_DEG, obsR) : coverageHalfAngleDeg(LEO_RADIUS_M, LEO.maskDeg, obsR)
    const footprints = new THREE.Group()
    const capGeom = capGeometry(half)
    const edgeGeom = ringGeometry(half)
    const n = geo ? GEO_SATS.length : engine.leoSats.length
    const edges: THREE.LineLoop[] = []
    for (let i = 0; i < n; i++) {
      const e = new THREE.LineLoop(edgeGeom, edgeMat)
      edges.push(e)
      footprints.add(e)
    }
    // Only the satellite in use gets a filled cap: overlapping caps would hide the Earth.
    const servingCap = new THREE.Mesh(capGeom, capMat)
    footprints.add(servingCap)
    root.add(footprints)

    // Link: aircraft → satellite (→ satellites) → ground; dashed when blocked or switching.
    const link = dynamicLine(24, new THREE.LineBasicMaterial({ color: tc(t, 'sim-signal') }))
    const broken = dynamicLine(2, new THREE.LineDashedMaterial({ color: tc(t, 'sim-alert'), dashSize: 0.05, gapSize: 0.04 }))
    root.add(link, broken)

    // Ground stations.
    const stMat = new THREE.MeshStandardMaterial({ color: tc(t, 'sim-ink') })
    const stations = geo ? GEO_SATS.map((g) => g.station.pos) : [LEO_GATEWAY.pos]
    for (const p of stations) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.045, 4), stMat)
      m.position.copy(surface(p, 1.02))
      m.quaternion.setFromUnitVectors(UP, surface(p).normalize())
      root.add(m)
    }

    // The message travelling in the latency replay.
    const dot = new THREE.Mesh(new THREE.SphereGeometry(geo ? 0.08 : 0.025, 16, 12), new THREE.MeshBasicMaterial({ color: tc(t, 'sim-warning') }))
    dot.visible = false
    root.add(dot)

    return { root, earthTex, routeFlown, N, aircraft, geoMeshes, leoMesh, highlight, orbitLines, footprints, edges, servingCap, link, broken, dot }
  }, [t, engine, geo])

  useEffect(
    () => () => {
      objs.earthTex.dispose()
      objs.root.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          o.geometry.dispose()
          const m = o.material as THREE.Material | THREE.Material[]
          if (Array.isArray(m)) m.forEach((x) => x.dispose())
          else m.dispose()
        }
      })
    },
    [objs],
  )

  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), c: new THREE.Color(), p: new THREE.Vector3(), v: new THREE.Vector3() }), [])
  const colors = useMemo(() => ({ serving: new THREE.Color(tc(t, 'primary')), visible: new THREE.Color(tc(t, 'sim-ink')), other: new THREE.Color(tc(t, 'sim-neutral')) }), [t])

  useFrame(() => {
    const e = engine
    const o = objs
    if (light.current) light.current.position.copy(camera.position).add(new THREE.Vector3(2, 3, 0))
    o.footprints.visible = showFootprints

    // Aircraft.
    const acPos = three(e.aircraftEcef)
    const up = acPos.clone().normalize()
    const pos = e.routePoint.pos
    const north = surface({ lat: Math.min(89.999, pos.lat + 0.01), lon: pos.lon }).sub(surface({ lat: Math.max(-89.999, pos.lat - 0.01), lon: pos.lon }))
    north.addScaledVector(up, -north.dot(up)).normalize()
    const east = new THREE.Vector3().crossVectors(north, up).normalize()
    const h = toRad(e.headingDeg)
    const fwd = north.clone().multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h))
    // Basis: x = right (fwd × up), y = up (tilted by bank), z = −forward.
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize()
    const b = toRad(e.bankDeg)
    const upB = up.clone().multiplyScalar(Math.cos(b)).addScaledVector(right, Math.sin(b))
    const rightB = new THREE.Vector3().crossVectors(fwd, upB).normalize()
    tmp.m.makeBasis(rightB, upB, fwd.clone().negate())
    o.aircraft.quaternion.setFromRotationMatrix(tmp.m)
    o.aircraft.position.copy(up.clone().multiplyScalar(1.012))

    // Route flown.
    const frac = e.distanceNm / Math.max(1, e.routeLengthNm)
    o.routeFlown.geometry.setDrawRange(0, Math.max(0, Math.min(o.N + 1, Math.round(frac * o.N) + 1)))

    // Satellites and footprints.
    const serving = e.link.sat ?? e.link.target
    if (o.leoMesh) {
      for (let i = 0; i < e.satPos.length; i++) {
        tmp.p.copy(three(e.satPos[i]))
        tmp.m.makeTranslation(tmp.p.x, tmp.p.y, tmp.p.z)
        o.leoMesh.setMatrixAt(i, tmp.m)
        o.leoMesh.setColorAt(i, i === serving ? colors.serving : e.looks[i]?.visible ? colors.visible : colors.other)
      }
      o.leoMesh.instanceMatrix.needsUpdate = true
      if (o.leoMesh.instanceColor) o.leoMesh.instanceColor.needsUpdate = true
      // Orbit planes: the satellites' paths, turning with the Earth.
      for (let k = 0; k < o.orbitLines.length; k++) {
        setLine(o.orbitLines[k], orbitTrackEcef(e.leoSats[k * LEO.perPlane], e.timeS).map(three))
      }
    } else {
      for (let i = 0; i < o.geoMeshes.length; i++) {
        const g = o.geoMeshes[i]
        g.position.copy(three(e.satPos[i]))
        g.lookAt(0, 0, 0)
        g.scale.setScalar(i === serving ? 1.25 : 1)
      }
    }
    for (let i = 0; i < o.edges.length; i++) {
      const dir = three(e.satPos[i]).normalize()
      tmp.q.setFromUnitVectors(UP, dir)
      o.edges[i].quaternion.copy(tmp.q)
    }
    if (serving != null) {
      o.servingCap.visible = true
      o.servingCap.quaternion.setFromUnitVectors(UP, three(e.satPos[serving]).normalize())
    } else o.servingCap.visible = false
    o.highlight.visible = serving != null
    if (serving != null) o.highlight.position.copy(three(e.satPos[serving]))

    // Link lines.
    const path = e.livePath
    if (path && e.link.state === 'connected') {
      setLine(o.link, [path.legs[0].from, ...path.legs.map((l) => l.to)].map(three))
    } else o.link.geometry.setDrawRange(0, 0)
    const other = e.link.state === 'handover' ? e.link.target : e.link.state === 'blocked' ? e.bestVisible() : null
    if (other != null) setLine(o.broken, [acPos, three(e.satPos[other])])
    else o.broken.geometry.setDrawRange(0, 0)

    // Replay dot.
    const rp = e.replayPosition()
    o.dot.visible = rp != null
    if (rp) o.dot.position.copy(three(rp))

    // DOM labels.
    const station = geo ? (serving != null ? GEO_SATS[serving].station.pos : null) : LEO_GATEWAY.pos
    placeLabel(labels.aircraft.current, acPos, camera, size)
    placeLabel(labels.sat.current, serving != null ? three(e.satPos[serving]) : null, camera, size)
    placeLabel(labels.station.current, station ? surface(station, 1.02) : null, camera, size)
    placeLabel(labels.pole.current, e.routeId === 'polar' ? new THREE.Vector3(0, 1.01, 0) : null, camera, size)
  })

  return (
    <>
      <ambientLight intensity={1.6} />
      <directionalLight ref={light} intensity={1.1} />
      <primitive object={objs.root} />
    </>
  )
}

/** Position a DOM label over a 3D point; hide it when the Earth is in the way or it is off screen. */
function placeLabel(el: HTMLDivElement | null, p: THREE.Vector3 | null, camera: THREE.Camera, size: { width: number; height: number }) {
  if (!el) return
  if (!p || occludedByEarth(camera.position, p)) {
    el.style.visibility = 'hidden'
    return
  }
  const v = p.clone().project(camera)
  if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) {
    el.style.visibility = 'hidden'
    return
  }
  const x = ((v.x + 1) / 2) * size.width
  const y = ((1 - v.y) / 2) * size.height
  el.style.visibility = 'visible'
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
}

/** True when the straight line from the camera to p passes through the Earth (radius 1) before reaching p. */
function occludedByEarth(cam: THREE.Vector3, p: THREE.Vector3): boolean {
  const d = p.clone().sub(cam)
  const a = d.dot(d)
  const bq = 2 * cam.dot(d)
  const c = cam.dot(cam) - 1
  const disc = bq * bq - 4 * a * c
  if (disc <= 0) return false
  const t1 = (-bq - Math.sqrt(disc)) / (2 * a)
  return t1 > 0 && t1 < 0.999
}
