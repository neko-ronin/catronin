// Cat Ronin in three.js: loads the GLB built by tools/cat/build.sh (Tumbler's
// model, the site's clips), keeps its colours under this page's cel shading and
// ink outlines, and plays its clips.
// Used by the site's night scene and by the dev-only lab (tools/cat/lab.html).
import * as THREE from 'three/webgpu'
import { LightingModel } from 'three/webgpu'
import {
  atan, color, diffuseColor, float, floor, fract, hash, length, materialColor, max, mix, mx_noise_float, normalLocal,
  normalView, positionLocal, positionView, positionViewDirection, positionWorld, pow, saturate, sin,
  smoothstep, uniform, vec2, vec3, vec4,
} from 'three/tsl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { createAimLayer } from './aim-layer.js'

// ── The wash ──
// Three light bands with a soft terminator, the way a wash sits on paper rather
// than a hard cel step. The shadow is a cool plum wash, not black, and the lit
// band is warm, so form reads without the greyness of a pure multiply.
const SHADOW = color('#5d5068')
const MID = color('#bdb6b2')
const LIGHT = color('#fff4de')
// The scene's ambient and hemisphere fill is strong. Let only a cool whisper of
// it through, or it floods the shadow band and the whole cat goes flat grey --
// which is exactly what a 3-band toon material under a 0.4 ambient plus a 0.9
// hemisphere does.
const FILL = 0.22
const FILL_TINT = color('#6d76b8')
// A cool edge light along the silhouette. The ink line is a near-black stroke,
// and the night sky is a near-black ground, so wherever a contour falls on open
// sky the line is the same value as what is behind it and the whole edge
// disappears. The cat kept reading as a grey blob on the hero for exactly this
// reason. A pale rim just inside the contour is what makes an ink line read on
// a dark ground -- it puts a light between the stroke and the sky.
const RIM = color('#c6d2ff')
const RIM_AMOUNT = 0.55
// The rim fades where the key is already strong, so it does not blow out the
// lit edge, but it never goes to nothing.
const RIM_KEY_CUT = 0.92
// How much of the rim is a broad wash on the shadow side rather than an edge.
// Large dark masses like the hakama flood lavender if this is high.
const RIM_BREAK = 0.06
// Terminator positions in NdotL: 0 is turned away from the key, 1 faces it.
const TERMINATOR = [0.4, 0.63]

class InkWashLighting extends LightingModel {
  direct({ lightDirection, lightColor, reflectedLight }) {
    const ndl = normalView.dot(lightDirection).mul(0.5).add(0.5)
    // fwidth holds each terminator about a pixel wide at any zoom, which is what
    // makes the band read as a wash edge rather than a hard cel step -- but only
    // about a pixel: soften it much further and the whole cat goes milky and
    // formless, which is the failure this wash was written to fix.
    const fw = ndl.fwidth().mul(0.28).add(0.003)
    const up = smoothstep(float(TERMINATOR[0]).sub(fw), float(TERMINATOR[0]).add(fw), ndl)
    const lit = smoothstep(float(TERMINATOR[1]).sub(fw), float(TERMINATOR[1]).add(fw), ndl)
    // The key keeps its own hue, so the scene's lighting still reaches him.
    const peak = max(lightColor.r, max(lightColor.g, lightColor.b))
    const hue = lightColor.div(peak)
    const wash = mix(mix(SHADOW, MID, up), LIGHT, lit).mul(hue).mul(diffuseColor.rgb)
    // Edge light along the silhouette, and a whisper of it over the whole shadow
    // side, which is what a bounce card off a dark ground looks like. Keep the
    // edge narrow: a wide falloff turns every large dark mass blue.
    const edge = pow(saturate(float(1).sub(normalView.dot(positionViewDirection))), 3.6)
    const away = smoothstep(float(RIM_KEY_CUT), float(0.15), ndl)
    reflectedLight.directDiffuse.addAssign(
      wash.add(RIM.mul(edge.add(away.mul(RIM_BREAK))).mul(RIM_AMOUNT).mul(diffuseColor.rgb)),
    )
  }

  indirect(builder) {
    const { ambientOcclusion, irradiance, reflectedLight } = builder.context
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(FILL).mul(FILL_TINT).mul(diffuseColor.rgb))
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion)
  }
}

function inkMaterial(name) {
  const m = new THREE.MeshToonNodeMaterial({ name })
  m.setupLightingModel = () => new InkWashLighting()
  return m
}

// ── Surface shaders (TSL: WGSL on WebGPU, GLSL on WebGL 2) ──
// Where the beanie brim sits, and how deep the shadow it drops on the skull.
// The brim is the brightest thing on him, so without a shadow under it the top
// of the head is as light as the hat and the face never comes forward.
const BROW = [1.30, 1.44, 0.5]

// The brim's shadow, keyed to world height so it lands on the skull and the ear
// roots and nowhere else.
function underBrim(c) {
  return c.mul(float(1).sub(smoothstep(float(BROW[0]), float(BROW[1]), positionWorld.y).mul(BROW[2])))
}
// Cloth that hangs: a value gradient down the drape, lightening toward the hem
// so the leg has a base, plus a soft occlusion where the pleats meet the waist.
// Without it the hakama is the largest mass on him and holds one value from top
// to bottom, which reads as a hole rather than a garment.
function drape() {
  const y = positionWorld.y
  const fall = smoothstep(float(0.62), float(0.14), y) // 0 at the waist, 1 at the hem
  const lift = float(0.3).mul(fall)
  const waist = smoothstep(float(0.74), float(0.6), y).mul(0.18) // the pleats darken at the top
  return materialColor.mul(float(1).add(lift).sub(waist))
}
// Knit ribs running around the beanie, broken up by a slow noise so they read
// as wool rather than as corduroy: a perfectly even rib was the loudest thing
// on the hat.
function knit() {
  const p = positionLocal
  const wobble = mx_noise_float(p.mul(11)).mul(1.6)
  const rib = smoothstep(-0.5, 0.5, sin(atan(p.z, p.x).mul(52).add(wobble)))
  const band = sin(atan(p.z, p.x).mul(13)).mul(0.5).add(0.5)
  return materialColor.mul(rib.mul(0.1).add(0.9)).mul(band.mul(0.06).add(0.97))
}
// ── Shell fur ──
// Layer h of n is the part's surface pushed out along its normals and cut into
// strands. Three things decide whether this reads as fur or as dirt:
//   * Cell size. Cells are laid out in world units around the part's own axis,
//     so a strand is the same physical size on a paw and on the head. Per-uv
//     cells stretch on the cones and limbs, and on the site the whole cat is
//     ~130px tall, so anything coarse reads as blotches while the old fine
//     cells read as speckle. The count here is a compromise: fine enough not
//     to be a pattern, coarse enough to survive the site's minification.
//   * Flow. Cells are stretched along the part's local Z, which is the axis of
//     every cone and tapered cylinder in the model, so strands lie with the
//     part instead of standing in a grid.
//   * Colour. Fur catches light on the tips and is dark at the root, so a
//     strand is a little warmer and lighter than the skin under it and the skin
//     is darkened where the fur roots. A strand darker than its base is a speck
//     of dirt, which is what the first version looked like. Strands take the
//     coat's own colour at their root, so the markings run through the fur.
const FUR_CELLS = 120 // strand cells per world unit
const FUR_LIFT = 0.022 // how much light a strand tip catches over its base
// `bare` lists fur-free ellipsoids on the part, as { at, radii } in the model's
// rest space, and `toRest` takes this part's local space there. Shell fur is
// lifted well clear of the surface, so it would spear through the eye and bury
// the nose and mouth: there is no depth trick for that, the fur has to stop.
function shellMaterial(part, source, h, len, radius, bare, toRest, cache) {
  const key = `${part}|${h.toFixed(3)}`
  const shared = cache.get(key)
  if (shared) {
    // Per part, not per material: the arc scale is a uniform, so sharing one
    // material across parts of different sizes gives every part but the last
    // the wrong strand size.
    shared.radius.value = radius
    return shared.material
  }
  const m = inkMaterial('shell')
  m.map = source.map
  m.vertexColors = source.vertexColors
  m.color.copy(source.color)
  const radiusU = uniform(radius)
  const lift = float(h) // h is a plain number, so it has to enter the graph as a node
  const p = positionLocal
  // Cylindrical unwrap about the part's local Z: theta * radius is arc length.
  const cell = vec2(atan(p.y, p.x).mul(radiusU), p.z).mul(FUR_CELLS)
  const id = floor(cell)
  // Each strand sits off-centre in its cell and leans its own way, so the
  // strands never line up in a grid or all comb the same way.
  const lean = hash(id.add(vec2(17.3, 3.1))).sub(0.5).mul(1.3)
  const jitter = vec2(hash(id.add(vec2(5.7, 41.9))).add(lean), hash(id.add(vec2(23.1, 7.7)))).sub(0.5).mul(0.5)
  const f = fract(cell).sub(0.5).sub(jitter)
  const d = length(vec2(f.x, f.y.mul(1.9))) // stretched along the part's axis
  // Wide and short reads as a nap; narrow and long reads as scratches on the
  // surface, which is what the first version looked like.
  const r = float(0.62).mul(float(1).sub(lift.mul(0.42)))
  const cov = saturate(r.sub(d).div(0.16))
  const keep = smoothstep(lift.mul(0.7), lift.mul(0.7).add(0.3), hash(id.add(vec2(3.3, lift.mul(31.7)))))
  let op = cov.mul(keep)
  if (bare) {
    const rest = uniform(toRest).mul(vec4(p, 1)).xyz
    for (const { at, radii } of bare) {
      op = op.mul(smoothstep(float(1), float(1.25), length(rest.sub(vec3(...at)).div(vec3(...radii)))))
    }
  }
  m.positionNode = p.add(normalLocal.mul(lift.mul(len)))
  m.opacityNode = op
  m.alphaTest = 0.4
  m.colorNode = materialColor.mul(0.9).add(float(FUR_LIFT).mul(lift))
  cache.set(key, { material: m, radius: radiusU })
  return m
}

export const BONES = ['root', 'hips', 'spine', 'head', 'ear.L', 'ear.R', 'eye.L', 'lid.L', 'lid_lower.L', 'upper_arm.L', 'forearm.L', 'upper_arm.R', 'forearm.R', 'thigh.L', 'shin.L', 'thigh.R', 'shin.R', 'tail.1', 'tail.2', 'tail.3', 'tail.4', 'tail.5', 'tail.6', 'tail.7']

// Where the head's fur stops, in rest coordinates: mouth, nose, under the eyepatch,
// and the open eye. Tumbler's measurements for this model (FACES.ronin in its
// character-surface.js).
const BARE_FACE = [
  { at: [0, 1.19, 0.27], radii: [0.085, 0.045, 0.07] },
  { at: [0, 1.241, 0.285], radii: [0.05, 0.03, 0.05] },
  { at: [-0.128, 1.345, 0.22], radii: [0.135, 0.106, 0.1] },
  { at: [0.128, 1.335, 0.222], radii: [0.1, 0.09, 0.085] },
]

// Parts that get no ink contour. The exclusions are thin membranes and painted
// marks: an inverted hull on a whisker is a dark line lying across itself, and
// it would swallow a 0.0075-radius claw line whole.
const NO_OUTLINE = /whisker|iris|pupil|catchlight|eyeball|mouth|philtrum|nose|strap|scar|toe|finger|welt|rivet|button|placket|ear_hair|obi_tie|blade|ankle|forearm_fur/
const OUTLINE_PX = 5.4 // the ink line's weight, in device pixels

// `fur` is the shell count: 0 for flat toon, ~4 for the full look.
export async function loadRonin(url = '/cat/ronin.glb', { fur = 4, furLength = 0.026 } = {}) {
  const [gltf, manifest] = await Promise.all([
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url),
    fetch(url.replace(/\.glb$/, '.clips.json')).then((r) => r.json()),
  ])
  const loops = new Set(manifest.filter((c) => c.loop).map((c) => c.name))
  // The ink line is a fixed weight on screen, so widen the hull by the view
  // depth instead of a constant world offset -- otherwise the line fattens as
  // he comes forward and thins as the camera pulls back. `inkScale` is
  // OUTLINE_PX * 2 * tan(fov/2) / canvasHeight, which the caller knows and this
  // module does not; see `ronin.ink()`.
  const inkScale = uniform(0.012)
  const modelScale = uniform(1)
  // A furry part wears a shell of strands a furLength proud of its own surface,
  // and the hull would otherwise sink inside them and lose its line. `reach` is
  // how far past the surface this hull has to clear, in the same units.
  function inkHull(reach) {
    // Sepia, not black. A near-black stroke is the same value as the night sky,
    // so every contour that fell on open sky vanished; a warm dark brown reads
    // as ink against the sky, against the cream fur, and against the letters.
    const m = new THREE.MeshBasicNodeMaterial({ color: '#46372a', side: THREE.BackSide })
    m.positionNode = positionLocal.add(
      normalLocal.mul(positionView.z.negate().mul(inkScale).add(float(reach)).div(modelScale)),
    )
    return m
  }
  const ink = inkHull(0)
  const inkFur = inkHull(furLength * 1.15)

  // A copy of a part in another material, riding on it. A skinned part's copy has
  // to bend with the same skeleton, or the fur and ink stay behind in the bind pose.
  function layerOf(o, material, name) {
    const layer = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, material) : new THREE.Mesh(o.geometry, material)
    if (o.isSkinnedMesh) layer.bind(o.skeleton, o.bindMatrix)
    layer.name = name
    o.add(layer)
  }

  const toon = new Map()
  const outlined = []
  const furred = []
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return
    const src = o.material
    if (!toon.has(src.name)) {
      const m = inkMaterial(src.name)
      m.color.copy(src.color)
      m.map = src.map
      m.vertexColors = src.vertexColors
      m.side = src.side
      m.transparent = src.transparent
      m.depthWrite = src.depthWrite
      if (src.name === 'fur_coat') m.colorNode = underBrim(materialColor.mul(0.86))
      else if (src.name === 'beanie') m.colorNode = knit()
      else if (src.name === 'hakama') m.colorNode = drape()
      toon.set(src.name, m)
    }
    o.material = toon.get(src.name)
    if (!NO_OUTLINE.test(o.name)) outlined.push(o)
    // Both lids are membranes one strand-length from the eyeball; fur on them
    // just spears the iris, and they read as smooth hoods either way.
    if (fur && /^fur/.test(src.name) && !/^eyelid|^lower_lid/.test(o.name)) furred.push(o)
  })
  gltf.scene.updateMatrixWorld(true)
  const toModel = gltf.scene.matrixWorld.clone().invert()
  const shells = new Map()
  const furredSet = new Set()
  for (const o of furred) {
    o.geometry.computeBoundingBox()
    const span = o.geometry.boundingBox.getSize(new THREE.Vector3())
    const radius = Math.max(span.x, span.y) * 0.25 || 0.08
    furredSet.add(o)
    const isHead = o.name === 'headmesh'
    const toRest = isHead ? new THREE.Matrix4().multiplyMatrices(toModel, o.matrixWorld) : null
    for (let i = 1; i <= fur; i++) {
      const m = shellMaterial(o.name, o.material, i / fur, furLength, radius, isHead ? BARE_FACE : null, toRest, shells)
      layerOf(o, m, `${o.name}.fur${i}`)
    }
  }
  // Inverted hull: a back-face copy pushed out along normals reads as an ink line.
  for (const o of outlined) {
    layerOf(o, furredSet.has(o) ? inkFur : ink, `${o.name}.outline`)
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
  const aims = createAimLayer(rest)

  const mixer = new THREE.AnimationMixer(gltf.scene)
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]))
  let current = null
  let currentName = null
  const worldScale = new THREE.Vector3()
  const worldPos = new THREE.Vector3()
  const worldQuat = new THREE.Quaternion()

  return {
    object: gltf.scene,
    clips: Object.keys(clips),
    bone: (name) => gltf.scene.getObjectByName(name.replace('.', '')) ?? gltf.scene.getObjectByName(name),
    // Tells the ink how heavy a line is meant to be: OUTLINE_PX device pixels
    // across this canvas, under this camera. Unset, the hull keeps the old
    // world-space weight, so nothing breaks if a caller never asks.
    ink(camera, canvasHeightPx) {
      inkScale.value = (OUTLINE_PX * 2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, canvasHeightPx)
    },
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
    // Advances the clip, then layers the aims on top (see aim-layer.js).
    update(dt) {
      aims.undo()
      mixer.update(dt)
      aims.apply()
      // The ink hull is a child of its part, so the model's own world scale is
      // exactly the factor between a local offset and a world one.
      this.object.matrixWorld.decompose(worldPos, worldQuat, worldScale)
      modelScale.value = worldScale.x || 1
    },
    // Extra rotation for a bone in character axes, in degrees; null clears it.
    aim: (bone, rotation) => aims.set(bone, rotation),
    // Name of the clip playing now (follows `then` hand-offs).
    get clip() {
      return currentName
    },
    // Stops every clip and returns to the bind pose (the lab's pose tool starts here).
    stop() {
      mixer.stopAllAction()
      current = null
      currentName = null
      aims.reset()
      for (const { node, local } of rest.values()) node.quaternion.copy(local)
    },
    dispose() {
      mixer.stopAllAction()
      ink.dispose()
      inkFur.dispose()
      toon.forEach((m) => {
        m.map?.dispose()
        m.dispose()
      })
      shells.forEach(({ material }) => material.dispose())
    },
  }
}
