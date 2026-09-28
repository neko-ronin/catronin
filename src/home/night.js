// The night stage, loaded in the background only on capable browsers.
//   sky:      vgpu fullscreen WGSL effect (WebGPU only; skipped without it)
//   specimen: three.js glass dodecahedron with a living core (WebGPU or WebGL 2)
// Both read one lerped scroll clock (progress 0..1) and a lerped pointer.
import * as THREE from 'three/webgpu'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { createRenderer } from '../enhance.jsx'
import skyShader from './sky.wgsl'
import { createBoltzman } from './boltzman.js'
import { loadRonin } from './ronin.js'

const LERP = 0.08 // displayed values chase their targets; the "butter"

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

  // Optics from the Boltzman shell as saved in Orbius (ior, no dispersion).
  const glass = new THREE.Mesh(
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshPhysicalMaterial({
      color: '#f1ecf7',
      transmission: 1,
      roughness: 0.04,
      ior: 1.4,
      thickness: 0.9,
      clearcoat: 0.3,
      envMapIntensity: 0.7,
      transparent: true,
    }),
  )
  group.add(glass)
  // Lit edges, so the geodesic reads even where the glass is clearest.
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: '#f3e6d0', transparent: true, opacity: 0.28 })))

  // The brain is Orbius's own render of "Steve Boltzman", drawn onto a card that
  // always faces the camera. It is raymarched, so it still turns in real 3D.
  const brain = createBoltzman(512)
  const map = new THREE.CanvasTexture(brain.canvas)
  map.colorSpace = THREE.SRGBColorSpace
  const core = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3),
    // Opaque (empty pixels discarded) so it lands in the pass the glass's
    // transmission samples: the shell genuinely refracts the brain.
    new THREE.MeshBasicMaterial({ map, alphaTest: 0.04, toneMapped: false }), // Orbius already tone-mapped it
  )
  group.add(core)
  return { group, core, brain, map }
}

// What the ronin does, decided once per frame. Idle -> he dozes off; the pointer
// moving wakes him; otherwise he floats and glances around now and then.
function director(ronin) {
  let next = 6 // seconds until the next glance
  let lastMove = 0
  let dozing = false
  return {
    start: () => ronin.play('present', { fade: 0.6, then: 'float' }),
    moved(t) {
      lastMove = t
      if (dozing) {
        dozing = false
        ronin.play('lookaround', { then: 'float' })
        next = t + 8
      }
    },
    tick(t) {
      if (!dozing && t - lastMove > 25) {
        dozing = true
        ronin.play('doze', { fade: 1.2 })
      } else if (!dozing && t > next) {
        ronin.play('lookaround', { then: 'float' })
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
    ronin.play('float')
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
    // The ronin keeps to the specimen's left, drifting with it into the corner.
    if (ronin) {
      const spot = [center[0] - 0.19 * (1 - away * 0.5), center[1] + 0.12 * (1 - away)]
      const s = Math.min(1, camera.aspect * 0.75) * 0.8 * (1 - away * 0.6)
      ronin.object.position.set((spot[0] - 0.5) * 2 * halfH * camera.aspect, (0.5 - spot[1]) * 2 * halfH - 0.8 * s, 0.4)
      ronin.object.scale.setScalar(s)
      ronin.object.rotation.y = 0.35 + shown.pointer[0] * 0.3
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
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

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
