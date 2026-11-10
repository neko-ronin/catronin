# Tumbler’s fly-through cumulus

[Illustrated field note and print layout](https://catronin.com/labs/clouds/)

Tumbler renders hand-placed, procedural cloud volumes in WebGL 2. Each cloud is an axis-aligned box with a world-space center, three dimensions in meters, and a seed. The box bounds the work. A density function inside it supplies the visible silhouette, including when the camera flies through it. For a first port, build one cloud with a fixed seed, sun, and wind. Add more cells once the same shader works from below, at the edge, inside, and above.

## Build one convincing cloud

1. Normalize the sample position within the cell. Start with a wide, low ellipsoid, add two unequal main turrets, and surround them with five smaller billows. Take the maximum of the eight signed ellipsoid profiles. Rotate the arrangement horizontally and vary turret heights with the seed. Multiply the final density by a smooth mask at the base and a fade at the box boundary.
2. Bake one repeating 48 × 48 × 48 RGBA8 texture. Pack smooth value noise at three frequencies into R and inverted Worley noise at two frequencies into G and B. In Tumbler the value octaves have 4, 8, and 16 lattice cells per tile with weights 0.58, 0.28, and 0.14. The Worley channels use 6 and 12 cells. Sample with linear filtering and repeat wrap. The red channel roughens the profile, the green channel cuts broad scallops, and the blue channel erodes finer detail at a higher sample frequency. Scroll the noise coordinates with horizontal wind. The larger billow shape stays anchored in the cell.
3. Render the opaque world and retain its depth. Intersect a camera ray with the cell. Clamp the entry to zero if the camera is inside and cap the exit at the opaque scene along that ray. Use the target engine’s depth convention to reconstruct that distance. Tumbler uses proxy box back faces to limit pixel coverage, then marches the interval in a target at half width and half height. It offsets the samples with a stable per-pixel jitter and exits when very little light can pass through.
4. At each occupied sample, use the same density function toward the sun. Start with five expanding midpoint samples of the coarser field to estimate sunlight optical depth. Use exponential transmission for the direct sun and a second, softer transmission term to fill shadows. Add altitude-dependent ambient light and a small forward-scattering lobe to brighten the sun-facing rim in backlit views. Keep the view ray on the detailed density field.
5. Accumulate cloud light and transmission front to back. Composite into linear scene color before tone mapping. Fade distant clouds toward the clear-air sky color evaluated in the same view direction. Apply display encoding after compositing.

```text
entry, exit = intersect(ray, cell)
entry = max(entry, 0)
exit = min(exit, distanceToOpaqueWorldAlongRay)
if exit <= entry: skip

T = 1
C = 0
ds = (exit - entry) / viewSamples
for i in 0 .. viewSamples - 1:
    p = ray.origin + ray.direction * (entry + (i + pixelJitter) * ds)
    a = 1 - exp(-extinction * density(p) * ds)
    C += T * a * litCloudColor(p)
    T *= 1 - a
    if T < 0.012: break
outLinear = C + T * opaqueSceneLinear
```

For Tumbler’s density curve, add `0.82 × (value - 0.5)` to the ellipsoid profile, subtract `0.30 × (1 - coarseWorley)` and `0.26 × (1 - fineWorley)`, then apply `smoothstep(-0.09, 0.14, profile)` and the two boundary masks. The fine Worley channel is sampled at 2.7 times the base frequency. The light cache omits that fine erosion. Tumbler uses an extinction coefficient of 0.014 in this meter-based field. The loop illustrates one cell. If cells frequently intersect in another game, integrate their densities in a common ray march or explicitly handle the overlap. Tumbler’s separate transparent proxies approximate compositing between cells.

## Scale it up

- **Cache sun transmission.** Tumbler evaluates the coarser density along the sun ray into a 32 × 32 × 32 lattice per cell. It stores two transmission terms in a padded 2D slice atlas, with bilinear filtering within each slice and interpolation between slices. It refreshes about twice per simulation second and when the sun or wind changes. Native 3D storage works too. Keep detailed density in the view march so the cache only softens the light.
- **Give clouds a presence on the ground.** Tumbler projects each cell’s bounds along the sun and ray-marches the same density from terrain receivers into a separate 256 × 256 world-space transmission map. The terrain and objects use it to dim direct sun while keeping ambient light. Verify that overlapping shadows accumulate independently of draw order. Tumbler’s older ground-shadow implementation can lose overlap because of scissored clears.
- **Profile a moving camera before reducing view samples.** Start with a fixed budget and compare it with a higher-sample reference. Tumbler uses 96 view samples and a conservative empty-space skip from above. The skip only removes sample indices that provably have zero density. It preserves every occupied sample position. Derive a fresh bound if the density function changes.

## What improved in Tumbler

| Stage | Change |
| --- | --- |
| Painted sky to fly-through clouds | A flat sky layer gave way to nine bounded volumes that a flight camera could enter. The current world has 16 authored cells, with a common altitude band of 980 to 1,600 m. |
| Shape and light | The first volume shape used three smooth lobes. The later shape added the broad base, unequal turrets, two scales of erosion, more sun samples, and the same clear-air haze as the sky. A low-resolution light cache then took the sun-ray work out of the high-detail view march. |
| Motion | The view march went from 48 to 96 samples. In the recorded moving cloud-edge test, the worst opacity error against a 192-sample reference fell from 25 to 5 levels out of 255. The worst temporal residual fell from 24 to 4. Median cloud-pass GPU time at that edge rose from 3.93 to 8.91 ms on the test setup. |
| Valley preview | The move from Three.js r180 to r187 fixed horizontal lighting bands caused by applying the canvas pixel ratio to a scissor rectangle expressed in offscreen atlas texels. With cloud time pinned, the atlas matched byte for byte across five tested scales from 0.7 to 2. The density and 96 view samples stayed the same. [Three.js migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide#186--187) |

## Review in motion

Record the same camera path below, grazing the edge, inside, and above. Include a ridgeline crossing, a warm low sun, and a high sun. Compare fixed-seed captures to the higher-sample reference. Look for stepping at the edge, depth leaks at silhouettes, seams in the repeating field, lighting bands as render scale changes, and abrupt cache refreshes. Measure GPU median and 95th-percentile time for the cloud pass and cache updates separately. Test projected shadow overlaps in both draw orders.

For a coding agent, give it this brief, a Tumbler reference capture, the target renderer’s depth and color conventions, and one fixed camera route. Ask it to return the first fly-through with GPU timings and a higher-sample comparison before adding the rest of the sky.

For comparison with other production approaches, see [Guerrilla’s Nubis authoring talk](https://www.guerrilla-games.com/read/nubis-authoring-real-time-volumetric-cloudscapes-with-the-decima-engine) and [Nubis³](https://www.guerrilla-games.com/read/nubis-cubed).

## Tumbler source map

- `shared/world/worldmap.json` under `atmosphere` holds the authored cells.
- `client/web/src3d/cloud-field.js` defines the procedural noise, density, and sun sampling.
- `client/web/src3d/clouds.js` renders the volume, performs depth clipping, and composites it.
- `client/web/src3d/cloud-lighting.js` caches sun transmission through the volume.
- `client/web/src3d/cloud-shadows.js` and `cloud-shadow-field.js` handle ground transmission and bounds.
- `client/web/src3d/atmosphere-sky.js` supplies clear-air color and haze.
- `docs/reviews/web-sky-clouds-2026-10-20.md`, `cloud-regression-2026-10-24.md`, `cloud-performance-2026-10-24.md`, and `valley-geometry-fixes-2026-11-09.md` record the changes and measurements.
