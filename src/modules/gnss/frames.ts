import * as THREE from 'three'
import { earthRotationAngleRad } from '@/core/gnss'
import { WGS84_A_M, type Vec3 } from '@/core/geometry'
import type { GnssEngine } from './engine'

/**
 * three.js axes for Earth-centred frames: X → +x, north pole (Z) → +y, Y → −z.
 * This is a proper rotation, so ECI and ECEF keep their handedness; one unit is
 * one Earth equatorial radius. Earth-fixed things live in a group rotated about
 * +y by the Earth-rotation angle, which is exactly ECEF → ECI.
 */
export function toThree(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x / WGS84_A_M, v.z / WGS84_A_M, -v.y / WGS84_A_M)
}

export const Y_AXIS = new THREE.Vector3(0, 1, 0)

/** Receiver position in world (inertial) three.js coordinates: ECEF → ECI is a turn about +y by the Earth-rotation angle. */
export function receiverWorld(e: GnssEngine): THREE.Vector3 {
  return toThree(e.receiverEcef).applyAxisAngle(Y_AXIS, earthRotationAngleRad(e.timeS))
}
