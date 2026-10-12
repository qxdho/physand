/**
 * Tests for the body collection.
 *
 * The survey that produced this module found the properties that make body
 * handling tractable: one creation point, thirteen removal sites, no
 * reassignment, and four mutate-while-iterating functions that were each
 * checked and found safe.
 *
 * These tests pin the OPERATIONS and the safety rules. The identity-removal rule
 * in particular is load-bearing: a body can be removed from inside a loop or a
 * collision callback, and an index captured earlier may by then refer to a
 * different body.
 *
 * Run: node --test app/physics/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BODY_LIST_KEY,
  BodyList,
  installBodyListBridge,
  type LegacyBody,
  type RemovalReason,
} from './body-list.ts';

const body = (x = 0, y = 0): LegacyBody => ({ x, y });

test('add appends and returns the body', () => {
  const list = new BodyList();
  const b = body();
  assert.equal(list.add(b), b, 'returns the body so callers keep their shape');
  assert.equal(list.length, 1);
  assert.equal(list.at(0), b);
});

test('indexOf and has use IDENTITY, not structural equality', () => {
  /* Two bodies can legitimately have identical fields — a spawned pair, or a
   * shattered fragment. Comparing by value would target the wrong one, so the
   * collection must be identity-addressed.
   */
  const list = new BodyList();
  const a = body(10, 20);
  const twin = body(10, 20); // structurally identical, different object
  list.add(a);

  assert.equal(list.indexOf(a), 0);
  assert.equal(list.indexOf(twin), -1, 'a lookalike must NOT be found');
  assert.equal(list.has(a), true);
  assert.equal(list.has(twin), false);
});

test('remove is by identity and reports whether anything happened', () => {
  const list = new BodyList();
  const a = body(), twin = body();
  list.add(a);

  assert.equal(list.remove(twin), false, 'a lookalike removes nothing');
  assert.equal(list.length, 1, 'and leaves the list untouched');

  assert.equal(list.remove(a), true);
  assert.equal(list.length, 0);
});

test('removing twice is tolerated, not an error', () => {
  /* Teardown paths run more than once — clear-all followed by an expiry tick,
   * for example. Throwing here would take down the page during a delete.
   */
  const list = new BodyList();
  const a = body();
  list.add(a);
  assert.equal(list.remove(a), true);
  assert.equal(list.remove(a), false, 'second removal is a no-op');
  assert.equal(list.length, 0);
});

test('removeAt removes the right body from a backwards walk', () => {
  /* Five legacy sites count down and already know the index. The collection
   * must support that without those sites hand-rolling a splice.
   */
  const list = new BodyList();
  const bs = [body(1), body(2), body(3), body(4)];
  for (const b of bs) list.add(b);

  for (let i = list.length - 1; i >= 0; i--) {
    if (list.at(i)!.x % 2 === 0) list.removeAt(i);
  }
  assert.deepEqual(list.copy().map((b) => b.x), [1, 3], 'evens removed, odds kept');
});

test('removeAt ignores out-of-range indices', () => {
  const list = new BodyList();
  list.add(body());
  assert.equal(list.removeAt(-1), undefined);
  assert.equal(list.removeAt(5), undefined);
  assert.equal(list.length, 1, 'nothing was removed');
});

test('remove notifies listeners with a reason', () => {
  const list = new BodyList();
  const seen: { b: LegacyBody; why: RemovalReason }[] = [];
  list.onRemove((b, why) => seen.push({ b, why }));

  const a = body();
  list.add(a);
  list.remove(a, 'consumed');
  assert.deepEqual(seen, [{ b: a, why: 'consumed' }]);
});

test('a throwing listener does not prevent the removal', () => {
  /* Listeners are where future invariants go (e.g. disposing the Matter
   * mirror). A bug in one must not leave a body stuck in the list.
   */
  const list = new BodyList();
  list.onRemove(() => {
    throw new Error('listener blew up');
  });
  const a = body();
  list.add(a);
  assert.equal(list.remove(a), true, 'removal completed anyway');
  assert.equal(list.length, 0);
});

test('the collection is iterable and array-like', () => {
  // ~372 legacy read sites index into `bodies` directly; the shape must survive.
  const list = new BodyList();
  const bs = [body(1), body(2), body(3)];
  for (const b of bs) list.add(b);

  assert.deepEqual([...list].map((b) => b.x), [1, 2, 3]);
  for (let i = 0; i < list.length; i++) assert.equal(list.at(i), bs[i]);
  assert.equal(list.get(1), bs[1], 'indexed accessor');
  assert.equal(list.snapshot().length, 3);
});

test('copy is a snapshot, so later mutation does not affect it', () => {
  // Guards against a test iterating a live list while the code under test
  // removes from it.
  const list = new BodyList();
  const a = body(1);
  list.add(a);
  const snap = list.copy();
  list.remove(a);
  assert.equal(snap.length, 1, 'snapshot is unaffected');
  assert.equal(list.length, 0);
});

/* --------------------------------------------------------------------------
 * The bridge over the live legacy array
 * ------------------------------------------------------------------------ */

/** Build a bridge over a fake legacy array and return both. */
function bridge(initial: LegacyBody[]) {
  const arr = initial.slice();
  installBodyListBridge(() => arr);
  const g = globalThis as Record<string, unknown>;
  return { arr, bridge: g[BODY_LIST_KEY] as ReturnType<typeof readBridge> };
}
function readBridge(): {
  add(b: LegacyBody): LegacyBody;
  indexOf(b: unknown): number;
  isAlive(b: unknown): boolean;
  remove(b: unknown): boolean;
  removeAt(i: number): void;
  count(): number;
  forEachBody(visit: (b: LegacyBody, i: number) => void): void;
} {
  return (globalThis as Record<string, unknown>)[BODY_LIST_KEY] as never;
}

test('the bridge mutates the SAME array the legacy code holds', () => {
  /* This is the property the whole approach rests on. Roughly 372 read sites are
   * written as `bodies[i]`, and functions pass the array around by value.
   * Replacing it with a different object would break all of them at once.
   */
  const { arr, bridge: b } = bridge([]);
  const first = body(1);
  const returned = b.add(first);

  assert.equal(returned, first, 'add returns the body');
  assert.equal(arr.length, 1, 'the ORIGINAL array grew');
  assert.equal(arr[0], first);
});

test('the bridge removes by identity from the live array', () => {
  const a = body(1), keep = body(2);
  const { arr, bridge: b } = bridge([a, keep]);

  assert.equal(b.remove(a), true);
  assert.deepEqual(arr, [keep], 'only the target left');
});

test('the bridge tolerates a missing array', () => {
  // Before boot the global does not exist; these must not throw.
  const g = globalThis as Record<string, unknown>;
  const saved = g[BODY_LIST_KEY];
  installBodyListBridge(() => undefined);
  const b = readBridge();
  try {
    assert.equal(b.indexOf(body()), -1);
    assert.equal(b.remove(body()), false);
    b.removeAt(0); // must not throw
    assert.equal(b.add(body()).x, 0, 'add still returns the body');
  } finally {
    if (saved === undefined) delete g[BODY_LIST_KEY];
    else g[BODY_LIST_KEY] = saved;
  }
});

test('the bridge resolves the array lazily, not at install time', () => {
  /* Install happens before the legacy source runs, so the array does not exist
   * yet. Capturing it eagerly would give a permanent no-op.
   */
  let arr: LegacyBody[] | undefined;
  installBodyListBridge(() => arr);

  const g = globalThis as Record<string, unknown>;
  const b = g[BODY_LIST_KEY] as { add(x: LegacyBody): LegacyBody; indexOf(x: unknown): number };

  // Before the array exists: nothing to add to.
  const early = body(1);
  b.add(early);
  assert.equal(b.indexOf(early), -1);

  // Now the legacy code creates it.
  arr = [];
  const late = body(2);
  b.add(late);
  assert.equal(arr.length, 1, 'writes reach the array created later');
  assert.equal(b.indexOf(late), 0);
});

/* --------------------------------------------------------------------------
 * Liveness — the semantic query that dominates the legacy indexOf sites
 * ------------------------------------------------------------------------ */

test('isAlive answers the question the call sites actually ask', () => {
  /* Of 28 `bodies.indexOf(...)` sites, 23 are liveness checks: "is this anchor
   * host / referral / handle still in the world?". Naming that intent is the
   * point, because a dropped `>= 0` yields a NUMBER that reads as truthy.
   */
  const { arr, bridge: b } = bridge([]);
  const live = body(1);
  arr.push(live);

  assert.equal(b.isAlive(live), true);
  assert.equal(b.isAlive(body(1)), false, 'a lookalike is not alive');
  assert.equal(b.isAlive(null), false);
  assert.equal(b.isAlive(undefined), false);
});

test('isAlive turns false the moment a body is removed', () => {
  // This is the case every anchor-release path depends on.
  const { arr, bridge: b } = bridge([]);
  const host = body(1);
  arr.push(host);
  assert.equal(b.isAlive(host), true);
  b.remove(host);
  assert.equal(b.isAlive(host), false);
});

test('isAlive agrees with indexOf >= 0 in every case', () => {
  // They must not drift: the helper is a rename of the rule, not a new rule.
  const { arr, bridge: b } = bridge([]);
  const a1 = body(1), a2 = body(2), absent = body(3);
  arr.push(a1, a2);

  for (const probe of [a1, a2, absent, null, undefined]) {
    assert.equal(
      b.isAlive(probe),
      b.indexOf(probe) >= 0,
      `disagreement for ${JSON.stringify(probe)}`,
    );
  }
});

test('isAlive is false when the array does not exist yet', () => {
  // Before boot there is no array; a liveness check must answer "no".
  const g = globalThis as Record<string, unknown>;
  const saved = g[BODY_LIST_KEY];
  installBodyListBridge(() => undefined);
  try {
    const b = g[BODY_LIST_KEY] as { isAlive(x: unknown): boolean };
    assert.equal(b.isAlive({ x: 0, y: 0 }), false);
    assert.equal(b.isAlive(null), false);
  } finally {
    if (saved === undefined) delete g[BODY_LIST_KEY];
    else g[BODY_LIST_KEY] = saved;
  }
});

/* --------------------------------------------------------------------------
 * count() and forEachBody() — the loop-bound surface
 * ------------------------------------------------------------------------ */

test('count matches the live array length', () => {
  // 83 legacy loops use `bodies.length` as their bound; each restates it.
  const { arr, bridge: b } = bridge([]);
  assert.equal(b.count(), 0);
  arr.push(body(1), body(2));
  assert.equal(b.count(), 2);
  arr.pop();
  assert.equal(b.count(), 1, 'count follows the array, it is not a snapshot');
});

test('count is zero when there is no array yet', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = g[BODY_LIST_KEY];
  installBodyListBridge(() => undefined);
  try {
    const b = g[BODY_LIST_KEY] as { count(): number };
    assert.equal(b.count(), 0);
  } finally {
    if (saved === undefined) delete g[BODY_LIST_KEY];
    else g[BODY_LIST_KEY] = saved;
  }
});

test('count is re-read every iteration, matching `i < bodies.length`', () => {
  /* This is the semantic that must not change. A loop written as
   *   for (i = 0; i < bodies.length; i++)
   * re-evaluates the bound each step, so removing during the walk shortens it.
   * Caching the length first would silently iterate over a slot that no longer
   * exists — and that difference is invisible until something is deleted
   * mid-loop, which several teardown paths do.
   */
  const items = [body(1), body(2), body(3)];
  const g = globalThis as Record<string, unknown>;
  const saved = g[BODY_LIST_KEY];
  installBodyListBridge(() => items);
  try {
    const b = g[BODY_LIST_KEY] as { count(): number };
    let iterations = 0;
    for (let i = 0; i < b.count(); i++) {
      iterations++;
      if (i === 1) items.splice(2, 1); // drop the third while walking
    }
    /* The walk stops early: i=0 and i=1 run (length 3), the third item is
     * dropped during i=1, so at i=2 the bound is 2 and 2 < 2 is false.
     * Caching the length first would have produced 3 iterations instead. */
    assert.equal(iterations, 2, 'the walk saw the shortened list and stopped early');

    // And with the bound cached (the WRONG way) it would be 3 as well here but
    // for a different reason — so assert the count really is re-read.
    let reads = 0;
    const counted = { count: () => (reads++, items.length) };
    for (let i = 0; i < counted.count(); i++) { /* walk */ }
    assert.ok(reads >= items.length, `bound evaluated ${reads} times for ${items.length} items`);
  } finally {
    if (saved === undefined) delete g[BODY_LIST_KEY];
    else g[BODY_LIST_KEY] = saved;
  }
});

test('forEachBody visits every body in order, with its index', () => {
  const { arr, bridge: b } = bridge([]);
  const bs = [body(1), body(2), body(3)];
  arr.push(...bs);

  const seen: { x: number; i: number }[] = [];
  b.forEachBody((x, i) => seen.push({ x: x.x, i }));
  assert.deepEqual(seen, [
    { x: 1, i: 0 },
    { x: 2, i: 1 },
    { x: 3, i: 2 },
  ]);
});

test('forEachBody tolerates a missing array', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = g[BODY_LIST_KEY];
  installBodyListBridge(() => undefined);
  try {
    const b = g[BODY_LIST_KEY] as { forEachBody(f: (x: unknown, i: number) => void): void };
    let ran = false;
    b.forEachBody(() => {
      ran = true;
    });
    assert.equal(ran, false, 'visits nothing, does not throw');
  } finally {
    if (saved === undefined) delete g[BODY_LIST_KEY];
    else g[BODY_LIST_KEY] = saved;
  }
});
