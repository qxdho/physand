/**
 * Body list — the owned collection of simulated bodies.
 *
 * WHY THIS IS THE CENTREPIECE OF PHASE C
 * --------------------------------------
 * The boundary survey found 476 of 555 legacy functions in one connected
 * component, glued by two things: canvas geometry and `bodies`. Geometry was
 * consolidated first because it is written in exactly one place. `bodies` is the
 * harder half, and this module is the result of surveying it rather than
 * guessing at it.
 *
 * WHAT THE SURVEY FOUND (the numbers that make this tractable)
 * -----------------------------------------------------------
 *   creation points    1   — every body comes from `BODY()` (src/10-app.js:222)
 *   removal sites     13   — 8 are `indexOf` then splice; the other 5 sit inside
 *                            backwards-counting loops, so all 13 are identity-
 *                            or reverse-based. None uses a stale forward index.
 *   reassignments      0   — verified: the only match for `bodies = [` is the
 *                            `var` declaration itself (a second match is inside
 *                            a comment). The array identity is stable.
 *   mutate-while-iterating: 4 functions, each checked individually
 *
 * That asymmetry — one door in, thirteen doors out, all by identity — is why an
 * owned collection is a real improvement rather than a rename. With one creation
 * point there is a single place to attach invariants, and there is no second
 * path that could bypass them.
 *
 * THE MUTATE-WHILE-ITERATING FINDING, RECORDED BECAUSE IT IS SUBTLE
 * ----------------------------------------------------------------
 * Four functions both loop over `bodies` and modify it:
 *
 *   clearAll, bossKillKept   iterate BACKWARDS while splicing — safe
 *   gdDown                   the mutating loop is separate from the scanning loop
 *   trailClearAll            forward loop, but mutation happens in a callee
 *
 * So the current code is correct. That is worth pinning rather than assuming,
 * because it is exactly the kind of correctness that a later "harmless" reorder
 * destroys silently. `remove()` documents the rule, and the tests cover it.
 *
 * WHY REMOVAL IS BY IDENTITY
 * --------------------------
 * Never by index. A body can be removed from inside a loop or from a collision
 * callback, and an index captured earlier may then refer to a different body —
 * the classic "wrong object deleted" bug. The legacy code already re-checks
 * `indexOf` at every site; this makes that the only available operation.
 */

/** A body, as the legacy code models it. Intentionally loose during migration. */
export interface LegacyBody {
  x: number;
  y: number;
  kind?: string | null;
  dead?: boolean;
  /** Matter mirror, created lazily by the physics step. */
  mb?: unknown;
  [key: string]: unknown;
}

/** Why a body was removed. Used for logging and tests, not for behaviour. */
export type RemovalReason =
  /** The user deleted it. */
  | 'user'
  /** Consumed by a black hole. */
  | 'consumed'
  /** Fragmented by shatter/explosion. */
  | 'shattered'
  /** Bulk teardown (clear-all, boss cleanup, trail reset). */
  | 'teardown';

/** Observer invoked after a body leaves the list. */
export type RemovalListener = (body: LegacyBody, reason: RemovalReason) => void;

/**
 * An ordered, identity-addressed body collection.
 *
 * Deliberately array-like (`length`, `[i]`, iterable) so the ~372 existing read
 * sites keep working untouched. The value added is not a new access style; it is
 * that ADD and REMOVE become explicit operations with one implementation each,
 * instead of one `push` and thirteen hand-written `indexOf`/`splice` pairs.
 */
export class BodyList implements Iterable<LegacyBody> {
  private readonly items: LegacyBody[] = [];
  private readonly listeners: RemovalListener[] = [];

  /** Number of bodies. */
  get length(): number {
    return this.items.length;
  }

  /** Indexed read, for the many loops written as `bodies[i]`. */
  at(i: number): LegacyBody | undefined {
    return this.items[i];
  }

  /** Alias so `bodies[i]` style code keeps working through a proxy-like access. */
  get(index: number): LegacyBody | undefined {
    return this.items[index];
  }

  /** The underlying array, for read-only interop with array methods. */
  snapshot(): readonly LegacyBody[] {
    return this.items;
  }

  [Symbol.iterator](): Iterator<LegacyBody> {
    return this.items[Symbol.iterator]();
  }

  /**
   * Add a body.
   *
   * The single creation path. Returns the body so callers can keep the
   * `const b = bodies.add(makeBody())` shape.
   */
  add(body: LegacyBody): LegacyBody {
    this.items.push(body);
    return body;
  }

  /**
   * Position of a body by identity, or -1.
   *
   * Identity, never structural equality: two bodies can legitimately have
   * identical fields (a spawned pair), and comparing by value would remove the
   * wrong one.
   */
  indexOf(body: unknown): number {
    return this.items.indexOf(body as LegacyBody);
  }

  /** True when the body is in the list. */
  has(body: unknown): boolean {
    return this.items.indexOf(body as LegacyBody) >= 0;
  }

  /**
   * Remove a body by identity.
   *
   * Returns false when it is not present, which is a NORMAL case: teardown paths
   * run more than once, and a body may already have been consumed. Silent
   * tolerance here is deliberate — throwing on a double-remove would take down
   * the page during a delete.
   */
  remove(body: unknown, reason: RemovalReason = 'user'): boolean {
    const i = this.items.indexOf(body as LegacyBody);
    if (i < 0) return false;
    this.items.splice(i, 1);
    const b = body as LegacyBody;
    for (const fn of this.listeners) {
      try {
        fn(b, reason);
      } catch {
        // A listener must never prevent a removal from completing.
      }
    }
    return true;
  }

  /**
   * Remove the body at an index.
   *
   * Provided because a few loops walk backwards and already know the index.
   * Prefer `remove()` by identity; this exists so those sites do not have to
   * hand-roll a splice.
   */
  removeAt(index: number, reason: RemovalReason = 'user'): LegacyBody | undefined {
    if (index < 0 || index >= this.items.length) return undefined;
    const [b] = this.items.splice(index, 1);
    if (b) {
      for (const fn of this.listeners) {
        try {
          fn(b, reason);
        } catch {
          /* as above */
        }
      }
    }
    return b;
  }

  /**
   * Register a listener called after each removal.
   *
   * This is where future invariants belong — for example disposing the Matter
   * mirror, which today every call site has to remember to do by hand. It is not
   * wired to that yet: phase C's standing rule is not to change behaviour while
   * moving code, and a missed disposal would be a behaviour change.
   */
  onRemove(listener: RemovalListener): void {
    this.listeners.push(listener);
  }

  /** Freeze the current order, for tests that need a stable iteration copy. */
  copy(): LegacyBody[] {
    return this.items.slice();
  }
}

/* --------------------------------------------------------------------------
 * Bridging to the legacy array
 * ------------------------------------------------------------------------ */

/**
 * Operations the legacy code needs on the live array.
 *
 * THE CRITICAL CONSTRAINT: the legacy `bodies` array must remain the SAME ARRAY
 * OBJECT. There are roughly 372 read sites written as `bodies[i]`,
 * `bodies.length`, `bodies.indexOf(...)` and so on, plus functions that receive
 * it as a value. Replacing it with a different object would break all of them at
 * once — which is precisely the "rewrite everything and hope" move this refactor
 * exists to avoid.
 *
 * So the bridge does NOT own storage. It performs the same mutations on the same
 * array, and exists so that add/remove have ONE implementation instead of one
 * `push` and thirteen hand-rolled `indexOf`/`splice` pairs.
 *
 * That is a smaller claim than "the list is now owned by a module", and it is the
 * honest one: ownership moves in a later step, once the read sites are narrowed
 * the way the renderers were.
 */
export interface BodyListBridge {
  /** Append a body; returns it, so callers keep `add(makeBody())` shape. */
  add(body: LegacyBody): LegacyBody;
  /** Index by identity, or -1. */
  indexOf(body: unknown): number;
  /** Remove by identity; false when already gone (a normal, tolerated case). */
  remove(body: unknown): boolean;
  /**
   * Remove by index.
   *
   * Offered because five legacy sites sit inside backwards-counting loops and
   * already know the index; they need a splice, not a lookup.
   */
  removeAt(index: number): void;
}

export const BODY_LIST_KEY = '__bodyList';

/**
 * Publish a bridge over the LIVE legacy array.
 *
 * `readArray` is called lazily on every operation rather than captured once,
 * because the array must be resolved after the legacy source has been evaluated.
 * The array identity itself never changes (verified: the only assignment is its
 * `var` declaration), so this is a lookup by name, not a snapshot.
 */
export function installBodyListBridge(readArray: () => LegacyBody[] | undefined): void {
  const bridge: BodyListBridge = {
    add(body) {
      readArray()?.push(body);
      return body;
    },
    indexOf(body) {
      return readArray()?.indexOf(body as LegacyBody) ?? -1;
    },
    remove(body) {
      const arr = readArray();
      if (!arr) return false;
      const i = arr.indexOf(body as LegacyBody);
      if (i < 0) return false;
      arr.splice(i, 1);
      return true;
    },
    removeAt(index) {
      const arr = readArray();
      if (!arr) return;
      if (index < 0 || index >= arr.length) return;
      arr.splice(index, 1);
    },
  };
  (globalThis as unknown as Record<string, unknown>)[BODY_LIST_KEY] = bridge;
}
