/**
 * Tests for the device registry.
 *
 * The registry is only worth having if it stays TRUE to the legacy code it
 * describes. Two failure modes matter:
 *
 *   1. VALUE DRIFT — a spawn length or preview differs from what the app does,
 *      so the preview silently stops matching the result.
 *   2. CHAIN DRIFT — a device is handled in `placeDevice` but forgotten in
 *      `drawDeviceGhost` (or vice versa). This is the failure the registry
 *      exists to prevent, and it is invisible at runtime: a missing ghost branch
 *      draws nothing, which reads as a rendering glitch rather than a wiring
 *      mistake.
 *
 * Run: node --test app/devices/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEVICE_DEFINITIONS, deviceDefinition, deviceIds } from './registry.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEGACY = readFileSync(join(ROOT, 'src', '10-app.js'), 'utf8');

/** The ids and labels from the legacy DEVICES table, in order. */
function legacyTable(): { id: string; name: string; len: string }[] {
  const block = /var DEVICES=\[([\s\S]*?)\];/.exec(LEGACY);
  assert.ok(block, 'the legacy DEVICES table must exist');
  return [...block![1]!.matchAll(/id:'([a-z]+)',name:'([^']+)',len:([A-Z_0-9]+)/g)].map((m) => ({
    id: m[1]!,
    name: m[2]!,
    len: m[3]!,
  }));
}

/** The branch ids of a legacy if-chain, read from its source. */
function chainIds(fnName: string): string[] {
  const start = LEGACY.indexOf(`function ${fnName}(`);
  assert.ok(start > 0, `${fnName} must exist`);
  let end = LEGACY.indexOf('\nfunction ', start + 1);
  if (end < 0) end = LEGACY.length;
  const body = LEGACY.slice(start, end);
  return [...new Set([...body.matchAll(/\.id==='([a-z]+)'/g)].map((m) => m[1]!))];
}

/** Read a legacy numeric global. */
function legacyNumber(name: string): number | null {
  const m = new RegExp(`^var ${name}=([0-9.]+)`, 'm').exec(LEGACY);
  return m ? Number(m[1]) : null;
}

test('ids and labels match the legacy table exactly, in order', () => {
  // Order is the palette order; a mismatch reorders the UI.
  const legacy = legacyTable();
  assert.deepEqual(deviceIds(), legacy.map((d) => d.id));
  assert.deepEqual(DEVICE_DEFINITIONS.map((d) => d.name), legacy.map((d) => d.name));
});

test('spawn lengths match the legacy constants', () => {
  /* A test guards this because drift is silent: the preview would simply look
   * slightly wrong, and the parameter default would no longer match the spawn
   * size — the bug class that produced R102 and R125.
   */
  const legacy = legacyTable();
  for (const entry of legacy) {
    const def = deviceDefinition(entry.id);
    assert.ok(def, `${entry.id} must be in the registry`);
    if (entry.len === '0') {
      assert.equal(def!.spawnLen, 0, `${entry.id} is a point`);
    } else {
      const expected = legacyNumber(entry.len);
      assert.equal(def!.spawnLen, expected, `${entry.id}.spawnLen must equal ${entry.len}`);
    }
  }
});

test('placeDevice handles exactly the registered devices', () => {
  /* THE CHAIN-DRIFT CHECK. A device in the table but not in the spawn chain
   * cannot be placed; a branch for a device not in the table is dead code.
   */
  const handled = chainIds('placeDevice');
  assert.deepEqual(
    [...handled].sort(),
    [...deviceIds()].sort(),
    'placeDevice branches must cover exactly the registered devices',
  );
});

test('drawDeviceGhost covers every device that claims to have a preview', () => {
  /* THE OTHER HALF of the drift check: the code comments promise "ghost seen =
   * result obtained", which only holds while both chains cover the same set.
   *
   * One device legitimately has no preview: `ground`. That is a measured FACT,
   * not a test relaxation — rendering each ghost and measuring ink gives 0 for
   * ground and 184-5200 for every other device. It is marked \`hasGhost: false\`
   * in the registry so the gap is recorded, and this test fails if the flag and
   * the code ever disagree in either direction.
   */
  const handled = chainIds('drawDeviceGhost');
  const missing = deviceIds().filter((id) => !handled.includes(id));
  const expectedMissing = DEVICE_DEFINITIONS.filter((d) => d.hasGhost === false).map((d) => d.id);
  assert.deepEqual(
    missing.sort(),
    expectedMissing.sort(),
    'a device with no ghost must be declared hasGhost:false, and vice versa',
  );
  const extra = handled.filter((id) => !deviceIds().includes(id));
  assert.deepEqual(extra, [], `ghost branches for unregistered devices: ${extra.join(', ')}`);
});

test('the rope preview carries slack so it does not draw as a straight line', () => {
  /* R104-2: without a sag value the rope ghost is a straight line, which reads
   * as a rod. The slack is a property of the rope's preview specifically.
   */
  const rope = deviceDefinition('rope');
  assert.ok(rope!.ghostSlack && rope!.ghostSlack > 0, 'rope ghost needs slack');

  const rod = deviceDefinition('rod');
  assert.equal(rod!.ghostSlack, undefined, 'a rod is straight');
});

test('the legacy ghost uses the registered slack value for ropes', () => {
  // The number must not drift from the registry's.
  const start = LEGACY.indexOf('function drawDeviceGhost(');
  let end = LEGACY.indexOf('\nfunction ', start + 1);
  if (end < 0) end = LEGACY.length;
  const body = LEGACY.slice(start, end);
  // Match the trailing slack argument of the drawRope call, allowing the
  // nested braces of the stub object it is passed.
  const m = /drawRope\(\{[\s\S]*?\},\s*([A-Z_0-9]+)\s*\)/.exec(body);
  assert.ok(m, 'the rope ghost passes a slack constant');
  assert.equal(legacyNumber(m![1]!), deviceDefinition('rope')!.ghostSlack);
});

test('every device has a preview renderer named', () => {
  // The `preview` field is what makes "ghost = result" checkable per device.
  for (const d of DEVICE_DEFINITIONS) {
    assert.ok(d.preview, `${d.id} must name its preview renderer`);
  }
});

test('deviceDefinition returns null for unknown ids', () => {
  assert.equal(deviceDefinition('nope'), null);
  assert.equal(deviceDefinition(''), null);
});
