// The survey sheet's terrain. The SVG poster traces contours of this height
// field on the CPU; the live scene evaluates the same function per pixel.
// Coordinates: x ∈ [0, ASPECT], y ∈ [0, 1], y pointing down (like SVG).
export const ASPECT = 16 / 10
export const LEVELS = 16 // contour lines across the full height range; every 5th is an index contour

export const PEAKS = [
  // [x, y, radius, height]
  [0.42, 0.34, 0.2, 1.0],
  [1.18, 0.62, 0.24, 0.82],
  [0.86, 0.9, 0.16, 0.48],
  [1.46, 0.18, 0.13, 0.5],
  [0.12, 0.84, 0.18, 0.36],
]

export function height(x, y) {
  let h = 0
  for (const [cx, cy, r, a] of PEAKS) h += a * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (r * r))
  return h
}

// Records from the field log, pinned where they were captured.
export const RECORDS = [
  { name: 'North culvert', status: 'Synced', x: 0.3, y: 0.5 },
  { name: 'Unit 14', status: 'Synced', x: 1.02, y: 0.44 },
  { name: 'Ridge line', status: 'Offline', x: 0.5, y: 0.2 },
  { name: 'Rebar check', status: 'Assigned', x: 1.3, y: 0.78 },
]

// Marching squares → one SVG path per level. Grid is coarse on purpose;
// the poster only has to look right until the live scene takes over.
export function contourPaths(cols = 160, w = 1600) {
  const rows = Math.round(cols / ASPECT)
  const px = w / cols
  const g = []
  for (let j = 0; j <= rows; j++) {
    g.push([])
    for (let i = 0; i <= cols; i++) g[j].push(height((i / cols) * ASPECT, j / rows) * LEVELS)
  }
  const out = []
  for (let level = 1; level < LEVELS; level++) {
    let d = ''
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const c = [g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]] // tl tr br bl
        const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]
        const hits = []
        for (let e = 0; e < 4; e++) {
          const a = c[e], b = c[(e + 1) % 4]
          if ((a < level) !== (b < level)) {
            const t = (level - a) / (b - a)
            const [x0, y0] = corners[e], [x1, y1] = corners[(e + 1) % 4]
            hits.push([(x0 + (x1 - x0) * t) * px, (y0 + (y1 - y0) * t) * px])
          }
        }
        // ponytail: saddle cells (4 hits) pair arbitrarily; invisible at this grid size
        for (let k = 0; k + 1 < hits.length; k += 2)
          d += `M${hits[k][0].toFixed(1)} ${hits[k][1].toFixed(1)}L${hits[k + 1][0].toFixed(1)} ${hits[k + 1][1].toFixed(1)}`
      }
    }
    out.push({ level, d, index: level % 5 === 0 })
  }
  return out
}
