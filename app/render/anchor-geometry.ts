/**
 * Anchor geometry — where a spring's end should stop, given the body it is
 * attached to.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * These three functions are PURE GEOMETRY: no canvas, no shared state, no
 * globals. They were sitting among the drawing code only because the spring
 * renderer was their first caller.
 *
 * Moving them is what unblocks extracting `drawSpring`, which could not move
 * while it called a function that lived in the legacy file. Splitting pure
 * geometry from rendering is worth doing on its own terms too: this code decides
 * where a spring visually terminates on the surface of a rotated polygon or a
 * circle, and that is exactly the kind of thing worth unit-testing directly
 * rather than through a canvas.
 *
 * WHAT THE LOGIC DOES
 * -------------------
 * A spring anchored to a body should end at that body's SURFACE, not its centre.
 * So: shoot a ray from the anchor point along the spring's axis and find how far
 * it travels to leave the host.
 *
 *   circle  — closed-form positive root of |m + u·t| = R
 *   polygon — point-in-ink test first, then a ray/edge intersection sweep
 *
 * The point-in-ink test matters: an anchor that is already OUTSIDE the host must
 * contribute zero inset, otherwise the spring would be pulled inside a body it
 * is not actually embedded in.
 */

/** A point in the host's local (unrotated) ink space. */
export type InkPoint = readonly [number, number];

/** The host shape, as the legacy body model presents it. */
export interface AnchorHost {
  x: number;
  y: number;
  /** Rotation in radians. */
  th?: number;
  /** Present on circular hosts; radius in pixels. */
  rad?: number;
  /** True for closed shapes. Open strokes and arcs have no "inside". */
  closed?: boolean;
  /** Local-space outline points. */
  pts?: readonly InkPoint[];
}

/**
 * True when (px, py) is inside the host's outline.
 *
 * Standard even-odd crossing test, evaluated in world space by rotating each
 * local point by the host's angle.
 */
export function hostInsideInk(H: AnchorHost, px: number, py: number): boolean {
  const p = H.pts;
  if (!p || p.length < 3) return false;
  const c = Math.cos(H.th || 0), s = Math.sin(H.th || 0);
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const ai = p[i]!, aj = p[j]!;
    const ax = H.x + ai[0] * c - ai[1] * s, ay = H.y + ai[0] * s + ai[1] * c;
    const bx = H.x + aj[0] * c - aj[1] * s, by = H.y + aj[0] * s + aj[1] * c;
    if ((ay > py) !== (by > py) && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Smallest positive distance from (px, py) along (ux, uy) to leave the closed
 * outline.
 *
 * Returns 0 when the ray never leaves (degenerate input), which the caller
 * treats as "no inset" — safer than returning a huge value that would collapse
 * the spring.
 */
export function hostExitDist(H: AnchorHost, px: number, py: number, ux: number, uy: number): number {
  const p = H.pts;
  if (!p || p.length < 3) return 0;
  const c = Math.cos(H.th || 0), s = Math.sin(H.th || 0);
  let best = 1e9;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const ai = p[i]!, aj = p[j]!;
    const ax = H.x + ai[0] * c - ai[1] * s, ay = H.y + ai[0] * s + ai[1] * c;
    const bx = H.x + aj[0] * c - aj[1] * s, by = H.y + aj[0] * s + aj[1] * c;
    const ex = bx - ax, ey = by - ay, den = ux * ey - uy * ex;
    if (Math.abs(den) < 1e-9) continue; // ray parallel to this edge
    const t = ((ax - px) * ey - (ay - py) * ex) / den; // along the ray
    const v = ((ax - px) * uy - (ay - py) * ux) / den; // position along the edge
    if (t > 0.01 && v >= 0 && v <= 1 && t < best) best = t;
  }
  return best < 1e9 ? best : 0;
}

/**
 * How far the anchor point must travel along (ux, uy) to reach the host's
 * surface.
 *
 * Zero when the host is missing, open, or the anchor is already outside it —
 * all three mean "the spring should start where it is".
 */
export function springHostSurfDist(
  H: AnchorHost | null | undefined,
  px: number,
  py: number,
  ux: number,
  uy: number,
): number {
  if (!H) return 0;
  const mx = px - H.x, my = py - H.y, m2 = mx * mx + my * my;
  if (H.rad) {
    // Circle: positive root of |m + u·t| = R
    const R = H.rad + 3;
    if (m2 >= R * R) return 0; // anchor already outside
    const a = mx * ux + my * uy, disc = a * a - m2 + R * R;
    return disc > 0 ? Math.max(0, -a + Math.sqrt(disc)) : 0;
  }
  if (!H.closed) return 0; // open stroke / arc: no inside
  if (!hostInsideInk(H, px, py)) return 0; // outside the closed shape
  return hostExitDist(H, px, py, ux, uy);
}
