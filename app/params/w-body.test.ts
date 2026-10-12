/**
 * Consumers of the parameter registry must not silently drift from the legacy
 * definitions they replace.
 *
 * The migration keeps `src/10-app.js` as the running implementation while the
 * registry is built up beside it. If someone edits a range or default in the
 * legacy PARAM_DEFS and not here (or vice versa), the panel would disagree with
 * the engine — exactly the "I changed it and nothing happened" class of bug this
 * whole refactor is meant to eliminate.
 *
 * So we assert the mirrored numbers against the real source file. This is a
 * deliberate cross-check between two representations of the same truth, and it
 * gets deleted in phase C when the legacy table is removed.
 *
 * Run: node --test app/params/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  W_DEFAULTS,
  W_RANGES,
  wScale,
  wCharge,
  wWidth,
  wHeight,
  wFixed,
} from './w-body.ts';
import { params } from '../core/param-registry.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEGACY = readFileSync(join(ROOT, 'src', '10-app.js'), 'utf8');

/**
 * Pull a legacy PARAM_DEFS entry's numeric fields.
 *
 * The legacy table is a plain object literal; entries look like
 *   wmass:{key:'wmass',label:'质量 mass',min:0.2,max:5,step:0.1,unit:'kg',siK:1,def:1},
 * We parse the specific numeric fields rather than eval-ing the file, so the
 * test cannot execute legacy code.
 */
function legacyEntry(id: string): Record<string, number> {
  const re = new RegExp(`^\\s*${id}:\\{([^}]*)\\},?\\s*$`, 'm');
  const m = LEGACY.match(re);
  assert.ok(m, `legacy PARAM_DEFS entry "${id}" not found — was it renamed?`);
  const body = m![1]!;
  const out: Record<string, number> = {};
  for (const field of ['min', 'max', 'step', 'def', 'siK']) {
    const fm = body.match(new RegExp(`\\b${field}:([^,}]+)`));
    if (!fm) continue;
    const raw = fm[1]!.trim();
    // `def` sometimes references a constant (e.g. WFRICT_DEF); record NaN and
    // let the caller decide whether that is acceptable.
    const num = Number(raw);
    out[field] = Number.isFinite(num) ? num : NaN;
  }
  return out;
}

test('wmass mirrors the legacy range and default', () => {
  const l = legacyEntry('wmass');
  assert.equal(wMassSpec().min, l.min);
  assert.equal(wMassSpec().max, l.max);
  assert.equal(wMassSpec().step, l.step);
  assert.equal(wMassSpec().def, l.def);
});

test('wfrict mirrors the legacy range', () => {
  const l = legacyEntry('wfrict');
  assert.equal(W_RANGES.friction.min, l.min);
  assert.equal(W_RANGES.friction.max, l.max);
  assert.equal(W_RANGES.friction.step, l.step);
  // legacy def is the constant WFRICT_DEF, so only assert the numeric default
  // we chose matches what that constant resolves to at runtime elsewhere.
  assert.ok(Number.isNaN(l.def), 'expected a symbolic default in the legacy table');
});

test('wbounc mirrors the legacy range and default', () => {
  const l = legacyEntry('wbounc');
  assert.equal(W_RANGES.bounce.min, l.min);
  assert.equal(W_RANGES.bounce.max, l.max);
  assert.equal(W_RANGES.bounce.step, l.step);
  assert.equal(W_DEFAULTS.bounce, l.def);
});

test('wair mirrors the legacy range and default', () => {
  const l = legacyEntry('wair');
  assert.equal(W_RANGES.air.min, l.min);
  assert.equal(W_RANGES.air.max, l.max);
  assert.equal(W_RANGES.air.step, l.step);
  assert.equal(W_DEFAULTS.air, l.def);
});

test('scale mirrors the legacy range and default', () => {
  const l = legacyEntry('scale');
  assert.equal(W_RANGES.scale.min, l.min);
  assert.equal(W_RANGES.scale.max, l.max);
  assert.equal(W_RANGES.scale.step, l.step);
  assert.equal(W_DEFAULTS.scale, l.def);
});

test('wcharge mirrors the legacy range and default', () => {
  const l = legacyEntry('wcharge');
  assert.equal(W_RANGES.charge.min, l.min);
  assert.equal(W_RANGES.charge.max, l.max);
  assert.equal(W_RANGES.charge.step, l.step);
  assert.equal(W_DEFAULTS.charge, l.def);
});

test('SIZE is offered without requiring an `r` glyph — the reported bug', () => {
  // The legacy gate (src/10-app.js:8800) only pushed 'scale' when a body carried
  // an `r` glyph:
  //     else if(t==='r'&&ids.indexOf('scale')<0)ids.push('scale');
  // A freshly drawn shape has no glyphs, so the size row never appeared.
  // Our scope must therefore NOT mention glyphs at all.
  const scoped = (b: Record<string, any>) => {
    const s = wScale.scope;
    if (s.kinds && !s.kinds.includes(b.kind)) return false;
    if (s.when && !s.when(b)) return false;
    return true;
  };

  // A plain drawn shape with no memory/glyphs must get the size knob.
  assert.equal(scoped({ kind: 'W' }), true, 'plain drawn shape must be resizable');

  // ...and the legacy gate really did require `r`, proving the fix is meaningful.
  assert.match(
    LEGACY,
    /t==='r'&&ids\.indexOf\('scale'\)<0/,
    'legacy scale gate should still be present until phase C removes it',
  );
});

test('size is not offered for devices that have their own knobs', () => {
  for (const b of [{ kind: 'W', gnd: 1 }, { kind: 'W', belt: true }, { kind: 'W', isWell: true }]) {
    assert.equal(wScale.scope.when!(b), false, `${JSON.stringify(b)} should not expose size`);
  }
});

test('charge only appears once the body actually has one', () => {
  assert.equal(wCharge.scope.when!({ kind: 'W' }), false, 'no charge -> hidden');
  assert.equal(wCharge.scope.when!({ kind: 'W', charge: 2 }), true, 'charged -> shown');
});

test('write path calls refresh() so geometry and collider are rebuilt', () => {
  // Not calling refresh was the subtle trap: B.scaleParam alone changes nothing
  // visible, because refresh() is what re-lays out hw/hh and rebuilds the hull.
  const calls: string[] = [];
  const g = globalThis as Record<string, any>;
  const had = 'refresh' in g;
  const prev = g.refresh;
  g.refresh = (b: any) => calls.push(b.id);
  try {
    const body: Record<string, any> = { id: 'b1', kind: 'W' };
    wScale.write(body, 2);
    assert.equal(body.scaleParam, 2);
    assert.deepEqual(calls, ['b1'], 'refresh must be invoked exactly once');
  } finally {
    if (had) g.refresh = prev;
    else delete g.refresh;
  }
});

test('write path clamps a non-positive size back to the default', () => {
  const body: Record<string, any> = { kind: 'W' };
  wScale.write(body, 0);
  assert.equal(body.scaleParam, W_DEFAULTS.scale);
});

/** Look the mass spec up from the registry, so the assertion tracks the real object. */
function wMassSpec() {
  return params.get('wmass');
}

/* --------------------------------------------------------------------------
 * WIDTH / HEIGHT — the "parameters aren't rich enough" complaint
 * ------------------------------------------------------------------------ */

test('width and height are separate parameters, not one uniform scale', () => {
  // Uniform `scale` alone cannot turn a square into a plank. These two must be
  // independently addressable and must write DIFFERENT body fields.
  assert.notEqual(wWidth.id, wHeight.id);
  assert.notEqual(wWidth.id, wScale.id);

  const body: Record<string, any> = { kind: 'W' };
  wWidth.write(body, 2);
  assert.equal(body.wScaleX, 2, 'width writes wScaleX');
  assert.equal(body.wScaleY, undefined, 'and must not touch the height factor');

  wHeight.write(body, 1.5);
  assert.equal(body.wScaleY, 1.5, 'height writes wScaleY');
  assert.equal(body.wScaleX, 2, 'and must not disturb the width factor');
});

test('axis factors default to 1 so a fresh body is untouched', () => {
  assert.equal(wWidth.def, 1);
  assert.equal(wHeight.def, 1);
  assert.equal(wWidth.read({ kind: 'W' }), 1);
  assert.equal(wHeight.read({ kind: 'W' }), 1);
});

test('a non-positive axis factor falls back to 1 rather than collapsing the shape', () => {
  const body: Record<string, any> = { kind: 'W' };
  wWidth.write(body, 0);
  assert.equal(body.wScaleX, 1);
  wHeight.write(body, -3);
  assert.equal(body.wScaleY, 1);
});

test('width/height are NOT offered for circles or arcs', () => {
  // The collider and the renderer draw circles from `rad`, so a non-uniform
  // stretch would make the visible shape and the collidable shape disagree.
  // Showing a control that silently lies about geometry is worse than hiding it.
  const circle = { kind: 'W', wshape: 'circle', rad: 30 };
  assert.equal(wWidth.scope.when!(circle), false, 'circle must not expose width');
  assert.equal(wHeight.scope.when!(circle), false, 'circle must not expose height');

  const arc = { kind: 'W', ell: { a0: 0, a1: 1 } };
  assert.equal(wWidth.scope.when!(arc), false, 'arc must not expose width');

  // A plain polygon still does.
  assert.equal(wWidth.scope.when!({ kind: 'W', wshape: 'poly' }), true);
});

test('width/height write path calls refresh() to rebuild the collider', () => {
  const calls: string[] = [];
  const g = globalThis as Record<string, any>;
  const had = 'refresh' in g;
  const prev = g.refresh;
  g.refresh = (b: any) => calls.push(b.id);
  try {
    const body: Record<string, any> = { id: 'w1', kind: 'W' };
    wWidth.write(body, 2);
    wHeight.write(body, 1.5);
    assert.deepEqual(calls, ['w1', 'w1'], 'both axes must rebuild geometry');
  } finally {
    if (had) g.refresh = prev;
    else delete g.refresh;
  }
});

/* --------------------------------------------------------------------------
 * FIXED — an existing capability that was only reachable from the menu
 * ------------------------------------------------------------------------ */

test('fixed reads the body flag and defaults to off', () => {
  assert.equal(wFixed.def, 0);
  assert.equal(wFixed.read({ kind: 'W' }), 0);
  assert.equal(wFixed.read({ kind: 'W', fixed: true }), 1);
});

test('fixed write sets the flag, mirrors Matter.setStatic and wakes the body', () => {
  const calls: string[] = [];
  const g = globalThis as Record<string, any>;
  const hadMatter = 'Matter' in g;
  const prevMatter = g.Matter;
  g.Matter = {
    Body: {
      setStatic: (_mb: unknown, on: boolean) => calls.push(`static:${on}`),
    },
    Sleeping: {
      set: (_mb: unknown, awake: boolean) => calls.push(`sleep:${awake}`),
    },
  };
  try {
    const mb = { isStatic: false };
    const body: Record<string, any> = { kind: 'W', mb };

    wFixed.write(body, 1);
    assert.equal(body.fixed, true);
    // Mirroring the legacy menu toggle exactly: setStatic AND wake, because a
    // sleeping body that becomes static would otherwise stay stuck.
    assert.deepEqual(calls, ['static:true', 'sleep:false']);

    calls.length = 0;
    wFixed.write(body, 0);
    assert.equal(body.fixed, false);
    assert.deepEqual(calls, ['static:false', 'sleep:false']);
  } finally {
    if (hadMatter) g.Matter = prevMatter;
    else delete g.Matter;
  }
});

test('fixed is hidden for devices that are already immovable', () => {
  assert.equal(wFixed.scope.when!({ kind: 'W', belt: true }), false, 'belt is already fixed');
  assert.equal(wFixed.scope.when!({ kind: 'W', gnd: 1 }), false, 'ground is already fixed');
  assert.equal(wFixed.scope.when!({ kind: 'W' }), true);
});

test('the W parameter set exposes the new knobs and stays a superset of the old', () => {
  const ids = params.forBody({ kind: 'W', wshape: 'poly' }).map((s) => s.id);
  for (const required of ['wmass', 'wfrict', 'wbounc', 'wair', 'scale']) {
    assert.ok(ids.includes(required), `must still offer ${required}`);
  }
  for (const added of ['wscaleX', 'wscaleY', 'wfixed']) {
    assert.ok(ids.includes(added), `must now offer ${added}`);
  }
});
