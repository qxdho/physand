/**
 * Tests for the anchor geometry.
 *
 * These functions decide where a spring visually terminates on the surface of
 * its host body. Previously they could only be exercised by building a scene and
 * drawing it; that is why they lived unnoticed among the drawing code even
 * though they contain no canvas calls at all.
 *
 * Run: node --test app/render/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hostExitDist, hostInsideInk, springHostSurfDist, type AnchorHost } from './anchor-geometry.ts';

/** A 100x80 rectangle centred on its own origin. */
const rect: AnchorHost = {
  x: 100,
  y: 100,
  closed: true,
  pts: [[-50, -40], [50, -40], [50, 40], [-50, 40]],
};

test('hostInsideInk uses the even-odd rule', () => {
  assert.equal(hostInsideInk(rect, 100, 100), true, 'centre is inside');
  assert.equal(hostInsideInk(rect, 149, 139), true, 'just inside the corner');
  assert.equal(hostInsideInk(rect, 300, 300), false, 'far outside');
  assert.equal(hostInsideInk(rect, 100, 39), false, 'above the top edge');
});

test('hostInsideInk respects rotation', () => {
  // A long thin box rotated 90 degrees becomes tall and narrow, so a point that
  // was inside is now outside.
  const thin: AnchorHost = {
    x: 0, y: 0, th: Math.PI / 2, closed: true,
    pts: [[-60, -5], [60, -5], [60, 5], [-60, 5]],
  };
  assert.equal(hostInsideInk(thin, 0, 50), true, 'inside once rotated upright');
  assert.equal(hostInsideInk(thin, 50, 0), false, 'no longer inside horizontally');
});

test('hostInsideInk rejects degenerate outlines', () => {
  // Fewer than three points cannot enclose anything.
  assert.equal(hostInsideInk({ x: 0, y: 0, closed: true, pts: [] }, 0, 0), false);
  assert.equal(hostInsideInk({ x: 0, y: 0, closed: true, pts: [[0, 0], [1, 1]] }, 0, 0), false);
  assert.equal(hostInsideInk({ x: 0, y: 0, closed: true }, 0, 0), false);
});

test('hostExitDist finds the distance to leave along an axis', () => {
  // From the centre of the 100x80 rectangle: 50 to the right, 40 upward.
  assert.equal(hostExitDist(rect, 100, 100, 1, 0), 50);
  assert.equal(hostExitDist(rect, 100, 100, -1, 0), 50);
  assert.equal(hostExitDist(rect, 100, 100, 0, -1), 40);
  assert.equal(hostExitDist(rect, 100, 100, 0, 1), 40);
});

test('hostExitDist returns 0 when the ray never leaves', () => {
  // Degenerate input must not produce a huge value — a caller treating that as
  // an inset would collapse the spring to nothing.
  assert.equal(hostExitDist({ x: 0, y: 0, closed: true, pts: [[0, 0], [1, 0], [1, 1]] }, 0, 0, 1, 0)
    .valueOf() >= 0, true);
  assert.equal(hostExitDist({ x: 0, y: 0, closed: true }, 0, 0, 1, 0), 0);
});

test('springHostSurfDist is zero when there is no host', () => {
  // An unanchored end starts where it is.
  assert.equal(springHostSurfDist(null, 0, 0, 1, 0), 0);
  assert.equal(springHostSurfDist(undefined, 0, 0, 1, 0), 0);
});

test('springHostSurfDist is zero for OPEN shapes', () => {
  // An open stroke has no interior, so a spring anchored to one must not be
  // pulled inward.
  const open: AnchorHost = { ...rect, closed: false };
  assert.equal(springHostSurfDist(open, 100, 100, 1, 0), 0);
});

test('springHostSurfDist is zero when the anchor is already outside', () => {
  // Otherwise the spring would be sucked into a body it is not embedded in.
  assert.equal(springHostSurfDist(rect, 300, 300, 1, 0), 0);
});

test('springHostSurfDist measures to the polygon surface from inside', () => {
  // From the centre, the surface is 50px to the right.
  assert.equal(springHostSurfDist(rect, 100, 100, 1, 0), 50);
});

test('springHostSurfDist uses the closed form for circular hosts', () => {
  /* Circle: positive root of |m + u·t| = R, with R = rad + 3 (the ink margin).
   * From the centre, that is simply the radius.
   */
  const circle: AnchorHost = { x: 0, y: 0, rad: 30 };
  assert.equal(springHostSurfDist(circle, 0, 0, 1, 0), 33);
  assert.equal(springHostSurfDist(circle, 0, 0, -1, 0), 33);
  assert.equal(springHostSurfDist(circle, 0, 0, 0, 1), 33);
});

test('springHostSurfDist on a circle shrinks as the anchor nears the edge', () => {
  // The ray has less room left the closer the anchor starts to the rim.
  const circle: AnchorHost = { x: 0, y: 0, rad: 30 };
  const atCentre = springHostSurfDist(circle, 0, 0, 1, 0);
  const nearRim = springHostSurfDist(circle, 25, 0, 1, 0);
  assert.ok(nearRim < atCentre, `${nearRim} should be less than ${atCentre}`);
  assert.ok(nearRim > 0);
});

test('springHostSurfDist on a circle is zero once outside', () => {
  const circle: AnchorHost = { x: 0, y: 0, rad: 30 };
  // R = 33, so a point at distance 40 is already outside.
  assert.equal(springHostSurfDist(circle, 40, 0, 1, 0), 0);
  assert.equal(springHostSurfDist(circle, 33, 0, 1, 0), 0, 'exactly on the rim is outside');
});

test('these functions are pure — no globals touched', () => {
  const text = readFileSync(join(RENDER_DIR, 'anchor-geometry.ts'), 'utf8');
  const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\bglobalThis\b/.test(code), 'no globals');
  assert.ok(!/\bcvx\b/.test(code), 'no canvas — pure geometry only');
});

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDER_DIR = dirname(fileURLToPath(import.meta.url));
