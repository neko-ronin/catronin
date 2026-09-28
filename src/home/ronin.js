// Cat Ronin in three.js: loads the GLB built by tools/cat/build.sh, swaps its
// plain materials for cel shading with ink outlines, and plays its clips.
// Used by the site's night scene and by the dev-only lab (tools/cat/lab.html).
import * as THREE from 'three/webgpu'
import { atan, color, float, floor, fract, hash, length, mix, mx_noise_float, normalLocal, positionLocal, sin, smoothstep, step, uv, vec2 } from 'three/tsl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// Three flat light bands, like the ink-and-wash drawings.
let RAMP
function toonRamp() {
  const t = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1)
  t.minFilter = t.magFilter = THREE.NearestFilter
  t.needsUpdate = true
  RAMP = t
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

// ── Surface shaders (TSL: WGSL on WebGPU, GLSL on WebGL 2) ──
// Tabby: noise-warped bands along each part's long axis. On limbs and the tail
// that gives rings; on the head, stripes.
function tabby(base) {
  const p = positionLocal
  const band = smoothstep(0.35, 0.8, sin(p.y.mul(46).add(mx_noise_float(p.mul(7)).mul(3.2))))
  return mix(color(base), color(base).mul(0.52), band.mul(0.85))
}
// Knit ribs running around the beanie.
function knit(base) {
  const p = positionLocal
  const rib = smoothstep(-0.4, 0.4, sin(atan(p.z, p.x).mul(64)))
  return color(base).mul(rib.mul(0.16).add(0.84))
}
// Iris: dark olive rim to a bright yellow-green centre, with fine radial
// striations. glTF puts the iris's face in its local XY plane.
function iris() {
  const p = positionLocal
  const r = length(p.xy).div(0.061) // iris radius in tools/cat/build_cat.py
  const fibres = sin(atan(p.y, p.x).mul(34)).mul(0.06).add(0.97)
  return mix(color('#58651a'), color('#e4e56e'), smoothstep(0.98, 0.4, r)).mul(fibres)
}
// Shell fur: layer h of n is the surface pushed out along its normals and cut
// into strands. Each uv cell holds one strand that tapers as it rises.
function shell(base, h, len, stripes) {
  const m = new THREE.MeshToonNodeMaterial({ gradientMap: RAMP })
  const cell = uv().mul(vec2(320, 160))
  const id = floor(cell)
  const r = hash(id)
  // Each strand sits off-centre in its cell, so the strands never line up in a grid.
  const jitter = vec2(hash(id.add(vec2(17.3, 3.1))), hash(id.add(vec2(5.7, 41.9)))).sub(0.5).mul(0.55)
  const d = length(fract(cell).sub(0.5).sub(jitter))
  m.positionNode = positionLocal.add(normalLocal.mul(h * len))
  m.opacityNode = step(float(h * 0.9), r).mul(step(d, float(0.5 * (1 - h))))
  m.alphaTest = 0.5
  m.colorNode = (stripes ? tabby(base) : color(base)).mul(0.9 + 0.12 * h)
  return m
}
const FUR = /^fur/
export const BONES = ['root', 'hips', 'spine', 'head', 'ear.L', 'ear.R', 'eye.L', 'lid.L', 'upper_arm.L', 'forearm.L', 'upper_arm.R', 'forearm.R', 'thigh.L', 'shin.L', 'thigh.R', 'shin.R', 'tail.1', 'tail.2', 'tail.3']

const NO_OUTLINE = /whisker|iris|pupil|catchlight|mouth|philtrum|lash|nose|strap|scar/
const OUTLINE = 0.012 // world-ish units; the ink line weight

// `fur` is the shell count: 0 for flat toon, ~5 for the full look.
export async function loadRonin(url = '/cat/ronin.glb', { fur = 5, furLength = 0.022 } = {}) {
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
  const furred = []
  const bases = new Map() // material name -> Blender base colour
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return
    const src = o.material
    if (!toon.has(src.name)) {
      const m = new THREE.MeshToonNodeMaterial({ gradientMap: ramp, name: src.name })
      const base = `#${src.color.getHexString()}`
      bases.set(src.name, base)
      if (src.name === 'flannel') m.map = flannel
      else if (src.name === 'fur') m.colorNode = tabby(base)
      else if (src.name === 'beanie') m.colorNode = knit(base)
      else if (src.name === 'iris') m.colorNode = iris()
      else m.color = src.color
      toon.set(src.name, m)
    }
    o.material = toon.get(src.name)
    if (!NO_OUTLINE.test(o.name)) outlined.push(o)
    if (fur && FUR.test(src.name)) furred.push(o)
  })
  const shells = new Map() // `${material}:${layer}` -> material, shared across parts
  for (const o of furred) {
    const base = bases.get(o.material.name)
    for (let i = 1; i <= fur; i++) {
      const key = `${o.material.name}:${i}`
      if (!shells.has(key)) shells.set(key, shell(base, i / fur, furLength, o.material.name === 'fur'))
      const layer = new THREE.Mesh(o.geometry, shells.get(key))
      layer.name = `${o.name}.fur${i}`
      o.add(layer)
    }
  }
  // Inverted hull: a back-face copy pushed out along normals reads as an ink line.
  for (const o of outlined) {
    const hull = new THREE.Mesh(o.geometry, ink)
    hull.name = `${o.name}.outline`
    o.add(hull)
  }

  // Rest orientation of every bone, relative to the model: the frame that
  // character-axis rotations (pitch/yaw/roll) are measured in. Same convention as
  // tools/cat/build_cat.py, so a pose from the lab bakes identically.
  gltf.scene.updateMatrixWorld(true)
  const rest = new Map()
  for (const name of BONES) {
    const node = gltf.scene.getObjectByName(name.replace('.', '')) ?? gltf.scene.getObjectByName(name)
    if (node) rest.set(name, { node, local: node.quaternion.clone(), world: node.getWorldQuaternion(new THREE.Quaternion()) })
  }
  const aims = new Map() // bone -> extra rotation, layered on top of the playing clip
  // Nodes some clip drives (track names are "<node>.<property>"). Aims on any other
  // bone start from rest each frame, since no clip rewrites them.
  const animated = new Set(gltf.animations.flatMap((c) => c.tracks.map((t) => t.name.slice(0, t.name.lastIndexOf('.')))))
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const deg = THREE.MathUtils.degToRad
  function applyAims() {
    for (const [name, { pitch = 0, yaw = 0, roll = 0 }] of aims) {
      const r = rest.get(name)
      if (!r) continue
      // Blender Z-up -> three Y-up: pitch X->X, roll Y->-Z, yaw Z->Y.
      q.setFromEuler(e.set(deg(pitch), deg(yaw), deg(-roll), 'YZX'))
      r.node.quaternion.multiply(r.world.clone().invert().multiply(q).multiply(r.world))
    }
  }

  const mixer = new THREE.AnimationMixer(gltf.scene)
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]))
  let current = null
  let currentName = null

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
      currentName = name
      if (once && then) {
        const done = (e) => {
          if (e.action !== next) return
          mixer.removeEventListener('finished', done)
          this.play(then, { fade })
        }
        mixer.addEventListener('finished', done)
      }
    },
    // Advances the clip, then layers aims on top. Bones no clip animates (eye,
    // eyelid) are reset to rest first so their aims do not accumulate.
    update(dt) {
      for (const name of aims.keys()) {
        const r = rest.get(name)
        if (r && (!current || !animated.has(r.node.name))) r.node.quaternion.copy(r.local)
      }
      mixer.update(dt)
      applyAims()
    },
    // Extra rotation for a bone in character axes, in degrees; null clears it.
    aim(bone, rotation) {
      if (rotation) aims.set(bone, rotation)
      else aims.delete(bone)
    },
    // Name of the clip playing now (follows `then` hand-offs).
    get clip() {
      return currentName
    },
    // Stops every clip and returns to the bind pose (the lab's pose tool starts here).
    stop() {
      mixer.stopAllAction()
      current = null
      currentName = null
      for (const { node, local } of rest.values()) node.quaternion.copy(local)
    },
    dispose() {
      mixer.stopAllAction()
      ramp.dispose()
      flannel.dispose()
      ink.dispose()
      toon.forEach((m) => m.dispose())
      shells.forEach((m) => m.dispose())
    },
  }
}
