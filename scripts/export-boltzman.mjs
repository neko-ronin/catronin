// Re-export the "Steve Boltzman" brain from Orbius as a standalone shader bundle.
// Uses Orbius's own exportFamily(), so the site renders exactly what Orbius does.
//   node scripts/export-boltzman.mjs [path/to/orbius]
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const orbius = resolve(process.argv[2] ?? `${homedir()}/Repos/vibes/orbius`)
const { exportFamily } = await import(`${orbius}/src/materials/export.js`)
const { palettes } = await import(`${orbius}/src/project.js`)

const project = JSON.parse(readFileSync(`${orbius}/saves/projects/steve-boltzman.json`, 'utf8'))
const shell = project.objects.find((o) => o.role === 'glass' && o.contents)
if (!shell) throw Error('steve-boltzman.json has no glass object with contents')

const look = shell.contents.look
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) // as Orbius's engine does
const bundle = exportFamily({ ...project.config, ...look, family: shell.contents.family }, palettes[look.palette].colors.map(rgb))

// Uniforms Orbius sets at draw time rather than in the export. Standalone orb
// workspace mode: not placed inside a scene shell, and no second bounding ball.
Object.assign(bundle.uniforms, { uContained: 0, uEnclosure: 0, uPlace: [0, 0, 0], uPlaceScale: 1 })
if (bundle.fragment.includes('texture(uChemistry')) throw Error('This look samples uChemistry; the site does not simulate it')

const out = new URL('../src/home/boltzman.bundle.json', import.meta.url)
writeFileSync(out, JSON.stringify({
  source: 'orbius/saves/projects/steve-boltzman.json',
  exposure: project.config.exposure,
  shell: { ior: shell.ior, thickness: shell.thickness, opacity: shell.opacity, contentsScale: shell.contents.scale },
  vertex: bundle.vertex,
  fragment: bundle.fragment,
  uniforms: bundle.uniforms,
}))
console.log(`wrote ${out.pathname} (${bundle.family.name}, ${bundle.fragment.length} chars of GLSL)`)
