/**
 * Device rendering — ropes, hinges, black holes and snap markers.
 *
 * WHY THESE FOUR
 * --------------
 * An audit of every renderer still in the legacy file measured two things per
 * function: which shared globals it reads as VALUES, and which external
 * functions it CALLS. The results sorted the renderers into clear tiers, and
 * these four came out cleanest — zero key globals, zero external calls:
 *
 *   drawRope(B, extraSlack)   reads B.e0, B.e1, B.len, B.nodes, B.anc
 *   drawHinge(B)              reads B.e0, B.e1, B.anc
 *   drawBlackHole(B)          reads B.bh, B.x, B.y
 *   drawSnapMarker(x, y)      reads nothing
 *
 * Every input is a parameter or a field of one. That is exactly the shape a
 * function must have to cross a module boundary, and it is why they are grouped
 * here rather than moved one at a time: they share the same contract (data in,
 * surface in) and the same drawing helpers.
 *
 * WHAT DID NOT CHANGE
 * -------------------
 * The drawing code is preserved character for character, including the
 * deliberately unrounded alpha interpolation (`'rgba(38,34,28,'+(0.30-li*0.045)+')'`),
 * because the acceptance criterion for the extraction is that the canvas output
 * is unchanged. Any "tidy-up" while moving would make that untestable.
 */

import type { DrawSurface } from './surface.ts';

/** Canvas calls these renderers need. */
interface DeviceSurface extends DrawSurface {
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  stroke(): void;
  fill(): void;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradient;
}

/** A point in screen space. */
export interface Point {
  x: number;
  y: number;
}

/** What `drawRope` needs from a rope body. */
export interface RopeLike {
  e0: Point;
  e1: Point;
  len: number;
  /** Chain nodes when the rope is simulated as a flexible chain. */
  nodes?: Point[] | null;
  /** Per-end anchor flags; only anchored ends get an end cap drawn. */
  anc?: (unknown | null)[];
}

/** What `drawHinge` needs. */
export interface HingeLike {
  e0: Point;
  e1: Point;
  anc?: (unknown | null)[];
}

/** What `drawBlackHole` needs — the hole's visual parameters live in `bh`. */
export interface BlackHoleLike {
  x: number;
  y: number;
  bh: { r: number; spin: number };
}

/**
 * Draw a rope.
 *
 * `extraSlack` adds temporary slack, used while the rope is being dragged.
 */
export function drawRope(surface: DrawSurface | null, B: RopeLike, extraSlack: number): boolean {
  if (!surface) return false;
  const cvx = surface as DeviceSurface;

  const x0 = B.e0.x, y0 = B.e0.y, x1 = B.e1.x, y1 = B.e1.y;
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const slack = Math.max(0, B.len - L) + (extraSlack > 0 ? extraSlack : 0);
  const col = 'rgba(38,34,28,0.85)';
  cvx.strokeStyle = col; cvx.lineWidth = 1.7; cvx.lineJoin = 'round'; cvx.lineCap = 'round';
  cvx.beginPath();
  cvx.moveTo(x0, y0);
  if (B.nodes && B.nodes.length) {
    /* Flexible rope drawn as quadratic curves through adjacent midpoints: each
     * node acts as a control point so the curve passes through every segment
     * midpoint. A straight rope stays straight (collinear control points); a
     * slack one becomes a smooth catenary. Straight `lineTo` between nodes reads
     * as "a few broken segments" on a 110px rope with only 4 nodes. */
    const rp: [number, number][] = [[x0, y0]];
    for (let rn = 0; rn < B.nodes.length; rn++) rp.push([B.nodes[rn]!.x, B.nodes[rn]!.y]);
    rp.push([x1, y1]);
    cvx.moveTo(rp[0]![0], rp[0]![1]);
    for (let rs = 1; rs < rp.length - 1; rs++) {
      const rmx = (rp[rs]![0] + rp[rs + 1]![0]) / 2;
      const rmy = (rp[rs]![1] + rp[rs + 1]![1]) / 2;
      cvx.quadraticCurveTo(rp[rs]![0], rp[rs]![1], rmx, rmy);
    }
    cvx.lineTo(x1, y1);
  } else if (slack > 0.5) {
    const sag = Math.min(slack * 0.55, 90); // cap the sag so a long rope is not a deep well
    cvx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag, x1, y1);
  } else {
    cvx.lineTo(x1, y1);
  }
  cvx.stroke();
  cvx.fillStyle = col;
  for (let a = 0; a < 2; a++) {
    if (!B.anc || !B.anc[a]) continue; // only anchored ends get a cap, same rule as springs
    cvx.beginPath();
    cvx.arc(a ? x1 : x0, a ? y1 : y0, 3.6, 0, 6.2832);
    cvx.fill();
  }
  return true;
}

/**
 * Draw a hinge: a pin (filled dot plus outer ring), with thin arms to its
 * anchors while the two ends have not converged.
 *
 * The arm condition is load-bearing and was arrived at through two regressions:
 * arms are drawn when the hinge is NOT doubly anchored. Tightening this to
 * "both anchored" (an earlier attempt) broke the documented render contract,
 * because a stub hinge with `anc = [null, null]` then drew no arms at all.
 */
export function drawHinge(surface: DrawSurface | null, B: HingeLike): boolean {
  if (!surface) return false;
  const cvx = surface as DeviceSurface;

  const x0 = B.e0.x, y0 = B.e0.y, x1 = B.e1.x, y1 = B.e1.y;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const col = 'rgba(38,34,28,0.85)';

  const bothAnc = !!(B.anc && B.anc[0] && B.anc[1]);
  if (!bothAnc && Math.hypot(x1 - x0, y1 - y0) > 1.5) {
    cvx.strokeStyle = col; cvx.lineWidth = 1.4; cvx.lineCap = 'round';
    cvx.beginPath(); cvx.moveTo(x0, y0); cvx.lineTo(cx, cy); cvx.lineTo(x1, y1); cvx.stroke();
  }
  cvx.beginPath(); cvx.arc(cx, cy, 4.6, 0, 6.2832); cvx.fillStyle = col; cvx.fill();
  cvx.beginPath(); cvx.arc(cx, cy, 7.2, 0, 6.2832);
  cvx.strokeStyle = col; cvx.lineWidth = 1.5; cvx.stroke();
  return true;
}

/**
 * Draw a black hole: lensed rings, tangential streaks, an accretion swirl, and
 * the core falloff.
 *
 * Everything is ink-black line art — no colour anywhere on this canvas, which is
 * why the rings use the same dark tone at varying alpha.
 */
export function drawBlackHole(surface: DrawSurface | null, B: BlackHoleLike): boolean {
  if (!surface) return false;
  const cvx = surface as DeviceSurface;

  const bh = B.bh, cx = B.x, cy = B.y;
  const r = Math.max(4, bh.r);

  // 1) gravitational lens: concentric distorted rings around the hole
  const rings = 5;
  for (let li = 0; li < rings; li++) {
    const lr = r * 1.15 + li * 13 + Math.sin(bh.spin * 1.4 + li * 1.9) * 3;
    const wob = 1 + 0.10 * Math.sin(bh.spin * 2.1 + li * 2.4);
    cvx.strokeStyle = 'rgba(38,34,28,' + (0.30 - li * 0.045) + ')';
    cvx.lineWidth = 1.6 - li * 0.18;
    cvx.beginPath();
    // a ring drawn as a wobbly ellipse: space is "stretched" tangentially
    const N = 26;
    for (let n = 0; n <= N; n++) {
      const a = n / N * 6.2832;
      const rr = lr * (wob + (0.05 * Math.sin(3 * a + bh.spin * 1.7)) * li * 0.4);
      const xx = cx + Math.cos(a) * rr;
      const yy = cy + Math.sin(a) * rr * (0.92 + 0.06 * Math.sin(2 * a + bh.spin));
      if (n === 0) cvx.moveTo(xx, yy); else cvx.lineTo(xx, yy);
    }
    cvx.stroke();
  }
  // lens streaks: short arcs tangentially smeared (space warping streaks)
  cvx.strokeStyle = 'rgba(38,34,28,0.22)';
  cvx.lineWidth = 1.2;
  for (let s2 = 0; s2 < 8; s2++) {
    const sa = bh.spin * 0.9 + s2 * 0.7854;
    const sr = r * 1.3 + (s2 % 3) * 10;
    cvx.beginPath();
    cvx.arc(cx, cy, sr, sa, sa + 0.9);
    cvx.stroke();
  }
  // 2) accretion disk: a monochrome swirl of dark streaks just outside the horizon
  for (let ai = 0; ai < 3; ai++) {
    const ar = r + 4 + ai * 4;
    cvx.strokeStyle = 'rgba(38,34,28,' + (0.55 - ai * 0.13) + ')';
    cvx.lineWidth = 3.4 - ai * 0.9;
    cvx.beginPath();
    cvx.arc(cx, cy, ar, bh.spin * 2 + ai * 0.5, bh.spin * 2 + ai * 0.5 + 4.6 - ai * 1.1);
    cvx.stroke();
  }
  // 3) the hole itself: pure black core with a soft dark falloff
  const grd = cvx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.05);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.78, 'rgba(12,10,14,0.96)');
  grd.addColorStop(1, 'rgba(20,18,22,0)');
  cvx.fillStyle = grd;
  cvx.beginPath();
  cvx.arc(cx, cy, r * 1.05, 0, 6.2832);
  cvx.fill();
  // thin photon-ring edge (ink, not colour)
  cvx.strokeStyle = 'rgba(38,34,28,0.75)';
  cvx.lineWidth = 1.4;
  cvx.beginPath();
  cvx.arc(cx, cy, r + 1, 0, 6.2832);
  cvx.stroke();
  return true;
}

/** Draw the small marker shown at a candidate snap position. */
export function drawSnapMarker(surface: DrawSurface | null, x: number, y: number): boolean {
  if (!surface) return false;
  const cvx = surface as DeviceSurface;

  cvx.beginPath(); cvx.arc(x, y, 6, 0, 6.2832);
  cvx.strokeStyle = 'rgba(206,74,44,0.92)'; cvx.lineWidth = 1.6; cvx.stroke();
  cvx.beginPath(); cvx.arc(x, y, 1.9, 0, 6.2832);
  cvx.fillStyle = 'rgba(206,74,44,0.95)'; cvx.fill();
  return true;
}
