/**
 * W-body parameters — the knobs for a drawn shape.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This is the first real consumer of the parameter registry, and it fixes the
 * two product complaints directly:
 *
 *   1. "I can't resize a placed block." The SIZE parameter existed all along
 *      (`PARAM_DEFS.scale`) but was only offered when the body carried an `r`
 *      glyph (legacy src/10-app.js:8800). Draw a square, right-click it, and
 *      there was no size row at all. The capability was hidden behind the wrong
 *      condition — not missing.
 *
 *   2. "The parameter set is thin." A drawn shape with no glyphs offered exactly
 *      four sliders. Adding one meant editing four separate places in the
 *      legacy file, which is why it stayed thin.
 *
 * By declaring scope next to the spec, a freshly drawn body now exposes size
 * along with mass / friction / bounce / air drag — and adding more is a single
 * self-contained declaration.
 *
 * UNITS AND STORAGE
 * -----------------
 * Values are stored on the body exactly as the legacy engine expects, so the
 * simulation is untouched. In particular:
 *   - `scale` writes `B.scaleParam`, which `refresh(B)` applies multiplicatively
 *     at layout time (legacy 5428-5431). It is NOT cumulative: refresh re-lays
 *     out unscaled hw/hh and applies the factor once.
 *   - The defaults below are copied from the legacy PARAM_DEFS so behaviour is
 *     identical. They are asserted against the legacy source by a test.
 */
import { params, type AnyBody, type ParamSpec } from '../core/param-registry.ts';

/** Legacy defaults, mirrored so the registry cannot silently drift from them. */
export const W_DEFAULTS = {
  mass: 1,
  friction: 0.5,
  bounce: 0,
  air: 0,
  scale: 1,
  charge: 0,
} as const;

/** Ranges, mirrored from the legacy PARAM_DEFS. */
export const W_RANGES = {
  mass: { min: 0.2, max: 5, step: 0.1 },
  friction: { min: 0, max: 1, step: 0.01 },
  bounce: { min: 0, max: 1, step: 0.01 },
  air: { min: 0, max: 0.5, step: 0.001 },
  scale: { min: 0.4, max: 3, step: 0.05 },
  charge: { min: -5, max: 5, step: 0.1 },
} as const;

/**
 * True for ordinary drawn shapes.
 *
 * Excludes devices and field sources, which have their own dedicated knobs —
 * the legacy code made the same distinction, documenting the rule as "don't put
 * knobs in front of the user that can never do anything".
 */
function isDrawableShape(b: AnyBody): boolean {
  return (
    b.kind === 'W' &&
    !b.gnd && // ground/wall: only length + angle
    !b.belt && // conveyor: only belt speed
    !b.isWell // gravity-well whole (mv²/r): different semantics
  );
}

/** Mass multiplier. Stored in `B.mMul` and mirrored to Matter's mass. */
export const wMass: ParamSpec = params.register({
  id: 'wmass',
  label: '质量 mass',
  unit: 'kg',
  ...W_RANGES.mass,
  def: W_DEFAULTS.mass,
  group: '本体',
  scope: { when: isDrawableShape },
  read: (b) => (b && b.kind === 'W' ? (b.mMul ?? W_DEFAULTS.mass) : W_DEFAULTS.mass),
  write: (b, v) => {
    // Legacy applyParam semantics: keep JS-side B.mass and Matter's mass in
    // sync. Static bodies keep Infinity-mass semantics and are skipped.
    b.mMul = v;
    b.mass = v;
    if (b.mb && b._natMass && !b.mb.isStatic) {
      const Matter = (globalThis as any).Matter;
      if (Matter?.Body?.setMass) Matter.Body.setMass(b.mb, b._natMass * v);
    }
  },
});

/** Dynamic friction coefficient. */
export const wFriction: ParamSpec = params.register({
  id: 'wfrict',
  label: '摩擦系数 μ',
  ...W_RANGES.friction,
  def: W_DEFAULTS.friction,
  group: '本体',
  scope: { when: isDrawableShape },
  read: (b) => {
    if (!b || b.kind !== 'W') return W_DEFAULTS.friction;
    // Legacy: high-school mode defaults mu to 0 (R76).
    const mode = (globalThis as any).PHYS_MODE;
    return b.wFrict != null ? b.wFrict : mode === 'high' ? 0 : W_DEFAULTS.friction;
  },
  write: (b, v) => {
    b.wFrict = v;
  },
});

/** Restitution (bounciness). */
export const wBounce: ParamSpec = params.register({
  id: 'wbounc',
  label: '弹性 bounce',
  ...W_RANGES.bounce,
  def: W_DEFAULTS.bounce,
  group: '本体',
  scope: { when: isDrawableShape },
  read: (b) => (b && b.wBounc != null ? b.wBounc : W_DEFAULTS.bounce),
  write: (b, v) => {
    b.wBounc = v;
  },
});

/** Air drag, independent of the spring damper. */
export const wAir: ParamSpec = params.register({
  id: 'wair',
  label: '空气阻力 air',
  ...W_RANGES.air,
  def: W_DEFAULTS.air,
  group: '本体',
  scope: { when: isDrawableShape },
  read: (b) => (b && b.wAir != null ? b.wAir : W_DEFAULTS.air),
  write: (b, v) => {
    b.wAir = v;
  },
});

/**
 * SIZE — the fix for "I can't resize a placed block".
 *
 * Scope is deliberately just "any drawable shape", with NO glyph requirement.
 * That single change is what makes the size row appear when you right-click a
 * shape you just drew.
 *
 * Write path: set `B.scaleParam` then `refresh(B)`, which re-lays out the
 * unscaled half-extents and applies the factor exactly once. Calling refresh is
 * required — it is what rebuilds the hull, the Matter body and the render
 * geometry. Omitting it would leave the visual and the collider stale.
 */
export const wScale: ParamSpec = params.register({
  id: 'scale',
  label: '尺寸 size',
  unit: '×',
  ...W_RANGES.scale,
  def: W_DEFAULTS.scale,
  group: '本体',
  scope: { when: isDrawableShape },
  read: (b) => (b && b.scaleParam != null ? b.scaleParam : W_DEFAULTS.scale),
  write: (b, v) => {
    b.scaleParam = v > 0 ? v : W_DEFAULTS.scale;
    if (b.isWell) b.wellR = (b.baseWellR || 360) * b.scaleParam;
    const refresh = (globalThis as any).refresh;
    if (typeof refresh === 'function') refresh(b);
  },
});

/**
 * WIDTH / HEIGHT — non-uniform resize.
 *
 * Motivation: uniform `scale` cannot turn a square into a plank. Both factors
 * multiply with `scale` (see `applyInkScale`), so "2x overall, then stretch the
 * width 1.5x" yields 3x wide by 2x tall — intuitive and reversible.
 *
 * NOT offered for circles or arcs: the collision shell and the renderer both
 * draw them from `rad`, so a non-uniform stretch would make the visible shape
 * and the collidable shape disagree. Exposing a control that visibly does
 * nothing (or worse, lies about the geometry) is exactly the "don't show the
 * user a knob that cannot work" rule the legacy code documented.
 */
function isStretchableShape(b: AnyBody): boolean {
  if (!isDrawableShape(b)) return false;
  if (b.wshape === 'circle' || b.rad != null) return false;
  if (b.ell) return false; // arc: geometry is derived from an ellipse spec
  return true;
}

/** Both axis factors share this range: 0.2x .. 3x. */
const AXIS_RANGE = { min: 0.2, max: 3, step: 0.05 } as const;

export const wWidth: ParamSpec = params.register({
  id: 'wscaleX',
  label: '宽度 width',
  unit: '×',
  ...AXIS_RANGE,
  def: 1,
  group: '本体',
  scope: { when: isStretchableShape },
  read: (b) => (b && b.wScaleX != null ? b.wScaleX : 1),
  write: (b, v) => {
    b.wScaleX = v > 0 ? v : 1;
    const refresh = (globalThis as any).refresh;
    if (typeof refresh === 'function') refresh(b);
  },
});

export const wHeight: ParamSpec = params.register({
  id: 'wscaleY',
  label: '高度 height',
  unit: '×',
  ...AXIS_RANGE,
  def: 1,
  group: '本体',
  scope: { when: isStretchableShape },
  read: (b) => (b && b.wScaleY != null ? b.wScaleY : 1),
  write: (b, v) => {
    b.wScaleY = v > 0 ? v : 1;
    const refresh = (globalThis as any).refresh;
    if (typeof refresh === 'function') refresh(b);
  },
});

/**
 * FIXED — pin a body in place.
 *
 * The capability already existed but only in the right-click MENU
 * (`menuBody.fixed = !menuBody.fixed`, legacy 6396), so it was invisible to
 * anyone who opened the parameter panel looking for it. This is a pure
 * relocation of an existing, already-tested behaviour — no new physics.
 *
 * Implemented via the same body-flag + Matter `setStatic` pair the menu uses,
 * including waking the body so a sleeping static body cannot stay stuck.
 */
export const wFixed: ParamSpec = params.register({
  id: 'wfixed',
  label: '固定 fixed',
  min: 0,
  max: 1,
  step: 1,
  def: 0,
  group: '本体',
  scope: { kinds: ['W'], when: (b) => !b.belt && !b.gnd },
  read: (b) => (b && b.fixed ? 1 : 0),
  write: (b, v) => {
    const on = v >= 0.5;
    b.fixed = on;
    const Matter = (globalThis as any).Matter;
    if (b.mb && Matter?.Body?.setStatic) {
      Matter.Body.setStatic(b.mb, on);
      if (Matter.Sleeping?.set) Matter.Sleeping.set(b.mb, false);
    }
  },
});

/** Charge, only once the body has been given one. */
export const wCharge: ParamSpec = params.register({
  id: 'wcharge',
  label: '电荷量 q',
  unit: 'C',
  ...W_RANGES.charge,
  def: W_DEFAULTS.charge,
  group: '本体',
  scope: { kinds: ['W'], when: (b) => !!b.charge },
  read: (b) => (b && b.charge != null ? b.charge : W_DEFAULTS.charge),
  write: (b, v) => {
    b.charge = v;
  },
});

/** Everything registered above, for callers that want the W set explicitly. */
export const W_PARAMS: readonly ParamSpec[] = [
  wMass,
  wFriction,
  wBounce,
  wAir,
  wScale,
  wWidth,
  wHeight,
  wFixed,
  wCharge,
];
