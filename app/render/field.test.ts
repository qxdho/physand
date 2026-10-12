/**
 * Tests for the field and plank renderers.
 *
 * The most valuable test here is the ROD INDEXING one. The legacy code carried a
 * reported bug (R105-3: "the hinge should be at the end connected to the object,
 * why is it at the other end?") caused by placing the pin using slot-named
 * variables instead of semantic indices. That mapping was previously only
 * checkable by an instrumented in-browser probe; now it is a unit test.
 *
 * Run: node --test app/render/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boxExtentAlong, drawFieldDots, drawRodPlank } from './field.ts';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDER_DIR = dirname(fileURLToPath(import.meta.url));

/** A context stand-in that records drawing calls. */
function recorder() {
  const calls: string[] = [];
  const surface: Record<string, unknown> = {
    calls,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    beginPath: () => calls.push('beginPath'),
    moveTo: (x: number, y: number) => calls.push(`moveTo(${x},${y})`),
    lineTo: (x: number, y: number) => calls.push(`lineTo(${x},${y})`),
    arc: (x: number, y: number, r: number) => calls.push(`arc(${x.toFixed(2)},${y.toFixed(2)},${r})`),
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
  };
  return surface as never as Parameters<typeof drawRodPlank>[0] & { calls: string[] };
}

const callsOf = (s: unknown) => (s as { calls: string[] }).calls;

test('drawFieldDots draws dots when the field points out of the page', () => {
  const s = recorder();
  drawFieldDots(s, 100, 100, 26, 1);
  const calls = callsOf(s);
  assert.ok(calls.some((c) => c.startsWith('arc(100.00,100.00,1.7)')), 'centre dot');
  // Out-of-page uses fill, not the cross strokes.
  assert.ok(!calls.some((c) => c.includes('moveTo') && !c.includes('0,0')), 'no cross strokes');
});

test('drawFieldDots draws crosses when the field points into the page', () => {
  /* A user reported "why a circle when the field points away? it should just be
   * a cross" — the sign previously had no visual effect at all.
   */
  const s = recorder();
  drawFieldDots(s, 100, 100, 26, -1);
  const calls = callsOf(s);
  const moves = calls.filter((c) => c.startsWith('moveTo'));
  // Diagonal cross: two strokes per lattice point at +/-4.6 around the point.
  assert.ok(moves.length >= 2, 'crosses are drawn with moveTo/lineTo pairs');
  assert.ok(
    moves.some((c) => c === 'moveTo(95.4,95.4)'),
    'diagonal from -k,-k',
  );
  assert.ok(
    moves.some((c) => c === 'moveTo(104.6,95.4)'),
    'diagonal from +k,-k',
  );
});

test('drawFieldDots treats zero as out-of-page', () => {
  // `bz >= 0` draws dots; only a strictly negative value crosses.
  const zero = recorder();
  drawFieldDots(zero, 50, 50, 26, 0);
  const neg = recorder();
  drawFieldDots(neg, 50, 50, 26, -0.001);
  assert.notDeepEqual(callsOf(zero), callsOf(neg), 'zero and negative differ');
});

test('drawFieldDots always strokes the bounding circle', () => {
  const s = recorder();
  drawFieldDots(s, 60, 70, 40, 1);
  assert.ok(callsOf(s).some((c) => c === 'arc(60.00,70.00,40)'), 'outer circle');
});

test('drawRodPlank draws the plank between the two ends', () => {
  const s = recorder();
  drawRodPlank(s, { x: 100, y: 100, th: 0, len: 200 });
  const calls = callsOf(s);
  assert.ok(calls.includes('moveTo(0,100)'), 'left end');
  assert.ok(calls.includes('lineTo(200,100)'), 'right end');
});

test('drawRodPlank defaults length to 170', () => {
  const s = recorder();
  drawRodPlank(s, { x: 0, y: 0, th: 0 });
  const calls = callsOf(s);
  assert.ok(calls.includes('moveTo(-85,0)'), 'half of 170');
  assert.ok(calls.includes('lineTo(85,0)'));
});

test('drawRodPlank draws a hinge pin ONLY at connected ends', () => {
  const none = recorder();
  drawRodPlank(none, { x: 0, y: 0, th: 0, len: 100 });
  assert.equal(callsOf(none).filter((c) => c === 'fill').length, 0, 'no pins');

  const one = recorder();
  drawRodPlank(one, { x: 0, y: 0, th: 0, len: 100, anc: [{}, null] });
  assert.equal(callsOf(one).filter((c) => c === 'fill').length, 1, 'one pin');

  const both = recorder();
  drawRodPlank(both, { x: 0, y: 0, th: 0, len: 100, anc: [{}, {}] });
  assert.equal(callsOf(both).filter((c) => c === 'fill').length, 2, 'two pins');
});

test('rod end INDEX 0 is the +u side and index 1 is the -u side', () => {
  /* This is the R105-3 fix, pinned. The rod is drawn from -u to +u, so with
   * th=0 and len=100 at the origin, index 0 is at x=+50 and index 1 at x=-50.
   *
   * The bug was that the pin was placed using the slot-named `x1`/`x2`
   * variables, and `x1` is the -u side — so anchoring index 1 drew the pin at
   * index 0. Measured before the fix: 39 ink units at the anchored end vs 193 at
   * the free end.
   */
  const anch0 = recorder();
  drawRodPlank(anch0, { x: 0, y: 0, th: 0, len: 100, anc: [{}, null] });
  const pin0 = callsOf(anch0).find((c) => c.startsWith('arc(') && c.endsWith(',4.6)'));
  assert.equal(pin0, 'arc(50.00,0.00,4.6)', 'anchoring index 0 pins the +u end');

  const anch1 = recorder();
  drawRodPlank(anch1, { x: 0, y: 0, th: 0, len: 100, anc: [null, {}] });
  const pin1 = callsOf(anch1).find((c) => c.startsWith('arc(') && c.endsWith(',4.6)'));
  assert.equal(pin1, 'arc(-50.00,0.00,4.6)', 'anchoring index 1 pins the -u end');
});

test('the pin is a hinge pin: filled dot plus outer ring', () => {
  // Drawing a bare filled circle prompted "what is this black dot?" — the pin
  // must match drawHinge's visual exactly.
  const s = recorder();
  drawRodPlank(s, { x: 0, y: 0, th: 0, len: 100, anc: [{}, null] });
  const calls = callsOf(s);
  assert.ok(calls.includes('arc(50.00,0.00,4.6)'), 'inner dot');
  assert.ok(calls.includes('arc(50.00,0.00,7.2)'), 'outer ring');
  assert.equal(calls.filter((c) => c === 'stroke').length, 2, 'plank + ring');
});

test('drawRodPlank rotates the ends with th', () => {
  const s = recorder();
  drawRodPlank(s, { x: 0, y: 0, th: Math.PI / 2, len: 100 });
  const calls = callsOf(s);
  /* At 90 degrees the rod is vertical: ends at (0, -50) and (0, 50).
   * Note the x coordinate is ~-3e-15 rather than exactly 0, because
   * Math.cos(Math.PI/2) is 6.1e-17 rather than 0 — asserting an exact string
   * would test floating-point noise rather than the rotation. */
  const starts = calls.filter((c) => c.startsWith('moveTo'));
  assert.equal(starts.length, 1);
  const m = /^moveTo\((-?[\d.e-]+),(-?[\d.e-]+)\)$/.exec(starts[0]!);
  assert.ok(m, `unparseable moveTo: ${starts[0]}`);
  assert.ok(Math.abs(Number(m[1])) < 1e-9, `x should be ~0, got ${m[1]}`);
  assert.equal(Number(m[2]), -50, 'y should be -50');
});

test('boxExtentAlong picks the dominant axis', () => {
  const er = { l: 1, r: 2, t: 3, b: 4 };
  assert.equal(boxExtentAlong(1, 0, er), 2, '+x -> right edge');
  assert.equal(boxExtentAlong(-1, 0, er), 1, '-x -> left edge');
  assert.equal(boxExtentAlong(0, 1, er), 4, '+y -> bottom edge');
  assert.equal(boxExtentAlong(0, -1, er), 3, '-y -> top edge');
  // A tie goes to the horizontal axis, matching the legacy comparison.
  assert.equal(boxExtentAlong(0.7071, 0.7071, er), 2, 'tie favours horizontal');
});

test('renderers tolerate a missing surface', () => {
  assert.equal(drawFieldDots(null, 0, 0, 10, 1), false);
  assert.equal(drawRodPlank(null, { x: 0, y: 0 }), false);
});

test('these renderers read no shared state', () => {
  /* The extraction is only valid while this holds: an added `W` or `bodies` read
   * would make the module un-movable again, and no behavioural test would
   * notice.
   */
  const text = readFileSync(join(RENDER_DIR, 'field.ts'), 'utf8');
  const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\bglobalThis\b/.test(code), 'no globals');
  assert.ok(!/(?<![.\w])(W|H|groundY|bodies)(?![\w(])/.test(code), 'no app state');
  if (/\bcvx\b/.test(code)) {
    assert.ok(/\b(?:const|let|var)\s+cvx\b/.test(code), 'cvx must be a local alias');
  }
});
