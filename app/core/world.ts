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

/** Read-only view of the app state the recorder needs. */
export interface WorldReadView {
  /** Live body collection. */
  readonly bodies: BodyList;
  /** Free (unmerged) letters. */
  readonly freeLetters: readonly unknown[];
  /** Canvas width/height in CSS pixels. */
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /** Matter engine handle, or null before boot. */
  readonly matter: unknown;
  /** Simulation constants, read at snapshot time. */
  readonly gravity: number;
  readonly pixelsPerMetre: number;
  readonly groundY: number;
  readonly physMode: string | null;
  /** Current tool mode, e.g. "pen" or "pen/circle". */
  readonly toolMode: string | null;
  readonly uiMode: string | null;
}

/**
 * Bridge to the legacy globals during the migration.
 *
 * The legacy app is still the implementation; this only gives typed, named
 * access to it. When a subsystem is fully migrated, its entry here is deleted
 * and replaced by a real field on World — that is the signal a seam is closed.
 */
interface LegacySource {
  bodies: BodyList | null;
  freeLetters: readonly unknown[] | null;
  canvasWidth?: number;
  canvasHeight?: number;
  matter: unknown;
  gravity: number;
  pixelsPerMetre: number;
  groundY: number;
  physMode: string | null;
  toolMode: string | null;
  uiMode: string | null;
}

export class World {
  readonly bodies = new BodyList();

  /** Canvas size and the Matter world handle, both injected at boot. */
  canvasWidth = 0;
  canvasHeight = 0;
  matter: unknown = null;

  /**
   * Populated by `attachLegacySource` while the legacy globals are still the
   * real implementation. Removed in phase C.
   */
  private legacy: LegacySource | null = null;

  /**
   * Point the read facade at the legacy globals.
   *
   * Called once from the bridge right after the legacy app is evaluated. Using
   * a getter-based object (rather than copying values) matters: `GRAV` and
   * `bodies` are reassigned/ mutated at runtime, so a snapshot copy would go
   * stale and the recorder would silently capture wrong values.
   */
  attachLegacySource(src: LegacySource): void {
    this.legacy = src;
  }

  /**
   * The recorder's read view.
   *
   * Every field is guarded: the recorder runs in environments where some
   * globals may not exist yet (and `recEnv` is explicitly written to tolerate
   * that — it wraps each field in try/catch and emits null). We preserve that
   * tolerance rather than throwing, because a recording must never be able to
   * crash the app the user is trying to report a bug in.
   */
  readView(): WorldReadView {
    const L = this.legacy;
    const bodies = L?.bodies ?? this.bodies;
    return {
      bodies,
      get freeLetters() {
        return L?.freeLetters ?? [];
      },
      get canvasWidth() {
        return L ? (L.canvasWidth ?? 0) : 0;
      },
      get canvasHeight() {
        return L ? (L.canvasHeight ?? 0) : 0;
      },
      get matter() {
        return L?.matter ?? null;
      },
      get gravity() {
        return L?.gravity ?? 0;
      },
      get pixelsPerMetre() {
        return L?.pixelsPerMetre ?? 0;
      },
      get groundY() {
        return L?.groundY ?? 0;
      },
      get physMode() {
        return L?.physMode ?? null;
      },
      get toolMode() {
        return L?.toolMode ?? null;
      },
      get uiMode() {
        return L?.uiMode ?? null;
      },
    } as WorldReadView;
  }

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
