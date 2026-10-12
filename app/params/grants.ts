/**
 * Letter-granting parameters — the values a physics symbol carries BEFORE it is
 * merged into a body.
 *
 * WHY THESE ARE DIFFERENT FROM EVERY OTHER PARAMETER
 * --------------------------------------------------
 * All the parameters migrated so far describe a BODY. These describe a LETTER
 * (the draggable `v` / `a` / `q` / `t` glyphs), and the value has to travel with
 * the glyph so that dropping it onto a body grants the right quantity.
 *
 * The legacy code documents a genuinely subtle rule (R132-9d) that a naive
 * implementation gets wrong:
 *
 *   The letters sitting in the dock are SINGLETONS (`vO`, `aO`, `qO`...). They
 *   act as templates. If editing a dock row wrote the value back onto the
 *   singleton, then every future clone dragged out of the dock would inherit it
 *   — the user reported this as "I changed one v and now every v I drag out has
 *   the same number". So:
 *
 *     - dock (template) state -> write the VALUE onto the body only;
 *       the template keeps just its appearance defaults (CHAR_DEF).
 *     - world state -> also write back onto the letter itself, so the value the
 *       user set travels with the glyph they are about to drop.
 *
 * `wacc` / `waccang` are the exception in the other direction: they act on a
 * body that was already GIVEN an acceleration, and they must keep magnitude and
 * direction consistent with each other (changing one recomputes the vector).
 */
import { params, type AnyBody, type ParamSpec } from '../core/param-registry.ts';

/** The letter object the panel is currently editing, if any. */
function paramLetter(): AnyBody | null {
  const l = (globalThis as unknown as Record<string, unknown>).paramLetter;
  return (l as AnyBody) ?? null;
}

/** Call a legacy helper if present. */
function call(name: string, ...args: unknown[]): unknown {
  const fn = (globalThis as unknown as Record<string, unknown>)[name];
  return typeof fn === 'function' ? (fn as (...a: unknown[]) => unknown)(...args) : undefined;
}

/** Clamp helper matching the legacy `clamp(v, lo, hi)` semantics. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Scope for LETTER-ONLY parameters.
 *
 * Return false unconditionally, on purpose.
 *
 * These eight ids are reached exclusively through the right-click-a-letter path
 * (`specIdForLetter` -> `paramDefForLetter`), never through `paramDef`. If they
 * advertised a body scope, `registry.forBody(body)` would add them to the body
 * panel as DUPLICATE rows — `vsize`/`vang` would appear on every formula body
 * even when no `v` letter was involved. The registry is still the single
 * declaration site (spec, read and write all live here); it just must not
 * volunteer itself into the body-scoped list.
 */
function letterOnlyScope(): { when: (b: AnyBody) => boolean } {
  return { when: () => false };
}

/**
 * Write a grant value onto the body, and onto the letter only when the letter is
 * a real world glyph rather than a dock template.
 *
 * Mirrors the legacy branch exactly:
 *   dock  -> charDefWrite(letter, field, value)   (appearance defaults only)
 *   world -> letter[field] = value                (travels with the glyph)
 */
function writeGrant(
  body: AnyBody,
  bodyField: string,
  letterField: string,
  value: number,
): void {
  body[bodyField] = value;
  const letter = paramLetter();
  if (!letter) return;
  if (letter.state !== 'dock') letter[letterField] = value;
  else call('charDefWrite', letter, letterField, value);
}

/* --------------------------------------------------------------------------
 * TIME
 * ------------------------------------------------------------------------ */

export const timeScale: ParamSpec = params.register({
  id: 'tscale',
  label: 'Δt 时间倍率',
  unit: '×',
  min: 0,
  max: 1,
  step: 0.01,
  def: 1,
  group: '世界',
  // A world-level control on the `t` glyph; unlike `grav` there is no body
  // field at all — it only ever sets the global TIME_SCALE.
  scope: letterOnlyScope(),
  read: () => {
    const v = (globalThis as unknown as Record<string, unknown>).TIME_SCALE;
    return typeof v === 'number' && Number.isFinite(v) ? v : 1;
  },
  write: (_b, v) => {
    // Legacy clamps to [0, 20]: 0 freezes self-evolution (interaction stays
    // live), and the upper bound is a sanity guard.
    const s = clamp(v, 0, 20);
    (globalThis as unknown as Record<string, any>).TIME_SCALE = s;
  },
});

/* --------------------------------------------------------------------------
 * v — grant velocity (magnitude + direction)
 * ------------------------------------------------------------------------ */

export const velocitySize: ParamSpec = params.register({
  id: 'vsize',
  label: '赋予速度 v',
  unit: 'm/s',
  siK: 260,
  min: 0,
  max: 6000,
  step: 100,
  def: 1800,
  group: '字符 v',
  scope: letterOnlyScope(),
  read: (b) => {
    if (b && b.vGive != null) return b.vGive;
    const l = paramLetter();
    if (l && l.vGive != null) return l.vGive;
    return 1800;
  },
  write: (b, v) => {
    writeGrant(b, 'vGive', 'vGive', v < 0 ? 0 : v);
  },
});

export const velocityAngle: ParamSpec = params.register({
  id: 'vang',
  label: '速度方向 θ',
  unit: '°',
  min: -180,
  max: 180,
  step: 1,
  def: 0,
  group: '字符 v',
  scope: letterOnlyScope(),
  read: (b) => {
    if (b && b.vAng != null) return b.vAng;
    const l = paramLetter();
    if (l && l.vAng != null) return l.vAng;
    return 0;
  },
  write: (b, v) => {
    writeGrant(b, 'vAng', 'vAng', v);
  },
});

/* --------------------------------------------------------------------------
 * a — grant acceleration (magnitude + direction)
 * ------------------------------------------------------------------------ */

export const accelSize: ParamSpec = params.register({
  id: 'asize',
  label: '赋予加速度 a',
  unit: 'm/s²',
  siK: 260,
  min: 0,
  max: 6000,
  step: 100,
  def: 1300,
  group: '字符 a',
  scope: letterOnlyScope(),
  read: (b) => {
    if (b && b.aGive != null) return b.aGive;
    const l = paramLetter();
    if (l && l.aGive != null) return l.aGive;
    return 1300;
  },
  write: (b, v) => {
    writeGrant(b, 'aGive', 'aGive', v < 0 ? 0 : v);
  },
});

export const accelAngle: ParamSpec = params.register({
  id: 'aang',
  label: '加速度方向 θ',
  unit: '°',
  min: -180,
  max: 180,
  step: 1,
  def: 0,
  group: '字符 a',
  scope: letterOnlyScope(),
  read: (b) => {
    if (b && b.aAng != null) return b.aAng;
    const l = paramLetter();
    if (l && l.aAng != null) return l.aAng;
    return 0;
  },
  write: (b, v) => {
    writeGrant(b, 'aAng', 'aAng', v);
  },
});

/* --------------------------------------------------------------------------
 * q — grant charge
 * ------------------------------------------------------------------------ */

export const grantCharge: ParamSpec = params.register({
  id: 'qcharge',
  label: '电荷量 q',
  unit: 'C',
  min: -5,
  max: 5,
  step: 0.1,
  def: 1,
  group: '字符 q',
  scope: letterOnlyScope(),
  read: (b) => {
    if (b && b.qCharge != null) return b.qCharge;
    const l = paramLetter();
    if (l && l.qCharge != null) return l.qCharge;
    return 1;
  },
  write: (b, v) => {
    writeGrant(b, 'qCharge', 'qCharge', v);
  },
});

/* --------------------------------------------------------------------------
 * Acceleration already GRANTED to a body — magnitude and direction must stay
 * consistent with each other, so each write recomputes the vector.
 * ------------------------------------------------------------------------ */

export const givenAccelSize: ParamSpec = params.register({
  id: 'wacc',
  label: '赋予加速度 a',
  unit: 'm/s²',
  siK: 260,
  min: 0,
  max: 6000,
  step: 100,
  def: 1300,
  group: '本体',
  // Only appears once the body has actually been given an acceleration — the
  // legacy dispatcher gated on `accGive`/`accX`/`accY` being present.
  scope: { kinds: ['W'], when: (b) => b.accGive != null || b.accX != null || b.accY != null },
  read: (b) => {
    if (!b) return 0;
    // Prefer the vector's magnitude so the row always agrees with the physics.
    if (b.accX != null || b.accY != null) return Math.hypot(b.accX || 0, b.accY || 0);
    return b.accGive != null ? b.accGive : 0;
  },
  write: (b, v) => {
    // Changing the magnitude keeps the CURRENT direction (rescale the vector).
    const cur = Math.atan2(b.accY || 0, b.accX || 0);
    b.accGive = v < 0 ? 0 : v;
    b.accX = Math.cos(cur) * b.accGive;
    b.accY = Math.sin(cur) * b.accGive;
  },
});

export const givenAccelAngle: ParamSpec = params.register({
  id: 'waccang',
  label: '加速度方向 θ',
  unit: '°',
  min: -180,
  max: 180,
  step: 1,
  def: 0,
  group: '本体',
  scope: { kinds: ['W'], when: (b) => b.accGive != null || b.accX != null || b.accY != null },
  read: (b) => {
    if (!b) return 0;
    // Derived from the vector when one exists, otherwise the stored angle.
    if (b.accX != null || b.accY != null) {
      return (Math.atan2(b.accY || 0, b.accX || 0) * 180) / Math.PI;
    }
    return b.accAng != null ? b.accAng : 0;
  },
  write: (b, v) => {
    // Changing the direction keeps the CURRENT magnitude (rotate the vector).
    const len = Math.hypot(b.accX || 0, b.accY || 0) || b.accGive || 0;
    const rad = (v * Math.PI) / 180;
    b.accX = Math.cos(rad) * len;
    b.accY = Math.sin(rad) * len;
    b.accAng = v;
    b.accGive = len;
  },
});

/** Everything registered in this module. */
export const GRANT_PARAMS: readonly ParamSpec[] = [
  timeScale,
  velocitySize,
  velocityAngle,
  accelSize,
  accelAngle,
  grantCharge,
  givenAccelSize,
  givenAccelAngle,
];
