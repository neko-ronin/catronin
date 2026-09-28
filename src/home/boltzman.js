// Steve Boltzman's brain, rendered by Orbius's own exported shader (see
// scripts/export-boltzman.mjs) in a small offscreen WebGL 2 context. The canvas
// is then used as a live texture inside the three.js glass.
import bundle from './boltzman.bundle.json'

// Orbius writes linear HDR; its composite pass applies exposure and this curve.
// Alpha = brightest channel, so the dark background vanishes under additive blending.
const fragment =
  bundle.fragment.replace('void main()', 'void orbiusMain()') +
  `
uniform float uExposure;
void main(){orbiusMain();vec3 c=1.-exp(-frag.rgb*uExposure);c=pow(c,vec3(.88));frag=vec4(c,max(c.r,max(c.g,c.b)));}`

function compile(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(`Boltzman shader: ${gl.getShaderInfoLog(shader)}`)
  return shader
}

export function createBoltzman(size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
  if (!gl) throw Error('Boltzman needs WebGL 2')

  const program = gl.createProgram()
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, bundle.vertex))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(`Boltzman link: ${gl.getProgramInfoLog(program)}`)
  gl.useProgram(program)
  gl.bindVertexArray(gl.createVertexArray()) // fullscreen triangle from gl_VertexID

  // Set each uniform with the setter its declared GLSL type needs.
  const setters = {}
  for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
    const { name, type } = gl.getActiveUniform(program, i)
    const at = gl.getUniformLocation(program, name)
    const by = {
      [gl.FLOAT]: (v) => gl.uniform1f(at, v),
      [gl.INT]: (v) => gl.uniform1i(at, v),
      [gl.SAMPLER_2D]: (v) => gl.uniform1i(at, v),
      [gl.FLOAT_VEC2]: (v) => gl.uniform2fv(at, v),
      [gl.FLOAT_VEC3]: (v) => gl.uniform3fv(at, v),
      [gl.FLOAT_VEC4]: (v) => gl.uniform4fv(at, v),
    }
    setters[name] = by[type]
  }
  const set = (values) => {
    for (const [name, v] of Object.entries(values)) setters[name]?.(v)
  }
  set({ ...bundle.uniforms, uSteps: 120, uResolution: [size, size], uExposure: bundle.exposure })

  const base = bundle.uniforms.uRotation
  return {
    canvas,
    shell: bundle.shell,
    // `turn` is extra rotation in radians from pointer/scroll; the brain itself
    // is raymarched, so turning it here turns it in real 3D, not a flat sprite.
    render(time, turn = 0, tilt = 0) {
      set({ uTime: time, uRotation: base + turn, uTilt: bundle.uniforms.uTilt + tilt })
      gl.viewport(0, 0, size, size)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
