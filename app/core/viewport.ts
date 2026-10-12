/**
 * Viewport — canvas geometry, the shared context that currently blocks module
 * separation.
 *
 * WHY THIS EXISTS (phase C prerequisite)
 * --------------------------------------
 * A call-graph analysis of the legacy file found 476 of 555 top-level functions
 * in ONE connected component: there is no clean seam to cut modules along. That
 * is the actual reason phase C cannot proceed by simply "moving functions into
 * folders".
 *
 * Drilling into what glues that component together found two variables:
 *
 *   W        413 references, read by 110 different functions
 *   bodies   372 references, read by 104
 *
 * `bodies` is a phase-C job of its own (it is genuinely shared mutable state with
 * a lifecycle). `W` is different: it is canvas geometry, written in exactly ONE
 * place (`resize()`) and read everywhere. That asymmetry is what makes it safe
 * to consolidate FIRST and cheaply.
 *
 * Once geometry is read through a named surface instead of a free variable, a
 * function's dependency on "where things are on screen" becomes explicit, and
 * groups of functions that only need geometry (rendering, layout, hit-testing)
 * can be considered for extraction on evidence rather than by guesswork.
 *
 * WHY THIS IS NOT JUST A RENAME
 * -----------------------------
 * Ported code computes positions from `W`/`H`/`groundY` in hundreds of places
 * with subtly different intent:
 *
 *   - `W` alone  = width for centring
 *   - `W/2`      = horizontal centre
 *   - `groundY`  = the floor line, also used as a bounce/clamp bound
 *
 * Naming the common derivations (centre, floor, bounds) means a future renderer
 * or physics module can ask "where is the floor" without knowing that the answer
 * is a bare global computed at resize time. The raw values remain available for
 * the arithmetic that genuinely needs them.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not move `W`/`H`/`groundY` out of the legacy file yet. The same
 * conservative technique as the phase-B facades applies: the values are read
 * live through accessors, so the hundreds of existing uses keep working while
 * the dependency becomes nameable. Ownership moves once the consumers are
 * narrow enough to migrate in groups.
 */

import { constant } from './legacy.ts';

/** The canvas geometry the whole app derives positions from. */
export interface Viewport {
  /** Canvas width in CSS pixels. */
  readonly width: number;
  /** Canvas height in CSS pixels. */
  readonly height: number;
  /** Horizontal centre. */
  readonly centreX: number;
  /** Vertical centre. */
  readonly centreY: number;
  /**
   * The floor line.
   *
   * Read as a bounce/clamp bound as well as a drawing position, which is why it
   * is part of the viewport rather than a rendering detail.
   */
  readonly groundY: number;
  /** Pixels per metre — the scale from simulation units to screen units. */
  readonly pixelsPerMetre: number;
  /** Inward inset of the boundary frame. */
  readonly boundaryInset: number;
}

/**
 * Read the current geometry.
 *
 * A function rather than a constant object on purpose: every field except the
 * insets changes on resize, so a frozen snapshot would silently go stale — the
 * same trap already documented for the module bridge and the recorder facade.
 */
export function viewport(): Viewport {
  const width = constant('W', 0);
  const height = constant('H', 0);
  return {
    width,
    height,
    centreX: width / 2,
    centreY: height / 2,
    groundY: constant('groundY', 0),
    pixelsPerMetre: constant('PX_PER_M', 0),
    boundaryInset: constant('BND_INK', 0) + constant('CEL_INSET', 0),
  };
}

/**
 * The geometry a renderer needs, as one object.
 *
 * Grouping it means an extracted rendering module can take a single parameter
 * instead of closing over five globals.
 */
export function renderContext(): {
  width: number;
  height: number;
  cx: number;
  cy: number;
  groundY: number;
  pxPerM: number;
} {
  const v = viewport();
  return {
    width: v.width,
    height: v.height,
    cx: v.centreX,
    cy: v.centreY,
    groundY: v.groundY,
    pxPerM: v.pixelsPerMetre,
  };
}

/** Where the boundary frame's inner edge sits on the left, in screen x. */
export function boundLeft(): number {
  return viewport().boundaryInset;
}

/** Where the boundary frame's inner edge sits on the right, in screen x. */
export function boundRight(): number {
  const v = viewport();
  return v.width - v.boundaryInset;
}

/**
 * True when a point is inside the visible canvas.
 *
 * Named because hit-testing and spawn-validation both ask this and currently
 * spell the comparison out each time.
 */
export function inViewport(x: number, y: number): boolean {
  const v = viewport();
  return x >= 0 && y >= 0 && x <= v.width && y <= v.height;
}

/* --------------------------------------------------------------------------
 * Installing the facade object
 * ------------------------------------------------------------------------ */

/** What the legacy helpers call into. */
export interface ViewportFacadeHandle {
  width(): number;
  height(): number;
  centreX(): number;
  centreY(): number;
  groundY(): number;
  pixelsPerMetre(): number;
  boundaryInset(): number;
  renderContext(): ReturnType<typeof renderContext>;
}

export const VIEWPORT_FACADE_KEY = '__viewport';

/**
 * Publish the facade.
 *
 * Same shape as the phase-B bridges: the legacy code reaches it through a global
 * so the dozens of geometry reads can migrate in groups rather than all at once.
 * Every accessor is a function, not a value, because `resize()` rewrites the
 * underlying globals.
 */
export function installViewportFacade(): void {
  (globalThis as unknown as Record<string, unknown>)[VIEWPORT_FACADE_KEY] = {
    width: () => viewport().width,
    height: () => viewport().height,
    centreX: () => viewport().centreX,
    centreY: () => viewport().centreY,
    groundY: () => viewport().groundY,
    pixelsPerMetre: () => viewport().pixelsPerMetre,
    boundaryInset: () => viewport().boundaryInset,
    renderContext,
  } satisfies ViewportFacadeHandle;
}
