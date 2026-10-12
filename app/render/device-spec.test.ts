/**
 * Tests for the device spec table.
 *
 * The risk this guards is VALUE DRIFT: the numbers here are duplicated from the
 * legacy declarations, and a mismatch would silently change how devices are
 * sized or drawn. Since the legacy file is the source of truth until it is
 * retired, the table is checked against it directly.
 *
 * Run: node --test app/render/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BOUNDARY_INK, DEVICE_SPECS, beltSpec, deviceSpec, groundSpec } from './device-spec.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEGACY = readFileSync(join(ROOT, 'src', '10-app.js'), 'utf8');

/** Read a numeric legacy global declaration, e.g. `var GROUND_TH=18;`. */
function legacyNumber(name: string): number | null {
  const m = new RegExp(`^var ${name}=([0-9.]+)`, 'm').exec(LEGACY);
  return m ? Number(m[1]) : null;
}

test('spawn lengths match the legacy globals exactly', () => {
  // These are the numbers the parameter table's `def` references. The legacy
  // comments record two bugs caused by them drifting apart from their parameter
  // defaults (R102 for CONV_DEF, R125 for GROUND_SPAWN_LEN), so the comparison
  // is worth pinning rather than trusting.
  const expected: [string, string][] = [
    ['spring', 'SPR_SPAWN_LEN'],
    ['rod', 'ROD_SPAWN_LEN'],
    ['belt', 'BELT_SPAWN_LEN'],
    ['ground', 'GROUND_SPAWN_LEN'],
    ['rope', 'ROPE_SPAWN_LEN'],
  ];
  for (const [id, legacyName] of expected) {
    const spec = deviceSpec(id);
    assert.ok(spec, `${id} must exist in the table`);
    assert.equal(
      spec!.spawnLen,
      legacyNumber(legacyName),
      `${id}.spawnLen must equal ${legacyName}`,
    );
  }
});

test('thickness and hatch spacing match the legacy globals', () => {
  assert.equal(groundSpec().thickness, legacyNumber('GROUND_TH'));
  assert.equal(groundSpec().hatchStep, legacyNumber('GROUND_HATCH_STEP'));
  assert.equal(beltSpec().thickness, legacyNumber('BELT_TH'));
  assert.equal(beltSpec().hatchStep, legacyNumber('BELT_DECO_STEP'));
  assert.equal(BOUNDARY_INK, legacyNumber('BND_HH'));
});

test('the table covers exactly the legacy DEVICES ids, in order', () => {
  /* Order is the palette order, and the ids are referenced by the device
   * factory and the spawn path. A missing or renamed id would break device
   * placement in a way no renderer test would catch.
   */
  const block = /var DEVICES=\[([\s\S]*?)\];/.exec(LEGACY);
  assert.ok(block, 'legacy DEVICES table must exist');
  const legacyIds = [...block![1]!.matchAll(/id:'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    DEVICE_SPECS.map((d) => d.id),
    legacyIds,
    'ids and order must match the legacy palette',
  );
});

test('device names match the legacy palette labels', () => {
  const block = /var DEVICES=\[([\s\S]*?)\];/.exec(LEGACY)!;
  const legacyNames = [...block[1]!.matchAll(/name:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(DEVICE_SPECS.map((d) => d.name), legacyNames);
});

test('a hinge has no length', () => {
  // It is a point, not a segment; the palette renders no length for it and the
  // factory does not size one.
  assert.equal(deviceSpec('hinge')!.spawnLen, 0);
});

test('deviceSpec returns null for an unknown id', () => {
  assert.equal(deviceSpec('nope'), null);
  assert.equal(deviceSpec(''), null);
});

test('spawn lengths are positive for devices that have a size', () => {
  for (const d of DEVICE_SPECS) {
    if (d.id === 'hinge') continue;
    assert.ok(d.spawnLen > 0, `${d.id} must have a positive spawn length`);
  }
});
