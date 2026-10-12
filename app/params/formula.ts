/**
 * Formula-body and field-source parameters.
 *
 * This completes the parameter migration: combined with `w-body.ts` (drawn
 * shapes) and `devices.ts` (springs, rods, ground, belts), every parameter the
 * legacy `PARAM_DEFS` table defined is now declared once, with its scope, read
 * and write together.
 *
 * TWO THINGS ARE DIFFERENT HERE
 * -----------------------------
 * 1. `grav` is a GLOBAL, not a per-body value. The legacy comment (R71-13)
 *    records the design decision: right-clicking `g` changes the world's
 *    gravity — `GRAV` plus Matter's `engine.gravity.y` — so that everything
 *    visibly falls harder. It deliberately does NOT write `B.grav` (which would
 *    be a private per-body override). "Letters that never had gravity are
 *    unaffected" falls out of the physics still gating on `B.hasG`.
 *
 * 2. `mass` and `massM` are DIFFERENT quantities despite the similar labels:
 *    lowercase `m` writes `B.mass`, capital `M` writes `B.massCap` (the cap for
 *    a body whose mass symbol is `M`). They are independently tunable.
 */
import { params, type AnyBody, type ParamSpec } from '../core/param-registry.ts';

/** Read a legacy global numeric constant (e.g. GRAV, PX_PER_M). */
function G(name: string, fallback: number): number {
  const v = (globalThis as unknown as Record<string, unknown>)[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Set a legacy global. */
function setG(name: string, value: number): void {
  (globalThis as unknown as Record<string, unknown>)[name] = value;
}

/** Clamp helper matching the legacy `clamp(v, lo, hi)` semantics. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* --------------------------------------------------------------------------
 * MASS — lowercase m and capital M are separate quantities
 * ------------------------------------------------------------------------ */

export const massM_lower: ParamSpec = params.register({
  id: 'mass',
  label: '质量 mass',
  unit: 'kg',
  min: 0.2,
  max: 5,
  step: 0.1,
  def: 1,
  group: '公式',
  // Only for formula bodies carrying an `m`: a body with no mass glyph has no
  // mass to tune. The legacy dispatcher expressed this as a separate branch per
  // glyph type; here it is one predicate.
  scope: { when: (b) => !b.kind && !!b.massG && b.massG.type !== 'M' },
  read: (b) => (b && b.mass != null ? b.mass : 1),
  write: (b, v) => {
    // Mass <= 0 is unphysical; the legacy branch guarded exactly this way.
    b.mass = v > 0 ? v : 0.001;
  },
});

export const massM_upper: ParamSpec = params.register({
  id: 'massM',
  label: '质量 M',
  unit: 'kg',
  min: 1,
  max: 12,
  step: 0.5,
  def: 3,
  group: '公式',
  scope: { when: (b) => !b.kind && !!b.massG && b.massG.type === 'M' },
  // Stored in B.massCap — capital-M mass, independently tunable from lowercase m.
  read: (b) => (b && b.massCap != null ? b.massCap : 3),
  write: (b, v) => {
    b.massCap = v > 0 ? v : 0.001;
  },
});

/* --------------------------------------------------------------------------
 * KINEMATICS — gravity (global), acceleration, elasticity, friction
 * ------------------------------------------------------------------------ */

export const gravity: ParamSpec = params.register({
  id: 'grav',
  label: '重力 g',
  unit: 'm/s²',
  siK: 260, // PX_PER_M
  min: 200,
  max: 6000,
  step: 50,
  def: 2600,
  group: '世界',
  // Offered on a body carrying `g`. Reading and writing affect the WHOLE world.
  scope: { when: (b) => !b.kind && !!(b.hasG || b.hasGrav) },
  read: () => G('GRAV', 2600),
  write: (_b, v) => {
    const g = clamp(v, 0, 1e7);
    setG('GRAV', g);
    // Matter keeps its own copy of gravity; the legacy branch synced it so the
    // visible objects actually get heavier, not just the handwritten solver.
    const MW = (globalThis as unknown as Record<string, any>).MW;
    if (MW?.engine) MW.engine.gravity.y = g / 1000;
  },
});

export const acceleration: ParamSpec = params.register({
  id: 'acc',
  label: '加速度 a',
  unit: 'm/s²',
  siK: 260,
  min: 100,
  max: 4000,
  step: 50,
  def: 1300,
  group: '公式',
  scope: { when: (b) => !b.kind && !!b.hasA },
  read: (b) => (b && b.acc != null ? b.acc : 1300),
  write: (b, v) => {
    b.acc = v;
  },
});

export const elasticity: ParamSpec = params.register({
  id: 'bounc',
  label: '弹性 bounce',
  min: 0,
  max: 1,
  step: 0.01,
  def: 0.6,
  group: '公式',
  scope: { when: (b) => !b.kind && !!b.hasV },
  read: (b) => (b && b.bounc != null ? b.bounc : 0.6),
  write: (b, v) => {
    // Restitution is one of the few quantities with a genuine physical bound.
    b.bounc = clamp(v, 0, 1);
  },
});

export const friction: ParamSpec = params.register({
  id: 'frict',
  label: '摩擦系数 μ',
  min: 0,
  max: 1,
  step: 0.01,
  def: 0.1,
  group: '公式',
  scope: { when: (b) => !b.kind && !!b.hasMu },
  read: (b) => (b && b.frict != null ? b.frict : 0.1),
  write: (b, v) => {
    // No upper bound on purpose: mu > 1 is physical (rubber on glass ~ 2).
    b.frict = v;
  },
});

/* --------------------------------------------------------------------------
 * FIELD SOURCES — magnetic / electric / current strength
 * ------------------------------------------------------------------------ */

/** Field sources share a shape: kind tag, a strength field, and a range. */
function fieldSource(kind: string, id: string, label: string, unit: string, field: string): ParamSpec {
  return params.register({
    id,
    label,
    unit,
    min: -3,
    max: 3,
    step: 0.1,
    def: 1,
    group: '场',
    scope: { kinds: [kind] },
    read: (b) => (b && b[field] != null ? b[field] : 1),
    write: (b, v) => {
      b[field] = v;
    },
  });
}

export const magneticField = fieldSource('B', 'bz', '磁场强度 B', 'T', 'Bz');
export const electricField = fieldSource('E', 'eacc', '电场强度 E', 'V/m', 'eacc');
export const currentStrength = fieldSource('I', 'iacc', '电流强度 I', 'A', 'iacc');

/** Everything registered in this module. */
export const FORMULA_PARAMS: readonly ParamSpec[] = [
  massM_lower,
  massM_upper,
  gravity,
  acceleration,
  elasticity,
  friction,
  magneticField,
  electricField,
  currentStrength,
];
