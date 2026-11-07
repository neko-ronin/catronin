// Regression check: he draws the sword on his first idle beat, and the director does
// nothing before his entrance, however long the scene took to load.
// Run: node tools/cat/check_director.mjs
import assert from 'node:assert/strict'
import { createDirector } from '../../src/home/ronin-director.js'
function run(startAt, untilT) {
  const log = []
  const ronin = { clip: 'sit', play(n) { log.push(n); this.clip = n }, aim() {} }
  const d = createDirector(ronin)
  const p = { x: 0, y: 0 }
  let started = false
  const t0 = performance.now() / 1000
  for (let t = t0; t < t0 + untilT; t += 1 / 30) {
    if (!started && t >= t0 + startAt) { d.start(); started = true; ronin.clip = 'sit' }
    d.tick(t, 1 / 30, p, p, Math.floor((t - t0) * 30) % 300 === 0) // pointer stirs every 10s
    if (ronin.clip !== 'sit_doze') ronin.clip = 'sit' // one-shots finish instantly here
  }
  return log
}
const quick = run(0, 40)
assert.equal(quick[0], 'sit_present')
assert.equal(quick[1], 'sit_draw', 'first idle beat draws the sword')
console.log('quick load:', quick.join(' > '))
// slow load: idle past the 25s doze timer before he appears, pointer never moving
const log = []
const ronin = { clip: 'sit', play(n) { log.push(n); this.clip = n }, aim() {} }
const d = createDirector(ronin)
const p = { x: 0, y: 0 }
for (let t = 0; t < 31; t += 1 / 30) d.tick(t, 1 / 30, p, p, false)
assert.deepEqual(log, [], 'nothing plays before he appears')
d.start(); ronin.clip = 'sit'
const t0 = performance.now() / 1000
for (let t = t0; t < t0 + 9; t += 1 / 30) { d.tick(t, 1 / 30, p, p, false); if (ronin.clip !== 'sit') ronin.clip = 'sit' }
assert.ok(log.includes('sit_draw'), 'not stuck dozing: ' + log.join(' > '))
console.log('slow load: ', log.join(' > '))
