// Cat Lab: preview Cat Ronin and every clip with the exact materials the site uses.
import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { loadRonin } from '../../src/home/ronin.js'

const stage = document.getElementById('stage')
const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true })
await renderer.init()
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
stage.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
camera.position.set(0.8, 1.1, 4.2)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 0.85, 0)
controls.update()

const key = new THREE.DirectionalLight('#fff1d6', 2.4)
key.position.set(2, 3, 3)
scene.add(key, new THREE.HemisphereLight('#c9c3ff', '#2a2433', 1.1))

const ronin = await loadRonin()
scene.add(ronin.object)

const list = document.getElementById('clips')
const buttons = ronin.clips.map((name) => {
  const b = document.createElement('button')
  b.textContent = name
  b.onclick = () => {
    ronin.play(name, { then: 'float' })
    buttons.forEach((x) => x.setAttribute('aria-pressed', x === b))
  }
  list.append(b)
  return b
})
buttons.find((b) => b.textContent === 'float')?.click()

document.getElementById('paper').onchange = (e) => document.body.classList.toggle('paper', e.target.checked)
const spin = document.getElementById('spin')
const speed = document.getElementById('speed')
const stats = document.getElementById('stats')
stats.textContent = `${renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2'} · ${ronin.clips.length} clips`

// ── Pose tool. Same convention as tools/cat/build_cat.py: degrees about the
//    character's axes. Blender Z-up -> three Y-up: pitch X->X, roll Y->-Z, yaw Z->Y.
const BONES = ['root', 'hips', 'spine', 'head', 'ear.L', 'ear.R', 'eye.L', 'upper_arm.L', 'forearm.L', 'upper_arm.R', 'forearm.R', 'leg.L', 'leg.R', 'tail.1', 'tail.2', 'tail.3']
const rest = new Map() // bone -> { local, world } rest quaternions, relative to the model root
ronin.object.updateMatrixWorld(true)
for (const name of BONES) {
  const node = ronin.bone(name)
  if (node) rest.set(name, { node, local: node.quaternion.clone(), world: node.getWorldQuaternion(new THREE.Quaternion()) })
}
const pose = Object.fromEntries(BONES.map((b) => [b, { pitch: 0, yaw: 0, roll: 0 }]))
const deg = THREE.MathUtils.degToRad
function applyPose() {
  for (const [name, { node, local, world }] of rest) {
    const { pitch, yaw, roll } = pose[name]
    const r = new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(pitch), deg(yaw), deg(-roll), 'YZX'))
    node.quaternion.copy(local).multiply(world.clone().invert()).multiply(r).multiply(world)
  }
}
const bonePick = document.getElementById('bone')
bonePick.innerHTML = [...rest.keys()].map((b) => `<option>${b}</option>`).join('')
const sliders = ['pitch', 'yaw', 'roll'].map((k) => document.getElementById(k))
const snippet = document.getElementById('snippet')
const posing = document.getElementById('posing')
function showPose() {
  const p = pose[bonePick.value]
  sliders.forEach((el) => {
    el.value = p[el.id]
    el.nextElementSibling.textContent = p[el.id]
  })
  const used = Object.entries(pose).filter(([, v]) => v.pitch || v.yaw || v.roll)
  snippet.value = used
    .map(([b, v]) => `"${b}": { ${Object.entries(v).filter(([, x]) => x).map(([k, x]) => `"${k}": [[0, 0], [24, ${x}]]`).join(', ')} }`)
    .join(',\n')
}
bonePick.onchange = showPose
sliders.forEach((el) => (el.oninput = () => {
  pose[bonePick.value][el.id] = Number(el.value)
  if (!posing.checked) posing.click()
  applyPose()
  showPose()
}))
posing.onchange = () => {
  if (posing.checked) ronin.stop()
  else buttons.find((b) => b.textContent === 'float')?.click()
  applyPose()
}
document.getElementById('copy').onclick = () => navigator.clipboard.writeText(snippet.value)
document.getElementById('reset').onclick = () => {
  for (const v of Object.values(pose)) Object.assign(v, { pitch: 0, yaw: 0, roll: 0 })
  applyPose()
  showPose()
}
showPose()

const resize = () => {
  const { clientWidth: w, clientHeight: h } = stage
  renderer.setSize(w, h, false)
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block'
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
new ResizeObserver(resize).observe(stage)
resize()

const clock = new THREE.Clock()
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta()
  if (!posing.checked) ronin.update(dt * Number(speed.value))
  if (spin.checked) ronin.object.rotation.y += dt * 0.6
  controls.update()
  renderer.render(scene, camera)
})

// Handle for scripted framing and checks from the console or browser automation.
window.lab = { THREE, scene, camera, controls, ronin }
