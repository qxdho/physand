/**
 * Render surface — the canvas 2D context and the drawing helpers every renderer
 * shares.
 *
 * WHY THIS EXISTS (phase C, "pluggable rendering")
 * -----------------------------------------------
 * The boundary survey found 476 of 555 legacy functions in one connected
 * component, glued largely by canvas geometry and `bodies`. Drilling further
 * turned up a third, more tractable seam: `cvx`, the 2D context, referenced 349
 * times and assigned in exactly ONE place (`cvx = cv.getContext('2d')`).
 *
 * An audit of the draw functions confirms they are genuinely separable:
 *
 *   17 functions named `draw…` / `render…` use `cvx` and NOT ONE of them writes
 *   shared state. Their dependencies are the canvas API, two pure helpers
 *   (`rgba`, `clamp`), and whatever is passed in as arguments. Several are
 *   7–40 lines.
 *
 * That is what makes a `render/` boundary real rather than aspirational: these
 * functions can be given a context instead of closing over one. This module
 * provides that context, plus the two helpers, so a renderer extracted later
 * needs no globals at all.
 *
 * WHY A FACADE RATHER THAN A DIRECT HANDOFF
 * -----------------------------------------
 * All 349 `cvx` reads still live in the legacy file. Handing the context to a
 * module and leaving the old reads in place would produce two ways to draw,
 * which is worse than one. So this follows the phase-B pattern: the context is
 * reachable through a named accessor while the remaining call sites migrate in
 * groups, and the accessor is live because `resize()` reconfigures the transform
 * on the same context object.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not reimplement drawing, wrap the canvas API, or introduce a scene
 * graph. `cvx` remains the same CanvasRenderingContext2D; callers that need a
 * specific API call still call it. The value here is that "how do I get the
 * drawing surface" has one answer, and that pure helpers stop being free
 * variables.
 */

/** The subset of CanvasRenderingContext2D this module relies on being present. */
import { drawContext } from '../core/legacy.ts';

export interface DrawSurface {
  readonly canvas?: unknown;
  [key: string]: unknown;
}

/**
 * The live 2D context.
 *
 * Returns null before the canvas exists or when 2D is unavailable — the legacy
 * boot path already tolerates a null context (`ctx2d` is created inside a
 * try/catch for exactly this reason), so callers must be able to ask without
 * throwing.
 */
export function drawSurface(): DrawSurface | null {
  return (drawContext() as DrawSurface | undefined) ?? null;
}

/** True when a drawing surface is available. */
export function canDraw(): boolean {
  return drawSurface() !== null;
}

/**
 * Build an `rgba(...)` string from a channel triple and an alpha.
 *
 * Moved here from the legacy file because it is pure: it depends on nothing but
 * its arguments, and every renderer needs it. A pure function with no state is
 * the safest possible thing to share.
 */
export function rgba(channel: readonly [number, number, number] | number[], alpha: number): string {
  return `rgba(${channel[0]},${channel[1]},${channel[2]},${alpha})`;
}

/**
 * Clamp a value into a range.
 *
 * Also pure. It lives here rather than in a general utils module because its
 * main consumers are geometric drawing calculations (radius fading, alpha
 * ramps), and keeping it beside `rgba` means an extracted renderer imports one
 * module instead of two.
 */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Run `draw` with the canvas saved and restored around it.
 *
 * Every renderer that changes the transform, alpha or composite mode has to
 * restore it or it leaks into whatever draws next — a classic source of "one
 * shape is suddenly rotated" bugs. Several legacy draw functions do this by hand
 * with mismatched save/restore pairs; this makes the pairing automatic.
 */
export function withSavedContext(draw: (surface: DrawSurface) => void): boolean {
  const surface = drawSurface();
  if (!surface) return false;
  const save = surface.save as (() => void) | undefined;
  const restore = surface.restore as (() => void) | undefined;
  try {
    save?.call(surface);
    draw(surface);
    return true;
  } finally {
    // In a `finally` so a throwing renderer cannot leave the context dirty.
    restore?.call(surface);
  }
}
