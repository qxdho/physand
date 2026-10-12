/**
 * Device body rendering — ground/wall slabs and conveyor belts.
 *
 * WHY THESE NEEDED MORE WORK THAN THE PREVIOUS BATCH
 * --------------------------------------------------
 * The renderers extracted so far took everything as parameters. These two read
 * 5–8 loose numeric globals plus `lastDt` (the frame integration step). Tracing
 * those constants showed they are not renderer details at all — they are the
 * DEVICE SPEC, shared with the device factories and the parameter table's
 * defaults. `device-spec.ts` now names them, so these functions can take a spec
 * plus a frame delta instead of reaching for globals.
 *
 * TWO DOCUMENTED REGRESSIONS ARE PRESERVED HERE
 * ---------------------------------------------
 * Both were reported by users and both are the kind of thing a "tidy-up while
 * moving" would destroy, so they are called out rather than silently carried:
 *
 * R101④ — the belt had a stray horizontal line down its middle. Cause: canvas
 *   auto-connects the end of one subpath to the start of the next, so two `arc`
 *   calls in the SAME path produced a chord across the belt at y=0. The fix is
 *   two separate beginPath/stroke pairs. The legacy comment notes this is
 *   invisible to JS-level hooks (no `lineTo` is ever emitted), so the only
 *   reliable check is structural: the two circles must not share a subpath.
 *
 * R100① / R103-5 — a connected rod end must be drawn as a hinge pin (dot plus
 *   ring), not a bare filled circle. That one lives in `field.ts`.
 *
 * The drawing is unchanged; only the inputs differ.
 */

import type { DrawSurface } from './surface.ts';
import type { DeviceSpec } from './device-spec.ts';

/** Canvas calls these renderers need. */
interface BodySurface extends DrawSurface {
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, s: number, e: number, ccw?: boolean): void;
  stroke(): void;
  fill(): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(rad: number): void;
}

/** What the ground renderer needs from a ground body. */
export interface GroundLike {
  /** Present on ground/wall bodies; the renderer bails without it. */
  gnd?: unknown;
  x: number;
  y: number;
  th?: number;
  hw?: number;
  hh?: number;
}

/** What the belt renderer needs from a belt body. */
export interface BeltLike {
  belt?: unknown;
  x: number;
  y: number;
  th?: number;
  hw?: number;
  hh?: number;
  /** Belt surface speed; also drives the chevron animation phase. */
  conv?: number;
  /** Phase accumulator, mutated across frames to animate the chevrons. */
  _bph?: number;
}

/**
 * Draw a ground/wall slab.
 *
 * One device, not two: a rotated ground reads as a wall, which is how the user
 * described it. Appearance is deliberate — the top edge is a solid line (the
 * bearing surface) and the hatch marks below are the engineering-drawing symbol
 * for ground. Both sit INSIDE the rectangle the collider is built from, so what
 * you see is what can stop you.
 */
export function drawGroundBody(
  surface: DrawSurface | null,
  B: GroundLike,
  spec: DeviceSpec,
  boundaryInk: number,
  hov: boolean,
): boolean {
  if (!surface) return false;
  if (!B || !B.gnd) return false; // same guard as the legacy implementation
  const cvx = surface as BodySurface;

  const hw = B.hw || spec.spawnLen / 2, hh = B.hh || spec.thickness / 2;
  const ink = hov ? 'rgba(28,58,92,1)' : 'rgba(38,34,28,1)';
  cvx.save();
  cvx.translate(B.x, B.y);
  cvx.rotate(B.th || 0);

  // Body outline. R111: at rest the rectangle is NOT filled — only the top
  // bearing line and the hatch marks are inked, because the user reported a
  // "shadow overlay" under the hatching. Hover keeps the pale blue hint, which
  // matches the selection feedback on belts and other devices.
  cvx.beginPath(); cvx.rect(-hw, -hh, hw * 2, hh * 2);
  if (hov) {
    cvx.fillStyle = 'rgba(96,182,255,0.16)';
    cvx.fill();
  }

  // (1) Bearing surface: a single solid line along the top edge — the user's
  //     "one side is a line".
  cvx.beginPath();
  cvx.moveTo(-hw, -hh); cvx.lineTo(hw, -hh);
  cvx.lineWidth = boundaryInk * 2.2;
  cvx.strokeStyle = ink;
  cvx.lineCap = 'round';
  cvx.stroke();

  // (2) Hatch marks slanting down from the bearing surface (the user's "the
  //     other side is rows of slashes"), all inside the rectangle so that what
  //     you see is what can stop you.
  const y0 = -hh + boundaryInk * 1.7, y1 = hh - boundaryInk * 0.7, drop = y1 - y0;
  cvx.beginPath();
  for (let x = -hw + 2; x <= hw - 2; x += spec.hatchStep) {
    // The slant is clamped at the right edge so no stroke leaves the body.
    let xa = x + drop * 0.75;
    if (xa > hw - 1) xa = hw - 1;
    cvx.moveTo(x, y0);
    cvx.lineTo(xa, y1);
  }
  cvx.lineWidth = boundaryInk * 0.85;
  cvx.strokeStyle = ink;
  cvx.stroke();
  cvx.restore();
  return true;
}

/**
 * Draw a conveyor belt: a stadium-shaped band with two rollers and animated
 * chevrons showing direction.
 *
 * `lastDt` is passed in because the chevron phase advances with it. Passing it
 * rather than reading the global is what lets this function be tested.
 */
export function drawBeltBody(
  surface: DrawSurface | null,
  B: BeltLike,
  spec: DeviceSpec,
  boundaryInk: number,
  lastDt: number,
  hov: boolean,
): boolean {
  if (!surface) return false;
  if (!B || !B.belt) return false;
  const cvx = surface as BodySurface;

  const hw = B.hw || spec.spawnLen / 2, hh = B.hh || spec.thickness / 2;
  B._bph = ((B._bph || 0) + (B.conv || 0) * lastDt) % spec.hatchStep;
  let ph = B._bph;
  if (ph < 0) ph += spec.hatchStep;
  const r = hh, ex = Math.max(1, hw - r); // roller radius / centre offset (outer edge = +/-hw)
  const ink = hov ? 'rgba(28,58,92,1)' : 'rgba(38,34,28,1)';
  const fwd = (B.conv || 0) > 0;

  cvx.save();
  cvx.translate(B.x, B.y);
  cvx.rotate(B.th || 0);
  cvx.lineJoin = 'round';
  cvx.lineCap = 'round';

  // (1) The band: two tangent lines plus semicircular caps (stadium shape).
  //     The arc start points meet the lineTo endpoints exactly, so no chord appears.
  cvx.beginPath();
  cvx.moveTo(-ex, -hh); cvx.lineTo(ex, -hh);
  cvx.arc(ex, 0, r, -Math.PI / 2, Math.PI / 2, false);
  cvx.lineTo(-ex, hh);
  cvx.arc(-ex, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  cvx.closePath();
  cvx.fillStyle = hov ? 'rgba(96,182,255,0.16)' : 'rgba(38,34,28,0.10)';
  cvx.fill();
  cvx.lineWidth = boundaryInk * 1.55;
  cvx.strokeStyle = ink;
  cvx.stroke();

  /* (2) The two rollers, as full circles.
   *
   * R101④: these MUST be in separate subpaths. Canvas connects the end of the
   * previous subpath to the start of the next, so putting both arcs in one path
   * draws a chord from (-ex+r, 0) to (ex-r, 0) — which is exactly the stray
   * horizontal line down the middle of the belt that the user reported.
   *
   * That comment also notes the chord cannot be caught by a JS-level hook,
   * because no `lineTo` is ever emitted for it. So the test asserts the
   * STRUCTURE (two separate beginPath/stroke pairs) rather than the ink. */
  cvx.beginPath();
  cvx.arc(-ex, 0, r, 0, 6.2832);
  cvx.lineWidth = boundaryInk * 1.15;
  cvx.stroke();
  cvx.beginPath();
  cvx.arc(ex, 0, r, 0, 6.2832);
  cvx.lineWidth = boundaryInk * 1.15;
  cvx.stroke();

  // (3) Directional chevrons, drawn only on the flat band between the rollers
  //     so they never overlap the circles. Colour encodes direction.
  cvx.beginPath();
  const d = fwd ? 5 : -5, y0 = -hh + 4, y1 = hh - 4, ym = (y0 + y1) / 2;
  for (let x = -ex + ph; x < ex; x += spec.hatchStep) {
    if (x <= -ex + 2 || x >= ex - 2) continue;
    cvx.moveTo(x - d, y0); cvx.lineTo(x, ym); cvx.lineTo(x - d, y1);
  }
  cvx.strokeStyle = fwd ? 'rgba(62,124,116,0.95)' : 'rgba(178,110,60,0.95)';
  cvx.lineWidth = 2; cvx.stroke();
  cvx.restore();
  return true;
}
