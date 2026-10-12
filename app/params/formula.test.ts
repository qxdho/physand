/**
 * Cross-checks the formula / field parameter definitions against the legacy table,
 * and pins the two behaviours that differ from a plain per-body value.
 *
 * Run: node --test app/params/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  massM_lower,
  massM_upper,
  gravity,
  acceleration,
  elasticity,
  friction,
  magneticField,
  electricField,
  currentStrength,
} from './formula.ts';
import { params } from '../core/param-registry.ts';

/* Import EVERY parameter module so this file's registry is the full set. The
 * completeness test below compares against the legacy table, and a module that
 * is not imported would look "missing" — which would be a false alarm rather
 * than a real gap. (Node gives each test file its own module graph.) */
import './w-body.ts';
import './devices.ts';
import './grants.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEGACY = readFileSync(join(ROOT, 'src', '10-app.js'), 'utf8');

function legacyEntry(id: string): Record<string, number> {
  const re = new RegExp(`^\\s*${id}:\\{([^}]*)\\},?\\s*$`, 'm');
  const m = LEGACY.match(re);
  assert.ok(m, `legacy PARAM_DEFS entry "${id}" not found — renamed or removed?`);
  const body = m[1]!;
  const out: Record<string, number> = {};
  for (const field of ['min', 'max', 'step']) {
    const fm = body.match(new RegExp(`\\b${field}:([^,}]+)`));
    if (!fm) continue;
    const num = Number(fm[1]!.trim());
    out[field] = Number.isFinite(num) ? num : NaN;
  }
  return out;
}

function assertRange(id: string, spec: { min: number; max: number; step: number }): void {
  const l = legacyEntry(id);
  assert.equal(spec.min, l.min, `${id}.min`);
  assert.equal(spec.max, l.max, `${id}.max`);
  assert.equal(spec.step, l.step, `${id}.step`);
}

test('mass / acceleration / elasticity / friction ranges mirror the legacy table', () => {
  assertRange('mass', massM_lower);
  assertRange('massM', massM_upper);
  assertRange('acc', acceleration);
  assertRange('bounc', elasticity);
  assertRange('frict', friction);
});

test('field source ranges mirror the legacy table', () => {
  assertRange('bz', magneticField);
  assertRange('eacc', electricField);
  assertRange('iacc', currentStrength);
});

test('lowercase m and capital M are DIFFERENT quantities', () => {
  // Same label shape, different storage: `mass` writes B.mass, `massM` writes
  // B.massCap. Conflating them would make one control silently overwrite the other.
  assert.notEqual(massM_lower.id, massM_upper.id);

  const lower: Record<string, any> = {};
  massM_lower.write(lower, 2);
  assert.equal(lower.mass, 2);
  assert.equal(lower.massCap, undefined, 'lowercase m must not touch the cap');

  const upper: Record<string, any> = {};
  massM_upper.write(upper, 7);
  assert.equal(upper.massCap, 7);
  assert.equal(upper.mass, undefined, 'capital M must not touch B.mass');
});

test('mass glyph type selects which mass control is offered', () => {
  const lowerBody = { massG: { type: 'm' } };
  const upperBody = { massG: { type: 'M' } };
  assert.equal(massM_lower.scope.when!(lowerBody), true);
  assert.equal(massM_lower.scope.when!(upperBody), false);
  assert.equal(massM_upper.scope.when!(upperBody), true);
  assert.equal(massM_upper.scope.when!(lowerBody), false);
  // A body with no mass glyph gets neither.
  assert.equal(massM_lower.scope.when!({}), false);
  assert.equal(massM_upper.scope.when!({}), false);
});

test('gravity is GLOBAL: it writes GRAV and Matter, not the body', () => {
  // Legacy R71-13: right-clicking `g` changes the world's gravity so everything
  // visibly falls harder. Writing B.grav instead would be a private override.
  const calls: string[] = [];
  const g = globalThis as Record<string, any>;
  const hadGrav = 'GRAV' in g;
  const hadMW = 'MW' in g;
  const prevGrav = g.GRAV;
  const prevMW = g.MW;
  g.GRAV = 2600;
  g.MW = { engine: { gravity: { y: 2.6 } } };
  try {
    const body: Record<string, any> = { hasG: true };
    gravity.write(body, 3000);

    assert.equal(g.GRAV, 3000, 'global gravity updated');
    assert.equal(g.MW.engine.gravity.y, 3, 'Matter gravity synced (GRAV/1000)');
    assert.equal(body.grav, undefined, 'must NOT write a private per-body override');

    // Reading is global too, regardless of which body is asking.
    assert.equal(gravity.read({}), 3000);
    assert.equal(gravity.read(null), 3000);
  } finally {
    if (hadGrav) g.GRAV = prevGrav;
    else delete g.GRAV;
    if (hadMW) g.MW = prevMW;
    else delete g.MW;
    void calls;
  }
});

test('gravity clamps to a non-negative guard rather than allowing negatives', () => {
  // The legacy clamp is a NaN/negativity guard, not a physical limit (g has no
  // upper bound in this sandbox).
  const g = globalThis as Record<string, any>;
  const hadGrav = 'GRAV' in g;
  const hadMW = 'MW' in g;
  const prevGrav = g.GRAV;
  const prevMW = g.MW;
  g.MW = null;
  try {
    gravity.write({}, -500);
    assert.equal(g.GRAV, 0, 'negative gravity clamps to 0');
    gravity.write({}, 5e9);
    assert.equal(g.GRAV, 1e7, 'upper guard holds');
  } finally {
    if (hadGrav) g.GRAV = prevGrav;
    else delete g.GRAV;
    if (hadMW) g.MW = prevMW;
    else delete g.MW;
  }
});

test('elasticity is bounded to [0,1] but friction is not', () => {
  // Restitution has a genuine physical range; mu > 1 is real (rubber on glass).
  const b: Record<string, any> = {};
  elasticity.write(b, 5);
  assert.equal(b.bounc, 1);
  elasticity.write(b, -2);
  assert.equal(b.bounc, 0);

  friction.write(b, 1.8);
  assert.equal(b.frict, 1.8, 'mu above 1 must be preserved');
});

test('field sources expose exactly their own kind', () => {
  const matches = (spec: any, kind: string) =>
    !spec.scope.kinds || spec.scope.kinds.includes(kind);
  assert.equal(matches(magneticField, 'B'), true);
  assert.equal(matches(magneticField, 'E'), false);
  assert.equal(matches(electricField, 'E'), true);
  assert.equal(matches(electricField, 'B'), false);
  assert.equal(matches(currentStrength, 'I'), true);
  assert.equal(matches(currentStrength, 'B'), false);
});

test('field strength round-trips through its own storage field', () => {
  const b: Record<string, any> = { kind: 'B', Bz: 1 };
  magneticField.write(b, -2);
  assert.equal(b.Bz, -2);
  assert.equal(magneticField.read(b), -2);

  const e: Record<string, any> = { kind: 'E', eacc: 1 };
  electricField.write(e, 2.5);
  assert.equal(e.eacc, 2.5);

  const i: Record<string, any> = { kind: 'I', iacc: 1 };
  currentStrength.write(i, -1.5);
  assert.equal(i.iacc, -1.5);
});

test('the registry covers every parameter the legacy table defined', () => {
  // Guards against a parameter being silently dropped during the migration: the
  // panel would simply stop offering it, with no error anywhere.
  const registered = new Set<string>(params.all().map((s) => s.id));

  const block = LEGACY.slice(LEGACY.indexOf('var PARAM_DEFS'), LEGACY.indexOf('// ★R104-7'));
  const legacyIds = [...block.matchAll(/^\s*([a-zA-Z]+):\{key:'/gm)].map((m) => m[1]!);

  const missing = legacyIds.filter((id) => !registered.has(id));
  assert.deepEqual(
    missing,
    [],
    `these legacy parameters have no registry declaration: ${missing.join(', ')}`,
  );
});
