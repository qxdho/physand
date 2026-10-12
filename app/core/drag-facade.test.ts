/**
 * Tests for the drag facade.
 *
 * `grab` is the most-referenced global in the project (568 references) and the
 * physics core reads it constantly, because a dragged body must follow the
 * pointer instead of the solver. That coupling is real and cannot be removed.
 *
 * What these tests protect is the SHAPE of it: a bare string comparison like
 * `grab.kind === 'Body'` is false forever, so the drag silently stops affecting
 * physics — no error, no crash, just a body that ignores the pointer. The kind
 * union turns that into a compile error.
 *
 * Run: node --test app/core/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DRAG_FACADE_KEY,
  dragKind,
  dragLocalOffset,
  dragStartVelocity,
  dragTarget,
  installDragFacade,
  isDragging,
  isDraggingBody,
  isDraggingKind,
  type DragFacadeHandle,
} from './drag-facade.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Install a fake `grab` for the duration of `fn`. */
function withGrab<T>(value: unknown, fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const had = 'grab' in g;
  const saved = g.grab;
  g.grab = value;
  try {
    return fn();
  } finally {
    if (had) g.grab = saved;
    else delete g.grab;
  }
}

test('reports no drag when grab is absent or idle', () => {
  // Before boot, and whenever the pointer is up.
  withGrab(undefined, () => {
    assert.equal(dragKind(), null);
    assert.equal(dragTarget(), null);
    assert.equal(isDragging(), false);
  });
  withGrab({ kind: null, obj: null }, () => {
    assert.equal(dragKind(), null);
    assert.equal(isDragging(), false);
  });
});

test('a kind without a target is not a drag', () => {
  // The state machine sets `kind` before `obj` in some paths; physics must not
  // treat that half-initialised state as "the user is holding something".
  withGrab({ kind: 'body', obj: null }, () => {
    assert.equal(isDragging(), false);
    assert.equal(dragKind(), 'body', 'kind is still reported for callers that want it');
  });
});

test('isDraggingBody identifies the held body by identity, not equality', () => {
  const held = { kind: 'W', id: 1 };
  const other = { kind: 'W', id: 1 }; // structurally identical
  withGrab({ kind: 'body', obj: held }, () => {
    assert.equal(isDraggingBody(held), true);
    assert.equal(isDraggingBody(other), false, 'a lookalike must NOT match');
    assert.equal(isDraggingBody(null), false);
    assert.equal(isDraggingBody(undefined), false);
  });
});

test('isDraggingBody requires kind body, not merely a matching obj', () => {
  // Dragging a rod's LENGTH handle sets obj to the rod but kind to 'rodlen'.
  // Physics must not treat that as "the rod itself is being moved" — the
  // difference is what stops the spring constraint fighting the handle.
  const rod = { kind: 'T' };
  withGrab({ kind: 'rodlen', obj: rod }, () => {
    assert.equal(isDraggingBody(rod), false);
    assert.equal(isDraggingKind('rodlen'), true);
    assert.equal(isDraggingKind('body'), false);
  });
});

test('dragLocalOffset keeps the grabbed point under the pointer', () => {
  // Without this a body jumps so its centre sits under the cursor the moment
  // you grab it near an edge.
  withGrab({ kind: 'body', obj: {}, glx: 10, gly: -5 }, () => {
    assert.deepEqual(dragLocalOffset(), { x: 10, y: -5 });
  });
  withGrab({ kind: 'body', obj: {} }, () => {
    assert.equal(dragLocalOffset(), null, 'absent offsets are reported as absent');
  });
});

test('dragStartVelocity exposes the press-time momentum', () => {
  withGrab({ kind: 'body', obj: {}, svx: 12, svy: -3 }, () => {
    assert.deepEqual(dragStartVelocity(), { x: 12, y: -3 });
  });
  withGrab({ kind: 'body', obj: {} }, () => {
    assert.equal(dragStartVelocity(), null);
  });
});

test('reads are live, not snapshots', () => {
  // The pointer handlers reassign grab.kind/obj every press and release, so a
  // captured copy would go stale within a single frame.
  const g = globalThis as Record<string, unknown>;
  const state: { kind: string | null; obj: unknown } = { kind: 'body', obj: { id: 1 } };
  withGrab(state, () => {
    assert.equal(isDragging(), true);
    state.kind = null;
    state.obj = null;
    assert.equal(isDragging(), false, 'facade saw the mutation');
  });
  void g;
});

test('the installed facade exposes every accessor', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = g[DRAG_FACADE_KEY];
  try {
    installDragFacade();
    const facade = g[DRAG_FACADE_KEY] as DragFacadeHandle;
    assert.ok(facade);
    for (const key of [
      'dragKind',
      'dragTarget',
      'isDragging',
      'isDraggingBody',
      'isDraggingKind',
      'dragLocalOffset',
      'dragStartVelocity',
    ] as const) {
      assert.equal(typeof facade[key], 'function', `${key} must be callable`);
    }
  } finally {
    if (saved === undefined) delete g[DRAG_FACADE_KEY];
    else g[DRAG_FACADE_KEY] = saved;
  }
});

test('the kind union covers every kind the legacy code assigns', () => {
  /* The union is only useful if it is complete: a kind missing from it means
   * every comparison against that kind is a type error the author will work
   * around with a cast, defeating the purpose.
   *
   * Collect the assignments from the legacy source and require each to appear in
   * the union declared in drag-facade.ts.
   */
  const legacy = readFileSync(join(ROOT, 'src', '10-app.js'), 'utf8');
  const facade = readFileSync(join(ROOT, 'app', 'core', 'drag-facade.ts'), 'utf8');

  const assigned = new Set<string>();
  for (const m of legacy.matchAll(/grab\.kind\s*=\s*'([a-z]+)'/g)) assigned.add(m[1]!);
  for (const m of legacy.matchAll(/kind\s*:\s*'([a-z]+)'/g)) assigned.add(m[1]!);

  assert.ok(assigned.size > 0, 'the audit must find at least one kind');

  const union = facade.slice(facade.indexOf('export type DragKind'));
  const declared = new Set<string>();
  for (const m of union.matchAll(/\|\s*'([a-z]+)'/g)) declared.add(m[1]!);

  const missing = [...assigned].filter((k) => !declared.has(k)).sort();
  assert.deepEqual(
    missing,
    [],
    `these drag kinds exist in the legacy source but are missing from the ` +
      `DragKind union, so comparisons against them will not type-check: ` +
      missing.join(', '),
  );
});

test('stepMatter reads the drag state through the facade aliases', () => {
  /* stepMatter is where a dragged body is placed each frame — the single most
   * physics-critical consumer of `grab`. A regression here would be caught by
   * the replay suite only if a scenario happened to drag something, so pin it.
   *
   * Comment lines are excluded: they legitimately name the raw fields while
   * explaining the design.
   */
  const lines = readFileSync(join(ROOT, 'src', '10-app.js'), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith('function stepMatter(dt){'));
  assert.ok(start > 0, 'stepMatter must exist');
  let end = lines.findIndex((l, i) => i > start && l.startsWith('function '));
  if (end < 0) end = lines.length;

  const offenders: string[] = [];
  for (let i = start; i < end; i++) {
    const line = lines[i]!;
    if (/^\s*\*|^\s*\/\*/.test(line)) continue;
    // The alias initialisation is the one legitimate mention.
    if (/_gf\?|var _grab/.test(line)) continue;
    if (/\bgrab\./.test(line)) offenders.push(`L${i + 1}: ${line.trim()}`);
  }

  assert.deepEqual(
    offenders,
    [],
    `stepMatter reads the raw grab global instead of the facade aliases ` +
      `(_grabIsBody / _grabBody / _grabIsKind):\n${offenders.join('\n')}`,
  );
});
