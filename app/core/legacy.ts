/**
 * Legacy bridge — the ONE typed place where the new architecture touches the
 * still-global legacy app.
 *
 * WHY THIS EXISTS (phase B)
 * -------------------------
 * Phase B consolidates state subsystem by subsystem. The mechanism has to be
 * boring and uniform, because the alternative — every module doing its own
 * `(globalThis as any).whatever` — is how the original code ended up with 211
 * mutable globals referenced from everywhere.
 *
 * Before this file, the new modules already contained 20+ such casts, each
 * slightly different: some `as any`, some `as Record<string, unknown>`, some
 * indexing, some property access. That is three problems at once:
 *
 *   1. No single place to see what the new code depends on in the legacy app.
 *   2. No type information, so a typo (`PHYS_MODE` vs `PHYSMODE`) compiles and
 *      fails silently at runtime by yielding `undefined`.
 *   3. No place to add instrumentation when tracking down a coupling bug.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a replacement for the module bridge (`module-bridge.ts`), which *publishes*
 * the legacy declarations onto globalThis. This file *consumes* them, with types.
 * The two are complementary: module-bridge sets up the surface, this reads it.
 *
 * MIGRATION TARGET
 * ----------------
 * Every accessor here is a seam that phase C closes. When a subsystem is fully
 * migrated, its entries are deleted from this file and replaced by real imports;
 * the file shrinking over time IS the progress metric.
 */

/** Names this file knows how to reach. Kept explicit so typos are impossible. */
export interface LegacyApp {
  /** Live body collection. */
  bodies: LegacyBody[];
  /** Free (unmerged) letters floating on the canvas. */
  freeL: LegacyLetter[];
  /** Floating, short-lived formula objects (spawnText, orbit labels, ...). */
  formulas: unknown[];
  /** Device/tool mode state. */
  TOOL: { mode: string; shape?: string | null; cont?: boolean; stroke?: unknown; drag?: unknown };
  /** Physics mode: 'high' (high school) or 'uni' (university). */
  PHYS_MODE: string;
  /** Global gravity, in px/s^2. */
  GRAV: number;
  /** World time multiplier; 0 freezes self-evolution. */
  TIME_SCALE: number;
  /** Canvas width/height in CSS pixels. */
  W: number;
  H: number;
  /** Matter world wrapper, or null before boot. */
  MW: unknown;
  /** The letter whose parameters the panel is currently editing, if any. */
  paramLetter: LegacyLetter | null;
  /** The body whose parameters the panel is currently editing. */
  paramBody: LegacyBody | null;
  /** Legacy parameter spec table (label/min/max/step per id). */
  PARAM_DEFS: Record<string, LegacyParamSpec>;
  /** Per-glyph default values, keyed by glyph character. */
  CHAR_DEF: Record<string, Record<string, unknown>>;
  /** Matter.js namespace, installed by the UMD bundle. */
  Matter: MatterNamespace;
}

/**
 * A body as the legacy app models it.
 *
 * `x`/`y` are optional on purpose. The parameter registry deliberately works
 * with a looser `AnyBody` shape (it only needs the fields a given parameter
 * reads), and requiring coordinates here would force every caller to narrow a
 * type they do not otherwise care about. The legacy functions we call only
 * dereference `x`/`y` for bodies that actually have them.
 */
export interface LegacyBody {
  kind?: string | null;
  x?: number;
  y?: number;
  [key: string]: unknown;
}

export interface LegacyLetter {
  ch?: string;
  state?: string;
  [key: string]: unknown;
}

export interface LegacyParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  def: number;
  siK?: number;
  bool?: boolean;
}

/** The subset of Matter.js the new code touches. */
export interface MatterNamespace {
  Body?: {
    setStatic?: (body: unknown, isStatic: boolean) => void;
    setMass?: (body: unknown, mass: number) => void;
  };
  Sleeping?: {
    set?: (body: unknown, isSleeping: boolean) => void;
  };
  Composite?: {
    add?: (composite: unknown, body: unknown) => void;
    remove?: (composite: unknown, body: unknown, deep?: boolean) => void;
  };
}

/** Top-level legacy functions the new code calls. */
export interface LegacyFunctions {
  refresh(body: LegacyBody): void;
  setRodLen(body: LegacyBody, len: number, force?: boolean): void;
  springSetLen(spring: LegacyBody, len: number): void;
  setGroundEnds(
    ground: LegacyBody,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    force?: boolean,
  ): void;
  setGroundAngle(ground: LegacyBody, radians: number): void;
  setBeltAngle(belt: LegacyBody, radians: number, mode: unknown): void;
  shortAng(radians: number): number;
  charDefWrite(letter: LegacyLetter, key: string, value: unknown): void;
  /**
   * Tear down a floating formula: detach its glyph DOM and mark it dead.
   *
   * Declared here even though `formula-facade.ts` is its only caller, because
   * this map is the audited list of what the new code calls into the legacy app.
   */
  killFormula(formula: { glyphs?: { el?: { parentNode?: unknown } }[]; dead?: boolean }): void;
}

/**
 * Read a legacy global by name.
 *
 * Returns `undefined` rather than throwing when the app has not booted yet.
 * That is deliberate: these accessors are also used from unit tests, where the
 * legacy app does not exist at all, and a throw would make the modules
 * untestable in isolation.
 */
function readRaw<K extends keyof LegacyApp>(name: K): LegacyApp[K] | undefined {
  return (globalThis as unknown as Partial<LegacyApp>)[name];
}

/* --------------------------------------------------------------------------
 * State accessors
 * ------------------------------------------------------------------------ */

/** Bodies, or an empty array when the app has not booted. */
export function bodies(): LegacyBody[] {
  return readRaw('bodies') ?? [];
}

/** Free letters, or an empty array before boot. */
export function freeLetters(): LegacyLetter[] {
  return readRaw('freeL') ?? [];
}

/** Current physics mode; defaults to university when unavailable. */
export function physMode(): string {
  return readRaw('PHYS_MODE') ?? 'uni';
}

/** Current tool state; a neutral default before boot. */
export function toolState(): LegacyApp['TOOL'] {
  return readRaw('TOOL') ?? { mode: 'pen' };
}

export function gravity(): number {
  return readRaw('GRAV') ?? 0;
}

export function setGravity(value: number): void {
  (globalThis as unknown as Record<string, unknown>).GRAV = value;
}

export function timeScale(): number {
  return readRaw('TIME_SCALE') ?? 1;
}

export function setTimeScale(value: number): void {
  (globalThis as unknown as Record<string, unknown>).TIME_SCALE = value;
}

export function paramLetter(): LegacyLetter | null {
  return readRaw('paramLetter') ?? null;
}

export function paramSpec(id: string): LegacyParamSpec | undefined {
  return readRaw('PARAM_DEFS')?.[id];
}

/**
 * The live legacy PARAM_DEFS table, for mutation.
 *
 * Returned by reference on purpose: `panel-bridge.ts` ADDS entries to it so the
 * panel can render registry-only parameters (which have no legacy entry). A copy
 * would be written to and discarded, and the rows would silently never appear.
 */
export function legacyParamDefsTable(): Record<string, LegacyParamSpec> | undefined {
  return readRaw('PARAM_DEFS');
}

export function matterNamespace(): MatterNamespace | undefined {
  return readRaw('Matter');
}

/** Matter world wrapper, or undefined before boot. */
export function matterWorld(): { engine?: { gravity?: { y: number } } } | undefined {
  return readRaw('MW') as { engine?: { gravity?: { y: number } } } | undefined;
}

/* --------------------------------------------------------------------------
 * Function accessors
 * ------------------------------------------------------------------------ */

/**
 * Call a legacy top-level function by name.
 *
 * Generic over the function map so each call site keeps real parameter and
 * return types, while the lookup itself stays in one audited place. Returns
 * `undefined` when the function is absent (pre-boot or in unit tests).
 */
export function callLegacy<K extends keyof LegacyFunctions>(
  name: K,
  ...args: Parameters<LegacyFunctions[K]>
): ReturnType<LegacyFunctions[K]> | undefined {
  const fn = (globalThis as unknown as Partial<LegacyFunctions>)[name];
  if (typeof fn !== 'function') return undefined;
  return (fn as (...a: unknown[]) => ReturnType<LegacyFunctions[K]>)(...args);
}

/**
 * Invoke a legacy function that the new code only needs opportunistically.
 *
 * Some calls (notably `refresh`) happen during parameter writes, and in unit
 * tests there is no legacy app to refresh. Swallowing the absent case keeps
 * those modules unit-testable instead of forcing every test to stub the world.
 */
export function refreshBody(body: LegacyBody): void {
  callLegacy('refresh', body);
}

/**
 * The live `formulas` array — floating, short-lived formula objects.
 *
 * Returned by reference: callers iterate it and remove entries by index while
 * walking backwards, so a copy would make those removals silently ineffective.
 * Returns undefined before boot; `formula-facade.ts` turns that into an empty
 * array so callers can loop unconditionally.
 */
export function formulasArray(): unknown[] | undefined {
  const v = readRaw('formulas');
  return Array.isArray(v) ? v : undefined;
}

/** True when the legacy app has booted far enough to expose its body list. */
export function isBooted(): boolean {
  return Array.isArray(readRaw('bodies'));
}

/* --------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------ */

/**
 * Read a legacy numeric constant (SPR_KS_DEF, PX_PER_M, ROD_SPAWN_LEN, ...).
 *
 * These are configuration constants the legacy app declares at top level, e.g.
 * `var SPR_KS_DEF = 250`. Parameters whose default must track them read through
 * here rather than duplicating the number, so a change in one place cannot
 * silently desynchronise the panel (the legacy comments show that exact drift
 * happening repeatedly — "default didn't change" bugs where the panel kept
 * showing a stale literal).
 *
 * Falls back to `fallback` when absent, which keeps unit tests working without
 * a booted app.
 */
export function constant(name: string, fallback: number): number {
  const v = (globalThis as unknown as Record<string, unknown>)[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Overwrite a legacy global. Used by the few genuinely global parameters. */
export function setGlobal(name: string, value: number): void {
  (globalThis as unknown as Record<string, unknown>)[name] = value;
}
