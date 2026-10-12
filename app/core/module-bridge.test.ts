/**
 * Tests for the module bridge's publication semantics.
 *
 * THE BUG THESE LOCK IN
 * ---------------------
 * The legacy app is evaluated inside `new Function`, which gives it FUNCTION
 * scope. Its `var x` is therefore a local binding, not a global. The first
 * implementation copied each declaration onto `globalThis` once:
 *
 *     globalThis[name] = name;          // one-time snapshot
 *
 * That is subtly wrong in two different ways:
 *
 *   - objects/arrays keep working (the snapshot holds the same reference and the
 *     app mutates in place), so the mistake is invisible for `bodies`;
 *   - SCALARS go stale the moment the app reassigns them. Observed in the real
 *     app: `openParams()` set the internal `paramBody`, yet `window.paramBody`
 *     still read `null` — while the legacy single-file build correctly reported
 *     the new body. That silently breaks any consumer reading through the global
 *     surface, including the replay harness.
 *
 * The fix publishes accessors, so the global name stays bound to the live local.
 *
 * Run: node --test app/core/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAsClassicScript, assertGlobalsPresent } from './module-bridge.ts';
import { LEGACY_GLOBAL_NAMES } from './legacy-globals.generated.ts';

/** Remove any globals a test published, so cases cannot leak into each other. */
function cleanup(names: string[]): void {
  for (const n of names) {
    try {
      delete (globalThis as Record<string, unknown>)[n];
    } catch {
      /* non-configurable; nothing we can do */
    }
  }
}

test('published names reflect later reassignment (scalar case)', () => {
  const names = ['__t_scalar'];
  cleanup(names);
  try {
    evaluateAsClassicScript(
      `var __t_scalar = 1;\nfunction bump(){ __t_scalar = 2; }\nbump();`,
      names,
    );
    // The function ran inside the wrapper scope; the global must see the NEW value.
    assert.equal((globalThis as Record<string, unknown>).__t_scalar, 2);
  } finally {
    cleanup(names);
  }
});

test('published names stay live, not snapshotted', () => {
  const names = ['__t_live'];
  cleanup(names);
  try {
    // Expose a setter so we can mutate the internal binding after evaluation.
    evaluateAsClassicScript(
      `var __t_live = 'initial';\nfunction __t_setLive(v){ __t_live = v; }`,
      [...names, '__t_setLive'],
    );
    const g = globalThis as Record<string, unknown>;
    assert.equal(g.__t_live, 'initial');

    (g.__t_setLive as (v: string) => void)('changed');
    assert.equal(g.__t_live, 'changed', 'global must track the live binding');
  } finally {
    cleanup([...names, '__t_setLive']);
  }
});

test('objects stay identical by reference', () => {
  const names = ['__t_obj'];
  cleanup(names);
  try {
    evaluateAsClassicScript(`var __t_obj = { n: 0 };`, names);
    const g = globalThis as Record<string, unknown>;
    const obj = g.__t_obj as { n: number };
    assert.equal(obj.n, 0);
    obj.n = 5;
    assert.equal((g.__t_obj as { n: number }).n, 5, 'same reference, mutation visible');
  } finally {
    cleanup(names);
  }
});

test('assignment through the global writes back to the internal binding', () => {
  const names = ['__t_writeback'];
  cleanup(names);
  try {
    evaluateAsClassicScript(
      `var __t_writeback = 1;\nfunction __t_read(){ return __t_writeback; }`,
      [...names, '__t_read'],
    );
    const g = globalThis as Record<string, unknown>;
    g.__t_writeback = 42;
    assert.equal(
      (g.__t_read as () => number)(),
      42,
      'internal code must observe a write made through the global',
    );
  } finally {
    cleanup([...names, '__t_writeback', '__t_read']);
  }
});

test('the epilogue runs inside the same scope as the declarations', () => {
  const names = ['__t_target'];
  cleanup(names);
  try {
    // The epilogue must be able to SEE and REPLACE the local binding. This is
    // exactly how the parameter hook wraps the panel functions; patching
    // globalThis from outside provably does not reach internal callers.
    evaluateAsClassicScript(
      `var __t_target = function(){ return 'original'; };`,
      names,
      `__t_target = function(){ return 'wrapped'; };`,
    );
    const g = globalThis as Record<string, unknown>;
    assert.equal(
      (g.__t_target as () => string)(),
      'wrapped',
      'epilogue must run in scope and affect the published binding',
    );
  } finally {
    cleanup(names);
  }
});

test('assertGlobalsPresent reports every missing name at once', () => {
  cleanup(['__t_absent_a', '__t_absent_b']);
  assert.throws(
    () => assertGlobalsPresent(['__t_absent_a', '__t_absent_b']),
    /__t_absent_a, __t_absent_b/,
  );
});

test('a declaration list matching the real app is plausible in size', () => {
  // Guards against the generator silently producing a truncated list, which
  // would leave most of the app unpublished.
  assert.ok(
    LEGACY_GLOBAL_NAMES.length > 700,
    `expected 700+ legacy declarations, got ${LEGACY_GLOBAL_NAMES.length}`,
  );
  for (const required of ['bodies', 'stepPhysics', 'makeGround', 'paramDef', 'paramV', 'applyParam']) {
    assert.ok(
      (LEGACY_GLOBAL_NAMES as readonly string[]).includes(required),
      `legacy declaration list must include "${required}"`,
    );
  }
});
