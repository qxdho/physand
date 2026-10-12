/**
 * Field and plank rendering — drawn shapes that depend only on their arguments.
 *
 * WHY THESE
 * ---------
 * The second extraction round measured every remaining renderer for shared
 * globals read as VALUES and external functions CALLED. This group came out with
 * zero globals and only pure helpers:
 *
 *   drawFieldDots(cx, cy, R, bz)   the magnetic-field dot/cross grid
 *   drawRodPlank(B)                a light rod's plank and its hinge pins
 *   boxExtentAlong(ux, uy, er)     which edge of an E-box a direction hits
 *
 * `boxExtentAlong` moved too because it is pure (arithmetic over its three
 * arguments) and `drawFieldE` in the legacy file calls it. Leaving it behind
 * would mean the extracted renderer and its geometry helper live in different
 * modules for no reason.
 *
 * WHY IT MATTERS BEYOND TIDINESS
 * ------------------------------
 * `drawRodPlank` carries the fix for a reported bug (R105-3: "the hinge appeared
 * at the wrong end of the rod"). Its correctness depends on indexing the rod's
 * ends by their semantic index rather than by the slot-flavoured names `x1`/`x2`
 * — a distinction that is easy to undo by accident. Bringing the code somewhere
 * it can be unit-tested is the main reason to move it, and the test file asserts
 * exactly that mapping.
 */

import type { DrawSurface } from './surface.ts';

/** Canvas calls these renderers need. */
interface FieldSurface extends DrawSurface {
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  stroke(): void;
  fill(): void;
}

/** What `drawRodPlank` needs from a rod. */
export interface RodLike {
  x: number;
  y: number;
  th?: number;
  len?: number;
  /** Per-end anchor flags; only connected ends get a hinge pin. */
  anc?: (unknown | null)[];
}

/** The four edge extents of a box, as used by `boxExtentAlong`. */
export interface BoxExtents {
  l: number;
  r: number;
  t: number;
  b: number;
}

/**
 * Draw the magnetic field as a grid of dots, or crosses when the field points
 * into the page.
 *
 * `bz` follows the physics convention: `bz > 0` is +z, out of the screen, so a
 * NEGATIVE value means the field faces away and must be drawn as ⊗. Before this
 * distinction existed the sign had no visual effect at all, which is why a user
 * reported "changing the field to negative shows no change".
 */
export function drawFieldDots(
  surface: DrawSurface | null,
  cx: number,
  cy: number,
  R: number,
  bz: number,
): boolean {
  if (!surface) return false;
  const cvx = surface as FieldSurface;

  const into = bz != null && bz < 0; /* field faces away => cross */
  const col = 'rgba(38,34,28,0.16)', colS = 'rgba(38,34,28,0.28)';
  cvx.fillStyle = col; cvx.strokeStyle = colS; cvx.lineWidth = 1.3;
  const sp = 26;
  for (let gx = -R; gx <= R; gx += sp) {
    for (let gy = -R; gy <= R; gy += sp) {
      if (gx * gx + gy * gy <= R * R) {
        const px = cx + gx, py = cy + gy;
        if (!into) {
          cvx.beginPath();
          cvx.arc(px, py, 1.7, 0, 6.2832);
          cvx.fill();
        } else {
          /* A user reported "why a circle when the field points away? it should
           * just be a cross" — the standard ⊗ has no surrounding circle, so the
           * ring was removed. */
          const k = 4.6;
          cvx.lineWidth = 1.6;
          cvx.beginPath();
          cvx.moveTo(px - k, py - k); cvx.lineTo(px + k, py + k);
          cvx.moveTo(px + k, py - k); cvx.lineTo(px - k, py + k);
          cvx.stroke();
          cvx.lineWidth = 1.3;
        }
      }
    }
  }
  cvx.strokeStyle = 'rgba(38,34,28,0.10)';
  cvx.lineWidth = 1;
  cvx.beginPath();
  cvx.arc(cx, cy, R, 0, 6.2832);
  cvx.stroke();
  return true;
}

/**
 * Draw a light rod: the plank line, plus a hinge pin at each CONNECTED end.
 *
 * The pin is drawn as a filled dot with an outer ring — identical to
 * `drawHinge`'s pin — because a connected rod end semantically IS a hinge (the
 * rod pivots about it, double-clicking releases it). Drawing a bare filled
 * circle there prompted a user to ask what the black dot was.
 *
 * INDEXING IS LOAD-BEARING. `x1`/`x2` below are slot names, and `x1` is defined
 * as the `-u` side, which is index 1 (see `rodEndWorld`: `s = i ? -1 : 1`). An
 * earlier version reused those names to place the pin and consequently drew it
 * at the WRONG END. The code therefore computes both ends explicitly and selects
 * by index. Measured before the fix: 39 ink units at the anchored end vs 193 at
 * the free end (ratio 0.20) — the marker was inverted.
 */
export function drawRodPlank(surface: DrawSurface | null, B: RodLike): boolean {
  if (!surface) return false;
  const cvx = surface as FieldSurface;

  const tht = B.th || 0, cth = Math.cos(tht), sth = Math.sin(tht), hl = (B.len || 170) / 2;
  const x1 = B.x - cth * hl, y1 = B.y - sth * hl, x2 = B.x + cth * hl, y2 = B.y + sth * hl;
  cvx.strokeStyle = 'rgba(38,34,28,0.85)';
  cvx.lineWidth = 3;
  cvx.lineCap = 'round';
  cvx.beginPath(); cvx.moveTo(x1, y1); cvx.lineTo(x2, y2); cvx.stroke();

  if (B.anc) {
    cvx.fillStyle = 'rgba(38,34,28,0.85)';
    cvx.strokeStyle = 'rgba(38,34,28,0.85)';
    for (let a = 0; a < 2; a++) {
      if (!B.anc[a]) continue;
      /* Select by INDEX: index 0 is the +u side, index 1 the -u side. */
      const ex0 = B.x + cth * hl, ey0 = B.y + sth * hl;
      const ex1 = B.x - cth * hl, ey1 = B.y - sth * hl;
      const ax = a ? ex1 : ex0, ay = a ? ey1 : ey0;
      cvx.beginPath(); cvx.arc(ax, ay, 4.6, 0, 6.2832); cvx.fill();
      cvx.beginPath(); cvx.arc(ax, ay, 7.2, 0, 6.2832); cvx.lineWidth = 1.5; cvx.stroke();
    }
  }
  return true;
}

/**
 * How far a box extends from its centre along the unit direction (ux, uy).
 *
 * e.g. u=(1,0) hits the +x edge (er.r); u=(0,-1) hits the top edge (er.t). Used
 * so the arrow spread, the rotate knob and the resize bar all agree with the
 * real per-edge geometry.
 */
export function boxExtentAlong(ux: number, uy: number, er: BoxExtents): number {
  if (Math.abs(ux) >= Math.abs(uy)) return ux >= 0 ? er.r : er.l;
  return uy >= 0 ? er.b : er.t;
}
