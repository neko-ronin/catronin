// Night sky behind the specimen: gold particle trails orbiting a bright core,
// plus a fixed star field. Orbits centre on the specimen's screen position.
import { hash2 } from "@vgpu/wgsl-std/hash";

struct Sky {
  time: f32,
  progress: f32, // lerped page scroll, 0..1
  aspect: f32,
  center: vec2f, // specimen position, uv space
  pointer: vec2f, // -0.5..0.5
}
@group(0) @binding(0) var<uniform> sky: Sky;

const TAU: f32 = 6.2831853;

// A tilted ellipse drawn as a dotted trail with a bright head.
fn orbit(p: vec2f, radius: vec2f, tilt: f32, phase: f32, speed: f32) -> f32 {
  let c = cos(tilt);
  let s = sin(tilt);
  let q = vec2f(c * p.x + s * p.y, -s * p.x + c * p.y);
  let d = abs(length(q / radius) - 1.0) * min(radius.x, radius.y);
  let a = atan2(q.y / radius.y, q.x / radius.x);
  let head = fract(a / TAU - sky.time * speed - phase);
  let trail = pow(head, 5.0);
  let dots = 0.5 + 0.5 * sin(a * 220.0);
  return exp(-d * 1400.0) * trail * dots + exp(-d * 90.0) * trail * 0.08;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let scale = vec2f(sky.aspect, 1.0);
  let p = (uv - sky.center) * scale - sky.pointer * 0.04;

  var glow = 0.0;
  for (var i = 0; i < 7; i++) {
    let fi = f32(i);
    let spread = 1.0 + sky.progress * 0.8;
    let r = vec2f(0.2 + fi * 0.055, 0.07 + fi * 0.03) * spread;
    glow += orbit(p, r, fi * 0.9 + sky.time * 0.015 + sky.progress * 1.2, fi * 0.37, 0.035 + fi * 0.006);
  }
  let core = 0.004 / (dot(p, p) + 0.004) * (1.0 - sky.progress * 0.7);

  let cell = floor(uv * scale * 160.0);
  let h = hash2(cell);
  let star = step(0.993, h.x) * (0.45 + 0.55 * sin(sky.time * 1.3 + h.y * 40.0));

  let night = vec3f(0.043, 0.047, 0.071);
  let ember = vec3f(1.0, 0.74, 0.4);
  let color = night + ember * (glow * 1.3 + core * 0.35) + vec3f(star * 0.3);
  return vec4f(color, 1.0);
}
