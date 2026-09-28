import { StrictMode, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { Enhance } from '../enhance.jsx'
import { ASPECT, RECORDS, contourPaths } from './terrain.js'
import './fieldnote.css'

const W = 1600
const H = W / ASPECT
const loadTerrain = () => import('./terrain-scene.js')
const TIDE_LEVEL = 7 // the pink contour, frozen where the live one starts climbing from

function ContourPoster() {
  const paths = useMemo(() => contourPaths(), [])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="h-full w-full bg-paper">
      {paths.map(({ level, d, index }) => (
        <path key={level} d={d} fill="none" strokeLinecap="round"
          stroke={level === TIDE_LEVEL ? 'var(--color-flag)' : index ? 'var(--color-ink)' : 'var(--color-contour)'}
          strokeWidth={index || level === TIDE_LEVEL ? 2.4 : 1.4} />
      ))}
    </svg>
  )
}

// Flags stay crisp in the DOM on top of both the poster and the live layer.
function Flags() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {RECORDS.map((r) => {
        const x = r.x * H, y = r.y * H
        return (
          <g key={r.name} transform={`translate(${x} ${y})`}>
            <line y2="-64" stroke="var(--color-ink)" strokeWidth="3" />
            <path d="M0 -64 L46 -52 L0 -40Z" fill="var(--color-flag)" />
            <circle r="5" fill="var(--color-ink)" />
            <text x="12" y="30" className="font-sans" fontSize="28" fontWeight="600" fill="var(--color-ink)"
              stroke="var(--color-paper)" strokeWidth="8" paintOrder="stroke">{r.name}</text>
          </g>
        )
      })}
    </svg>
  )
}

const LOG = [
  ['North culvert', 'Inspection, 18 photos', 'Synced'],
  ['Unit 14', 'Moisture reading, 3 points', 'Synced'],
  ['Ridge line', 'Photo set, 24 photos', 'Waiting for signal'],
  ['Rebar check', 'Follow-up on spacing', 'Assigned to Dana'],
  ['Weekly summary', 'Report for the client', 'Sent Monday 07:00'],
]

const FEATURES = [
  ['Works with no signal', 'Records, photos and measurements save on the device and merge without duplicates when you’re back in range.'],
  ['Every entry is evidence', 'Each one carries a timestamp, a GPS fix and the device it came from. Disagreements get settled by the record.'],
  ['Reports from a week of visits', 'Turn the log into a client-ready document in one pass, with the original photos one tap away.'],
]

const TIERS = [
  { name: 'Solo', price: '$0', unit: 'per month', blurb: 'One inspector, unlimited entries.', items: ['Offline capture', 'Photo sets', 'Basic reports'] },
  { name: 'Crew', price: '$19', unit: 'per seat, per month', blurb: 'For teams running several sites at once.', items: ['Everything in Solo', 'Assignments and handoffs', 'Client-ready reports', 'Full history of every edit'], flagged: true },
  { name: 'Firm', price: 'Talk to us', unit: 'annual contract', blurb: 'Dozens of crews, one compliance story.', items: ['Single sign-on', 'Retention policies', 'Priority support'] },
]

function Button({ children, quiet, href = '#pricing' }) {
  return (
    <a href={href} className={`inline-flex min-h-12 items-center px-5 font-semibold no-underline transition-colors ${quiet ? 'border-2 border-ink hover:bg-ink hover:text-paper' : 'bg-ink text-paper hover:bg-flag'}`}>
      {children}
    </a>
  )
}

function App() {
  return (
    <>
      <p className="bg-ink px-4 py-2 text-center text-sm text-paper">
        Fieldnote is invented — a design exercise from <a href="/" className="underline">Catronin</a>. No product, no company, nothing collected.
      </p>
      <header className="wrap flex items-center justify-between py-5">
        <a href="#" className="flex items-center gap-2 font-cond text-2xl font-bold no-underline">
          <svg width="16" height="22" viewBox="0 0 16 22" aria-hidden="true"><path d="M1 0v22" stroke="currentColor" strokeWidth="2" /><path d="M2 1l13 4-13 4z" fill="var(--color-flag)" /></svg>
          Fieldnote
        </a>
        <nav className="flex items-center gap-6 text-[15px]">
          <a href="#how" className="hidden sm:inline">How it works</a>
          <a href="#pricing" className="hidden sm:inline">Pricing</a>
          <Button>Start free</Button>
        </nav>
      </header>

      <main>
        <section className="wrap grid items-end gap-10 pb-20 pt-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <h1 className="font-cond text-[clamp(3.25rem,8vw,6.75rem)] font-extrabold uppercase leading-[0.88] tracking-[-0.01em]">
              The site visit, written down properly.
            </h1>
            <p className="mt-6 max-w-[42ch] text-lg leading-relaxed text-ink/80">
              Fieldnote keeps every inspection in one shared record — photos, measurements and
              follow-ups, captured offline and synced the moment you get signal.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button>Start free, no card needed</Button>
              <Button quiet href="#how">See how it works</Button>
            </div>
          </div>

          <figure className="m-0 lg:col-span-7">
            <div className="relative aspect-[16/10] border-2 border-ink">
              <Enhance load={loadTerrain} poster={<ContourPoster />} className="h-full w-full bg-paper" />
              <Flags />
            </div>
            <figcaption className="mt-2 flex justify-between text-sm text-ink/70">
              <span>This week’s records, pinned where they were taken</span>
              <span className="hidden sm:inline">Contour interval 5 m</span>
            </figcaption>
          </figure>
        </section>

        <section id="how" className="border-t-2 border-ink">
          <div className="wrap grid gap-12 py-20 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <h2 className="font-cond text-5xl font-extrabold uppercase leading-none">Built for places with no signal</h2>
              <dl className="mt-10 space-y-8">
                {FEATURES.map(([t, d]) => (
                  <div key={t}>
                    <dt className="text-lg font-semibold">{t}</dt>
                    <dd className="mt-1 max-w-[46ch] leading-relaxed text-ink/75">{d}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="lg:col-span-6 lg:col-start-7">
              <table className="w-full border-collapse bg-sheet text-left">
                <caption className="pb-3 text-left text-sm text-ink/70">Field log, Crew 3 — what the office sees</caption>
                <tbody>
                  {LOG.map(([name, what, status]) => (
                    <tr key={name} className="border-t border-contour first:border-t-2 first:border-ink">
                      <th scope="row" className="px-4 py-4 font-semibold">
                        {name}
                        <span className="block text-sm font-normal text-ink/70">{what}</span>
                      </th>
                      <td className={`px-4 py-4 text-right text-sm ${status.startsWith('Waiting') ? 'font-semibold text-flag-dark' : ''}`}>{status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="pricing" className="bg-ink text-paper">
          <div className="wrap py-20">
            <h2 className="font-cond text-5xl font-extrabold uppercase leading-none">Pricing</h2>
            <p className="mt-3 text-paper/75">Cancel whenever the project ends.</p>
            <div className="mt-12 grid gap-px bg-paper/25 md:grid-cols-3">
              {TIERS.map((t) => (
                <div key={t.name} className="relative bg-ink p-8 md:first:pl-0">
                  {t.flagged && <span className="absolute right-8 top-8 bg-flag px-2 py-1 text-sm font-semibold text-ink">Most crews pick this</span>}
                  <h3 className="font-cond text-3xl font-bold">{t.name}</h3>
                  <p className="mt-6 font-cond text-5xl font-extrabold">{t.price}</p>
                  <p className="text-sm text-paper/70">{t.unit}</p>
                  <p className="mt-5">{t.blurb}</p>
                  <ul className="mt-5 space-y-2 text-paper/80">
                    {t.items.map((i) => <li key={i}>{i}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="wrap flex flex-wrap justify-between gap-3 py-8 text-sm">
        <span>Fieldnote is a fictional brand.</span>
        <a href="/">Back to Catronin</a>
      </footer>
    </>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
