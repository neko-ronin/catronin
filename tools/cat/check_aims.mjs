// Regression check for src/home/aim-layer.js: an aim held for many frames must sit
// exactly on top of the clip's pose, frame after frame, never stacking on itself.
// This is the bug that made Cat Ronin's eye spin: the mixer writes a constant track
// only once, so an aim multiplied onto the bone every frame kept accumulating.
//   node tools/cat/check_aims.mjs
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { createAimLayer } from '../../src/home/aim-layer.js'

const quat = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray()
// Angle between unit quaternions, in degrees. 2·atan2(|a−b|, |a+b|) instead of
// Quaternion.angleTo's acos(dot), which turns float32 rounding into ~0.02°.
function degreesApart(a, b) {
  const s = a.dot(b) < 0 ? -1 : 1
  const [ax, ay, az, aw] = a.toArray(), [bx, by, bz, bw] = b.toArray()
  const diff = Math.hypot(ax - s * bx, ay - s * by, az - s * bz, aw - s * bw)
  const sum = Math.hypot(ax + s * bx, ay + s * by, az + s * bz, aw + s * bw)
  return THREE.MathUtils.radToDeg(2 * Math.atan2(diff, sum))
}
const CLIPS = {
  constant: new THREE.QuaternionKeyframeTrack('eyeL.quaternion', [0, 2], [...quat(0, 0, 0), ...quat(0, 0, 0)]),
  moving: new THREE.QuaternionKeyframeTrack('eyeL.quaternion', [0, 1, 2], [...quat(0, 0, 0), ...quat(0.4, 0.2, 0), ...quat(0, 0, 0)]),
}

for (const [label, track] of Object.entries(CLIPS)) {
  const root = new THREE.Object3D()
  const bone = new THREE.Object3D()
  bone.name = 'eyeL'
  root.add(bone)
  root.updateMatrixWorld(true)
  const rest = new Map([['eye.L', { node: bone, local: bone.quaternion.clone(), world: bone.getWorldQuaternion(new THREE.Quaternion()) }]])

  const mixer = new THREE.AnimationMixer(root)
  const action = mixer.clipAction(new THREE.AnimationClip(label, 2, [track]))
  action.play()
  const clipAt = track.createInterpolant()
  const aim = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(7), 0, 'YZX'))

  const layer = createAimLayer(rest)
  layer.set('eye.L', { yaw: 7 })
  for (let frame = 0; frame < 240; frame++) {
    layer.undo()
    mixer.update(1 / 60)
    layer.apply()
    const expected = new THREE.Quaternion().fromArray(clipAt.evaluate(action.time)).multiply(aim)
    const off = degreesApart(bone.quaternion, expected)
    assert.ok(off < 0.001, `${label} clip, frame ${frame}: bone is ${off.toFixed(3)}° away from clip pose + 7° aim`)
  }
  console.log(`ok: ${label} clip, 7° aim held exactly for 240 frames`)
}
