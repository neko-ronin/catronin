// The hero title as physical letters in the night scene.
//
// Each word is traced from the browser's own rendering of the DOM text (same
// font, weight and kerning: every glyph is drawn at the x the page laid it out
// at), then extruded *backward* from a front face that lines up with the HTML
// exactly. Hiding the HTML and showing these is therefore seamless, and the
// letters can rise out of the page. Faces are coloured by the way they point
// rather than lit, so the front face keeps the page's exact text colour.
import * as THREE from 'three/webgpu'
import { abs, color, mix, normalWorld, smoothstep } from 'three/tsl'
import { yieldToMain } from '../enhance.jsx'

const F = 384 // tracing resolution, px per em
const DEPTH = 0.34 // letter depth, em

// ── Tracing ──────────────────────────────────────────────────────────────────

// Marching squares over the canvas alpha, with sub-pixel edge interpolation,
// stitched into closed loops. Loops are unoriented; nesting sorts out holes.
function traceLoops(alpha, W, H, iso = 127.5) {
  const v = (i, j) => alpha[(j * W + i) * 4 + 3]
  const hId = (i, j) => j * W + i // edge (i,j)-(i+1,j)
  const vId = (i, j) => W * H + j * W + i // edge (i,j)-(i,j+1)
  const pts = new Map()
  const links = new Map()
  const at = (id, x0, y0, a0, x1, y1, a1) => {
    if (!pts.has(id)) {
      const t = (iso - a0) / (a1 - a0)
      pts.set(id, [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t])
    }
    return id
  }
  const link = (a, b) => {
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!links.has(x)) links.set(x, [])
      links.get(x).push(y)
    }
  }
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const tl = v(i, j), tr = v(i + 1, j), br = v(i + 1, j + 1), bl = v(i, j + 1)
      const c = (tl > iso ? 8 : 0) | (tr > iso ? 4 : 0) | (br > iso ? 2 : 0) | (bl > iso ? 1 : 0)
      if (c === 0 || c === 15) continue
      const T = () => at(hId(i, j), i, j, tl, i + 1, j, tr)
      const B = () => at(hId(i, j + 1), i, j + 1, bl, i + 1, j + 1, br)
      const L = () => at(vId(i, j), i, j, tl, i, j + 1, bl)
      const R = () => at(vId(i + 1, j), i + 1, j, tr, i + 1, j + 1, br)
      const centre = (tl + tr + br + bl) / 4 > iso // resolves the two saddle cases
      if (c === 1 || c === 14) link(L(), B())
      else if (c === 2 || c === 13) link(B(), R())
      else if (c === 3 || c === 12) link(L(), R())
      else if (c === 4 || c === 11) link(T(), R())
      else if (c === 6 || c === 9) link(T(), B())
      else if (c === 7 || c === 8) link(T(), L())
      else if (c === 5) centre ? (link(T(), L()), link(B(), R())) : (link(T(), R()), link(L(), B()))
      else if (c === 10) centre ? (link(T(), R()), link(L(), B())) : (link(T(), L()), link(B(), R()))
    }
  }
  const loops = []
  const seen = new Set()
  for (const start of links.keys()) {
    if (seen.has(start)) continue
    const loop = []
    let prev = -1
    let cur = start
    while (!seen.has(cur)) {
      seen.add(cur)
      loop.push(pts.get(cur))
      const [a, b] = links.get(cur)
      const next = a !== prev ? a : b
      prev = cur
      cur = next
    }
    if (loop.length > 8) loops.push(loop)
  }
  return loops
}

// Ramer–Douglas–Peucker on a closed loop: straight stems collapse to two points,
// curves keep enough to stay round.
function simplify(loop, eps) {
  const rdp = (p) => {
    if (p.length < 3) return p
    const [ax, ay] = p[0]
    const [bx, by] = p[p.length - 1]
    const dx = bx - ax, dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    let far = 0, at = 0
    for (let i = 1; i < p.length - 1; i++) {
      const d = Math.abs((p[i][0] - ax) * dy - (p[i][1] - ay) * dx) / len
      if (d > far) (far = d), (at = i)
    }
    return far > eps ? [...rdp(p.slice(0, at + 1)).slice(0, -1), ...rdp(p.slice(at))] : [p[0], p[p.length - 1]]
  }
  const half = loop.length >> 1
  return [...rdp(loop.slice(0, half + 1)).slice(0, -1), ...rdp([...loop.slice(half), loop[0]]).slice(0, -1)]
}

const area = (p) => p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0) / 2
function inside([x, y], poly) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

// Trace one DOM word into shapes, in em units: x from the word's left edge,
// y up from its baseline.
function traceWord(el) {
  const text = el.firstChild
  const style = getComputedStyle(el)
  const fs = parseFloat(style.fontSize)
  const box = el.getBoundingClientRect()
  const range = document.createRange()
  const chars = [...text.textContent].map((ch, i) => {
    range.setStart(text, i)
    range.setEnd(text, i + 1)
    const r = range.getBoundingClientRect()
    const upper = style.textTransform === 'uppercase' ? ch.toUpperCase() : ch
    return { ch: upper, left: (r.left - box.left) / fs, right: (r.right - box.left) / fs }
  })

  const margin = 0.25 * F
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(chars.at(-1).right * F + 2 * margin)
  canvas.height = Math.ceil(1.6 * F)
  const baseline = 1.15 * F
  const g = canvas.getContext('2d', { willReadFrequently: true })
  g.font = `${style.fontStyle} ${style.fontWeight} ${F}px ${style.fontFamily}`
  g.fillStyle = '#000'
  for (const c of chars) g.fillText(c.ch, margin + c.left * F, baseline)
  const capTop = g.measureText('I').actualBoundingBoxAscent / F

  const { data } = g.getImageData(0, 0, canvas.width, canvas.height)
  const loops = traceLoops(data, canvas.width, canvas.height).map((l) =>
    simplify(l, 0.35).map(([x, y]) => [(x - margin) / F, (baseline - y) / F]),
  )
  // Nesting depth decides: even = solid outline, odd = hole (a counter).
  const depth = loops.map((l, i) => loops.filter((o, j) => j !== i && inside(l[0], o)).length)
  const solids = loops.filter((_, i) => depth[i] % 2 === 0)
  const shapes = new Map(solids.map((l) => [l, new THREE.Shape(l.map(([x, y]) => new THREE.Vector2(x, y)))]))
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0) return
    const owner = solids.filter((o) => inside(l[0], o)).sort((a, b) => Math.abs(area(a)) - Math.abs(area(b)))[0]
    shapes.get(owner)?.holes.push(new THREE.Path(l.map(([x, y]) => new THREE.Vector2(x, y))))
  })
  return { shapes: [...shapes.values()], chars, capTop }
}

// ── Letters ──────────────────────────────────────────────────────────────────

function letterMaterial() {
  const m = new THREE.MeshBasicNodeMaterial()
  const n = normalWorld
  let c = color('#ede5d3') // the front: the page's night text colour, exactly
  c = mix(c, color('#fff8ea'), smoothstep(0.3, 0.75, n.y)) // tops catch the light
  c = mix(c, color('#b5a88d'), smoothstep(0.3, 0.75, abs(n.x))) // sides
  c = mix(c, color('#7a6f5d'), smoothstep(0.3, 0.75, n.y.negate())) // undersides
  m.colorNode = c
  return m
}

// words: DOM elements, each an inline-block holding one line of the title and a
// zero-size .baseline-probe (its top is the line's baseline).
export async function createHeroText(elements) {
  await document.fonts.ready
  const material = letterMaterial()
  const shadow = new THREE.ShadowNodeMaterial({ color: new THREE.Color('#120b08'), opacity: 0.5 })
  Object.assign(shadow, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, depthWrite: false })
  const group = new THREE.Group()

  const words = []
  for (const el of elements) {
    // Tracing is the heaviest part of the night's start: one word per task, so
    // the page keeps taking input while it runs.
    await yieldToMain()
    const { shapes, chars, capTop } = traceWord(el)
    // No geometric bevel: offsetting the outline self-intersects in the N's needle-
    // sharp counters and the cap fills them in. Faces are shaded by direction instead.
    const geometry = new THREE.ExtrudeGeometry(shapes, { depth: DEPTH, curveSegments: 1, bevelEnabled: false })
    geometry.computeBoundingBox()
    geometry.translate(0, 0, -geometry.boundingBox.max.z) // front face at z = 0
    const mesh = new THREE.Mesh(geometry, material)
    // Same letters again, showing only the shadows that fall on them.
    const shade = new THREE.Mesh(geometry, shadow)
    shade.receiveShadow = true
    shade.renderOrder = 1
    mesh.add(shade)
    group.add(mesh)
    words.push({ el, probe: el.querySelector('.baseline-probe'), mesh, chars, capTop, fs: 0 })
  }

  const ro = new ResizeObserver(() => words.forEach((w) => (w.fs = parseFloat(getComputedStyle(w.el).fontSize))))
  words.forEach((w) => ro.observe(w.el))
  words.forEach((w) => (w.fs = parseFloat(getComputedStyle(w.el).fontSize)))

  return {
    group,
    words,
    // Pin each word's front face onto its DOM text. `toPlane(px, py)` maps a
    // viewport point onto the plane z = 0 in the scene; `pxToWorld` is the
    // world size of one CSS pixel there. `rise` (0..1) extrudes the letters.
    layout(toPlane, pxToWorld, rise) {
      for (const w of words) {
        const box = w.el.getBoundingClientRect()
        const base = w.probe.getBoundingClientRect().top
        const k = w.fs * pxToWorld
        w.mesh.position.copy(toPlane(box.left, base))
        w.mesh.scale.set(k, k, k * Math.max(rise, 0.002))
        w.mesh.updateMatrixWorld()
      }
    },
    // A point on the top front edge of a letter, in world space: where to sit.
    ledge(word, letter) {
      const w = words[word]
      const c = w.chars.find((x) => x.ch === letter) ?? w.chars[0]
      return w.mesh.localToWorld(new THREE.Vector3((c.left + c.right) / 2, w.capTop, 0))
    },
    capHeight: (word) => words[word].capTop * words[word].mesh.scale.x,
    dispose() {
      ro.disconnect()
      words.forEach((w) => w.mesh.geometry.dispose())
      material.dispose()
      shadow.dispose()
    },
  }
}
