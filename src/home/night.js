// The night stage, loaded in the background only on capable browsers.
//   sky:      vgpu fullscreen WGSL effect (WebGPU only; skipped without it)
//   specimen: three.js glass dodecahedron with a living core (WebGPU or WebGL 2)
// Both read one lerped scroll clock (progress 0..1) and a lerped pointer.
import * as THREE from 'three/webgpu'
import { createRenderer } from '../enhance.jsx'
import skyShader from './sky.wgsl'
import { createOrbiusFamily } from './orbius-family.js'
import eggBundle from './goddess-egg.bundle.json'
import { loadRonin } from './ronin.js'

const LERP = 0.08 // displayed values chase their targets; the "butter"

// What the glass reflects: the night itself, not a lit room. A dark dome, one
// small warm softbox and a thin ember strip, so facets catch small highlights
// instead of big white panels.
function nightEnvironment() {
  const env = new THREE.Scene()
  env.background = new THREE.Color('#0b0c12')
  const light = (w, h, colour, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide }))
    m.position.set(...pos)
    m.lookAt(0, 0, 0)
    env.add(m)
  }
  light(1.2, 0.8, '#fff4e0', [-3, 4, 3]) // key softbox, above left
  light(4, 0.12, '#e6b25a', [4, -1, 2]) // ember strip, low right
  light(0.5, 2.2, '#9aa6ff', [3, 1, -4]) // cool rim, behind right
  return env
}

// Lerped, eased 0..1 for how far the reader has left the hero.
function smooth(target, shown) {
  shown.away = (shown.away ?? 0) + (target - (shown.away ?? 0)) * LERP
  const x = shown.away
  return x * x * (3 - 2 * x)
}

async function mountSky(el) {
  if (!('gpu' in navigator)) return null
  const { init, effect, surface, clock, frame } = await import('vgpu')
  const gpu = await init({ powerPreference: 'high-performance' })
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
  el.appendChild(canvas)
  const target = surface(gpu, canvas, { dpr: [1, 1.5] })
  const fx = effect(gpu, skyShader, {
    set: { sky: { time: 0, progress: 0, aspect: 1, center: [0.68, 0.5], pointer: [0, 0] } },
  })
  const t = clock(gpu)
  return {
    draw(state) {
      fx.set({ sky: { time: t.time, ...state, aspect: canvas.clientWidth / Math.max(1, canvas.clientHeight) } })
      frame(gpu, (f) => f.pass(target, fx)) // surfaces only accept passes inside a frame
    },
    dispose() {
      canvas.remove()
      gpu.dispose()
    },
  }
}

function makeSpecimen() {
  const group = new THREE.Group()

  // Glass optics: Orbius's shell IOR, no dispersion, so the contents stay legible.
  const glass = new THREE.Mesh(
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshPhysicalMaterial({
      color: '#f1ecf7',
      transmission: 1,
      roughness: 0.04,
      ior: 1.4,
      thickness: 0.9,
      clearcoat: 0.3,
      envMapIntensity: 1,
      transparent: true,
    }),
  )
  group.add(glass)
  // Lit edges, so the geodesic reads even where the glass is clearest.
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: '#f3e6d0', transparent: true, opacity: 0.28 })))

  // The contents are Orbius's own render of the Goddess Egg's prismatic silk, drawn
  // onto a card that always faces the camera. It is raymarched, so it still turns
  // in real 3D.
  const brain = createOrbiusFamily(eggBundle, 512)
  const map = new THREE.CanvasTexture(brain.canvas)
  map.colorSpace = THREE.SRGBColorSpace
  // No mipmaps: averaging would melt the silk's one-pixel filaments into flat colour.
  map.generateMipmaps = false
  map.minFilter = THREE.LinearFilter
  // The WebGL canvas holds premultiplied colour (alpha = brightest channel). Upload
  // it as-is: un-premultiplying would divide by alpha and saturate every faint veil.
  map.premultiplyAlpha = true
  const core = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3),
    // Opaque (empty pixels discarded) so it lands in the pass the glass's
    // transmission samples: the shell genuinely refracts the brain.
    new THREE.MeshBasicMaterial({ map, alphaTest: 0.04, toneMapped: false }), // Orbius already tone-mapped it
  )
  group.add(core)
  return { group, core, brain, map }
}

// What the ronin does, decided once per frame. He sits on the hero's "Ronin";
// idle -> he dozes off, the pointer moving wakes him, otherwise he glances around.
function director(ronin) {
  let next = 6 // seconds until the next glance
  let lastMove = 0
  let dozing = false
  return {
    start: () => ronin.play('sit_present', { fade: 0.6, then: 'sit' }),
    moved(t) {
      lastMove = t
      if (dozing) {
        dozing = false
        ronin.play('sit_lookaround', { then: 'sit' })
        next = t + 8
      }
    },
    tick(t) {
      if (!dozing && t - lastMove > 25) {
        dozing = true
        ronin.play('sit_doze', { fade: 1.2 })
      } else if (!dozing && t > next) {
        ronin.play('sit_lookaround', { then: 'sit' })
        next = t + 10 + Math.random() * 8
      }
    },
  }
}

export async function mount(el, onFirstFrame) {
  let sky = await mountSky(el).catch((err) => {
    console.warn('[night] vgpu sky unavailable, continuing without it:', err)
    return null
  })

  const layer = document.createElement('div')
  layer.style.cssText = 'position:absolute;inset:0'
  el.appendChild(layer)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
  camera.position.z = 7
  const { group, core, brain, map } = makeSpecimen()
  scene.add(group)

  // Cat Ronin floats beside the specimen. If he fails to load, the scene goes on.
  const ronin = await loadRonin('/cat/ronin.glb', { fur: 4 }).catch((err) => {
    console.warn('[night] ronin unavailable:', err)
    return null
  })
  const cast = ronin && director(ronin)
  if (ronin) {
    scene.add(ronin.object, new THREE.HemisphereLight('#c9c3ff', '#2a2433', 0.9))
    ronin.play('sit')
    setTimeout(() => cast.start(), 1200) // after the compass iris has mostly opened
  }
  const key = new THREE.DirectionalLight('#ffe2b0', 1)
  key.position.set(3, 4, 5)
  scene.add(key, new THREE.AmbientLight('#8a86a8', 0.4))

  const target = { progress: 0, pointer: [0, 0] }
  const shown = { progress: 0, pointer: [0, 0] }
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight
    target.progress = max > 0 ? scrollY / max : 0
  }
  // Seat: the top of the word "Ronin" in the hero, projected onto the plane he sits in.
  const word = document.getElementById('ronin-word')
  const ray = new THREE.Vector3()
  const toPlane = (px, py, w, h, z) => {
    ray.set((px / w) * 2 - 1, 1 - (py / h) * 2, 0.5).unproject(camera).sub(camera.position).normalize()
    return camera.position.clone().addScaledVector(ray, (z - camera.position.z) / ray.z)
  }
  const SEAT_HEIGHT = 0.5 // hakama seat above his root, model units
  const VISIBLE = 1.4 // seat to ear tips, model units
  const headScreen = new THREE.Vector3()
  let blinkAt = 3
  function seatRonin(w, h) {
    const r = word?.getBoundingClientRect()
    if (!r || !r.height) return
    const z = 0.6
    const ledge = toPlane(r.left + r.width * 0.8, r.top + r.height * 0.1, w, h, z) // over the "IN", clear of "CAT" above
    const below = toPlane(r.left + r.width * 0.8, r.top + r.height * 1.1, w, h, z)
    const s = ((ledge.y - below.y) * 1.2) / VISIBLE // as tall above the ledge as the word itself
    ronin.object.scale.setScalar(s)
    ronin.object.position.set(ledge.x, ledge.y - SEAT_HEIGHT * s, z)
    ronin.object.rotation.y = 0.25

    // Eye (and a little of the head) toward the pointer, from where his head is on screen.
    ronin.bone('head').getWorldPosition(headScreen).project(camera)
    const px = (target.pointer[0] + 0.5) * 2 - 1
    const py = 1 - (target.pointer[1] + 0.5) * 2
    const yaw = THREE.MathUtils.clamp((px - headScreen.x) * 40, -28, 28)
    const pitch = THREE.MathUtils.clamp(-(py - headScreen.y) * 30, -20, 22)
    ronin.aim('eye.L', { yaw, pitch })
    ronin.aim('head', { yaw: yaw * 0.35, pitch: pitch * 0.3 })
    // Blink every few seconds; the lid also follows the gaze a little.
    const blinking = now > blinkAt && now < blinkAt + 0.14
    if (now > blinkAt + 0.14) blinkAt = now + 2.5 + Math.random() * 4
    ronin.aim('lid.L', { pitch: blinking ? 72 : pitch * 0.5 })
  }

  let now = 0
  const onMove = (e) => {
    target.pointer = [e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5]
    cast?.moved(now)
  }
  addEventListener('scroll', onScroll, { passive: true })
  addEventListener('pointermove', onMove, { passive: true })
  onScroll()

  let paused = false // paper world: keep the stage warm but draw nothing
  const handle = await createRenderer(THREE, layer, onFirstFrame, (t, { w, h }) => {
    if (paused) return
    shown.progress += (target.progress - shown.progress) * LERP
    shown.pointer = shown.pointer.map((v, i) => v + (target.pointer[i] - v) * LERP)
    const p = shown.progress

    // Past the hero, the specimen shrinks into the top-right corner like a lantern,
    // so it never sits on text. `away` is 0 in the hero and 1 once it has left.
    const away = smooth(Math.min(1, scrollY / innerHeight), shown)
    const center = [0.68 + away * 0.24, 0.5 - away * 0.34]
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    const halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z
    group.position.set((center[0] - 0.5) * 2 * halfH * camera.aspect, (0.5 - center[1]) * 2 * halfH, 0)
    group.scale.setScalar(Math.min(1, camera.aspect * 0.75) * (1 - away * 0.72))
    group.rotation.set(0.35 + shown.pointer[1] * 0.6 + p * 2.2, t * 0.12 + shown.pointer[0] * 0.8 + p * 3.1, 0)
    // The ronin sits on the hero's "Ronin", measured from the DOM every frame so he
    // stays put through resizes and scrolling. His eye follows the pointer.
    if (ronin) {
      seatRonin(w, h)
      ronin.update(Math.min(0.1, t - now))
      cast.tick(t)
    }
    now = t

    // Card faces the camera; the brain's own rotation follows the glass instead.
    core.quaternion.copy(group.quaternion).invert()
    brain.render(t, group.rotation.y, shown.pointer[1] * 0.4)
    map.needsUpdate = true

    handle.renderer.render(scene, camera)
    try {
      sky?.draw({ progress: p, center, pointer: shown.pointer })
    } catch (err) {
      console.warn('[night] sky failed, dropping it:', err)
      sky.dispose()
      sky = null
    }
  })

  const pmrem = new THREE.PMREMGenerator(handle.renderer)
  scene.environment = pmrem.fromScene(nightEnvironment(), 0.04).texture

  return {
    backend: handle.backend,
    hasSky: !!sky,
    setPaused(v) {
      paused = v
    },
    dispose() {
      removeEventListener('scroll', onScroll)
      removeEventListener('pointermove', onMove)
      handle.dispose()
      pmrem.dispose()
      brain.dispose()
      ronin?.dispose()
      map.dispose()
      sky?.dispose()
      el.replaceChildren()
    },
  }
}
