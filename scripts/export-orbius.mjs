// Export what's inside an Orbius project's glass as a standalone shader bundle.
// Uses Orbius's own exportFamily(), so the site renders exactly what Orbius does.
//   node scripts/export-orbius.mjs <project> [path/to/orbius]
//   e.g. node scripts/export-orbius.mjs goddess-egg   -> src/home/goddess-egg.bundle.json
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const name = process.argv[2] ?? 'goddess-egg'
const orbius = resolve(process.argv[3] ?? `${homedir()}/Repos/vibes/orbius`)
const { exportFamily } = await import(`${orbius}/src/materials/export.js`)
const { palettes } = await import(`${orbius}/src/project.js`)
const { familyById, parseControls, uniformName } = await import(`${orbius}/src/materials/families.js`)

const project = JSON.parse(readFileSync(`${orbius}/saves/projects/${name}.json`, 'utf8'))
const shell = project.objects.find((o) => o.role === 'glass' && o.contents)
if (!shell) throw Error(`${name}.json has no glass object with contents`)

// Contents imported from another save carry their own look; otherwise they use the
// project's settings, exactly as Orbius's engine resolves them.
const look = shell.contents.look ?? {}
const config = { ...project.config, ...look, family: shell.contents.family }
if (!look.params) config.params = project.config.params?.[shell.contents.family] ?? {}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) // as Orbius's engine does
const bundle = exportFamily(config, palettes[config.palette].colors.map(rgb))

// A family's own declared controls (e.g. silk's filament and weave). exportFamily()
// leaves these out; Orbius's engine fills them from saved params or the family's
// defaults, so do the same or they silently render as 0.
const { defaults } = parseControls(familyById[config.family].glsl)
for (const [key, fallback] of Object.entries(defaults)) bundle.uniforms[uniformName(key)] = config.params?.[key] ?? fallback

// Uniforms Orbius sets at draw time rather than in the export. Standalone orb
// workspace mode: not placed inside a scene shell, and no second bounding ball.
Object.assign(bundle.uniforms, { uContained: 0, uEnclosure: 0, uPlace: [0, 0, 0], uPlaceScale: 1 })
if (bundle.fragment.includes('texture(uChemistry')) throw Error('This look samples uChemistry; the site does not simulate it')

const out = new URL(`../src/home/${name}.bundle.json`, import.meta.url)
writeFileSync(out, JSON.stringify({
  source: `orbius/saves/projects/${name}.json`,
  name: project.name,
  exposure: project.config.exposure,
  shell: { ior: shell.ior, thickness: shell.thickness, opacity: shell.opacity, contentsScale: shell.contents.scale },
  vertex: bundle.vertex,
  fragment: bundle.fragment,
  uniforms: bundle.uniforms,
}))
console.log(`wrote ${out.pathname} (${bundle.family.name}, ${bundle.fragment.length} chars of GLSL)`)
