/**
 * Parameter registry — one declaration per knob.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * In the legacy app, adding one adjustable parameter meant editing FOUR places:
 *
 *   1. `PARAM_DEFS`        — the spec (label, min, max, step, unit, default)
 *   2. `paramDef(B)`       — which bodies expose it (a long if/else chain)
 *   3. `paramV(B, id)`     — how to READ the current value off the body
 *   4. `applyParam(B,...)` — how to WRITE it back
 *
 * Forgetting #3 is a recurring, user-visible bug. The legacy source documents it
 * happening at least three times, each time as "I changed the value but nothing
 * happened":
 *
 *   - `sk` / `slen`  — "默认劲度系数没改变" (R61)
 *   - `rlen`         — "同 sk/slen 的专用字段纪律" (R101⑦)
 *   - `convspeed`    — "同弹簧 B.ks 的陷阱" (R99)
 *   - `waccang`      — the direction row was DEFINED and had a read/write branch
 *                      but was never added to the `paramDef` list, so the panel
 *                      never showed it: "定义了、读写分支也全有，却从来没进过这个清单"
 *
 * The root cause is that the four concerns are separate code paths that must be
 * kept in sync by hand. This registry makes them ONE object, so the only way to
 * add a parameter is to supply its read and write functions together — you
 * cannot forget one, because TypeScript requires them.
 *
 * It also fixes the layout problem: `paramDef()` hard-codes which body kinds see
 * which knobs, which is why a freshly drawn shape only offered 4 sliders and the
 * size control only appeared if you happened to attach an `r` glyph.
 */

/** A body, as loosely modelled during the migration. */
export type AnyBody = Record<string, any>;

/** Which bodies expose a parameter. */
export interface ParamScope {
  /** Body kinds this applies to, e.g. ['W'] or ['S']. Omit = any kind. */
  kinds?: readonly string[];
  /**
   * Extra predicate for cases the kind list cannot express, e.g. "only springs
   * that are hinges" or "only bodies carrying a charge".
   */
  when?: (b: AnyBody) => boolean;
}

/** One adjustable parameter. Values are numeric — the panel is all sliders. */
export interface ParamSpec {
  /** Stable id, e.g. 'wmass'. Also the key in the registry. */
  readonly id: string;
  /** UI label, e.g. '质量 mass'. */
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
  /** Default, shown when the body has no explicit value yet. */
  readonly def: number;
  /**
   * Display-to-internal scale. `siK: PX_PER_M` means the panel shows metres
   * while the engine stores pixels. Omit for a plain 1:1 value.
   */
  readonly siK?: number;
  /** Which bodies show this. */
  readonly scope: ParamScope;
  /**
   * Read the live value off a body. MUST handle "not set yet" by returning the
   * default — that is the branch whose omission caused the R61/R99/R101 bugs.
   */
  readonly read: (b: AnyBody | null) => number;
  /** Write the value back. */
  readonly write: (b: AnyBody, value: number) => void;
  /** Optional: UI grouping for the panel. */
  readonly group?: string;
}

/**
 * The registry.
 *
 * Registration returns the spec, so a param can be defined and referenced in one
 * expression. `get` throws on an unknown id rather than returning undefined,
 * because a silent undefined is exactly how the panel used to show stale
 * defaults.
 */
export class ParamRegistry {
  private readonly specs = new Map<string, ParamSpec>();

  register(spec: ParamSpec): ParamSpec {
    if (this.specs.has(spec.id)) {
      throw new Error(`ParamRegistry: duplicate parameter id "${spec.id}"`);
    }
    if (!(spec.max > spec.min)) {
      throw new Error(
        `ParamRegistry: "${spec.id}" has max (${spec.max}) <= min (${spec.min})`,
      );
    }
    this.specs.set(spec.id, spec);
    return spec;
  }

  get(id: string): ParamSpec {
    const s = this.specs.get(id);
    if (!s) {
      throw new Error(
        `ParamRegistry: unknown parameter "${id}". ` +
          `Known: ${[...this.specs.keys()].sort().join(', ')}`,
      );
    }
    return s;
  }

  has(id: string): boolean {
    return this.specs.has(id);
  }

  /** All specs, in registration order (stable panel ordering). */
  all(): readonly ParamSpec[] {
    return [...this.specs.values()];
  }

  /**
   * Which parameters apply to this body.
   *
   * This replaces the legacy `paramDef()` if/else chain. Because scope lives
   * WITH the parameter, adding a knob no longer requires editing a central
   * dispatch function — which is what made the old design so easy to get wrong.
   */
  forBody(b: AnyBody | null): readonly ParamSpec[] {
    return this.all().filter((s) => matchesScope(s.scope, b));
  }

  /** Read a value, falling back to the spec default when the body is absent. */
  read(id: string, b: AnyBody | null): number {
    const s = this.get(id);
    if (!b) return s.def;
    const v = s.read(b);
    return Number.isFinite(v) ? v : s.def;
  }

  /** Write a value, clamped to the spec range. */
  write(id: string, b: AnyBody, value: number): void {
    const s = this.get(id);
    s.write(b, clamp(value, s));
  }
}

function matchesScope(scope: ParamScope, b: AnyBody | null): boolean {
  if (!b) return false;
  if (scope.kinds && !scope.kinds.includes(b.kind)) return false;
  if (scope.when && !scope.when(b)) return false;
  return true;
}

/** Constrain a value to the spec's range. */
export function clamp(value: number, spec: ParamSpec): number {
  if (!Number.isFinite(value)) return spec.def;
  let v = value;
  if (v < spec.min) v = spec.min;
  if (v > spec.max) v = spec.max;
  return v;
}

/** Process-wide registry. */
export const params = new ParamRegistry();
