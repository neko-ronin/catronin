import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { canEnhance, whenIdle } from '../enhance.jsx'
import './home.css'

// Observational captions only — rename or rewrite these in your own words.
const SPECIMENS = [
  { slug: 'coral-reliquary', name: 'Coral reliquary', note: 'A glass dodecahedron holding something that looks alive.' },
  { slug: 'bloom-orb', name: 'Bloom', note: 'Thin-film ribbons wrapped around a clear orb.' },
  { slug: 'sea-glass', name: 'Sea glass', note: 'Frosted green glass, scratched like it spent years in the surf.' },
  { slug: 'ember-orbit', name: 'Ember orbit', note: 'Gold particle trails circling a bright core.' },
  { slug: 'nudibranch', name: 'Nudibranch', note: 'A sea slug made of coloured particles, drifting in the dark.' },
]

// The companion's compass in the hero illustration: the night opens from here.
const COMPASS = { x: 0.685, y: 0.64 }

// `commit` is the React side of the switch (the toggle's label). It runs inside the
// transition, so the old snapshot still shows the old label.
function setWorld(next, origin, commit) {
  const root = document.documentElement
  if (origin) {
    root.style.setProperty('--iris-x', `${origin[0]}px`)
    root.style.setProperty('--iris-y', `${origin[1]}px`)
  }
  if (!document.startViewTransition) {
    root.dataset.world = next // CSS colour transitions carry the change instead
    return commit()
  }
  const vt = document.startViewTransition(() => {
    root.dataset.world = next
    flushSync(commit)
  })
  vt.ready.catch(() => { }) // skipped (e.g. a hidden tab): the switch itself still ran
}

function useNight(artRef) {
  const stage = useRef(null)
  const [live, setLive] = useState(null) // { backend, hasSky, setPaused }
  const [world, setWorldState] = useState('paper')

  const go = useCallback(
    (next) => {
      const r = artRef.current?.getBoundingClientRect()
      const origin = r && r.bottom > 0 ? [r.left + r.width * COMPASS.x, r.top + r.height * COMPASS.y] : [innerWidth / 2, innerHeight / 2]
      live?.setPaused(next === 'paper')
      setWorld(next, origin, () => setWorldState(next))
    },
    [artRef, live],
  )

  useEffect(() => {
    if (!canEnhance()) return
    let cancelled = false
    let night
    whenIdle(async () => {
      try {
        const { mount } = await import('./night.js')
        if (cancelled) return
        night = await mount(stage.current, () => {
          if (cancelled) return
          setLive(night)
        })
        if (cancelled) night.dispose()
      } catch (err) {
        console.warn('[night] staying on paper:', err)
      }
    })
    return () => {
      cancelled = true
      night?.dispose()
    }
  }, [])

  // First frame is on screen: open the night once, from the compass.
  const opened = useRef(false)
  useEffect(() => {
    if (live && !opened.current) {
      opened.current = true
      go('night')
    }
  }, [live, go])

  return { stage, live, world, go }
}

function Follower({ slug }) {
  const pane = useRef(null)
  useEffect(() => {
    const pos = { x: innerWidth / 2, y: innerHeight / 2 }
    const shown = { ...pos }
    let raf
    const move = (e) => Object.assign(pos, { x: e.clientX, y: e.clientY })
    const tick = () => {
      shown.x += (pos.x - shown.x) * 0.12
      shown.y += (pos.y - shown.y) * 0.12
      const el = pane.current
      if (el) {
        const x = Math.min(shown.x + 28, innerWidth - el.offsetWidth - 16)
        const y = Math.min(Math.max(shown.y - el.offsetHeight / 2, 16), innerHeight - el.offsetHeight - 16)
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`
      }
      raf = requestAnimationFrame(tick)
    }
    addEventListener('pointermove', move, { passive: true })
    tick()
    return () => {
      removeEventListener('pointermove', move)
      cancelAnimationFrame(raf)
    }
  }, [])
  return (
    <div ref={pane} className={`follower ${slug ? 'is-on' : ''}`} aria-hidden="true">
      {SPECIMENS.map((s) => (
        <video key={s.slug} src={slug === s.slug ? `/work/${s.slug}.mp4` : undefined}
          muted loop playsInline autoPlay preload="none" className={slug === s.slug ? 'opacity-100' : 'opacity-0'} />
      ))}
    </div>
  )
}

function Specimens() {
  const [hover, setHover] = useState(null)
  const fine = typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine) and (min-width: 900px)').matches
  return (
    <section id="specimens" className="wrap relative z-10 py-28">
      <h2 className="font-display text-2xl font-semibold uppercase tracking-wide text-muted">Orbography</h2>
      <ul className="mt-6" onPointerLeave={() => setHover(null)}>
        {SPECIMENS.map((s) => (
          <li key={s.slug} className="border-t border-rule last:border-b">
            <details className="group" onPointerEnter={() => setHover(s.slug)}>
              <summary className="specimen-row">
                <span className="font-display text-[clamp(2.5rem,7vw,6rem)] font-bold uppercase leading-[0.9] tracking-tight">{s.name}</span>
                <span className="max-w-[34ch] text-muted">{s.note}</span>
              </summary>
              <video className="mb-8 aspect-video w-full max-w-3xl bg-black" src={`/work/${s.slug}.mp4`}
                controls muted loop playsInline preload="none" />
            </details>
          </li>
        ))}
      </ul>
      {fine && <Follower slug={hover} />}
    </section>
  )
}

function App() {
  const art = useRef(null)
  const { stage, live, world, go } = useNight(art)
  const [capable] = useState(canEnhance)

  return (
    <>
      <div ref={stage} className="stage" aria-hidden="true" />
      <a href="#specimens" className="skip">Skip to specimens</a>

      <header className="wrap relative z-10 flex items-center justify-between py-6">
        <a href="/" className="font-display text-xl font-bold uppercase tracking-wide no-underline">Cat Ronin</a>
        <nav className="flex items-center gap-6">
          <a href="#specimens" className="hidden sm:inline">Specimens</a>
          <a href="https://orbius.catronin.com/" className="hidden sm:inline">Orbius</a>
          <a href="#lab">Lab</a>
          {/* Laid out from the start and shown once the night is live: arriving
              later, it made the header taller and pushed the page down. */}
          {capable && (
            <button type="button" className={`world-toggle ${live ? '' : 'invisible'}`} onClick={() => go(world === 'night' ? 'paper' : 'night')}>
              {world === 'night' ? 'Back to paper' : 'Light it up'}
            </button>
          )}
        </nav>
      </header>

      <main className="relative z-10">
        <section className="wrap grid min-h-[calc(100svh-88px)] items-center gap-8 pb-16 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <h1 className="font-display text-[clamp(5rem,15vw,13.5rem)] font-black uppercase leading-[0.8] tracking-[-0.01em]">
              {/* Each word is rebuilt as physical letters in the night scene
                  (hero-text.js), measured from these boxes; the probe marks the baseline. */}
              <span className="hero-word inline-block">Cat<span className="baseline-probe" /></span>
              <br />
              <span className="hero-word inline-block">Ronin<span className="baseline-probe" /></span>
            </h1>
            <p className="mt-8 max-w-[38ch] text-xl leading-snug">
              A one-eyed cat wandering between ink and light — drawing on paper by day, growing
              glass specimens in real-time 3D by night.
            </p>
          </div>
          <figure ref={art} className="hero-art m-0 lg:col-span-7">
            <div className="photo-frame photo-frame--hero">
              <img src="/art/ronin-and-companion.webp" width="1920" height="1280" fetchPriority="high"
                alt="Cat Ronin, a one-eyed grey tabby in a mustard beanie and red plaid shirt, greets a fluffy white companion holding a brass compass and an old field book." />
            </div>
            <figcaption className="night-only text-sm text-muted">
              The Prismatic Egg incubates, from the Orbius light lab, rendered live with {live?.backend}{live?.hasSky ? ' and vgpu' : ''}.
            </figcaption>
          </figure>
        </section>

        <Specimens />

        <section id="field-notes" className="wrap grid gap-12 py-28 lg:grid-cols-12">
          <figure className="field-frame-wrap m-0 w-full lg:col-span-5">
            <div className="photo-frame photo-frame--portrait photo-frame--tape-right">
              <img src="/art/ronin-yosemite.webp" loading="lazy" width="1122" height="1402" className="field-photo w-full"
                alt="Cat Ronin from behind, in a mustard beanie and red flannel with a loaded backpack, looking out at Half Dome at sunset." />
            </div>
          </figure>
          <div className="self-center lg:col-span-6 lg:col-start-7">
            <h2 className="font-display text-[clamp(3rem,6vw,5rem)] font-bold uppercase leading-[0.9]">Field notes</h2>
            <div className="mt-8 max-w-[52ch] space-y-5 text-lg leading-relaxed">
              <p>
                A ronin is a Frankenheimer film that serves the best car chase scene in cinema history. This one is a cat.
              </p>
              <p>
                The trail runs two ways. On paper it is ink, drawn line by line: On the GPU it is shaders and particles, teaching glass, coral and light to
                hold still like objects with weight in the hand.
              </p>
              <p className="text-muted">The page is a specimen too. It arrives on paper, and only drinks compute if your browser can spare it.</p>
            </div>
          </div>
        </section>

        <section id="lab" className="wrap border-t border-rule py-28">
          <h2 className="font-display text-2xl font-semibold uppercase tracking-wide text-muted">Lab</h2>
          <a href="https://orbius.catronin.com/" className="mt-6 block max-w-3xl no-underline">
            <span className="font-display text-[clamp(3rem,8vw,6.5rem)] font-bold uppercase leading-none underline decoration-accent decoration-4 underline-offset-8">Orbius</span>
            <span className="mt-4 block text-lg text-muted">
              Web toy from the slop cannon, if you ask me. Tasteful though, as far as web toys go.
              UX oddities and bugs aside, play with it. Press all the buttons. Save composition to browser collections or to local disk.
            </span>
          </a>
        </section>
      </main>

      <footer className="wrap relative z-10 flex flex-wrap justify-between gap-3 py-10 text-sm text-muted">
        <span>catronin.com</span>
        <span>React, three.js and vgpu, served from Cloudflare</span>
      </footer>
    </>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
