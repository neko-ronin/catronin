// Cat Ronin in three.js: loads the GLB built by tools/cat/build.sh, swaps its
// plain materials for cel shading with ink outlines, and plays its clips.
// Used by the site's night scene and by the dev-only lab (tools/cat/lab.html).
import * as THREE from 'three/webgpu'
import { normalLocal, positionLocal } from 'three/tsl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// Three flat light bands, like the ink-and-wash drawings.
function toonRamp() {
  const t = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1)
  t.minFilter = t.magFilter = THREE.NearestFilter
  t.needsUpdate = true
  return t
}

// Buffalo check for the flannel: red and black, with the darker crossings.
function plaid() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  g.fillStyle = '#a3262a'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = 'rgba(20,10,12,0.55)'
  g.fillRect(0, 0, 32, 64)
  g.fillRect(0, 0, 64, 32)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(4, 3)
  t.magFilter = THREE.NearestFilter
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const NO_OUTLINE = /whisker|iris|pupil|mouth|nose|strap/
const OUTLINE = 0.012 // world-ish units; the ink line weight

export async function loadRonin(url = '/cat/ronin.glb') {
  const [gltf, manifest] = await Promise.all([
    new GLTFLoader().loadAsync(url),
    fetch(url.replace(/\.glb$/, '.clips.json')).then((r) => r.json()),
  ])
  const loops = new Set(manifest.filter((c) => c.loop).map((c) => c.name))
  const ramp = toonRamp()
  const flannel = plaid()
  const ink = new THREE.MeshBasicNodeMaterial({ color: '#1c1714', side: THREE.BackSide })
  ink.positionNode = positionLocal.add(normalLocal.mul(OUTLINE))

  const toon = new Map()
  const outlined = []
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return
    const src = o.material
    if (!toon.has(src.name)) {
      const m = new THREE.MeshToonMaterial({ color: src.color, gradientMap: ramp, name: src.name })
      if (src.name === 'flannel') Object.assign(m, { map: flannel, color: new THREE.Color('#ffffff') })
      toon.set(src.name, m)
    }
    o.material = toon.get(src.name)
    if (!NO_OUTLINE.test(o.name)) outlined.push(o)
  })
  // Inverted hull: a back-face copy pushed out along normals reads as an ink line.
  for (const o of outlined) {
    const hull = new THREE.Mesh(o.geometry, ink)
    hull.name = `${o.name}.outline`
    o.add(hull)
  }

  const mixer = new THREE.AnimationMixer(gltf.scene)
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]))
  let current = null

  return {
    object: gltf.scene,
    clips: Object.keys(clips),
    bone: (name) => gltf.scene.getObjectByName(name.replace('.', '')) ?? gltf.scene.getObjectByName(name),
    // Cross-fades into `name`. One-shot clips return to `then` when they end.
    play(name, { fade = 0.4, then } = {}) {
      const next = clips[name]
      if (!next || next === current) return
      next.reset()
      const once = !loops.has(name)
      next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
      next.clampWhenFinished = once
      next.play()
      if (current) current.crossFadeTo(next, fade, false)
      current = next
      if (once && then) {
        const done = (e) => {
          if (e.action !== next) return
          mixer.removeEventListener('finished', done)
          this.play(then, { fade })
        }
        mixer.addEventListener('finished', done)
      }
    },
    update: (dt) => mixer.update(dt),
    // Stops every clip and returns to the bind pose (the lab's pose tool starts here).
    stop() {
      mixer.stopAllAction()
      current = null
    },
    dispose() {
      mixer.stopAllAction()
      ramp.dispose()
      flannel.dispose()
      ink.dispose()
      toon.forEach((m) => m.dispose())
    },
  }
}
