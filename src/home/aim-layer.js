// Aims: extra bone rotations in the character's own axes (pitch/yaw/roll, degrees),
// layered over whatever clip is playing. The site uses them to point his eye and
// head at the pointer and to blink; the Cat Lab uses them to pose him.
//
// three's AnimationMixer only writes a bone when its clip value changes: constant
// tracks and held keys are written once. An aim can't simply be multiplied onto the
// bone every frame — wherever the mixer didn't write, it would stack on top of last
// frame's aim and the bone would spin. So each frame undoes the aims before the
// mixer runs, then re-applies them to the pose the clip left.
// Regression check: node tools/cat/check_aims.mjs
import { Euler, MathUtils, Quaternion } from 'three/webgpu'

// rest: Map(bone -> { node, local, world }): each bone's rest rotation relative to
// its parent and to the model. Axes match tools/cat/build_cat.py, so a pose made in
// the lab bakes identically in Blender.
export function createAimLayer(rest) {
  const aims = new Map()
  const unaimed = new Map() // the pose each aimed bone had before its aim
  const q = new Quaternion()
  const e = new Euler()
  const toBone = new Quaternion()
  const d = MathUtils.degToRad
  return {
    // A rotation for `bone` in degrees, or null to clear it.
    set(bone, rotation) {
      if (rotation) aims.set(bone, rotation)
      else aims.delete(bone)
    },
    // Before the mixer runs: put back the pose the clip left.
    undo() {
      for (const [name, pose] of unaimed) rest.get(name).node.quaternion.copy(pose)
    },
    // After the mixer: remember that pose, then aim.
    apply() {
      unaimed.clear()
      for (const [name, { pitch = 0, yaw = 0, roll = 0 }] of aims) {
        const r = rest.get(name)
        if (!r) continue
        unaimed.set(name, r.node.quaternion.clone())
        // Blender Z-up -> three Y-up: pitch X->X, roll Y->-Z, yaw Z->Y.
        q.setFromEuler(e.set(d(pitch), d(yaw), d(-roll), 'YZX'))
        r.node.quaternion.multiply(toBone.copy(r.world).invert().multiply(q).multiply(r.world))
      }
    },
    // After a hard reset to rest: nothing to undo.
    reset() {
      unaimed.clear()
    },
  }
}
