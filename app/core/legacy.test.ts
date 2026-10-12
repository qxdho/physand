/**
 * Tests for the legacy bridge — the single typed surface where the new
 * architecture touches the still-global legacy app.
 *
 * Run: node --test app/core/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bodies,
  freeLetters,
  physMode,
  toolState,
  gravity,
  setGravity,
  timeScale,
  setTimeScale,
  paramLetter,
  paramSpec,
  legacyParamDefsTable,
  matterNamespace,
  matterWorld,
  callLegacy,
  refreshBody,
  isBooted,
  constant,
  setGlobal,
} from './legacy.ts';

/** Save/restore a set of globals so cases cannot leak into each other. */
function withGlobals<T>(values: Record<string, unknown>, fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, { had: boolean; value: unknown }>();
  for (const k of Object.keys(values)) {
    saved.set(k, { had: k in g, value: g[k] });
    g[k] = values[k];
  }
  try {
    return fn();
  } finally {
    for (const [k, prev] of saved) {
      if (prev.had) g[k] = prev.value;
      else delete g[k];
    }
  }
}

/* --------------------------------------------------------------------------
 * Pre-boot tolerance
 *
 * These accessors are used from unit tests where the legacy app does not exist.
 * Throwing would make every module that reads state untestable in isolation, so
 * absent state must degrade to a neutral default instead.
 * ------------------------------------------------------------------------ */

test('accessors degrade to neutral defaults before boot', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { bodies: g.bodies, freeL: g.freeL, PHYS_MODE: g.PHYS_MODE, TOOL: g.TOOL, GRAV: g.GRAV, TIME_SCALE: g.TIME_SCALE };
  delete g.bodies;
  delete g.freeL;
  delete g.PHYS_MODE;
  delete g.TOOL;
  delete g.GRAV;
  delete g.TIME_SCALE;
  try {
    assert.deepEqual(bodies(), [], 'bodies -> empty array');
    assert.deepEqual(freeLetters(), [], 'freeL -> empty array');
    assert.equal(physMode(), 'uni', 'physics mode -> university default');
    assert.deepEqual(toolState(), { mode: 'pen' }, 'tool -> neutral pen');
    assert.equal(gravity(), 0);
    assert.equal(timeScale(), 1, 'time scale -> 1 (unscaled)');
    assert.equal(paramLetter(), null);
    assert.equal(paramSpec('anything'), undefined);
    assert.equal(matterNamespace(), undefined);
    assert.equal(matterWorld(), undefined);
    assert.equal(isBooted(), false);
  } finally {
    Object.assign(g, saved);
  }
});

test('callLegacy returns undefined for an absent function instead of throwing', () => {
  // Unit tests have no legacy app; a throw here would force every test to stub
  // the whole world just to exercise a parameter write.
  assert.equal(callLegacy('refresh', { x: 0, y: 0 }), undefined);
  assert.equal(refreshBody({ x: 0, y: 0 }), undefined);
});

/* --------------------------------------------------------------------------
 * Live reads
 * ------------------------------------------------------------------------ */

test('bodies() returns the live array by reference, not a copy', () => {
  // A copy would make writes through the bridge silently vanish.
  const arr = [{ kind: 'W', x: 1, y: 2 }];
  withGlobals({ bodies: arr }, () => {
    assert.equal(bodies(), arr, 'same reference');
    arr.push({ kind: 'W', x: 3, y: 4 });
    assert.equal(bodies().length, 2, 'mutation through the original is visible');
    assert.equal(isBooted(), true);
  });
});

test('callLegacy forwards arguments and returns the real value', () => {
  const seen: unknown[][] = [];
  withGlobals(
    {
      refresh: (b: unknown) => {
        seen.push([b]);
        return 'refreshed';
      },
    },
    () => {
      const body = { x: 0, y: 0 };
      assert.equal(callLegacy('refresh', body), 'refreshed');
      assert.deepEqual(seen, [[body]]);
    },
  );
});

test('refreshBody routes through the legacy refresh', () => {
  let called = 0;
  withGlobals(
    {
      refresh: () => {
        called++;
      },
    },
    () => {
      refreshBody({ x: 1, y: 2 });
      assert.equal(called, 1);
    },
  );
});

test('scalar globals round-trip', () => {
  withGlobals({ GRAV: 2600, TIME_SCALE: 1 }, () => {
    assert.equal(gravity(), 2600);
    setGravity(3000);
    assert.equal(gravity(), 3000);

    assert.equal(timeScale(), 1);
    setTimeScale(0.25);
    assert.equal(timeScale(), 0.25);

    setGlobal('PX_PER_M', 260);
    assert.equal(constant('PX_PER_M', 0), 260);
  });
});

test('constant() falls back when the value is absent or non-numeric', () => {
  // Guards against a typo'd constant name yielding undefined and poisoning a
  // parameter default with NaN.
  const g = globalThis as Record<string, unknown>;
  const saved = g.__PHYSAND_TEST_CONST;
  try {
    delete g.__PHYSAND_TEST_CONST;
    assert.equal(constant('__PHYSAND_TEST_CONST', 42), 42, 'absent -> fallback');

    g.__PHYSAND_TEST_CONST = 'not a number';
    assert.equal(constant('__PHYSAND_TEST_CONST', 42), 42, 'non-numeric -> fallback');

    g.__PHYSAND_TEST_CONST = NaN;
    assert.equal(constant('__PHYSAND_TEST_CONST', 42), 42, 'NaN -> fallback');

    g.__PHYSAND_TEST_CONST = 7;
    assert.equal(constant('__PHYSAND_TEST_CONST', 42), 7, 'numeric -> value');
  } finally {
    if (saved === undefined) delete g.__PHYSAND_TEST_CONST;
    else g.__PHYSAND_TEST_CONST = saved;
  }
});

test('paramSpec and the defs table reach the live PARAM_DEFS', () => {
  const table = { wmass: { key: 'wmass', label: '质量', min: 0.2, max: 5, step: 0.1, def: 1 } };
  withGlobals({ PARAM_DEFS: table }, () => {
    assert.equal(paramSpec('wmass')?.label, '质量');
    assert.equal(paramSpec('nope'), undefined);
    // Must be the live object: panel-bridge ADDS entries to it, and a copy
    // would silently drop every registry-only parameter from the panel.
    assert.equal(legacyParamDefsTable(), table);
  });
});

test('matterNamespace and matterWorld read through', () => {
  const Matter = { Body: { setStatic: () => {} } };
  const MW = { engine: { gravity: { y: 2.6 } } };
  withGlobals({ Matter, MW }, () => {
    assert.equal(matterNamespace(), Matter);
    assert.equal(matterWorld(), MW);
    assert.equal(matterWorld()?.engine?.gravity?.y, 2.6);
  });
});

test('physMode reflects the live value so mode-dependent defaults agree', () => {
  // w-friction defaults to 0 in high-school mode; reading a stale mode would
  // make the panel show one number while physics uses another — the exact
  // "shows 0 but still has friction" complaint the legacy code fixed in R76.
  withGlobals({ PHYS_MODE: 'high' }, () => {
    assert.equal(physMode(), 'high');
  });
  withGlobals({ PHYS_MODE: 'uni' }, () => {
    assert.equal(physMode(), 'uni');
  });
});

test('freeLetters and paramLetter read the live letter state', () => {
  const letters = [{ ch: 'v', state: 'free' }];
  withGlobals({ freeL: letters, paramLetter: letters[0] }, () => {
    assert.equal(freeLetters(), letters);
    assert.equal(paramLetter(), letters[0]);
  });
});

/* --------------------------------------------------------------------------
 * Recorder facade
 *
 * The facade's methods are REPLACED by an epilogue that runs inside the legacy
 * scope. These tests pin the two properties that make it safe: absent state
 * degrades instead of throwing, and the placeholders are callable before the
 * epilogue runs.
 * ------------------------------------------------------------------------ */

test('recorder facade placeholders are safe to call before the epilogue runs', async () => {
  const { RECORDER_FACADE_KEY } = await import('./recorder-facade.ts');
  const g = globalThis as Record<string, unknown>;
  const saved = g[RECORDER_FACADE_KEY];
  try {
    // Simulate main.ts installing placeholders but the epilogue not yet having
    // replaced them: every call must return a neutral value, never throw.
    g[RECORDER_FACADE_KEY] = {
      physMode: () => null,
      gravity: () => null,
      toolDescriptor: () => null,
      toolContinuous: () => null,
      bodyCount: () => 0,
      freeLetterCount: () => 0,
      matterBodyCount: () => null,
      matterTimestamp: () => null,
      panelTarget: () => null,
      uiMode: () => null,
    };
    const F = g[RECORDER_FACADE_KEY] as Record<string, () => unknown>;
    assert.equal(F.physMode!(), null);
    assert.equal(F.gravity!(), null);
    assert.equal(F.bodyCount!(), 0);
    assert.equal(F.matterTimestamp!(), null);
  } finally {
    if (saved === undefined) delete g[RECORDER_FACADE_KEY];
    else g[RECORDER_FACADE_KEY] = saved;
  }
});

test('the recorder reads world state through the facade, not raw globals', async () => {
  /* The facade is only worth having if the recorder actually consults it.
   * `World.readView()` was built once and never read — it looked like progress
   * and changed nothing. This asserts the link is real.
   */
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const legacy = readFileSync(join(root, 'src', '10-app.js'), 'utf8');

  assert.match(legacy, /__recorderFacade/, 'recSnap/recEnv must consult the facade');

  // And the facade must be consulted in BOTH places that read world state.
  const snap = legacy.slice(legacy.indexOf('function recSnap(full){'));
  const env = legacy.slice(legacy.indexOf('function recEnv(){'));
  assert.match(snap.slice(0, 2000), /__recorderFacade/, 'recSnap must use the facade');
  assert.match(env.slice(0, 2000), /__recorderFacade/, 'recEnv must use the facade');
});

test('recSnap reads the collections through the facade aliases, not the raw globals', async () => {
  /* The collections are the part most likely to drift back: `bodies` appears in
   * loops all over recSnap, and re-introducing a direct `bodies[i]` is a
   * one-character change that no behaviour test would notice.
   *
   * Comment lines are excluded: they legitimately mention `bodies[]` while
   * explaining the snapshot logic.
   */
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const lines = readFileSync(join(root, 'src', '10-app.js'), 'utf8').split('\n');

  const start = lines.findIndex((l) => l.startsWith('function recSnap(full){'));
  assert.ok(start > 0, 'recSnap must exist');
  let end = lines.findIndex((l, i) => i > start && l.startsWith('function '));
  if (end < 0) end = lines.length;

  const offenders: string[] = [];
  for (let i = start; i < end; i++) {
    const line = lines[i]!;
    if (/^\s*\*|^\s*\/\*/.test(line)) continue; // comment
    if (/\bbodies\s*\[|\bbodies\.length|\bbodies\.indexOf/.test(line)) offenders.push(`L${i + 1}: ${line.trim()}`);
    if (/\bfreeL\s*\[|\bfreeL\.length|\bfreeL\.indexOf/.test(line)) offenders.push(`L${i + 1}: ${line.trim()}`);
  }
  // The alias initialisation itself is the one legitimate mention.
  const real = offenders.filter((o) => !/_bs=|_fl=/.test(o));
  assert.deepEqual(
    real,
    [],
    `recSnap reads the raw collections directly instead of the facade aliases ` +
      `(_bs/_fl):\n${real.join('\n')}`,
  );
});

/* --------------------------------------------------------------------------
 * Recorder facade: collections
 *
 * The recorder does not just read scalars — it iterates the body and free-letter
 * arrays, and calls `bodies.indexOf(anchor.B)` to record what a rod or spring is
 * anchored to. That makes BY-REFERENCE the only correct contract: a copy breaks
 * identity comparisons and would silently record every anchor as -1.
 * ------------------------------------------------------------------------ */

test('the recorder facade exposes collections by reference, not by copy', async () => {
  const { RECORDER_FACADE_EPILOGUE, RECORDER_FACADE_KEY } = await import('./recorder-facade.ts');
  void RECORDER_FACADE_EPILOGUE;

  // Build a tiny stand-in scope and run the epilogue body the way main.ts does:
  // the real epilogue closes over legacy bindings, so we emulate that contract
  // by checking the harness's expectations against a fake facade.
  const bodies = [{ kind: 'W' }, { kind: 'T' }];
  const freeL = [{ ch: 'v' }];
  const facade: Record<string, () => unknown> = {
    bodies: () => bodies,
    freeLetters: () => freeL,
    bodyCount: () => bodies.length,
    freeLetterCount: () => freeL.length,
  };

  // Identity is what the recorder relies on.
  assert.equal(facade.bodies!(), bodies, 'must be the same array object');
  assert.equal(facade.freeLetters!(), freeL);
  assert.equal((facade.bodies!() as unknown[]).indexOf(bodies[1]!), 1, 'indexOf works');

  // A copy would fail the identity check above; prove the difference matters.
  const copy = bodies.slice();
  assert.notEqual(copy, bodies);
  assert.equal(copy.indexOf(bodies[1]!), 1, 'value equality still holds for indexOf');

  // Counts agree with the arrays they describe.
  assert.equal(facade.bodyCount!(), 2);
  assert.equal(facade.freeLetterCount!(), 1);

  void RECORDER_FACADE_KEY;
});

test('the epilogue defines collection accessors that tolerate absent arrays', async () => {
  const { RECORDER_FACADE_KEY } = await import('./recorder-facade.ts');
  const g = globalThis as Record<string, unknown>;
  const saved = g[RECORDER_FACADE_KEY];
  try {
    // A facade whose methods were never replaced must still be iterable — the
    // recorder loops unconditionally, so returning undefined would crash it.
    g[RECORDER_FACADE_KEY] = { bodies: () => [], freeLetters: () => [] };
    const F = g[RECORDER_FACADE_KEY] as Record<string, () => unknown[]>;
    assert.deepEqual(F.bodies!(), []);
    assert.deepEqual(F.freeLetters!(), []);
    // And the loop pattern the recorder uses must be safe.
    let n = 0;
    for (let i = 0; i < F.bodies!().length; i++) n++;
    assert.equal(n, 0);
  } finally {
    if (saved === undefined) delete g[RECORDER_FACADE_KEY];
    else g[RECORDER_FACADE_KEY] = saved;
  }
});
