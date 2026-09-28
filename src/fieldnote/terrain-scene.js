// Live survey sheet: the same height field shaded per pixel in TSL (compiles
// to WGSL on WebGPU, GLSL on the WebGL 2 fallback). Adds hillshading under a
// slowly circling sun and a flagging-tape contour that climbs the terrain.
import * as THREE from 'three/webgpu'
import { Fn, uniform, uv, vec2, vec3, float, exp, dot, fract, fwidth, smoothstep, mix, min, abs, floor, mod, select, normalize, dFdx, dFdy, cos, sin, max } from 'three/tsl'
import { createRenderer } from '../enhance.jsx'
import { ASPECT, LEVELS, PEAKS } from './terrain.js'

export async function mount(el, onFirstFrame) {
  const uAspect = uniform(1) // canvas w / h
  const uTime = uniform(0)

  // Screen uv → sheet coords, cover-fit like the poster's `slice`.
  const sheet = Fn(() => {
    const p = uv()
    const wide = uAspect.greaterThan(ASPECT)
    const x = select(wide, p.x.mul(ASPECT), p.x.sub(0.5).mul(uAspect).add(ASPECT / 2))
    const y = select(wide, float(0.5).sub(p.y.sub(0.5).mul(ASPECT).div(uAspect)), float(1).sub(p.y))
    return vec2(x, y)
  })

  const heightAt = (p) =>
    PEAKS.reduce((h, [cx, cy, r, a]) => {
      const d = p.sub(vec2(cx, cy))
      return h.add(exp(dot(d, d).div(-r * r)).mul(a))
    }, float(0))

  const colorNode = Fn(() => {
    const level = heightAt(sheet()).mul(LEVELS)
    const w = fwidth(level)
    const f = fract(level)
    const line = float(1).sub(smoothstep(0, w.mul(1.3), min(f, float(1).sub(f))))
    const isIndex = mod(floor(level.add(0.5)), 5).lessThan(0.5)

    const sunA = uTime.mul(0.08)
    const sun = normalize(vec3(cos(sunA), sin(sunA), 1.4))
    const n = normalize(vec3(dFdx(level).mul(-6), dFdy(level).mul(6), 1))
    const shade = max(dot(n, sun), 0)

    const paper = vec3(0.914, 0.925, 0.875) // #E9ECDF
    const olive = vec3(0.557, 0.604, 0.486) // #8E9A7C
    const ink = vec3(0.118, 0.165, 0.106) // #1E2A1B
    const pink = vec3(0.878, 0.22, 0.478) // #E0387A

    let c = paper.mul(shade.mul(0.14).add(0.88))
    c = mix(c, select(isIndex, ink, olive), line.mul(select(isIndex, 0.85, 0.7)))

    // One contour, tracing upward through the elevations and looping.
    const tide = fract(uTime.mul(0.04)).mul(LEVELS - 2).add(1)
    const band = float(1).sub(smoothstep(w.mul(0.8), w.mul(2.2), abs(level.sub(tide))))
    return mix(c, pink, band)
  })

  const material = new THREE.MeshBasicNodeMaterial()
  material.colorNode = colorNode()
  const scene = new THREE.Scene()
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material))
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const handle = await createRenderer(THREE, el, onFirstFrame, (t, { w, h }) => {
    uAspect.value = w / h
    uTime.value = t
    handle.renderer.render(scene, camera)
  })
  return handle
}
