/**
 * Symbol registry — one declaration per dock symbol.
 *
 * WHY THIS EXISTS (phase D: extensibility)
 * ----------------------------------------
 * Adding one symbol to the legacy app means editing FIVE kinds of place, two of
 * them duplicated:
 *
 *   1. `var xO = GD('x')`            a singleton per symbol
 *   2. `DOCK_ORDER = { 'x': 16 }`    the panel ordering table
 *   3. `kids = [mO, ..., xO]`        the re-append list — TWICE
 *   4. `case 'xO': xO = nd;`         the rebuild table — TWICE
 *
 * And the copies are already inconsistent, which is the argument for this module
 * stated as evidence rather than as a worry:
 *
 *   `sortPanel`'s kids list has 15 entries; the other one has 17.
 *   `k` and `x` are missing from the first.
 *
 * That omission turns out to be harmless today — `dockSlotEl` positions symbols
 * by the ordering table, so k and x still land in the panel — but it is exactly
 * the kind of drift that is invisible until someone changes the code path that
 * happens to paper over it.
 *
 * WHAT THIS MODULE IS
 * -------------------
 * The single source of truth for which symbols exist, what they read as, and
 * where they sit in the panel. The legacy structures stay in place and keep
 * running; this is the declaration a guard checks them against, so the next
 * symbol is added in one place and the five derived copies are verified rather
 * than remembered.
 *
 * WHAT IT IS NOT
 * --------------
 * It does not create the singletons. Those are `GD(...)` calls whose results are
 * captured in per-symbol globals referenced by name across ~20 sites; replacing
 * that with a lookup is a separate, larger change, and doing it in the same step
 * as introducing the table would make either failure hard to attribute.
 */

/** One dock symbol. */
export interface SymbolDefinition {
  /**
   * The character as drawn in the panel.
   *
   * Halves and Greek letters use their literal glyphs, matching how the legacy
   * code prints them.
   */
  char: string;
  /**
   * The legacy global holding this symbol's singleton, e.g. `xO`.
   *
   * Recorded because the legacy reset/rebuild tables switch on these names, and
   * a guard checks those tables cover exactly this set.
   */
  globalName: string;
  /**
   * Panel slot in the ordering table (`DOCK_ORDER`, zero-based).
   *
   * Position is part of the declaration because the legacy code once computed it
   * by counting existing elements, which produced a one-frame misalignment when
   * clearing during a layout pass.
   */
  slot: number;
}

/**
 * Every dock symbol, in panel order.
 *
 * The order here must match `DOCK_ORDER` exactly — a test compares them, because
 * a mismatch reorders the visible palette.
 */
export const SYMBOL_DEFINITIONS: readonly SymbolDefinition[] = [
  { char: 'm', globalName: 'mO', slot: 0 },
  { char: 'M', globalName: 'M2O', slot: 1 },
  { char: 'g', globalName: 'gO', slot: 2 },
  { char: 'a', globalName: 'aO', slot: 3 },
  { char: 'v', globalName: 'vO', slot: 4 },
  { char: 'r', globalName: 'rO', slot: 5 },
  { char: '½', globalName: 'halfO', slot: 6 },
  { char: 'μ', globalName: 'muO', slot: 7 },
  { char: 'c', globalName: 'cO', slot: 8 },
  { char: 'G', globalName: 'GO', slot: 9 },
  { char: 't', globalName: 'tO', slot: 10 },
  { char: 'B', globalName: 'BO', slot: 11 },
  { char: 'E', globalName: 'EO', slot: 12 },
  { char: 'q', globalName: 'qO', slot: 13 },
  { char: 'I', globalName: 'IO', slot: 14 },
  // k and x are the spring's two component letters (k·x -> spring). They were
  // added later, which is exactly why they are the ones missing from a copy of
  // the kids list — the drift this module exists to make visible.
  { char: 'k', globalName: 'kO', slot: 15 },
  { char: 'x', globalName: 'xO', slot: 16 },
];

/** How many symbols the panel shows. */
export function symbolCount(): number {
  return SYMBOL_DEFINITIONS.length;
}

/** Every legacy global name that holds a symbol singleton. */
export function symbolGlobalNames(): string[] {
  return SYMBOL_DEFINITIONS.map((s) => s.globalName);
}

/** Look up a symbol by its panel character. */
export function symbolByChar(char: string): SymbolDefinition | null {
  for (const s of SYMBOL_DEFINITIONS) if (s.char === char) return s;
  return null;
}
