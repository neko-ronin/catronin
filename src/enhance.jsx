// Progressive enhancement: the static page is the page. Live GPU code is only
// fetched when the browser can run it, after first paint, while idle.
import { useEffect, useRef, useState } from 'react'

export function canEnhance() {
  const mq = (q) => window.matchMedia(q).matches
  // Phones, reduced-motion and data-saver visitors keep the static page.
  if (mq('(prefers-reduced-motion: reduce)')) return false
  if (!mq('(min-width: 768px) and (pointer: fine)')) return false
  if (navigator.connection?.saveData) return false
  if ('gpu' in navigator) return true
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

export const whenIdle = (fn) =>
  window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 300)

// Ends the current task so input and paint can run between chunks of startup work.
export const yieldToMain = () => (globalThis.scheduler?.yield ? scheduler.yield() : new Promise((r) => setTimeout(r)))

// Cross-fades a poster into a live canvas once its first frame is drawn.
// `load` resolves to a module exporting `mount(el, onFirstFrame) => Promise<{ dispose }>`.
export function Enhance({ load, poster, className = '' }) {
  const host = useRef(null)
  const [live, setLive] = useState(false)

  useEffect(() => {
    if (!canEnhance()) return
    let cancelled = false
    let scene
    whenIdle(async () => {
      try {
        const { mount } = await load()
        if (cancelled) return
        scene = await mount(host.current, () => !cancelled && setLive(true))
        if (cancelled) scene.dispose()
      } catch (err) {
        console.warn('[enhance] staying on static poster:', err)
      }
    })
    return () => {
      cancelled = true
      scene?.dispose()
    }
  }, [load])

  return (
    <div className={`relative overflow-hidden ${className}`} aria-hidden="true">
      <div className={`absolute inset-0 transition-opacity duration-[1600ms] ease-out ${live ? 'opacity-0' : 'opacity-100'}`}>{poster}</div>
      <div ref={host} className={`absolute inset-0 transition-[opacity,filter] duration-[1600ms] ease-out ${live ? 'opacity-100 blur-0' : 'opacity-0 blur-md'}`} />
    </div>
  )
}

// three.js renderer lifecycle: resize, pause offscreen, first-frame signal.
// `warm(renderer)`, if given, finishes before the first frame may draw: compile
// shaders there, or the first frames stall building them.
export async function createRenderer(THREE, el, onFirstFrame, frame, warm) {
  const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true })
  await renderer.init() // WebGPU, or a WebGL 2 backend when WebGPU is missing
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  el.appendChild(renderer.domElement)
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'

  let size = { w: 1, h: 1 }
  const resize = () => {
    size = { w: el.clientWidth || 1, h: el.clientHeight || 1 }
    renderer.setSize(size.w, size.h, false)
  }
  resize()
  const ro = new ResizeObserver(resize)
  ro.observe(el)
  await warm?.(renderer)

  let first = true
  let running = false
  const loop = (t) => {
    frame(t / 1000, size)
    if (first) {
      first = false
      requestAnimationFrame(onFirstFrame) // one frame later, so it is on screen
    }
  }
  const setRunning = (on) => {
    running = on
    renderer.setAnimationLoop(on ? loop : null)
  }
  const io = new IntersectionObserver(([e]) => setRunning(e.isIntersecting))
  io.observe(el)

  return {
    renderer,
    backend: renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2',
    get running() {
      return running
    },
    dispose() {
      io.disconnect()
      ro.disconnect()
      renderer.setAnimationLoop(null)
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
