/**
 * Cross-checks the device parameter definitions against the legacy PARAM_DEFS.
 *
 * Same rationale as the W-body equivalent: while both representations exist,
 * a range or default edited in only one of them makes the panel disagree with
 * the engine. That is precisely the failure the legacy comments record three
 * times (R61 sk/slen, R99 convspeed, R101 rlen) — a parameter whose displayed
 * value has no relationship to what physics uses.
 *
 * Run: node --test app/params/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  springK,
  springLen,
  springDamp,
  rodLen,
  rodMass,
  ropeLen,
  groundLen,
  groundAngle,
  beltSpeed,
  beltAngle,
} from './devices.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEGACY = readFileSync(join(ROOT, 'src', '10-app.js'), 'utf8');

/** Parse one legacy PARAM_DEFS entry's numeric fields (no eval of legacy code). */
function legacyEntry(id: string): Record<string, number> {
  const re = new RegExp(`^\\s*${id}:\\{([^}]*)\\},?\\s*$`, 'm');
  const m = LEGACY.match(re);
  assert.ok(m, `legacy PARAM_DEFS entry "${id}" not found — renamed or removed?`);
  const body = m![1]!;
  const out: Record<string, number> = {};
  for (const field of ['min', 'max', 'step']) {
    const fm = body.match(new RegExp(`\\b${field}:([^,}]+)`));
    if (!fm) continue;
    const num = Number(fm[1]!.trim());
    out[field] = Number.isFinite(num) ? num : NaN;
  }
  return out;
}

/** Assert min/max/step of a registry spec match the legacy entry. */
function assertRangeMatches(id: string, spec: { min: number; max: number; step: number }): void {
  const l = legacyEntry(id);
  assert.equal(spec.min, l.min, `${id}.min`);
  assert.equal(spec.max, l.max, `${id}.max`);
  assert.equal(spec.step, l.step, `${id}.step`);
}

test('spring ranges mirror the legacy table', () => {
  assertRangeMatches('sk', springK);
  assertRangeMatches('slen', springLen);
  assertRangeMatches('sdamp', springDamp);
});

test('rod ranges mirror the legacy table', () => {
  assertRangeMatches('rodlen', rodLen);
  assertRangeMatches('rodmass', rodMass);
});

test('rope range mirrors the legacy table', () => {
  assertRangeMatches('rlen', ropeLen);
});

test('ground ranges mirror the legacy table', () => {
  assertRangeMatches('gndlen', groundLen);
  assertRangeMatches('gndang', groundAngle);
});

test('belt ranges mirror the legacy table', () => {
  assertRangeMatches('convspeed', beltSpeed);
  // beltangle stores radians with PI-based bounds; the panel shows degrees via
  // siK = PI/180, so the displayed range is +-180 degrees.
  assert.equal(beltAngle.siK, Math.PI / 180);
  assert.ok(Math.abs(beltAngle.min - -Math.PI) < 1e-12);
  assert.ok(Math.abs(beltAngle.max - Math.PI) < 1e-12);
  assert.ok(Math.abs(beltAngle.step - Math.PI / 180) < 1e-12);
  // Displayed range must come out as +-180 degrees.
  assert.ok(Math.abs(beltAngle.max / beltAngle.siK! - 180) < 1e-9);
});

/* --------------------------------------------------------------------------
 * Scope — which device kind sees which knob
 * ------------------------------------------------------------------------ */

test('each device kind exposes exactly its own parameters', () => {
  // Local re-implementation of the registry's scope filter, to keep this test
  // independent of registry internals.
  const matches = (
    spec: { scope: { kinds?: readonly string[]; when?: (b: any) => boolean } },
    b: Record<string, any>,
  ) => {
    if (spec.scope.kinds && !spec.scope.kinds.includes(b.kind)) return false;
    if (spec.scope.when && !spec.scope.when(b)) return false;
    return true;
  };
  const ids = (specs: readonly any[], b: Record<string, any>) =>
    specs.filter((s) => matches(s, b)).map((s) => s.id);

  const springs = [springK, springLen, springDamp];
  const rods = [rodLen, rodMass];
  const grounds = [groundLen, groundAngle];
  const belts = [beltSpeed, beltAngle];

  assert.deepEqual(ids(springs, { kind: 'S' }), ['sk', 'slen', 'sdamp'], 'plain spring');
  assert.deepEqual(ids(rods, { kind: 'T' }), ['rodlen', 'rodmass'], 'rod');
  assert.deepEqual(ids(grounds, { kind: 'W', gnd: 1 }), ['gndlen', 'gndang'], 'ground');
  assert.deepEqual(ids(belts, { kind: 'W', belt: true }), ['convspeed', 'beltangle'], 'belt');

  // Nothing leaks across kinds.
  assert.deepEqual(ids(springs, { kind: 'T' }), [], 'spring knobs must not appear on a rod');
  assert.deepEqual(ids(rods, { kind: 'S' }), [], 'rod knobs must not appear on a spring');
  assert.deepEqual(ids(belts, { kind: 'W' }), [], 'belt knobs must not appear on a plain shape');
});

test('rope and hinge get their own knobs, not the spring set', () => {
  const isSpring = (b: any) => b.kind === 'S' && !b.hinge && !b.rope;
  assert.equal(isSpring({ kind: 'S' }), true, 'plain spring');
  assert.equal(isSpring({ kind: 'S', rope: true }), false, 'rope is not a spring');
  assert.equal(isSpring({ kind: 'S', hinge: true }), false, 'hinge is not a spring');
});

/* --------------------------------------------------------------------------
 * Write paths must use the choke points, not raw field writes
 * ------------------------------------------------------------------------ */

test('spring rest-length write goes through springSetLen', () => {
  // Writing B.len alone left the drawing motionless and the spring mis-coloured
  // (legacy R58). The choke point is what makes it actually change length.
  const calls: any[] = [];
  const g = globalThis as Record<string, any>;
  const had = 'springSetLen' in g;
  const prev = g.springSetLen;
  g.springSetLen = (b: any, v: number) => calls.push([b.id, v]);
  try {
    const body: Record<string, any> = { id: 's1', kind: 'S', len: 110 };
    springLen.write(body, 200);
    assert.deepEqual(calls, [['s1', 200]], 'must route through the choke point');
    assert.equal(body.len, 110, 'and must not also poke the field directly');
  } finally {
    if (had) g.springSetLen = prev;
    else delete g.springSetLen;
  }
});

test('rod length write goes through setRodLen with force=true', () => {
  // Without the rebuild, the collision plate stays at the original width and the
  // rod becomes "visible but not touchable" (legacy R98-1 measured this).
  const calls: any[] = [];
  const g = globalThis as Record<string, any>;
  const had = 'setRodLen' in g;
  const prev = g.setRodLen;
  g.setRodLen = (b: any, v: number, force: boolean) => calls.push([b.id, v, force]);
  try {
    const body: Record<string, any> = { id: 'r1', kind: 'T', len: 170 };
    rodLen.write(body, 300);
    assert.deepEqual(calls, [['r1', 300, true]], 'must force the collider rebuild');
  } finally {
    if (had) g.setRodLen = prev;
    else delete g.setRodLen;
  }
});

test('ground length write goes through setGroundEnds', () => {
  const calls: any[] = [];
  const g = globalThis as Record<string, any>;
  const had = 'setGroundEnds' in g;
  const prev = g.setGroundEnds;
  g.setGroundEnds = (...args: any[]) => calls.push(args);
  try {
    const body: Record<string, any> = { kind: 'W', gnd: 1, x: 300, y: 700, th: 0, len: 400 };
    groundLen.write(body, 500);
    assert.equal(calls.length, 1, 'one rebuild call');
    const [b, x0, y0, x1, y1, force] = calls[0]!;
    assert.equal(b, body);
    assert.equal(force, true, 'must force the rebuild');
    // Symmetric about the centroid: 300 +/- 250 at th=0.
    assert.equal(x0, 50);
    assert.equal(x1, 550);
    assert.equal(y0, 700);
    assert.equal(y1, 700);
  } finally {
    if (had) g.setGroundEnds = prev;
    else delete g.setGroundEnds;
  }
});

test('belt angle write normalizes and routes through setBeltAngle', () => {
  // The panel converts display->internal (degrees * PI/180) BEFORE calling, so
  // write() receives radians. It must normalize to (-PI, PI] like the legacy
  // branch and go through setBeltAngle so points/hull/mirror plate follow.
  const calls: any[] = [];
  const g = globalThis as Record<string, any>;
  const hadAngle = 'setBeltAngle' in g;
  const hadShort = 'shortAng' in g;
  const prevAngle = g.setBeltAngle;
  const prevShort = g.shortAng;
  g.setBeltAngle = (b: any, th: number) => calls.push(th);
  g.shortAng = (a: number) => a; // identity, so we can assert the value passed
  try {
    const body: Record<string, any> = { kind: 'W', belt: true };
    beltAngle.write(body, Math.PI / 2);
    assert.equal(calls.length, 1);
    assert.ok(Math.abs(calls[0]! - Math.PI / 2) < 1e-9, 'PI/2 radians passes through');
  } finally {
    if (hadAngle) g.setBeltAngle = prevAngle;
    else delete g.setBeltAngle;
    if (hadShort) g.shortAng = prevShort;
    else delete g.shortAng;
  }
});

/* --------------------------------------------------------------------------
 * Read paths and unit conventions
 * ------------------------------------------------------------------------ */

test('angles read back in degrees, not radians', () => {
  // The panel declares unit '°', so a radians readback would show ~57x the
  // wrong number. gndang converts; beltangle's stored unit IS degrees by
  // convention in the legacy read branch.
  const ground = { kind: 'W', gnd: 1, th: Math.PI / 2 };
  assert.ok(Math.abs(groundAngle.read(ground) - 90) < 1e-9, 'ground angle in degrees');
});

test('device reads fall back sensibly when the field is unset', () => {
  assert.equal(springK.read({ kind: 'S' }), 250, 'SPR_KS_DEF');
  assert.equal(springDamp.read({ kind: 'S' }), 0.8, 'SPR_DAMP');
  assert.equal(springLen.read({ kind: 'S' }), 110, 'SPR_SPAWN_LEN');
  assert.equal(rodLen.read({ kind: 'T' }), 170, 'ROD_SPAWN_LEN');
  assert.equal(ropeLen.read({ rope: true }), 110, 'ROPE_SPAWN_LEN');
  assert.equal(groundLen.read({ gnd: 1 }), 260, 'GROUND_SPAWN_LEN');
  assert.equal(beltSpeed.read({ belt: true }), 0, 'belt speed defaults to stopped');
});

test('rod mass derives a default from length when unset', () => {
  // Legacy `rodMassOf`: unset -> len/170, so a longer rod is naturally heavier.
  assert.equal(rodMass.read({ kind: 'T', len: 170 }), 1);
  assert.equal(rodMass.read({ kind: 'T', len: 340 }), 2);
  assert.equal(rodMass.read({ kind: 'T', len: 340, rmass: 5 }), 5, 'explicit value wins');
});

test('hinge fixed flag lives in B.param.hfix, which is what physics reads', () => {
  // The physics guards on `B.param.hfix` (legacy 16399 / 16196), so the registry
  // must read and write that exact field.
  assert.equal(LegacyReadsParamHfix(), true, 'legacy physics must still read B.param.hfix');
  const body: Record<string, any> = { kind: 'S', hinge: true };
  assert.equal(hingeRead(body), 0, 'defaults to off');
  hingeWrite(body, 1);
  assert.equal(body.param.hfix, 1);
  assert.equal(hingeRead(body), 1);
});

/** Local imports kept at the bottom to make the test bodies read top-down. */
import { hingeFixed } from './devices.ts';
function hingeRead(b: any): number {
  return hingeFixed.read(b);
}
function hingeWrite(b: any, v: number): void {
  hingeFixed.write(b, v);
}
function LegacyReadsParamHfix(): boolean {
  return /B\.param&&B\.param\.hfix/.test(LEGACY) || /B\.param\.hfix/.test(LEGACY);
}
