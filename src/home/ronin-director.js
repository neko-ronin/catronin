// Cat Ronin's behaviour on the site: which clip plays when, where he looks, and
// when he blinks. Everything layers on ronin.play() and ronin.aim().
//
// Gaze works like a person's, not a turret's: the eye jumps to a target and
// holds it (a saccade), only re-targeting when the pointer has moved far enough
// or enough time has passed; the head follows slowly and does most of the
// turning. The eye itself only ever slides a few degrees (see eye.L's pivot in
// tools/cat/build_cat.py), which keeps it reading as a cartoon eye.
const EYE = { yaw: 7, pitch: 6 } // max degrees
const HEAD = { yaw: 16, pitch: 9 }
// How much each clip lets the pointer steer him (the clip's own looks win).
const ATTENTION = { sit: 1, sit_present: 0.3, sit_lookaround: 0.25, sit_doze: 0 }

const clamp = (v) => Math.max(-1, Math.min(1, v))
const approach = (from, to, rate, dt) => from + (to - from) * (1 - Math.exp(-rate * dt))

export function createDirector(ronin) {
  let nextGlance = 8
  let lastMove = 0
  let dozing = false
  const want = { yaw: 0, pitch: 0 } // where the pointer is, normalised -1..1
  const fix = { yaw: 0, pitch: 0 } // the eye's current saccade target
  const eye = { yaw: 0, pitch: 0 }
  const head = { yaw: 0, pitch: 0 }
  let refixAt = 0
  let attention = 0
  let lid = 0
  let blinkAt = 2

  return {
    start() {
      lastMove = performance.now() / 1000
      ronin.play('sit_present', { fade: 0.3, then: 'sit' })
    },
    reset() {
      dozing = false
      ronin.play('sit', { fade: 0 })
    },
    // pointer and headScreen in normalised device coordinates (-1..1, y up).
    tick(t, dt, pointer, headScreen, moved) {
      if (moved) {
        lastMove = t
        if (dozing) {
          dozing = false
          ronin.play('sit_lookaround', { then: 'sit' })
          nextGlance = t + 10
        }
      }
      if (!dozing && t - lastMove > 25) {
        dozing = true
        ronin.play('sit_doze', { fade: 1.2 })
      } else if (!dozing && t > nextGlance && ronin.clip === 'sit') {
        ronin.play('sit_lookaround', { then: 'sit' })
        nextGlance = t + 12 + Math.random() * 8
      }

      want.yaw = clamp((pointer.x - headScreen.x) / 0.9)
      want.pitch = clamp(-(pointer.y - headScreen.y) / 0.9) // pointer below -> look down (+)
      if (Math.hypot(want.yaw - fix.yaw, want.pitch - fix.pitch) > 0.18 || t > refixAt) {
        fix.yaw = want.yaw + (Math.random() - 0.5) * 0.06 // never dead-centre: tiny misses read as alive
        fix.pitch = want.pitch + (Math.random() - 0.5) * 0.06
        refixAt = t + 0.6 + Math.random() * 1.8
      }
      eye.yaw = approach(eye.yaw, fix.yaw, 28, dt) // saccade: fast, then hold
      eye.pitch = approach(eye.pitch, fix.pitch, 28, dt)
      head.yaw = approach(head.yaw, want.yaw, 2.5, dt) // the head catches up slowly
      head.pitch = approach(head.pitch, want.pitch, 2.5, dt)
      attention = approach(attention, ATTENTION[ronin.clip] ?? 0.5, 3, dt)

      ronin.aim('eye.L', { yaw: eye.yaw * EYE.yaw * attention, pitch: eye.pitch * EYE.pitch * attention })
      ronin.aim('head', { yaw: head.yaw * HEAD.yaw * attention, pitch: head.pitch * HEAD.pitch * attention })

      // Lid: shut while dozing, a quick blink every few seconds, otherwise it
      // rides a little with the gaze like a real upper lid.
      const blinking = t > blinkAt && t < blinkAt + 0.13
      if (t > blinkAt + 0.13) blinkAt = t + 2.2 + Math.random() * 4.5
      const lidTarget = dozing ? 64 : blinking ? 72 : eye.pitch * EYE.pitch * attention * 0.8
      lid = blinking ? lidTarget : approach(lid, lidTarget, dozing ? 2 : 20, dt)
      ronin.aim('lid.L', { pitch: lid })
    },
  }
}
