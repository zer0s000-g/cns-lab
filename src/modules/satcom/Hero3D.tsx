/**
 * The SATCOM hero: a small Earth on a stand, the geostationary ring or the
 * low-orbit constellation around it, and the aircraft flying its route. The
 * geometry is lifted from Globe3D; every pose, the link and the message
 * replay are read from the unchanged SatcomEngine each frame.
 *
 * Scale: the Earth and the orbits are to scale with each other (the GEO ring
 * really is about 6.6 Earth radii across the centre). The satellites, the
 * aircraft and the ground stations are drawn far larger than life; the page
 * labels both.
 *
 * Frame: north is up (+y) and the equator is the x-z plane. While "Follow the
 * aircraft" is on, the whole globe turns about its axis so the aircraft's
 * longitude faces the front of the stage (+z); this is a view rotation only.
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { StoreApi } from 'zustand'
import { toRad, type LatLon, type Vec3 } from '@/core/geometry'
import { coverageHalfAngleDeg, ecefToThree, GEO_ALTITUDE_KM, GEO_MASK_DEG, GEO_RADIUS_M, LEO, LEO_RADIUS_M, orbitTrackEcef, routePointAt, sphericalToEcef } from '@/core/satcom'
import { EARTH_RADIUS_M, ftToMetres } from '@/core/units'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { Callout3D } from '@/stage/Callout3D'
import { AircraftModel } from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'
import { LAND, WATER, type Ring } from './coastlines'
import { GEO_SATS, LEO_GATEWAY, type Constellation, type RouteId, type SatcomEngine } from './engine'
import { formatMs, STATE_TEXT } from './format'
import { GEO_U, LEO_U, R_U, STAND_FLOOR_Y } from './heroScale'
import type { SatcomState } from './state'

const V3 = (a: [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2])
/** ECEF (m) → globe units (1 = one Earth radius; the globe group is scaled by R_U). */
const three = (v: Vec3, out = new THREE.Vector3()) => out.set(...ecefToThree(v))
const surface = (p: LatLon, r = 1) => V3(ecefToThree(sphericalToEcef(p))).multiplyScalar(r)
const UP = new THREE.Vector3(0, 1, 0)

// ---------------------------------------------------------------------------
// Geometry helpers (from Globe3D)
// ---------------------------------------------------------------------------

function earthTexture(t: ThemeTokens): THREE.CanvasTexture {
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
  ctx.lineJoin = 'round'
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
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function gridGeometry(): THREE.BufferGeometry {
  const pts: number[] = []
  const r = 1.0015
  const push = (a: THREE.Vector3, b: THREE.Vector3) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z)
  for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 4) push(surface({ lat, lon }, r), surface({ lat, lon: lon + 4 }, r))
  for (let lon = -180; lon < 180; lon += 30) for (let lat = -88; lat < 88; lat += 4) push(surface({ lat, lon }, r), surface({ lat: lat + 4, lon }, r))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

/** A circle around +y at Earth-centre angle `halfDeg`, just above the surface. */
function ringGeometry(halfDeg: number, r = 1.004, n = 96): THREE.BufferGeometry {
  const h = toRad(halfDeg)
  const pts: THREE.Vector3[] = []
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2
    pts.push(new THREE.Vector3(Math.sin(h) * Math.cos(a) * r, Math.cos(h) * r, Math.sin(h) * Math.sin(a) * r))
  }
  return new THREE.BufferGeometry().setFromPoints(pts)
}

function dynamicLine(maxPoints: number, material: THREE.Material): THREE.Line {
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

/** True when the Earth (radius `r`, at the origin) hides p from the camera. */
function hiddenByEarth(cam: THREE.Vector3, p: THREE.Vector3, r: number): boolean {
  const d = p.clone().sub(cam)
  const a = d.dot(d)
  const b = 2 * cam.dot(d)
  const c = cam.dot(cam) - r * r
  const disc = b * b - 4 * a * c
  if (disc <= 0) return false
  const t1 = (-b - Math.sqrt(disc)) / (2 * a)
  return t1 > 0 && t1 < 0.999
}

// ---------------------------------------------------------------------------

export function SatcomHero({
  t,
  engine,
  store,
  constellation,
  routeId,
}: {
  t: ThemeTokens
  engine: SatcomEngine
  store: StoreApi<SatcomState>
  constellation: Constellation
  routeId: RouteId
}) {
  // Rebuild the scene when the constellation or the route changes (the reveal replays too).
  return <GlobeScene key={`${constellation}-${routeId}`} t={t} engine={engine} store={store} />
}

function GlobeScene({ t, engine, store }: { t: ThemeTokens; engine: SatcomEngine; store: StoreApi<SatcomState> }) {
  const geo = engine.constellation === 'geo'
  const camera = useThree((s) => s.camera)
  const width = useThree((s) => s.size.width)
  const spin = useRef<THREE.Group>(null)
  const spinAngle = useRef<number | null>(null)
  const acLabel = useRef<HTMLDivElement>(null)
  const acText = useRef<HTMLSpanElement>(null)
  const acLabelR = useRef<HTMLDivElement>(null)
  const acTextR = useRef<HTMLSpanElement>(null)
  const satLabel = useRef<HTMLDivElement>(null)
  const satText = useRef<HTMLSpanElement>(null)
  const satAnchor = useRef<THREE.Group>(null)
  const stLabel = useRef<HTMLDivElement>(null)
  const stText = useRef<HTMLSpanElement>(null)
  const stLabelL = useRef<HTMLDivElement>(null)
  const stTextL = useRef<HTMLSpanElement>(null)
  const stAnchor = useRef<THREE.Group>(null)
  const poleLabel = useRef<HTMLDivElement>(null)
  const acAnchor = useRef<THREE.Group>(null)
  const ringLabel = useRef<HTMLDivElement>(null)
  const ringAnchor = useRef<THREE.Group>(null)

  const objs = useMemo(() => {
    const root = new THREE.Group()
    const hw = new THREE.Group()
    const earthTex = earthTexture(t)
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 64),
      new THREE.MeshStandardMaterial({ map: earthTex, emissiveMap: earthTex, emissive: col(t, 'stage-paint'), emissiveIntensity: 0.55, roughness: 1, metalness: 0 }),
    )
    root.add(earth)
    root.add(new THREE.LineSegments(gridGeometry(), new THREE.LineBasicMaterial({ color: col(t, 'stage-line'), transparent: true, opacity: 0.16, depthWrite: false })))

    // Route: the whole route (dashed), and the part already flown (cyan).
    const route = engine.route
    const total = engine.routeLengthNm
    const N = 240
    const routePts: THREE.Vector3[] = []
    for (let k = 0; k <= N; k++) routePts.push(surface(routePointAt(route, (k / N) * total).pos, 1.006))
    const routeAll = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(routePts),
      new THREE.LineDashedMaterial({ color: col(t, 'stage-line'), dashSize: 0.02, gapSize: 0.015, transparent: true, opacity: 0.7 }),
    )
    routeAll.computeLineDistances()
    const routeFlown = new THREE.Line(new THREE.BufferGeometry().setFromPoints(routePts), new THREE.LineBasicMaterial({ color: col(t, 'stage-signal'), toneMapped: false }))
    root.add(routeAll, routeFlown)
    const endMat = new THREE.MeshBasicMaterial({ color: col(t, 'stage-paint') })
    for (const w of [route.waypoints[0], route.waypoints[route.waypoints.length - 1]]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), endMat)
      m.position.copy(surface(w.pos, 1.004))
      root.add(m)
    }

    // Satellites: GEO buses with brass solar wings (hardware), or 66 instanced LEO satellites.
    const busMat = new THREE.MeshStandardMaterial({ color: col(t, 'stage-paint'), roughness: 0.4, metalness: 0.5 })
    const wingMat = new THREE.MeshStandardMaterial({ color: col(t, 'stage-brass'), roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide })
    const geoMeshes: THREE.Group[] = []
    let leoMesh: THREE.InstancedMesh | null = null
    if (geo) {
      for (let i = 0; i < GEO_SATS.length; i++) {
        const g = new THREE.Group()
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.16), busMat))
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.12), wingMat))
        const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 0.03, 20), busMat)
        dish.rotation.x = Math.PI / 2
        dish.position.z = 0.1
        g.add(dish)
        hw.add(g)
        geoMeshes.push(g)
      }
    } else {
      // White base colour: the per-satellite token colours are set with setColorAt.
      leoMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.026, 0.026, 0.026), new THREE.MeshBasicMaterial({ toneMapped: false }), engine.leoSats.length)
      leoMesh.frustumCulled = false
      leoMesh.userData.noPenPlot = true
      root.add(leoMesh)
    }
    const highlight = new THREE.Mesh(
      new THREE.SphereGeometry(geo ? 0.13 : 0.04, 16, 12),
      new THREE.MeshBasicMaterial({ color: col(t, 'stage-signal'), wireframe: true, transparent: true, opacity: 0.45, toneMapped: false }),
    )
    root.add(highlight)

    // Orbits.
    const orbitMat = new THREE.LineBasicMaterial({ color: col(t, 'stage-line'), transparent: true, opacity: 0.32, depthWrite: false })
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

    // Coverage footprints, drawn for an observer at cruise height so the edge is where the link ends.
    const capMat = new THREE.MeshBasicMaterial({ color: col(t, 'stage-signal'), transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    const edgeMat = new THREE.LineBasicMaterial({ color: col(t, 'stage-signal'), transparent: true, opacity: geo ? 0.75 : 0.3, toneMapped: false })
    const obsR = EARTH_RADIUS_M + ftToMetres(engine.route.cruiseAltitudeFt)
    const half = geo ? coverageHalfAngleDeg(GEO_RADIUS_M, GEO_MASK_DEG, obsR) : coverageHalfAngleDeg(LEO_RADIUS_M, LEO.maskDeg, obsR)
    const footprints = new THREE.Group()
    const edgeGeom = ringGeometry(half)
    const n = geo ? GEO_SATS.length : engine.leoSats.length
    const edges: THREE.LineLoop[] = []
    for (let i = 0; i < n; i++) {
      const e = new THREE.LineLoop(edgeGeom, edgeMat)
      edges.push(e)
      footprints.add(e)
    }
    // Only the satellite in use gets a filled cap: overlapping caps would hide the Earth.
    const servingCap = new THREE.Mesh(new THREE.SphereGeometry(1.003, 64, 12, 0, Math.PI * 2, 0, toRad(half)), capMat)
    footprints.add(servingCap)
    root.add(footprints)

    // Link: aircraft → satellite (→ satellites) → ground; red dashes when blocked or switching.
    const link = dynamicLine(24, new THREE.LineBasicMaterial({ color: col(t, 'stage-signal'), toneMapped: false }))
    const broken = dynamicLine(2, new THREE.LineDashedMaterial({ color: col(t, 'stage-alert'), dashSize: 0.05, gapSize: 0.04, toneMapped: false }))
    root.add(link, broken)

    // Ground stations (hardware): a mast and a dish.
    const stMat = new THREE.MeshStandardMaterial({ color: col(t, 'stage-paint'), roughness: 0.5, metalness: 0.4 })
    const stations = geo ? GEO_SATS.map((g) => g.station.pos) : [LEO_GATEWAY.pos]
    for (const p of stations) {
      const g = new THREE.Group()
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.05, 8), stMat)
      mast.position.y = 0.025
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.006, 0.01, 16), stMat)
      dish.position.y = 0.055
      dish.rotation.z = 0.5
      g.add(mast, dish)
      g.position.copy(surface(p, 1.002))
      g.quaternion.setFromUnitVectors(UP, surface(p).normalize())
      hw.add(g)
    }

    // The message travelling in the latency replay.
    const dot = new THREE.Mesh(new THREE.SphereGeometry(geo ? 0.07 : 0.022, 16, 12), new THREE.MeshBasicMaterial({ color: col(t, 'stage-brass'), toneMapped: false }))
    dot.visible = false
    root.add(dot)

    // Heavy rain along the route: a haze of drops below the rain height (drawn thicker than life).
    const rainPts: number[] = []
    for (let k = 0; k < 900; k++) {
      const f = (k * 0.618034) % 1
      const p = routePointAt(route, f * total).pos
      const jitterLat = (((k * 37) % 17) / 17 - 0.5) * 3
      const jitterLon = (((k * 53) % 19) / 19 - 0.5) * 4
      const r = 1.004 + (((k * 29) % 13) / 13) * 0.02
      const v = surface({ lat: Math.max(-89, Math.min(89, p.lat + jitterLat)), lon: p.lon + jitterLon }, r)
      rainPts.push(v.x, v.y, v.z)
    }
    const rainGeo = new THREE.BufferGeometry()
    rainGeo.setAttribute('position', new THREE.Float32BufferAttribute(rainPts, 3))
    const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: col(t, 'stage-glass'), size: 0.012, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }))
    rain.visible = false
    root.add(rain)

    return { root, hw, earthTex, routeFlown, N, geoMeshes, leoMesh, highlight, orbitLines, footprints, edges, servingCap, link, broken, dot, rain }
  }, [t, engine, geo])

  useLayoutEffect(
    () => () => {
      objs.earthTex.dispose()
      for (const g of [objs.root, objs.hw]) {
        g.traverse((o) => {
          if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) {
            o.geometry.dispose()
            const m = o.material as THREE.Material | THREE.Material[]
            if (Array.isArray(m)) m.forEach((x) => x.dispose())
            else m.dispose()
          }
        })
      }
    },
    [objs],
  )

  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), w: new THREE.Vector3(), c: new THREE.Vector3() }), [])
  const colors = useMemo(() => ({ serving: col(t, 'stage-signal'), visible: col(t, 'stage-paint'), other: col(t, 'stage-metal') }), [t])
  const lineColor = useMemo(() => col(t, 'stage-line'), [t])
  const aircraft = useRef<THREE.Group>(null)

  useFrame((_, dtReal) => {
    const e = engine
    const o = objs
    const st = store.getState()
    o.footprints.visible = st.showFootprints
    o.rain.visible = e.env.heavyRain

    // View rotation: bring the aircraft's longitude to the front while following.
    const pos = e.routePoint.pos
    const want = toRad(-90 - pos.lon)
    if (spinAngle.current === null) spinAngle.current = want
    if (st.follow) {
      let d = want - spinAngle.current
      d = Math.atan2(Math.sin(d), Math.cos(d))
      spinAngle.current += d * (1 - Math.exp(-Math.min(dtReal, 0.1) / 0.5))
    }
    if (spin.current) spin.current.rotation.y = spinAngle.current

    // Aircraft: along its heading, banked as the engine says.
    const acPos = three(e.aircraftEcef)
    const up = acPos.clone().normalize()
    const north = surface({ lat: Math.min(89.999, pos.lat + 0.01), lon: pos.lon }).sub(surface({ lat: Math.max(-89.999, pos.lat - 0.01), lon: pos.lon }))
    north.addScaledVector(up, -north.dot(up)).normalize()
    const east = new THREE.Vector3().crossVectors(north, up).normalize()
    const h = toRad(e.headingDeg)
    const fwd = north.clone().multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h))
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize()
    const b = toRad(e.bankDeg)
    const upB = up.clone().multiplyScalar(Math.cos(b)).addScaledVector(right, Math.sin(b))
    const rightB = new THREE.Vector3().crossVectors(fwd, upB).normalize()
    tmp.m.makeBasis(rightB, upB, fwd.clone().negate())
    if (aircraft.current) {
      aircraft.current.quaternion.setFromRotationMatrix(tmp.m)
      aircraft.current.position.copy(up.clone().multiplyScalar(1.012))
    }
    if (acAnchor.current) acAnchor.current.position.copy(up.clone().multiplyScalar(1.07))

    // Route flown.
    const frac = e.distanceNm / Math.max(1, e.routeLengthNm)
    o.routeFlown.geometry.setDrawRange(0, Math.max(0, Math.min(o.N + 1, Math.round(frac * o.N) + 1)))

    // Satellites and footprints.
    const serving = e.link.sat ?? e.link.target
    if (o.leoMesh) {
      for (let i = 0; i < e.satPos.length; i++) {
        three(e.satPos[i], tmp.p)
        tmp.m.makeTranslation(tmp.p.x, tmp.p.y, tmp.p.z)
        o.leoMesh.setMatrixAt(i, tmp.m)
        o.leoMesh.setColorAt(i, i === serving ? colors.serving : e.looks[i]?.visible ? colors.visible : colors.other)
      }
      o.leoMesh.instanceMatrix.needsUpdate = true
      if (o.leoMesh.instanceColor) o.leoMesh.instanceColor.needsUpdate = true
      for (let k = 0; k < o.orbitLines.length; k++) setLine(o.orbitLines[k], orbitTrackEcef(e.leoSats[k * LEO.perPlane], e.timeS).map((v) => three(v)))
    } else {
      for (let i = 0; i < o.geoMeshes.length; i++) {
        const g = o.geoMeshes[i]
        three(e.satPos[i], g.position)
        g.lookAt(0, 0, 0)
        g.scale.setScalar(i === serving ? 1.25 : 1)
      }
    }
    for (let i = 0; i < o.edges.length; i++) {
      tmp.q.setFromUnitVectors(UP, three(e.satPos[i], tmp.p).normalize())
      o.edges[i].quaternion.copy(tmp.q)
    }
    if (serving != null) {
      o.servingCap.visible = true
      o.servingCap.quaternion.setFromUnitVectors(UP, three(e.satPos[serving], tmp.p).normalize())
      o.highlight.visible = true
      three(e.satPos[serving], o.highlight.position)
    } else {
      o.servingCap.visible = false
      o.highlight.visible = false
    }

    // Link lines.
    const path = e.livePath
    if (path && e.link.state === 'connected') setLine(o.link, [path.legs[0].from, ...path.legs.map((l) => l.to)].map((v) => three(v)))
    else o.link.geometry.setDrawRange(0, 0)
    const other = e.link.state === 'handover' ? e.link.target : e.link.state === 'blocked' ? e.bestVisible() : null
    if (other != null) setLine(o.broken, [acPos, three(e.satPos[other])])
    else o.broken.geometry.setDrawRange(0, 0)

    // Replay dot: the message on its way (the world is frozen meanwhile).
    const rp = e.replayPosition()
    o.dot.visible = rp != null
    if (rp) three(rp, o.dot.position)

    // Labels: text from the engine; hidden when the Earth is in the way.
    const cam = camera.position
    const show = (el: HTMLDivElement | null, anchor: THREE.Object3D | null, on: boolean) => {
      if (!el) return
      let vis = on
      if (vis && anchor) {
        anchor.getWorldPosition(tmp.w)
        vis = !hiddenByEarth(cam, tmp.w, R_U)
      }
      el.style.display = vis ? '' : 'none'
    }
    const setText = (el: HTMLSpanElement | null, s: string) => {
      if (el && el.textContent !== s) el.textContent = s
    }
    const state = STATE_TEXT[e.link.state].toUpperCase()
    const delay = path && e.link.state === 'connected' ? ` · ${formatMs(path.propagationS)} ONE WAY` : ''
    // The aircraft tag goes on whichever side has room: right when the aircraft is left of centre
    // (clear of the chapter panel), left otherwise. The station tag takes the other side.
    let acRight = false
    if (acAnchor.current) {
      acAnchor.current.getWorldPosition(tmp.c)
      // On a phone the stage is full width with no panel beside it, so split at the centre.
      acRight = tmp.c.project(camera).x < (width < 768 ? 0 : 0.45)
    }
    const acTxt = `AIRCRAFT · ${state}${delay}`
    setText(acText.current, acTxt)
    setText(acTextR.current, acTxt)
    show(acLabel.current, acAnchor.current, !acRight)
    show(acLabelR.current, acAnchor.current, acRight)
    if (satAnchor.current && serving != null) three(e.satPos[serving], satAnchor.current.position)
    setText(satText.current, serving != null ? e.satName(serving).toUpperCase() : '')
    show(satLabel.current, satAnchor.current, serving != null)
    const station = geo ? (serving != null ? GEO_SATS[serving].station : null) : LEO_GATEWAY
    if (stAnchor.current && station) stAnchor.current.position.copy(surface(station.pos, 1.03))
    const stTxt = station ? station.name.toUpperCase() : ''
    setText(stText.current, stTxt)
    setText(stTextL.current, stTxt)
    show(stLabel.current, stAnchor.current, station != null && !acRight)
    show(stLabelL.current, stAnchor.current, station != null && acRight)
    show(poleLabel.current, null, e.routeId === 'polar')
    if (ringAnchor.current) show(ringLabel.current, ringAnchor.current, true)
  })

  // The orbit tag sits in world space (it does not turn with the globe), front right.
  const ringTag: [number, number, number] = geo
    ? [Math.sin(toRad(8)) * GEO_U, 0, Math.cos(toRad(8)) * GEO_U]
    : [0.45 * LEO_U, -0.35 * LEO_U, 0.82 * LEO_U]

  return (
    <group>
      <StudioFloor t={t} y={STAND_FLOOR_Y} shadowScale={14} />
      {/* Desk-globe stand: a column and a base under the Earth. */}
      <PenPlot color={lineColor}>
        <mesh position={[0, (STAND_FLOOR_Y - R_U) / 2, 0]}>
          <cylinderGeometry args={[0.06, 0.1, -STAND_FLOOR_Y - R_U, 20]} />
          <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.35} metalness={0.8} />
        </mesh>
        <mesh position={[0, STAND_FLOOR_Y + 0.06, 0]}>
          <cylinderGeometry args={[0.9, 1.05, 0.12, 48]} />
          <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.5} metalness={0.6} />
        </mesh>
      </PenPlot>
      {/* Earth's axis. */}
      <mesh userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.01, 0.01, R_U * 2.3, 8]} />
        <meshBasicMaterial color={col(t, 'stage-brass')} toneMapped={false} />
      </mesh>

      <group ref={spin}>
        <group scale={R_U}>
          <primitive object={objs.root} />
          <PenPlot color={lineColor}>
            <primitive object={objs.hw} />
            <group ref={aircraft}>
              <group scale={0.34}>
                <AircraftModel t={t} />
              </group>
            </group>
          </PenPlot>
          <group ref={acAnchor}>
            <Callout3D position={[0, 0, 0]} tone="signal" side="left" lead={26} rootRef={acLabel}>
              <span ref={acText}>AIRCRAFT</span>
            </Callout3D>
            <Callout3D position={[0, 0, 0]} tone="signal" lead={26} rootRef={acLabelR}>
              <span ref={acTextR}>AIRCRAFT</span>
            </Callout3D>
          </group>
          <group ref={satAnchor}>
            <Callout3D position={[0, 0.12, 0]} tone="signal" lead={14} rootRef={satLabel}>
              <span ref={satText} />
            </Callout3D>
          </group>
          <group ref={stAnchor}>
            <Callout3D position={[0, 0, 0]} lead={14} rootRef={stLabel}>
              <span ref={stText} />
            </Callout3D>
            <Callout3D position={[0, 0, 0]} side="left" lead={14} rootRef={stLabelL}>
              <span ref={stTextL} />
            </Callout3D>
          </group>
          <Callout3D position={[0, 1.02, 0]} side="left" lead={18} rootRef={poleLabel}>
            NORTH POLE
          </Callout3D>
        </group>
      </group>
      <group ref={ringAnchor} position={ringTag}>
        <Callout3D position={[0, 0, 0]} lead={14} rootRef={ringLabel}>
          {geo
            ? `GEO RING · ${Math.round(GEO_ALTITUDE_KM).toLocaleString('en-US')} KM UP · TO SCALE`
            : `LOW ORBITS · ABOUT ${Math.round(LEO.altitudeM / 1000)} KM UP · TO SCALE`}
        </Callout3D>
      </group>
    </group>
  )
}

export default SatcomHero
