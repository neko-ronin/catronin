// The night stage, loaded in the background only on capable browsers.
//   sky:      vgpu fullscreen WGSL effect (WebGPU only; skipped without it)
//   specimen: three.js glass dodecahedron holding Orbius's Goddess Egg silk
//   title:    the hero's "CAT RONIN" as physical letters (hero-text.js)
//   ronin:    Cat Ronin sitting on them (ronin.js, ronin-director.js)
// All read one lerped scroll clock (progress 0..1) and a lerped pointer.
import * as THREE from 'three/webgpu'
import { createRenderer } from '../enhance.jsx'
import skyShader from './sky.wgsl'
import { createOrbiusFamily } from './orbius-family.js'
import eggBundle from './goddess-egg.bundle.json'
import { loadRonin } from './ronin.js'
import { createDirector } from './ronin-director.js'
import { createHeroText } from './hero-text.js'

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

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const easeOutCubic = (x) => 1 - (1 - x) ** 3
const easeOutBack = (x) => 1 + 2.4 * (x - 1) ** 3 + 1.4 * (x - 1) ** 2 // overshoots, settles

// Sitting on the letters, in model units (tools/cat/build_cat.py, "sit" clip).
const SEAT = 0.47 // underside of the hakama thighs above his root
const HIPS_BACK = 0.14 // hips sit this far behind the letters' front edge; knees overhang
const TALL = 1.47 // seat to ear tips
const KEY_DIR = new THREE.Vector3(3, 4, 5).normalize()
// Opening, in seconds after the night is switched on. The compass iris (1.5s,
// from the right) reaches the title around 0.9s; the letters rise as it passes,
// then he pops onto them.
const RISE_AT = 0.9
const RISE_FOR = 0.9
const POP_AT = 1.85
const POP_FOR = 0.35

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
  camera.updateMatrixWorld()
  const { group, core, brain, map } = makeSpecimen()
  scene.add(group)

  // The hero title as physical letters, and Cat Ronin sitting on them. Either can
  // fail on its own (fonts, a missing file) and the rest of the scene carries on.
  const words = [...document.querySelectorAll('.hero-word')]
  const title = await createHeroText(words).catch((err) => {
    console.warn('[night] 3D title unavailable, keeping the HTML one:', err)
    return null
  })
  if (title) {
    scene.add(title.group)
    document.documentElement.dataset.text3d = ''
  }
  const ronin =
    title &&
    (await loadRonin('/cat/ronin.glb', { fur: 4 }).catch((err) => {
      console.warn('[night] ronin unavailable:', err)
      return null
    }))
  const cast = ronin && createDirector(ronin)
  if (ronin) {
    ronin.object.visible = false
    // Solid parts cast shadows onto the letters; outline hulls and fur shells don't.
    ronin.object.traverse((o) => (o.castShadow = o.isMesh && !/\.(outline|fur\d+)$/.test(o.name)))
    scene.add(ronin.object)
    ronin.play('sit')
  }

  scene.add(new THREE.HemisphereLight('#c9c3ff', '#2a2433', 0.9), new THREE.AmbientLight('#8a86a8', 0.4))
  const key = new THREE.DirectionalLight('#ffe2b0', 1)
  key.position.copy(KEY_DIR).multiplyScalar(6)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.bias = -0.0004
  scene.add(key, key.target)

  const target = { progress: 0, pointer: [0, 0] }
  const shown = { progress: 0, pointer: [0, 0] }
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight
    target.progress = max > 0 ? scrollY / max : 0
  }
  let moved = false
  const onMove = (e) => {
    target.pointer = [e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5]
    moved = true
  }
  addEventListener('scroll', onScroll, { passive: true })
  addEventListener('pointermove', onMove, { passive: true })
  onScroll()

  // Viewport pixel -> the plane z = 0, where the letters' front faces are pinned.
  const ray = new THREE.Vector3()
  const toPlane = (px, py, w, h) => {
    ray.set((px / w) * 2 - 1, 1 - (py / h) * 2, 0.5).unproject(camera).sub(camera.position).normalize()
    return camera.position.clone().addScaledVector(ray, -camera.position.z / ray.z)
  }
  const pxToWorld = (h) => (2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360)) / h

  // He sits on the "I" of "RONIN", knees over the edge, shins against the face.
  const headScreen = new THREE.Vector3()
  const pointerNdc = { x: 0, y: 0 }
  let seated = false
  function sit(t, dt, since) {
    const edge = title.ledge(1, 'I')
    const s = (1.25 * title.capHeight(1)) / TALL
    const pop = since < POP_AT ? 0 : easeOutBack(clamp01((since - POP_AT) / POP_FOR))
    if (pop > 0 && !seated) {
      seated = true
      cast.start()
    }
    ronin.object.visible = pop > 0
    ronin.object.scale.setScalar(s * Math.max(pop, 0.001))
    ronin.object.position.set(edge.x, edge.y - SEAT * s, edge.z - HIPS_BACK * s)
    ronin.object.rotation.y = 0.12

    // The key light rides along so its shadow map is spent on him.
    key.target.position.copy(ronin.object.position)
    key.position.copy(ronin.object.position).addScaledVector(KEY_DIR, 6)
    key.target.updateMatrixWorld()
    const r = 1.7 * s
    Object.assign(key.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 12 })
    key.shadow.camera.updateProjectionMatrix()

    ronin.bone('head').getWorldPosition(headScreen).project(camera)
    pointerNdc.x = target.pointer[0] * 2
    pointerNdc.y = -target.pointer[1] * 2
    cast.tick(t, dt, pointerNdc, headScreen, moved)
    moved = false
    ronin.update(dt)
  }

  let paused = false // paper world: keep the stage warm but draw nothing
  let openAt = null // set on the first frame after the night opens
  let wantOpen = false
  let now = 0
  const handle = await createRenderer(THREE, layer, onFirstFrame, (t, { w, h }) => {
    if (paused) return
    const dt = Math.min(0.1, t - now)
    now = t
    if (wantOpen) {
      openAt = t
      wantOpen = false
    }
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

    // Letters pinned to the DOM title every frame (resizes, scrolling), rising out
    // of the page once the night has opened; then he pops onto them.
    if (title) {
      const since = openAt === null ? -1 : t - openAt
      title.layout((px, py) => toPlane(px, py, w, h), pxToWorld(h), since < 0 ? 0 : easeOutCubic(clamp01((since - RISE_AT) / RISE_FOR)))
      if (ronin) sit(t, dt, since)
    }

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
    // Dev only (stripped from builds): WebGPU canvases can only be read during the
    // task that drew them, so frame captures for review hook in here.
    if (import.meta.env.DEV && window.__captureNext) {
      const take = window.__captureNext
      window.__captureNext = null
      take([...el.querySelectorAll('canvas')])
    }
  })
  handle.renderer.shadowMap.enabled = true
  if (import.meta.env.DEV) window.__night = { THREE, scene, camera, title, ronin } // console debugging only

  const pmrem = new THREE.PMREMGenerator(handle.renderer)
  scene.environment = pmrem.fromScene(nightEnvironment(), 0.04).texture

  return {
    backend: handle.backend,
    hasSky: !!sky,
    // Paper hides the stage; night replays the opening: letters rise, he pops on.
    setPaused(v) {
      paused = v
      if (v) {
        openAt = null
        seated = false
        if (ronin) {
          ronin.object.visible = false
          cast.reset()
        }
      } else wantOpen = true
    },
    dispose() {
      removeEventListener('scroll', onScroll)
      removeEventListener('pointermove', onMove)
      delete document.documentElement.dataset.text3d
      handle.dispose()
      pmrem.dispose()
      brain.dispose()
      ronin?.dispose()
      title?.dispose()
      map.dispose()
      sky?.dispose()
      el.replaceChildren()
    },
  }
}
