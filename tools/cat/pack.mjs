// Meshopt-pack Cat Ronin, and refuse the result unless it still is him.
//   node tools/cat/pack.mjs <source.glb> <out.glb>
//
// The encoder is the gltfpack 1.2.0 vendored in Tumbler, hash-checked before it runs,
// so nothing is downloaded and nothing is added to package.json. GLTFPACK_DIR overrides
// where it lives. Every limit below is what the packed file is compared against after
// decoding it, part by part and clip by clip, through three's own meshopt decoder.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, renameSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

const here = dirname(fileURLToPath(import.meta.url))
const encoder = process.env.GLTFPACK_DIR ?? resolve(here, '../../../tumbler/tools/vendor/gltfpack-1.2.0')
const VENDORED = {
  'cli.js': 'c7f3a81fa93a3609847fb75817e4777c339bd5f94963bdbb9aa224a6fdb038ce',
  'library.js': 'fdeee2ee7b3828939fc6d346b4f6452201e0c9cd0994e0dd743f2a4d86704ee9',
  'library.wasm': 'a56ea4f85dfd5be6595cfb8cb9034fda79d4e73adc90acd8393cc65e89fe0db4',
  'package.json': '54b57aae70160b53cca521ffe34c22be4094a6e76311984219ce5abfd692c877',
}
// Keep every name, material and key. Float positions and UVs at full precision, so the
// face is not snapped to a grid and its markings do not slide on the coat texture; the
// default UV precision was two texels off. 16-bit rotations, because the draw needs his
// paw to stay on the hilt.
const FLAGS = ['-cc', '-kn', '-km', '-ke', '-kv', '-ac', '-af', '0', '-vpf', '-vtf', '-vp', '16', '-vt', '16', '-ar', '16']
const LIMITS = { positionMm: 0.25, normalDeg: 2.5, colour: 0.005, uv: 0.0005, rotationDeg: 0.05, moveMm: 0.5, areaShare: 0.001 }

const COMPONENTS = {
  5120: [Int8Array, 127], 5121: [Uint8Array, 255], 5122: [Int16Array, 32767], 5123: [Uint16Array, 65535], 5125: [Uint32Array, 1], 5126: [Float32Array, 1],
}
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

function parse(path) {
  const data = readFileSync(path)
  if (data.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`)
  const size = data.readUInt32LE(12)
  const gltf = JSON.parse(data.subarray(20, 20 + size).toString())
  const blob = data.subarray(20 + size + 8, 20 + size + 8 + data.readUInt32LE(20 + size))
  const views = (gltf.bufferViews ?? []).map((view) => {
    const packed = view.extensions?.EXT_meshopt_compression
    if (!packed) return { bytes: blob.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength), stride: view.byteStride }
    const target = new Uint8Array(packed.count * packed.byteStride)
    const source = blob.subarray(packed.byteOffset ?? 0, (packed.byteOffset ?? 0) + packed.byteLength)
    MeshoptDecoder.decodeGltfBuffer(target, packed.count, packed.byteStride, source, packed.mode, packed.filter)
    return { bytes: target, stride: packed.byteStride }
  })
  // Rows of floats, whatever the storage: normalised integers scaled, quantised ones not.
  const rows = (index) => {
    const accessor = gltf.accessors[index]
    const view = views[accessor.bufferView]
    const [Type, top] = COMPONENTS[accessor.componentType]
    const width = WIDTH[accessor.type]
    const stride = view.stride ?? width * Type.BYTES_PER_ELEMENT
    const dv = new DataView(view.bytes.buffer, view.bytes.byteOffset, view.bytes.byteLength)
    const read = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[accessor.componentType]
    const out = []
    for (let i = 0; i < accessor.count; i++) {
      const row = []
      for (let c = 0; c < width; c++) {
        const v = dv[read]((accessor.byteOffset ?? 0) + i * stride + c * Type.BYTES_PER_ELEMENT, true)
        row.push(accessor.normalized ? Math.max(v / top, -1) : v)
      }
      out.push(row)
    }
    return out
  }
  return { gltf, rows }
}

// A node's rest transform as a world matrix, column-major.
function worlds(gltf) {
  const parent = new Map()
  gltf.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)))
  const local = (n) => {
    if (n.matrix) return n.matrix
    const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1]
    const [sx, sy, sz] = n.scale ?? [1, 1, 1]
    const [tx, ty, tz] = n.translation ?? [0, 0, 0]
    return [
      (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + w * z) * sx, 2 * (x * z - w * y) * sx, 0,
      2 * (x * y - w * z) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + w * x) * sy, 0,
      2 * (x * z + w * y) * sz, 2 * (y * z - w * x) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
      tx, ty, tz, 1,
    ]
  }
  const times = (a, b) => {
    const m = new Array(16)
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) m[c * 4 + r] = a[r] * b[c * 4] + a[r + 4] * b[c * 4 + 1] + a[r + 8] * b[c * 4 + 2] + a[r + 12] * b[c * 4 + 3]
    return m
  }
  return (index) => {
    let m = local(gltf.nodes[index])
    for (let i = parent.get(index); i !== undefined; i = parent.get(i)) m = times(local(gltf.nodes[i]), m)
    return m
  }
}

const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]

function surface(indices, positions) {
  let area = 0
  let triangles = 0
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [positions[indices[i]], positions[indices[i + 1]], positions[indices[i + 2]]]
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const size = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2
    area += size
    if (size > 0) triangles++
  }
  return { area, triangles }
}

// name -> every vertex in rest space, with what it carries. A skinned part's own node is
// ignored by a skin, so its positions are already model space, as glTF defines.
function parts({ gltf, rows }) {
  const world = worlds(gltf)
  const out = new Map()
  gltf.nodes.forEach((node, index) => {
    if (node.mesh === undefined) return
    const primitives = gltf.meshes[node.mesh].primitives
    if (primitives.length !== 1) throw new Error(`${node.name}: split into ${primitives.length} primitives`)
    const [p] = primitives
    const m = node.skin === undefined ? world(index) : null
    const positions = rows(p.attributes.POSITION).map((q) => (m ? apply(m, q) : q))
    const normalRows = rows(p.attributes.NORMAL)
    const normals = normalRows.map((n) => {
      const d = m ? [m[0] * n[0] + m[4] * n[1] + m[8] * n[2], m[1] * n[0] + m[5] * n[1] + m[9] * n[2], m[2] * n[0] + m[6] * n[1] + m[10] * n[2]] : n
      const size = Math.hypot(d[0], d[1], d[2]) || 1
      return [d[0] / size, d[1] / size, d[2] / size]
    })
    out.set(node.name, {
      material: gltf.materials[p.material].name,
      // Area, and triangles that have any. Rounding collapses the odd sliver at a pole and
      // gltfpack drops it, along with the source's own zero-area ones. Nothing can see
      // those, but a lost face would show up here.
      ...surface(rows(p.indices).flat(), positions),
      positions,
      normals,
      colours: p.attributes.COLOR_0 === undefined ? null : rows(p.attributes.COLOR_0),
      uvs: p.attributes.TEXCOORD_0 === undefined ? null : rows(p.attributes.TEXCOORD_0),
    })
  })
  return out
}

function compareParts(a, b, issues) {
  const worst = { positionMm: 0, normalDeg: 0, colour: 0, uv: 0 }
  if ([...a.keys()].sort().join() !== [...b.keys()].sort().join()) issues.push('the set of parts changed')
  for (const [name, source] of a) {
    const packed = b.get(name)
    if (!packed) continue
    if (source.material !== packed.material) issues.push(`${name}: material ${source.material} became ${packed.material}`)
    if (Math.abs(source.area - packed.area) > source.area * LIMITS.areaShare) issues.push(`${name}: surface area ${source.area.toFixed(6)} became ${packed.area.toFixed(6)}`)
    if (packed.triangles < source.triangles * 0.98) issues.push(`${name}: ${source.triangles} triangles became ${packed.triangles}`)
    if (!source.colours !== !packed.colours || !source.uvs !== !packed.uvs) issues.push(`${name}: lost an attribute`)
    // gltfpack reorders vertices, so match by place. Seams stack vertices on one spot,
    // and the right twin is the one that agrees best on everything else.
    const cell = 0.002
    const key = (q) => q.map((v) => Math.floor(v / cell)).join()
    const grid = new Map()
    packed.positions.forEach((q, i) => {
      const k = key(q)
      if (!grid.has(k)) grid.set(k, [])
      grid.get(k).push(i)
    })
    source.positions.forEach((q, i) => {
      const [cx, cy, cz] = q.map((v) => Math.floor(v / cell))
      let best = null
      for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
        for (const j of grid.get(`${x},${y},${z}`) ?? []) {
          const r = packed.positions[j]
          const gap = Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]) * 1000
          const dot = source.normals[i][0] * packed.normals[j][0] + source.normals[i][1] * packed.normals[j][1] + source.normals[i][2] * packed.normals[j][2]
          const turn = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI
          const shade = source.colours ? Math.max(...source.colours[i].slice(0, 3).map((v, c) => Math.abs(v - packed.colours[j][c]))) : 0
          const uv = source.uvs ? Math.max(Math.abs(source.uvs[i][0] - packed.uvs[j][0]), Math.abs(source.uvs[i][1] - packed.uvs[j][1])) : 0
          const score = gap / LIMITS.positionMm + turn / LIMITS.normalDeg + shade / LIMITS.colour + uv / LIMITS.uv
          if (!best || score < best.score) best = { score, gap, turn, shade, uv }
        }
      }
      if (!best) {
        issues.push(`${name}: vertex ${i} has no counterpart within ${cell * 1000} mm`)
        return
      }
      worst.positionMm = Math.max(worst.positionMm, best.gap)
      worst.normalDeg = Math.max(worst.normalDeg, best.turn)
      worst.colour = Math.max(worst.colour, best.shade)
      worst.uv = Math.max(worst.uv, best.uv)
    })
  }
  return worst
}

function clips({ gltf, rows }) {
  const out = new Map()
  for (const anim of gltf.animations ?? []) {
    const tracks = new Map()
    for (const channel of anim.channels) {
      const sampler = anim.samplers[channel.sampler]
      tracks.set(`${gltf.nodes[channel.target.node].name}/${channel.target.path}`, { times: rows(sampler.input).map((r) => r[0]), values: rows(sampler.output) })
    }
    out.set(anim.name, tracks)
  }
  return out
}

function sample({ times, values }, t) {
  if (t <= times[0]) return values[0]
  for (let i = 1; i < times.length; i++) {
    if (t <= times[i]) {
      const f = (t - times[i - 1]) / (times[i] - times[i - 1] || 1)
      let b = values[i]
      if (b.length === 4 && values[i - 1].reduce((s, v, c) => s + v * b[c], 0) < 0) b = b.map((v) => -v)
      return values[i - 1].map((v, c) => v + (b[c] - v) * f)
    }
  }
  return values[values.length - 1]
}

function compareClips(a, b, issues) {
  const worst = { rotationDeg: 0, moveMm: 0 }
  if ([...a.keys()].sort().join() !== [...b.keys()].sort().join()) issues.push('the set of clips changed')
  for (const [name, tracks] of a) {
    const packed = b.get(name)
    if (!packed) continue
    // A clip's length, not a track's: a constant track may be stored as a single key.
    const length = (all) => Math.max(...[...all.values()].map((t) => t.times[t.times.length - 1]))
    if (Math.abs(length(tracks) - length(packed)) > 0.001) issues.push(`${name}: duration changed`)
    for (const [id, track] of tracks) {
      const other = packed.get(id)
      if (!other) {
        issues.push(`${name}: lost the track ${id}`)
        continue
      }
      // Every source key, and halfway to the next: that is where a dropped key would show.
      const moments = track.times.flatMap((t, i) => (i ? [(track.times[i - 1] + t) / 2, t] : [t]))
      for (const t of moments) {
        const p = sample(track, t)
        const q = sample(other, t)
        if (p.length === 4) {
          const size = Math.hypot(...p) * Math.hypot(...q) || 1
          const dot = Math.min(1, Math.abs(p.reduce((s, v, c) => s + v * q[c], 0)) / size)
          worst.rotationDeg = Math.max(worst.rotationDeg, (2 * Math.acos(dot) * 180) / Math.PI)
        } else {
          worst.moveMm = Math.max(worst.moveMm, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 1000)
        }
      }
    }
  }
  return worst
}

const [sourcePath, outPath] = process.argv.slice(2)
if (!sourcePath || !outPath) throw new Error('usage: node tools/cat/pack.mjs <source.glb> <out.glb>')
for (const [file, sha] of Object.entries(VENDORED)) {
  const actual = createHash('sha256').update(readFileSync(join(encoder, file))).digest('hex')
  if (actual !== sha) throw new Error(`refusing to run gltfpack: ${file} does not match its recorded hash`)
}
await MeshoptDecoder.ready
const candidate = join(mkdtempSync(join(tmpdir(), 'ronin-pack-')), 'ronin.glb')
const log = execFileSync(process.execPath, [join(encoder, 'cli.js'), '-i', resolve(sourcePath), '-o', candidate, ...FLAGS], { encoding: 'utf8', cwd: dirname(candidate) })
if (/warning|error/i.test(log)) console.log(log)

const issues = []
const source = parse(sourcePath)
const packed = parse(candidate)
const geometry = compareParts(parts(source), parts(packed), issues)
const motion = compareClips(clips(source), clips(packed), issues)
const measured = { ...geometry, ...motion }
for (const [key, limit] of Object.entries(LIMITS)) {
  if (key in measured && measured[key] > limit) issues.push(`${key} is ${measured[key].toFixed(4)}, over the limit of ${limit}`)
}
if ((source.gltf.images ?? []).length !== (packed.gltf.images ?? []).length) issues.push('the set of images changed')
if (issues.length) throw new Error(`packed model refused:\n  ${[...new Set(issues)].slice(0, 20).join('\n  ')}`)
renameSync(candidate, outPath)
const report = Object.fromEntries(Object.entries(measured).map(([k, v]) => [k, +v.toFixed(4)]))
console.log(`packed: ${statSync(sourcePath).size >> 10} KB -> ${statSync(outPath).size >> 10} KB, worst ${JSON.stringify(report)}`)
