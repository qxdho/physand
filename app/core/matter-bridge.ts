/**
 * Matter bridge — the one place that knows how the app attaches bodies to the
 * Matter.js world.
 *
 * WHY THIS EXISTS (phase B, and the "isolate Matter" goal)
 * --------------------------------------------------------
 * Attaching a mirror body to Matter is a repeated, error-prone dance spread
 * across the legacy file. A body can live in TWO different composites:
 *
 *   - `MW.engine.world`   — the simulated world (things that collide and fall)
 *   - `MW.wLayer`         — the "wall layer", where static boundary bodies live
 *
 * Getting the composite wrong is silent: the body is added, no error is thrown,
 * and it simply never collides (or collides when it should not). The legacy code
 * calls `Matter.Composite.add/remove` against one or the other in 11 places, and
 * several of them are wrapped in try/catch, which turns a mistake into a no-op
 * rather than a failure.
 *
 * Isolating Matter is also one of the refactor's stated goals, so this is the
 * natural place to start: every call site becomes `matterAttach(body)` or
 * `matterDetach(body)` and no longer names a composite at all.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not replace Matter, wrap it in an abstraction framework, or hide its
 * API. Callers that genuinely need engine internals (`engine.timing.timestamp`,
 * gravity, pair lists) still reach them directly — pretending otherwise would
 * add indirection without reducing coupling.
 *
 * WHAT IT DOES
 * ------------
 * Names the two composites and the attach/detach operations, so that:
 *   - the layer choice is stated once instead of inferred at 11 sites;
 *   - detach is idempotent and tolerant (the legacy code guards on `B.mb && MW`
 *     every time, and wraps some in try/catch);
 *   - a future engine swap has a single file to change.
 */
import { matterNamespace, matterWorld } from './legacy.ts';

/** Which composite a mirror body belongs in. */
export type MatterLayer =
  /** The simulated world: dynamic bodies that fall, collide and sleep. */
  | 'world'
  /** The wall layer: static boundary bodies. */
  | 'wall';

/** The subset of a Matter composite this module uses. */
interface Composite {
  add?(composite: unknown, body: unknown): void;
  remove?(composite: unknown, body: unknown, deep?: boolean): void;
}

/** The subset of `MW` this module reads. */
interface MatterWorldHandle {
  engine?: { world?: unknown };
  wLayer?: unknown;
}

/** Resolve the composite for a layer, or undefined when not booted. */
function compositeFor(layer: MatterLayer): unknown {
  const mw = matterWorld() as MatterWorldHandle | undefined;
  if (!mw) return undefined;
  return layer === 'world' ? mw.engine?.world : mw.wLayer;
}

/**
 * Attach a mirror body to the given layer.
 *
 * The default is 'wall' because that is where every converted call site attaches:
 * drawn W bodies, rod mirrors and spring end caps. The root world holds the
 * static frame, which is built once at boot and never goes through here.
 *
 * Returns false when Matter or the world is not available yet, which happens
 * during boot. Callers that need to know can check; the legacy code simply
 * early-returned in that case.
 */
export function matterAttach(mirrorBody: unknown, layer: MatterLayer = 'wall'): boolean {
  if (!mirrorBody) return false;
  const composite = compositeFor(layer);
  if (!composite) return false;
  const Composite = matterNamespace()?.Composite as Composite | undefined;
  if (typeof Composite?.add !== 'function') return false;
  try {
    Composite.add(composite, mirrorBody);
    return true;
  } catch {
    // The legacy code wraps several of these in try/catch: adding an already
    // added body, or one whose parent is set, can throw. A failed attach is not
    // worth taking the page down for.
    return false;
  }
}

/**
 * Detach a mirror body from the given layer.
 *
 * Deliberately tolerant: detaching something that is not attached is a normal
 * occurrence during teardown (the body may never have been added, or may already
 * have been removed), so it must not throw.
 */
export function matterDetach(mirrorBody: unknown, layer: MatterLayer = 'wall'): boolean {
  if (!mirrorBody) return false;
  const composite = compositeFor(layer);
  if (!composite) return false;
  const Composite = matterNamespace()?.Composite as Composite | undefined;
  if (typeof Composite?.remove !== 'function') return false;
  try {
    Composite.remove(composite, mirrorBody);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move a body from the wall layer into the simulated world.
 *
 * Used when a static boundary becomes movable, or when a device is promoted to a
 * simulated body. Kept explicit because "remove from one AND add to the other"
 * is easy to half-do, and a half-done move leaves the body attached to both
 * composites or neither.
 */
export function matterMoveToWorld(mirrorBody: unknown): boolean {
  if (!mirrorBody) return false;
  matterDetach(mirrorBody, 'wall');
  return matterAttach(mirrorBody, 'world');
}

/** True when Matter and a world handle are both present. */
export function matterReady(): boolean {
  return !!(matterWorld() && matterNamespace());
}

/**
 * The engine's world composite.
 *
 * Exposed because some callers legitimately need to enumerate or bulk-remove
 * contents (constraint cleanup, pair scans). Those are engine-level operations;
 * routing them through attach/detach would be worse, not better.
 */
export function matterEngineWorld(): unknown {
  return (matterWorld() as MatterWorldHandle | undefined)?.engine?.world;
}

/** Set the world's gravity (Matter keeps its own copy, separate from GRAV). */
export function setMatterGravity(y: number): void {
  const mw = matterWorld() as (MatterWorldHandle & { engine?: { gravity?: { y: number } } }) | undefined;
  if (mw?.engine?.gravity) mw.engine.gravity.y = y;
}

/* --------------------------------------------------------------------------
 * Installing the bridge object
 * ------------------------------------------------------------------------ */

/**
 * Publish the bridge object the legacy helpers call into.
 *
 * No epilogue is needed here — unlike the panel and recorder facades, this one
 * reaches the app purely through the already-published  /  globals,
 * so it can be installed by a plain assignment from TypeScript. The indirection
 * through a global exists only so the layer names and tolerance rules live in
 * THIS file instead of being restated in src/10-app.js.
 */
export function installMatterBridge(): void {
  (globalThis as unknown as Record<string, unknown>)[MATTER_BRIDGE_KEY] = {
    attachToWall: (mb: unknown) => matterAttach(mb, 'wall'),
    detachFromWall: (mb: unknown) => matterDetach(mb, 'wall'),
    attachToWorld: (mb: unknown) => matterAttach(mb, 'world'),
    detachFromWorld: (mb: unknown) => matterDetach(mb, 'world'),
  } satisfies MatterBridgeHandle;
}

export const MATTER_BRIDGE_KEY = '__matterBridge';

/** What the legacy helpers call into. */
export interface MatterBridgeHandle {
  attachToWall(mirrorBody: unknown): boolean;
  detachFromWall(mirrorBody: unknown): boolean;
  attachToWorld(mirrorBody: unknown): boolean;
  detachFromWorld(mirrorBody: unknown): boolean;
}
