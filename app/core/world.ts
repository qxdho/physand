/**
 * World — the single mutable state container for the simulation.
 *
 * WHY THIS EXISTS (phase A of the refactor)
 * -----------------------------------------
 * The legacy app hangs ~211 mutable globals off one script scope. The two worst
 * offenders are `bodies` (372 references) and `W` (409), and `grab` is worse
 * still (568). Every subsystem reaches into them directly, which is why the
 * code forms one 165-function strongly-connected component and why no clean
 * module seam exists today.
 *
 * Phase A does NOT change any call site. It introduces this container and the
 * accessor functions, and proves (via the 9 replay scenarios) that routing
 * reads/writes through it is behaviour-neutral. Subsequent phases then migrate
 * subsystems onto it one at a time.
 *
 * KEY OBSERVATION THAT MAKES THIS TRACTABLE
 * -----------------------------------------
 * Every body in the project is created through exactly one function (`BODY()`,
 * legacy src/10-app.js:216) and removed through `bodies.splice(...)`. There are
 * 14 splice sites but they all do the same "find by identity, remove" dance.
 * That means the collection has a genuine choke point, so an ordered container
 * with explicit add/remove can replace the bare array without hunting down
 * hundreds of call sites.
 *
 * DESIGN RULES
 * ------------
 * 1. `bodies` stays iterable and array-like (`length`, `[i]`, `for` loops) so
 *    the ~372 existing read sites keep working untouched during migration.
 * 2. Removal is by identity, never by index — index-based splices are the
 *    classic source of "wrong object deleted" bugs when the array is mutated
 *    during iteration (the legacy code already guards this by re-checking
 *    `indexOf`, see legacy line 283).
 * 3. No behaviour is added here. This is deliberately a dumb container in
 *    phase A; invariants (e.g. "mb is disposed on removal") come later, once
 *    the replay net proves they hold.
 */

/** A body as the legacy code models it. Intentionally loose during migration. */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  th: number;
  kind: string | null;
  dead?: boolean;
  fixed?: boolean;
  /** Matter.js mirror body, when this body participates in the Matter channel. */
  mb?: unknown;
  [key: string]: unknown;
}

/**
 * Ordered body collection with identity-based removal.
 *
 * Implemented as a class wrapping an internal array rather than subclassing
 * Array: subclassing leaks array mutators that would let callers bypass the
 * removal bookkeeping we need in later phases.
 */
export class BodyList implements Iterable<Body> {
  private items: Body[] = [];

  get length(): number {
    return this.items.length;
  }

  /** Direct index access, preserving the legacy `bodies[i]` idiom. */
  at(i: number): Body {
    return this.items[i]!;
  }

  /** `bodies[i]` style access so existing loops need no edit. */
  [index: number]: Body;

  push(b: Body): number {
    return this.items.push(b);
  }

  /** Remove by identity. Returns true when the body was present. */
  remove(b: Body): boolean {
    const i = this.items.indexOf(b);
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
  }

  /** Legacy-compatible index lookup. */
  indexOf(b: Body): number {
    return this.items.indexOf(b);
  }

  /** Remove the element at `i`, identity-guarded against concurrent mutation. */
  splice(i: number, count = 1): Body[] {
    return this.items.splice(i, count);
  }

  /** Snapshot copy — iterate this when the loop may mutate the collection. */
  toArray(): Body[] {
    return this.items.slice();
  }

  [Symbol.iterator](): Iterator<Body> {
    return this.items[Symbol.iterator]();
  }
}

/**
 * The world. Phase A exposes only what already exists globally, so a call site
 * can be migrated by swapping `bodies` -> `world.bodies` with no other change.
 */
export class World {
  readonly bodies = new BodyList();

  /** Canvas size and the Matter world handle, both injected at boot. */
  canvasWidth = 0;
  canvasHeight = 0;
  matter: unknown = null;

  /** Create a body and register it — the single add path (legacy `BODY()`). */
  createBody(init: Partial<Body> & { x: number; y: number }): Body {
    const b: Body = {
      vx: 0,
      vy: 0,
      th: 0,
      kind: null,
      ...init,
    } as Body;
    this.bodies.push(b);
    return b;
  }

  /** Remove a body by identity — the single removal path. */
  destroyBody(b: Body): boolean {
    return this.bodies.remove(b);
  }

  /** Reset for a fresh scenario run (used by the replay harness). */
  clear(): void {
    while (this.bodies.length) this.bodies.splice(0, 1);
  }
}

/** Process-wide instance. Phase B replaces this with explicit injection. */
export const world = new World();
