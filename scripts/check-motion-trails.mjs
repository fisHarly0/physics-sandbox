// Run with: node scripts/check-motion-trails.mjs (no dependencies).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
for (const [index, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].entries()) {
  new vm.Script(match[1], { filename: `inline-script-${index}.js` })
}
// Execute the production trail functions; the canvas spy measures visible output.
const functions = html.slice(html.indexOf('function updateTrails('), html.indexOf('function render(){'))
assert.ok(functions.startsWith('function updateTrails('))
let segments = 0
const context = vm.createContext({
  trailsOn: false, TRAIL_MS: 3000, TRAIL_SAMPLE_MS: 40, TRAIL_MAX_POINTS: 80,
  bodies: [], grab: { kind: null, obj: null },
  cvx: { save() {}, restore() {}, beginPath() {}, moveTo() {}, stroke() {}, lineTo() { segments++ } },
})
vm.runInContext(functions, context)
const body = { x: 0, y: 0, trail: null, trailAt: 0 }
context.bodies = [body]
context.updateTrails(100)
context.drawTrails(100)
assert.equal(body.trail, null, 'disabled mode must not allocate samples')
assert.equal(segments, 0)
context.trailsOn = true
for (let i = 0; i < 300; i++) {
  body.x = i * 3
  context.updateTrails(100 + i * 40)
  assert.ok(body.trail.length <= 80, 'sample storage stays bounded')
  assert.ok(body.trail.every(p => 100 + i * 40 - p.t <= 3000))
}
context.drawTrails(12060)
assert.ok(segments > 0, 'moving bodies produce visible segments')
segments = 0
context.updateTrails(16000)
context.drawTrails(16000)
assert.equal(segments, 0, 'old paths disappear when stationary')
context.grab = { kind: 'body', obj: body }
context.updateTrails(16040)
assert.equal(body.trail, null, 'dragging clears the previous path')
context.grab = { kind: null, obj: null }
body.x = 500
context.updateTrails(16100)
assert.equal(body.trail.length, 1, 'release starts a new path without joining the old position')
for (const kind of ['B', 'E', 'T']) {
  body.kind = kind
  context.updateTrails(16200)
  assert.equal(body.trail, null)
}
body.kind = null
body.x = NaN
context.updateTrails(16300)
assert.equal(body.trail, null, 'invalid coordinates must not reach the canvas')
console.log('PASS: disabled allocation, bounded samples, expiry, rendering, dragging, release, excluded fields and invalid coordinates')
