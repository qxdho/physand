/**
 * Drag facade — a typed, read-mostly view of the drag state machine.
 *
 * WHY THIS EXISTS (phase B, physics core)
 * ---------------------------------------
 * `grab` is the single most-referenced global in the project: 568 references,
 * and `grab.obj` / `grab.kind` alone account for 318 of them. It is the state
 * machine behind every pointer interaction — dragging a body, a letter, a rod's
 * end, an arc handle, a rotation grip.
 *
 * The physics core reads it constantly, because "is this body being dragged
 * right now" changes how it must be integrated: a dragged body follows the
 * pointer instead of the solver, and several forces must not fight the drag.
 * That coupling is REAL and cannot be wished away — physics genuinely needs to
 * know what the user is holding.
 *
 * What can be improved is the SHAPE of the dependency. Today the physics code
 * reaches for `grab.obj` and `grab.kind` directly (46 times across the step
 * functions), which means:
 *
 *   - a typo'd kind string (`'body '`, `'Body'`) compares false forever and the
 *     drag silently stops affecting physics — no error, no crash;
 *   - there is no list of what kinds exist, so adding one means grepping the
 *     whole file to find every place that must care;
 *   - the field names are load-bearing but undocumented at the point of use.
 *
 * This facade names the kinds as a union and exposes the two questions the
 * physics core actually asks: "what is being dragged" and "is it this thing".
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not move `grab` itself. The state machine still lives in the legacy
 * file and is still written by the pointer handlers. Only the READ side that
 * other subsystems depend on is named here. Moving ownership is a phase-C job,
 * and doing it now would mean rewriting every interaction path at once — the
 * exact change this project's history says breaks physics.
 */

import { legacyGrabState } from './legacy.ts';

/**
 * Every drag kind the app uses.
 *
 * Collected by auditing every `grab.kind = '...'` assignment and every
 * comparison in the legacy source. A union rather than plain strings so a typo
 * is a compile error at the call site instead of a silent `false`.
 */
export type DragKind =
  /** Moving a whole body (drawn shape, device, formula body). */
  | 'body'
  /** Moving a free letter glyph. */
  | 'letter'
  /** Dragging one end of a light rod to change its length. */
  | 'rodlen'
  /** Spinning something via the rotation grip. */
  | 'rot'
  /** Dragging an arc's endpoint handle. */
  | 'arcedit'
  /** Dragging a conveyor belt's end handle. */
  | 'ek'
  /** Dragging the E-field box edge. */
  | 'eq'
  /** Dragging field-source dots. */
  | 'dots'
  /** Dragging a t (time) glyph. */
  | 't'
  /** Dragging a vt-rod's grip. */
  | 'vt'
  /** Dragging a charge source. */
  | 'q';

/** The grab fields other subsystems read. */
interface RawGrabState {
  kind?: string | null;
  obj?: unknown;
  glx?: number;
  gly?: number;
  svx?: number;
  svy?: number;
}

function raw(): RawGrabState | undefined {
  return legacyGrabState() as RawGrabState | undefined;
}

/** The kind currently being dragged, or null when nothing is held. */
export function dragKind(): DragKind | null {
  const k = raw()?.kind;
  return typeof k === 'string' && k ? (k as DragKind) : null;
}

/**
 * The object currently being dragged, or null.
 *
 * This is the accessor the physics core uses most: `grab.obj === B` is how a
 * step function asks "is THIS the thing the user is holding".
 */
export function dragTarget(): unknown {
  return raw()?.obj ?? null;
}

/** True when a drag is in progress (of any kind). */
export function isDragging(): boolean {
  const g = raw();
  return !!(g && g.kind && g.obj);
}

/** True when the given body is the one being dragged. */
export function isDraggingBody(body: unknown): boolean {
  const g = raw();
  return !!(body && g && g.kind === 'body' && g.obj === body);
}

/** True when the drag is of the given kind AND has a target. */
export function isDraggingKind(kind: DragKind): boolean {
  const g = raw();
  return !!(g && g.kind === kind && g.obj);
}

/**
 * The local grab offset within the dragged body, or null.
 *
 * Physics uses this to keep the grabbed material point under the pointer
 * instead of snapping the centre, which is why a body does not jump when you
 * grab it near an edge.
 */
export function dragLocalOffset(): { x: number; y: number } | null {
  const g = raw();
  if (!g || g.glx == null || g.gly == null) return null;
  return { x: g.glx, y: g.gly };
}

/** The press-time velocity carried by the drag, for release momentum. */
export function dragStartVelocity(): { x: number; y: number } | null {
  const g = raw();
  if (!g || (g.svx == null && g.svy == null)) return null;
  return { x: g.svx ?? 0, y: g.svy ?? 0 };
}

/* --------------------------------------------------------------------------
 * Installing the facade object
 * ------------------------------------------------------------------------ */

/** What the legacy physics helpers call into. */
export interface DragFacadeHandle {
  dragKind(): DragKind | null;
  dragTarget(): unknown;
  isDragging(): boolean;
  isDraggingBody(body: unknown): boolean;
  isDraggingKind(kind: DragKind): boolean;
  dragLocalOffset(): { x: number; y: number } | null;
  dragStartVelocity(): { x: number; y: number } | null;
}

export const DRAG_FACADE_KEY = '__dragFacade';

/**
 * Publish the facade.
 *
 * Like the Matter and formula bridges this works through the published `grab`
 * global, so no epilogue is needed. The indirection exists so the kind union and
 * the narrowing rules live in one file rather than being restated in every step
 * function that has to ask "what is the user holding".
 */
export function installDragFacade(): void {
  (globalThis as unknown as Record<string, unknown>)[DRAG_FACADE_KEY] = {
    dragKind,
    dragTarget,
    isDragging,
    isDraggingBody,
    isDraggingKind,
    dragLocalOffset,
    dragStartVelocity,
  } satisfies DragFacadeHandle;
}
