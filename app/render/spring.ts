/**
 * Spring rendering — the coil, its end caps and its anchor dots.
 *
 * WHY THIS WAS THE LAST OF THE "CLEAN" TIER
 * -----------------------------------------
 * `drawSpring` read no shared globals, but it called `springHostSurfDist`, which
 * lived in the legacy file. A function cannot move while it calls something that
 * did not move with it — so the geometry helpers went first
 * (`anchor-geometry.ts`), and this followed.
 *
 * TWO RENDERING CONTRACTS ARE PRESERVED HERE
 * ------------------------------------------
 * R132-8b — a body hitting a spring should look like it compresses it. The cap
 *   on the struck end is pulled inward along the axis, which shortens `L`, and
 *   because the coil count is derived from the NATURAL length, the pitch
 *   tightens: the coil is squeezed into a shorter span, exactly like a real
 *   spring. When the body bounces off, `_capCmp` decays and the spring visibly
 *   re-extends.
 *
 *   The legacy comment records why the compression is applied ONLY at render
 *   time and never to the stored geometry: once compression fed back into
 *   `e0`/`e1`, the measurement baseline drifted with the state and the system
 *   became positively feedback-driven (the body was pushed further and further,
 *   or the spring froze). Keeping geometry at natural length and confining
 *   compression to rendering plus force made every feedback loop disappear at
 *   once. So `x0/y0/x1/y1` here are LOCAL to this function.
 *
 * R60 — the coil count comes from the natural length, not the current one. A
 *   real spring has a fixed number of turns: stretching increases the pitch,
 *   compressing decreases it. Deriving the count from the current length gives
 *   "more turns when stretched", which does not read as a spring.
 *
 * COLOUR IS DELIBERATELY MONOCHROME. R58 records the user explicitly asking for
 * no colour change on deformation; the deformation is communicated by pitch
 * instead. Do not "improve" this by tinting stretched versus compressed.
 */

import type { DrawSurface } from './surface.ts';
import { clamp } from './surface.ts';
import { springHostSurfDist, type AnchorHost } from './anchor-geometry.ts';

/** Canvas calls this renderer needs. */
interface SpringSurface extends DrawSurface {
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, s: number, e: number): void;
  stroke(): void;
  fill(): void;
}

/** One end of a spring: the anchor's host body, if any. */
export interface SpringAnchor {
  B?: AnchorHost | null;
}

/** What `drawSpring` needs from a spring body. */
export interface SpringLike {
  e0: { x: number; y: number };
  e1: { x: number; y: number };
  /** Natural length; the coil count derives from this, NOT from current span. */
  len: number;
  /** Index 0/1, or null when that end is free. */
  anc: (SpringAnchor | null)[];
  /** Render-only compression at the struck end, decayed by the simulation. */
  _capCmp?: number;
  /** Which end is compressed: 1 or 0. */
  _capEIdx?: number;
}

/**
 * Draw a spring.
 *
 * Geometry is taken from the body, but the END POSITIONS used for drawing are
 * local copies so that render-time compression never leaks back into the
 * simulation (see R132-8b above).
 */
export function drawSpring(surface: DrawSurface | null, B: SpringLike): boolean {
  if (!surface) return false;
  const cvx = surface as SpringSurface;

  let x0 = B.e0.x, y0 = B.e0.y, x1 = B.e1.x, y1 = B.e1.y;
  let dx = x1 - x0, dy = y1 - y0;
  let L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, px = -uy, py = ux;

  // R132-8b: pull the struck end inward along the axis so the coil tightens.
  if (B._capCmp! > 0) {
    const _ci = B._capEIdx === 1 ? 1 : 0;
    let _cp = B._capCmp!;
    if (_cp > 0 && _cp < L - 8) {
      _cp = _cp > L - 8 ? L - 8 : _cp;
      if (_ci === 1) { x1 = x1 - ux * _cp; y1 = y1 - uy * _cp; }
      else { x0 = x0 + ux * _cp; y0 = y0 + uy * _cp; }
      dx = x1 - x0; dy = y1 - y0;
      L = Math.hypot(dx, dy) || 1; ux = dx / L; uy = dy / L; px = -uy; py = ux;
    }
  }

  // R58: constant ink colour; deformation is shown by pitch, not by tint.
  const col = 'rgba(38,34,28,0.85)';
  // R60: turns from NATURAL length, so stretching widens the pitch.
  const nc = Math.round(clamp(B.len / 16, 6, 20)), amp = 8;

  // Anchored ends stop at the host's surface rather than its centre.
  let r0 = B.anc[0] && B.anc[0]!.B ? springHostSurfDist(B.anc[0]!.B, x0, y0, ux, uy) : 0;
  let r1 = B.anc[1] && B.anc[1]!.B ? springHostSurfDist(B.anc[1]!.B, x1, y1, -ux, -uy) : 0;
  const room = L - 16; // never retreat past 16px of coil
  if (r0 + r1 > room && r0 + r1 > 0) {
    const rt = room / (r0 + r1);
    r0 *= rt; r1 *= rt;
  }
  const c0x = x0 + ux * r0, c0y = y0 + uy * r0;
  const c1x = x1 - ux * r1, c1y = y1 - uy * r1;
  const CL = Math.hypot(c1x - c0x, c1y - c0y) || 1;
  const lead = Math.min(9, CL * 0.12);

  cvx.strokeStyle = col; cvx.lineWidth = 2.4; cvx.lineJoin = 'round'; cvx.lineCap = 'round';
  cvx.beginPath();
  cvx.moveTo(c0x, c0y);
  cvx.lineTo(c0x + ux * lead, c0y + uy * lead);

  const span = Math.max(1, CL - 2 * lead), steps = nc * 2;
  for (let i = 1; i <= steps; i++) {
    const t = lead + (span * i) / steps;
    const sgn = i % 2 === 0 ? 1 : -1;
    cvx.lineTo(c0x + ux * t + px * amp * sgn, c0y + uy * t + py * amp * sgn);
  }
  cvx.lineTo(c1x, c1y);
  cvx.stroke();

  // Anchor dots only on anchored ends; a pinned end has no cap to draw.
  cvx.fillStyle = col;
  for (let a = 0; a < 2; a++) {
    if (!B.anc[a]) continue;
    cvx.beginPath();
    cvx.arc(a ? x1 : x0, a ? y1 : y0, 4.4, 0, 6.2832);
    cvx.fill();
  }
  return true;
}
