/**
 * Device parameters — springs, rods, ground/walls, conveyor belts, ropes, hinges.
 *
 * WHY THIS MODULE
 * ---------------
 * The W-body migration proved the registry pattern on drawn shapes. This extends
 * it to the *device* kinds, which is where the legacy central dispatcher was at
 * its most tangled: `paramDef`, `paramV` and `applyParam` each carried a separate
 * branch per kind, so the same parameter was described in three places and a
 * missed read branch produced the "I changed it and nothing happened" bugs that
 * the legacy comments record three separate times (R61 sk/slen, R99 convspeed,
 * R101 rlen).
 *
 * UNITS
 * -----
 * `siK` means "display units differ from stored units". Several devices store
 * pixels while the panel shows metres (`siK: PX_PER_M`), and the belt angle is
 * stored in radians while shown in degrees (`siK: Math.PI/180`). The panel
 * already converts at its call sites, so the registry stores the same internal
 * value the legacy branches did — the numbers are mirrored and cross-checked
 * against the legacy table by a test.
 *
 * WRITE PATHS GO THROUGH THE EXISTING CHOKE POINTS
 * ------------------------------------------------
 * Changing a rod's length or a spring's rest length is not a plain field write:
 * the collision mirror has to be rebuilt. The legacy code routes these through
 * `setRodLen` / `springSetLen` / `setGroundEnds`, and the comments explain why
 * (writing `B.len` alone left the Matter plate at its original width, so the rod
 * was "visible but not touchable"). We call the same functions.
 */
import { params, type AnyBody, type ParamSpec } from '../core/param-registry.ts';
import { callLegacy, constant as K } from '../core/legacy.ts';

function isSpring(b: AnyBody): boolean {
  return b.kind === 'S' && !b.hinge && !b.rope;
}
function isRope(b: AnyBody): boolean {
  return !!b.rope;
}
function isHinge(b: AnyBody): boolean {
  return b.kind === 'S' && !!b.hinge;
}
function isRod(b: AnyBody): boolean {
  return b.kind === 'T';
}
function isGround(b: AnyBody): boolean {
  return !!b.gnd;
}
function isBelt(b: AnyBody): boolean {
  return !!b.belt;
}

/* --------------------------------------------------------------------------
 * SPRING — stiffness, rest length, damping
 * ------------------------------------------------------------------------ */

export const springK: ParamSpec = params.register({
  id: 'sk',
  label: '劲度系数 k',
  unit: 'N/m',
  min: 2,
  max: 600,
  step: 1,
  def: 250, // SPR_KS_DEF; cross-checked against the legacy table by a test
  group: '弹簧',
  scope: { when: isSpring },
  // Legacy read: `if(id==='sk'&&B.kind==='S')return B.ks;` — the unset case is
  // the read branch whose omission caused R61 ("默认劲度系数没改变").
  read: (b) => (b && b.ks != null ? b.ks : K('SPR_KS_DEF', 250)),
  write: (b, v) => {
    b.ks = Math.max(0, Math.min(v, 1e6));
  },
});

export const springLen: ParamSpec = params.register({
  id: 'slen',
  label: '自然长度 L₀',
  unit: 'm',
  siK: 260, // PX_PER_M
  min: 60,
  max: 420,
  step: 10,
  def: 110, // SPR_SPAWN_LEN
  group: '弹簧',
  scope: { when: isSpring },
  read: (b) => (b && b.len != null ? b.len : K('SPR_SPAWN_LEN', 110)),
  write: (b, v) => {
    // Must go through springSetLen: it makes the spring actually change length
    // rather than just storing a number. The legacy comment on R58 records that
    // writing the field alone left the drawing motionless and the spring
    // mis-coloured because cur != L0.
    if (b.kind === 'S') callLegacy('springSetLen', b, v);
    else b.len = Math.max(1, v);
  },
});

export const springDamp: ParamSpec = params.register({
  id: 'sdamp',
  label: '阻尼 D',
  min: 0,
  max: 30,
  step: 0.2,
  def: 0.8, // SPR_DAMP
  group: '弹簧',
  scope: { when: isSpring },
  read: (b) => (b && b.damp != null ? b.damp : K('SPR_DAMP', 0.8)),
  write: (b, v) => {
    b.damp = Math.max(0, Math.min(v, 1e6));
  },
});

/* --------------------------------------------------------------------------
 * ROD — length and mass
 * ------------------------------------------------------------------------ */

export const rodLen: ParamSpec = params.register({
  id: 'rodlen',
  label: '杆长 length',
  unit: 'm',
  siK: 260,
  min: 60,
  max: 420,
  step: 10,
  def: 170, // ROD_SPAWN_LEN
  group: '杆',
  scope: { when: isRod },
  read: (b) => (b && b.len != null ? b.len : K('ROD_SPAWN_LEN', 170)),
  write: (b, v) => {
    // setRodLen is the single choke point for rod length: it also rebuilds the
    // collision mirror plate, which is what makes the rod "touchable" at its
    // new size (legacy R98-1 measured boundsW stuck at the original width).
    if (b.kind === 'T') callLegacy('setRodLen', b, v, true);
    else b.len = Math.max(1, v);
  },
});

export const rodMass: ParamSpec = params.register({
  id: 'rodmass',
  label: '质量 mass',
  unit: 'kg',
  min: 0.05,
  max: 20,
  step: 0.05,
  def: 1,
  group: '杆',
  scope: { when: isRod },
  // Legacy read is `rodMassOf(B)`, which derives a default from length when the
  // user has not set one — replicate that rather than returning a flat 1.
  read: (b) => {
    if (!b) return 1;
    if (b.rmass != null) return b.rmass;
    return b.len ? b.len / 170 : 1;
  },
  write: (b, v) => {
    b.rmass = Math.max(0.01, Math.min(v, 1e7));
  },
});

/* --------------------------------------------------------------------------
 * ROPE and HINGE
 * ------------------------------------------------------------------------ */

export const ropeLen: ParamSpec = params.register({
  id: 'rlen',
  label: '绳长 L',
  unit: 'm',
  siK: 260,
  min: 60,
  max: 600,
  step: 10,
  def: 110, // ROPE_SPAWN_LEN
  group: '绳',
  scope: { when: isRope },
  read: (b) => (b && b.len != null ? b.len : K('ROPE_SPAWN_LEN', 110)),
  write: (b, v) => {
    // Same choke point as the spring: a rope whose length only changed on paper
    // would be a repeat of the R101 bug.
    if (b.rope) callLegacy('springSetLen', b, v);
    else b.len = Math.max(1, v);
  },
});

export const hingeFixed: ParamSpec = params.register({
  id: 'hfix',
  label: '固定铰链',
  min: 0,
  max: 1,
  step: 1,
  def: 0,
  group: '铰链',
  scope: { when: isHinge },
  /* The on/off flag lives in `B.param.hfix` — that is what the physics reads
   * (legacy 16399: `var fixed = !!(B.param && B.param.hfix)`, and 16196 guards
   * the free-rotation path on the same field). The legacy `paramV` has no
   * branch, so it fell through to `pv(B,'hfix',0)`, which reads exactly this
   * field. Replicating that keeps the panel and the physics on one source. */
  read: (b) => (b && b.param && b.param.hfix ? 1 : 0),
  write: (b, v) => {
    if (!b.param) b.param = {};
    b.param.hfix = v ? 1 : 0;
    // Enabling pins the angle at the CURRENT configuration, so the stale
    // reference fold must be discarded — otherwise the hinge visibly snaps back
    // to the fold it had when the two ends were first joined (legacy R105-6).
    if (v && b.hinge) b._hFold0 = null;
  },
});

/* --------------------------------------------------------------------------
 * GROUND / WALL — length and angle
 * ------------------------------------------------------------------------ */

export const groundLen: ParamSpec = params.register({
  id: 'gndlen',
  label: '长度 length',
  unit: 'm',
  siK: 260,
  min: 60,
  max: 1600,
  step: 10,
  def: 260, // GROUND_SPAWN_LEN
  group: '地面',
  scope: { when: isGround },
  read: (b) => (b && b.len != null ? b.len : K('GROUND_SPAWN_LEN', 260)),
  write: (b, v) => {
    if (!b.gnd) return;
    // Stretch symmetrically about the centroid, matching the rod semantics.
    const len = Math.max(K('GROUND_MIN_LEN', 60), Math.min(v, K('GROUND_MAX_LEN', 1600)));
    const u = Math.cos(b.th || 0);
    const w = Math.sin(b.th || 0);
    callLegacy(
      'setGroundEnds',
      b,
      b.x - (u * len) / 2,
      b.y - (w * len) / 2,
      b.x + (u * len) / 2,
      b.y + (w * len) / 2,
      true,
    );
  },
});

export const groundAngle: ParamSpec = params.register({
  id: 'gndang',
  label: '角度 angle',
  unit: '°',
  min: -180,
  max: 180,
  step: 1,
  def: 0,
  group: '地面',
  scope: { when: isGround },
  // Stored as radians internally, displayed in degrees (legacy returns degrees).
  read: (b) => ((b && b.th ? b.th : 0) * 180) / Math.PI,
  write: (b, v) => {
    if (b.gnd) callLegacy('setGroundAngle', b, (v * Math.PI) / 180);
  },
});

/* --------------------------------------------------------------------------
 * CONVEYOR BELT — speed and angle
 * ------------------------------------------------------------------------ */

export const beltSpeed: ParamSpec = params.register({
  id: 'convspeed',
  label: '带速 v',
  unit: 'm/s',
  siK: 260,
  min: -1040,
  max: 1040,
  step: 10,
  def: 130, // CONV_DEF (= round(0.5 * PX_PER_M)); cross-checked by a test
  group: '传送带',
  scope: { when: isBelt },
  // `B.conv` is a dedicated field; the legacy comment notes that skipping this
  // branch is the same trap as the spring's `ks` (R99).
  read: (b) => (b && b.conv != null ? b.conv : 0),
  write: (b, v) => {
    if (!b.belt) return;
    b.conv = Math.max(-1e5, Math.min(v, 1e5));
  },
});

export const beltAngle: ParamSpec = params.register({
  id: 'beltangle',
  label: '角度 θ',
  unit: '°',
  /* Storage is radians (B.th); the panel shows degrees via siK = PI/180, i.e. it
   * converts before calling (internal = displayed * siK) and divides on readback.
   * The slider bounds are ±PI internally, which is ±180 displayed. */
  siK: Math.PI / 180,
  min: -Math.PI,
  max: Math.PI,
  step: Math.PI / 180,
  def: 0,
  group: '传送带',
  scope: { when: isBelt },
  // Legacy read returns B.th directly (radians) because the panel divides by siK.
  read: (b) => (b && b.th ? b.th : 0),
  write: (b, v) => {
    // Normalize to (-PI, PI] exactly as the legacy branch does, then route
    // through setBeltAngle so points, hull and the mirror plate all follow.
    if (b.belt) {
      const norm = callLegacy('shortAng', v);
      callLegacy('setBeltAngle', b, typeof norm === 'number' ? norm : v, null);
    }
  },
});

/** Every device parameter, for callers that want the set explicitly. */
export const DEVICE_PARAMS: readonly ParamSpec[] = [
  springK,
  springLen,
  springDamp,
  rodLen,
  rodMass,
  ropeLen,
  hingeFixed,
  groundLen,
  groundAngle,
  beltSpeed,
  beltAngle,
];
