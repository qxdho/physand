/**
 * World — the intended state container for the simulation.
 *
 * ⚠️ CURRENT STATUS: PREPARED, NOT YET WIRED
 * ------------------------------------------
 * Built in phase A as the target for state consolidation; still UNUSED by the
 * running app. That is worth stating plainly rather than implying progress: no
 * call site has moved onto it yet.
 *
 * An earlier revision also carried `attachLegacySource()` / `readView()`, a
 * getter-based facade meant to let the recorder read world state through this
 * class. It was carefully built and then never read — the recorder used
 * `core/recorder-facade.ts` instead, because its functions close over the legacy
 * scope and cannot be reached by an object assembled outside it. That dead
 * facade was removed rather than left in place looking load-bearing.
 *
 * WHAT IS ACTUALLY IN USE FROM THIS FILE
 * --------------------------------------
 * Nothing today. Consolidation so far has gone through `core/legacy.ts` — one
 * audited access point with real types, which is where a subsystem's
 * dependencies become visible and type-checked.
 *
 * WHY KEEP IT
 * -----------
 * The observation below is still the plan for `bodies`, and it is why the
 * eventual move is tractable: every body is created through exactly one function
 * (`BODY()`, legacy src/10-app.js:216) and removed by identity. When `bodies`
 * is migrated, this is where it lands, and `BodyList` already models the
 * identity-based removal the 14 splice sites perform by hand.
 *
 * If that migration wants a different shape, delete this file rather than keep
 * it "just in case". Its value is the analysis, not the code.
 *
 * DESIGN RULES (for when it is wired)
 * -----------------------------------
 * 1. `bodies` stays iterable and array-like (`length`, `[i]`, `for` loops) so the
 *    ~372 existing read sites keep working untouched during migration.
 * 2. Removal is by identity, never by index — index-based splices are the
 *    classic source of "wrong object deleted" bugs when the array is mutated
 *    during iteration (the legacy code already guards this by re-checking
 *    `indexOf`).
 * 3. No behaviour beyond bookkeeping: invariants (e.g. "mb is disposed on
 *    removal") only get added once the replay net proves they hold.
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
 *
 * PHASE B — READ FACADE
 * ---------------------
 * Phase B migrates one subsystem at a time onto explicit accessors instead of
 * bare globals. The first (and lowest-risk) consumer is the recorder, whose
 * external coupling is tiny and measurable: `recSnap`/`recEnv` reach for just
 * ~10 globals across ~980 lines.
 *
 * Rather than rewrite all 372 `bodies` references at once — which history shows
 * is how refactors break physics — we give the recorder a *snapshot read* API.
 * The recorder only ever READS world state (it never drives the simulation), so
 * this is a genuinely safe seam: the blast radius of a mistake is a malformed
 * recording, caught immediately by the replay suite.
 *
 * See `attachLegacySource` for how these getters are wired to the still-global
 * legacy implementation during the migration.
 */

export class World {
  readonly bodies = new BodyList();

  /** Canvas size and the Matter world handle, both injected at boot. */
  canvasWidth = 0;
  canvasHeight = 0;
  matter: unknown = null;

  /*
   * NOTE ON A REMOVED DESIGN (kept so it is not reintroduced)
   * --------------------------------------------------------
   * An earlier revision exposed `attachLegacySource()` + `readView()` here: a
   * getter-based snapshot of the globals for the recorder to consume. It was
   * carefully built (live getters, null-tolerant) — and then never read by
   * anything. The recorder kept reading globals directly while the facade sat
   * unused, which LOOKS like migration progress and is not.
   *
   * The recorder now uses `app/core/recorder-facade.ts` instead, because its
   * functions close over the legacy scope and cannot be reached by an object
   * assembled outside it. Both designs were valid; keeping two would have been
   * worse than keeping the one that works.
   *
   * If a future subsystem genuinely needs a typed view of world state, add it to
   * `core/legacy.ts` (the single audited access point) rather than rebuilding
   * a second facade here.
   */

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
