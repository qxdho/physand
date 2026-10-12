/**
 * Formula facade — the lifecycle of floating formula objects.
 *
 * WHY THIS EXISTS (phase B, and the "formulas you can touch" goal)
 * ----------------------------------------------------------------
 * There are two kinds of formula-ish things in the app, and they are easy to
 * confuse:
 *
 *   1. A body's MEMORY (`B.mem` / `B.glyphs`) — the letters merged into a drawn
 *      shape. Layout only; no independent lifecycle.
 *   2. A FLOATING formula object in the `formulas` array — short-lived, has its
 *      own position/velocity/age, and is created by things like `spawnText` and
 *      the mv²/r orbit path.
 *
 * This facade covers the second. It is the same shape of problem as `bodies`:
 * one shared collection, mutated from creation, stepping and teardown, with
 * removal by identity. The legacy code calls `formulas.push(...)` in two places
 * and `formulas.splice(i, 1)` in four, each paired with `killFormula` by hand —
 * and forgetting the pairing leaks DOM nodes, because `killFormula` is what
 * removes the glyph elements.
 *
 * That pairing is the reason to name it: "remove from the array" and "detach the
 * DOM" must happen together, and nothing in the old code enforced that.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not touch formula LAYOUT (`setF`, `layoutBody`, `layoutRun`, ...).
 * An audit for this round measured those functions and found them already
 * self-contained: they operate on the body they are given and reference no
 * shared state at all. Wrapping them would be indirection without a payoff.
 */

import { callLegacy, formulasArray } from './legacy.ts';

/** A floating formula object, as the legacy code models it. */
export interface FormulaObject {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  dead?: boolean;
  glyphs?: { el?: { parentNode?: unknown } }[];
  [key: string]: unknown;
}

/**
 * Read the live `formulas` array.
 *
 * By reference, for the same reason as `bodies`: callers iterate it, and the
 * stepping loop removes entries while walking backwards by index. A copy would
 * make those removals silently ineffective.
 *
 * Returns an empty array before boot so callers can iterate unconditionally.
 */
export function formulas(): FormulaObject[] {
  return (formulasArray() as FormulaObject[] | undefined) ?? [];
}

/** Register a newly created floating formula. */
export function addFormula(f: FormulaObject): void {
  formulasArray()?.push(f);
}

/**
 * Destroy a formula: detach its glyph DOM, then remove it from the list.
 *
 * The two steps belong together. `killFormula` is what removes the glyph
 * elements; dropping the array entry without it leaks DOM nodes that keep
 * rendering nothing but still cost layout. Doing both here means a caller cannot
 * get one without the other.
 *
 * Tolerant of a formula that is not in the list (teardown may run twice).
 */
export function destroyFormula(f: FormulaObject): boolean {
  callLegacy('killFormula', f);
  const arr = formulasArray() as FormulaObject[] | undefined;
  if (!arr) return false;
  const i = arr.indexOf(f);
  if (i < 0) return false;
  arr.splice(i, 1);
  return true;
}

/** Remove every floating formula (used by clear-all). */
export function destroyAllFormulas(): number {
  const arr = formulas();
  let n = 0;
  // Walk backwards: destroyFormula mutates the same array we are iterating.
  for (let i = arr.length - 1; i >= 0; i--) {
    const f = arr[i];
    if (f && destroyFormula(f)) n++;
  }
  return n;
}

/** How many floating formulas exist. */
export function formulaCount(): number {
  return formulas().length;
}

/* --------------------------------------------------------------------------
 * Installing the facade object
 * ------------------------------------------------------------------------ */

/** What the legacy helpers call into. */
export interface FormulaFacadeHandle {
  add(formula: FormulaObject): void;
  destroy(formula: FormulaObject): boolean;
  destroyAll(): number;
  count(): number;
}

export const FORMULA_FACADE_KEY = '__formulaFacade';

/**
 * Publish the facade.
 *
 * Like the Matter bridge, this needs nothing from the legacy scope — it works
 * through the published `formulas` array and the `killFormula` function. The
 * indirection exists so the pairing rule (detach DOM AND remove from the list)
 * lives in one file instead of being re-stated at every call site.
 */
export function installFormulaFacade(): void {
  (globalThis as unknown as Record<string, unknown>)[FORMULA_FACADE_KEY] = {
    add: addFormula,
    destroy: destroyFormula,
    destroyAll: destroyAllFormulas,
    count: formulaCount,
  } satisfies FormulaFacadeHandle;
}
