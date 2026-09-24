import * as THREE from 'three'
import './style.css'

const canvas = document.getElementById('hero-canvas')
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0x0a0a0c, 0.055)

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
camera.position.set(0, 0, 7)

const core = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.85, 1),
  new THREE.MeshBasicMaterial({ color: 0x4a4f57, wireframe: true, transparent: true, opacity: 0.55 })
)
scene.add(core)

const shells = new THREE.Group()
for (let i = 0; i < 3; i += 1) {
  const shell = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(2.6 + i * 0.55, 0)),
    new THREE.LineBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.13 - i * 0.03 })
  )
  shell.rotation.set(Math.random(), Math.random(), Math.random())
  shells.add(shell)
}
scene.add(shells)

const COUNT = 1100
const positions = new Float32Array(COUNT * 3)
for (let i = 0; i < COUNT; i += 1) {
  const r = 3.4 + Math.random() * 5.2
  const theta = Math.random() * Math.PI * 2
  const phi = Math.acos(2 * Math.random() - 1)
  positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
  positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
  positions[i * 3 + 2] = r * Math.cos(phi)
}
const dust = new THREE.Points(
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)),
  new THREE.PointsMaterial({ color: 0x8b8478, size: 0.028, sizeAttenuation: true, transparent: true, opacity: 0.7 })
)
scene.add(dust)

const pointer = { x: 0, y: 0 }
const eased = { x: 0, y: 0 }
window.addEventListener('pointermove', (event) => {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1
  pointer.y = (event.clientY / window.innerHeight) * 2 - 1
})

function resize() {
  const parent = canvas.parentElement
  const width = parent.clientWidth
  const height = parent.clientHeight
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  if (reduced) render()
}
new ResizeObserver(resize).observe(canvas.parentElement)

const clock = new THREE.Clock()
let running = true

function render() {
  const t = clock.getElapsedTime()
  eased.x += (pointer.x - eased.x) * 0.05
  eased.y += (pointer.y - eased.y) * 0.05

  if (!reduced) {
    core.rotation.y = t * 0.16
    core.rotation.x = Math.sin(t * 0.11) * 0.28
    shells.rotation.y = -t * 0.06
    dust.rotation.y = t * 0.02
  }

  scene.rotation.x = eased.y * 0.12
  scene.rotation.y = eased.x * 0.22
  camera.position.z = 7 - Math.abs(eased.x) * 0.5

  renderer.render(scene, camera)
  if (running && !reduced) requestAnimationFrame(render)
}

document.addEventListener('visibilitychange', () => {
  running = !document.hidden
  if (running && !reduced) requestAnimationFrame(render)
})

resize()
render()
