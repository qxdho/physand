/**
 * Tests for the device body renderers.
 *
 * These two needed a spec object because they read 5–8 loose numeric globals.
 * The tests below pin the two things that are easy to lose:
 *
 *   1. drawGroundBody's APPEARANCE DETAIL — the top bearing line and the
 *      SLANTED hatch. The first extraction attempt dropped both (it drew only
 *      the rectangle and a vertical hatch); the pixel comparison against the
 *      legacy build caught it, and these assertions make the requirement
 *      explicit so the next person does not repeat it.
 *   2. drawBeltBody's R101④ STRUCTURE — the two roller circles must not share a
 *      canvas subpath, because canvas auto-connects subpaths and that draws the
 *      stray chord the user reported as "a horizontal line through the middle".
 *      The legacy comment notes this cannot be seen in a JS call log (no lineTo
 *      is emitted for the chord), so the test asserts the structure.
 *
 * Run: node --test app/render/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawBeltBody, drawGroundBody } from './bodies.ts';
import { BOUNDARY_INK, beltSpec, groundSpec } from './device-spec.ts';

/** A context stand-in that records drawing calls. */
function recorder() {
  const calls: string[] = [];
  const surface: Record<string, unknown> = {
    calls,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineJoin: '',
    lineCap: '',
    beginPath: () => calls.push('beginPath'),
    closePath: () => calls.push('closePath'),
    rect: (x: number, y: number, w: number, h: number) => calls.push(`rect(${x},${y},${w},${h})`),
    moveTo: (x: number, y: number) => calls.push(`moveTo(${round(x)},${round(y)})`),
    lineTo: (x: number, y: number) => calls.push(`lineTo(${round(x)},${round(y)})`),
    arc: (x: number, y: number, r: number, s: number, e: number) =>
      calls.push(`arc(${round(x)},${round(y)},${round(r)},${round(s)},${round(e)})`),
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: (x: number, y: number) => calls.push(`translate(${x},${y})`),
    rotate: (r: number) => calls.push(`rotate(${round(r)})`),
  };
  return surface as never as Parameters<typeof drawGroundBody>[0] & { calls: string[] };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const callsOf = (s: unknown) => (s as { calls: string[] }).calls;

test('drawGroundBody bails on bodies that are not ground', () => {
  // The legacy guard is `if(!B||!B.gnd)return;` — a non-ground body must draw
  // nothing rather than a stray slab.
  const s = recorder();
  assert.equal(drawGroundBody(s, { x: 0, y: 0 }, groundSpec(), BOUNDARY_INK, false), false);
  assert.deepEqual(callsOf(s), []);
});

test('drawGroundBody draws the rectangle and the TOP BEARING LINE', () => {
  /* The bearing line is the user's "one side is a line". Dropping it was the
   * bug in the first extraction attempt.
   */
  const s = recorder();
  drawGroundBody(s, { gnd: 1, x: 300, y: 300 }, groundSpec(), BOUNDARY_INK, false);
  const calls = callsOf(s);

  // Default size comes from the spec: 260 spawn length, 18 thickness.
  assert.ok(calls.includes('rect(-130,-9,260,18)'), 'body rectangle');
  assert.ok(
    calls.includes('moveTo(-130,-9)') && calls.includes('lineTo(130,-9)'),
    'solid line along the top edge',
  );
});

test('drawGroundBody hatch marks are SLANTED and clamped inside the body', () => {
  /* The user's "the other side is rows of slashes". The slant is what makes it
   * read as the engineering ground symbol; a vertical hatch does not. The
   * clamp keeps every stroke inside the rectangle.
   */
  const s = recorder();
  drawGroundBody(s, { gnd: 1, x: 300, y: 300 }, groundSpec(), BOUNDARY_INK, false);
  const calls = callsOf(s);

  // Collect hatch segments (everything after the bearing line's stroke).
  const hatch: { from: string; to: string }[] = [];
  let pending: string | null = null;
  for (const c of calls) {
    if (c.startsWith('moveTo(')) pending = c;
    else if (c.startsWith('lineTo(') && pending) {
      hatch.push({ from: pending, to: c });
      pending = null;
    }
  }
  // The bearing line is also a move/line pair; the rest are hatches.
  const slashes = hatch.filter((h) => h.from !== 'moveTo(-130,-9)');
  assert.ok(slashes.length >= 10, `expected many hatch marks, got ${slashes.length}`);

  for (const h of slashes) {
    const fx = Number(/moveTo\((-?[\d.]+),/.exec(h.from)![1]);
    const tx = Number(/lineTo\((-?[\d.]+),/.exec(h.to)![1]);
    assert.ok(tx > fx, `hatch must slant right: ${h.from} -> ${h.to}`);
    assert.ok(tx <= 129, `hatch must not leave the body: ${h.to}`);
    assert.ok(fx >= -128, `hatch must start inside: ${h.from}`);
  }
});

test('drawGroundBody fills only on hover', () => {
  // R111: the user reported a "shadow overlay" under the hatching, so the rest
  // state must not fill the rectangle.
  const rest = recorder();
  drawGroundBody(rest, { gnd: 1, x: 0, y: 0 }, groundSpec(), BOUNDARY_INK, false);
  assert.equal(callsOf(rest).filter((c) => c === 'fill').length, 0, 'no fill at rest');

  const hov = recorder();
  drawGroundBody(hov, { gnd: 1, x: 0, y: 0 }, groundSpec(), BOUNDARY_INK, true);
  assert.equal(callsOf(hov).filter((c) => c === 'fill').length, 1, 'pale hint on hover');
});

test('drawGroundBody saves and restores the context', () => {
  // It translates and rotates; leaking that would rotate everything drawn after.
  const s = recorder();
  drawGroundBody(s, { gnd: 1, x: 10, y: 20, th: 0.5 }, groundSpec(), BOUNDARY_INK, false);
  const calls = callsOf(s);
  assert.equal(calls[0], 'save');
  assert.equal(calls[calls.length - 1], 'restore');
  assert.ok(calls.includes('translate(10,20)'));
  assert.ok(calls.includes('rotate(0.5)'));
});

test('drawBeltBody bails on bodies that are not belts', () => {
  const s = recorder();
  assert.equal(drawBeltBody(s, { x: 0, y: 0 }, beltSpec(), BOUNDARY_INK, 1 / 60, false), false);
  assert.deepEqual(callsOf(s), []);
});

test('drawBeltBody draws the two rollers in SEPARATE subpaths (R101④)', () => {
  /* Canvas connects the end of a subpath to the start of the next. Two full
   * circles in ONE path therefore draw a chord from (-ex+r, 0) to (ex-r, 0) —
   * exactly the stray horizontal line through the belt's middle that the user
   * reported. The fix is two independent beginPath/stroke pairs.
   *
   * This is asserted structurally because the chord never appears as a lineTo.
   */
  const s = recorder();
  drawBeltBody(s, { belt: 1, x: 0, y: 0, conv: 0 }, beltSpec(), BOUNDARY_INK, 1 / 60, false);
  const calls = callsOf(s);

  // Locate the two full circles (start 0, end 2pi).
  const circleIdx = calls
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.startsWith('arc(') && c.includes(',0,6.2832)'))
    .map(({ i }) => i);
  assert.equal(circleIdx.length, 2, 'two roller circles');

  // The second circle must be preceded by its own beginPath, with a stroke
  // between the two circles (i.e. the first was completed independently).
  const first = circleIdx[0]!;
  const second = circleIdx[1]!;
  const between = calls.slice(first + 1, second);
  assert.ok(between.includes('stroke'), 'first roller is stroked before the second begins');
  assert.ok(between.includes('beginPath'), 'second roller starts its own subpath');
});

test('drawBeltBody chevrons encode direction', () => {
  // Forward and reverse must differ, and the chevron phase must stay in range.
  const fwd = recorder();
  drawBeltBody(fwd, { belt: 1, x: 0, y: 0, conv: 80 }, beltSpec(), BOUNDARY_INK, 1 / 60, false);
  const rev = recorder();
  drawBeltBody(rev, { belt: 1, x: 0, y: 0, conv: -80 }, beltSpec(), BOUNDARY_INK, 1 / 60, false);

  const chevrons = (s: unknown) =>
    callsOf(s).filter((c) => c.startsWith('lineTo(') && !c.includes(',0,'));
  assert.ok(chevrons(fwd).length > 0, 'forward chevrons drawn');
  assert.notDeepEqual(chevrons(fwd), chevrons(rev), 'direction changes the chevrons');
});

test('drawBeltBody advances the chevron phase with the frame delta', () => {
  // lastDt is a parameter precisely so this is testable.
  const belt: { belt: number; x: number; y: number; conv: number; _bph?: number } =
    { belt: 1, x: 0, y: 0, conv: 100 };
  const s = recorder();
  drawBeltBody(s, belt, beltSpec(), BOUNDARY_INK, 1 / 60, false);
  const first = belt._bph!;
  drawBeltBody(s, belt, beltSpec(), BOUNDARY_INK, 1 / 60, false);
  const second = belt._bph!;
  assert.notEqual(second, first, 'phase advanced');
  assert.ok(first >= 0 && first < beltSpec().hatchStep, 'phase stays in range');
  assert.ok(second >= 0 && second < beltSpec().hatchStep);
});

test('a large negative phase is NOT fully normalised — a pre-existing quirk', () => {
  /* Found while extracting this function, and deliberately preserved rather
   * than quietly fixed: the legacy code adds BELT_DECO_STEP to the phase only
   * ONCE (`if(ph<0)ph+=BELT_DECO_STEP`), so a large negative phase stays
   * negative and the chevron loop starts far to the left of the belt.
   *
   * Phase 1 of this refactor fixes no physics or drawing constants, and
   * changing this would alter belt rendering for a case nobody has reported.
   * The correct treatment is to record the behaviour, pin it, and raise it as
   * a product question — not to change it inside a structural refactor.
   */
  const belt: { belt: number; x: number; y: number; conv: number; _bph?: number } =
    { belt: 1, x: 0, y: 0, conv: -1000, _bph: 1 };
  const s = recorder();
  drawBeltBody(s, belt, beltSpec(), BOUNDARY_INK, 1 / 6, false);
  assert.ok(belt._bph! < 0, 'large negative phase remains negative (legacy behaviour)');
  /* What IS corrected is the local phase used to place the chevrons, so a
   * small negative phase still draws chevrons starting from the right edge
   * rather than off the left. `_bph` itself keeps its signed value — that is
   * the legacy contract, not a bug in the extraction. */
  const small: { belt: number; x: number; y: number; conv: number; _bph?: number } =
    { belt: 1, x: 0, y: 0, conv: -1, _bph: 0 };
  const s2 = recorder();
  drawBeltBody(s2, small, beltSpec(), BOUNDARY_INK, 1 / 6, false);
  const starts = callsOf(s2)
    .filter((c) => c.startsWith('moveTo('))
    .map((c) => Number(/moveTo\((-?[\d.]+),/.exec(c)![1]));
  assert.ok(starts.length > 0, 'chevrons were drawn');
  assert.ok(
    starts.every((x) => x >= -200),
    `small negatives must not push chevrons far left, got ${starts[0]}`,
  );
});

test('both renderers tolerate a missing surface', () => {
  assert.equal(drawGroundBody(null, { gnd: 1, x: 0, y: 0 }, groundSpec(), BOUNDARY_INK, false), false);
  assert.equal(
    drawBeltBody(null, { belt: 1, x: 0, y: 0 }, beltSpec(), BOUNDARY_INK, 1 / 60, false),
    false,
  );
});
