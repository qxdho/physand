/**
 * Tests for the parameter registry.
 *
 * These run with `node --test` (no extra dependency). They exist mainly to lock
 * in the invariant that the legacy design kept violating: a parameter's READ
 * path and its SPEC must never disagree. Three separate user-visible bugs in the
 * legacy app ("I changed it and nothing happened") were all that one mistake.
 *
 * Run: node --test app/core/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ParamRegistry, clamp, type ParamSpec } from './param-registry.ts';

/** Minimal spec factory so each test states only what it is about. */
function spec(over: Partial<ParamSpec> & Pick<ParamSpec, 'id'>): ParamSpec {
  return {
    id: over.id,
    label: over.label ?? over.id,
    min: over.min ?? 0,
    max: over.max ?? 100,
    step: over.step ?? 1,
    def: over.def ?? 1,
    scope: over.scope ?? {},
    read: over.read ?? (() => over.def ?? 1),
    write: over.write ?? (() => {}),
    ...(over.unit !== undefined ? { unit: over.unit } : {}),
    ...(over.siK !== undefined ? { siK: over.siK } : {}),
    ...(over.group !== undefined ? { group: over.group } : {}),
  };
}

test('register + get round-trip', () => {
  const r = new ParamRegistry();
  r.register(spec({ id: 'wmass', label: '质量', min: 0.01, max: 100, def: 1 }));
  assert.equal(r.get('wmass').label, '质量');
  assert.equal(r.has('wmass'), true);
  assert.equal(r.has('nope'), false);
});

test('duplicate id is rejected loudly, not silently overwritten', () => {
  const r = new ParamRegistry();
  r.register(spec({ id: 'dup' }));
  assert.throws(() => r.register(spec({ id: 'dup' })), /duplicate parameter id/);
});

test('inverted range is rejected at registration', () => {
  const r = new ParamRegistry();
  assert.throws(() => r.register(spec({ id: 'bad', min: 10, max: 1 })), /max .* <= min/);
});

test('unknown id throws with a helpful message instead of returning undefined', () => {
  const r = new ParamRegistry();
  r.register(spec({ id: 'sk' }));
  assert.throws(() => r.get('typo'), /unknown parameter "typo".*sk/s);
});

test('read falls back to the spec default when the body has no value yet', () => {
  // This is the R61/R99/R101 bug class: the read path forgets the unset case,
  // so the panel shows a stale or wrong number and edits appear to do nothing.
  const r = new ParamRegistry();
  r.register(
    spec({
      id: 'sk',
      def: 250,
      read: (b) => (b && b.ks != null ? b.ks : 250),
      write: (b, v) => {
        b.ks = v;
      },
    }),
  );

  assert.equal(r.read('sk', null), 250, 'null body -> default');
  assert.equal(r.read('sk', {}), 250, 'body without the field -> default');
  assert.equal(r.read('sk', { ks: 77 }), 77, 'body with the field -> live value');
});

test('read survives a non-finite read result by falling back to the default', () => {
  const r = new ParamRegistry();
  r.register(spec({ id: 'x', def: 5, read: () => NaN }));
  assert.equal(r.read('x', {}), 5);
});

test('write clamps to the declared range', () => {
  const r = new ParamRegistry();
  r.register(
    spec({
      id: 'mu',
      min: 0,
      max: 1,
      def: 0.5,
      write: (b, v) => {
        b.mu = v;
      },
    }),
  );
  const b: Record<string, any> = {};
  r.write('mu', b, 5);
  assert.equal(b.mu, 1, 'clamped high');
  r.write('mu', b, -3);
  assert.equal(b.mu, 0, 'clamped low');
  r.write('mu', b, 0.25);
  assert.equal(b.mu, 0.25, 'in range passes through');
});

test('write of a non-finite value falls back to the default rather than poisoning state', () => {
  const r = new ParamRegistry();
  r.register(
    spec({
      id: 'k',
      def: 42,
      write: (b, v) => {
        b.k = v;
      },
    }),
  );
  const b: Record<string, any> = {};
  r.write('k', b, Number.POSITIVE_INFINITY);
  assert.equal(b.k, 42);
});

test('forBody selects by kind, replacing the legacy if/else chain', () => {
  const r = new ParamRegistry();
  r.register(spec({ id: 'wmass', scope: { kinds: ['W'] } }));
  r.register(spec({ id: 'sk', scope: { kinds: ['S'] } }));
  r.register(spec({ id: 'anyparam', scope: {} }));

  const ids = (b: Record<string, any> | null) => r.forBody(b).map((s) => s.id);

  assert.deepEqual(ids({ kind: 'W' }), ['wmass', 'anyparam']);
  assert.deepEqual(ids({ kind: 'S' }), ['sk', 'anyparam']);
  assert.deepEqual(ids({ kind: 'T' }), ['anyparam']);
  assert.deepEqual(ids(null), []);
});

test('forBody honours the `when` predicate for sub-cases kinds cannot express', () => {
  const r = new ParamRegistry();
  r.register(spec({ id: 'hfix', scope: { kinds: ['S'], when: (b) => !!b.hinge } }));
  r.register(spec({ id: 'rlen', scope: { kinds: ['S'], when: (b) => !!b.rope } }));
  const ids = (b: Record<string, any>) => r.forBody(b).map((s) => s.id);

  assert.deepEqual(ids({ kind: 'S', hinge: true }), ['hfix']);
  assert.deepEqual(ids({ kind: 'S', rope: true }), ['rlen']);
  assert.deepEqual(ids({ kind: 'S' }), [], 'plain spring gets neither');
});

test('this is the exact regression the registry prevents: spec visible but unreadable', () => {
  // Reproduces the `waccang` bug in miniature. In the legacy code the direction
  // row was defined AND had read/write branches, but was never added to the
  // list of ids the panel renders, so the user could never reach it.
  //
  // With the registry, reaching a knob and reading it are the same declaration,
  // so a parameter that is visible is by construction readable.
  const r = new ParamRegistry();
  r.register(
    spec({
      id: 'waccang',
      def: 0,
      min: -180,
      max: 180,
      scope: { kinds: ['W'], when: (b) => b.accX != null || b.accY != null },
      read: (b) => (b && b.accAng != null ? b.accAng : 0),
      write: (b, v) => {
        b.accAng = v;
      },
    }),
  );

  const body = { kind: 'W', accX: 1, accY: 0, accAng: 45 };

  // Visible AND readable AND writable must all hold together.
  assert.deepEqual(r.forBody(body).map((s) => s.id), ['waccang'], 'appears in the panel');
  assert.equal(r.read('waccang', body), 45, 'reads the real value');

  r.write('waccang', body, -90);
  assert.equal(body.accAng, -90, 'writes it back');
  assert.equal(r.read('waccang', body), -90, 'and the read reflects the write');
});

test('clamp handles NaN/Infinity by returning the default', () => {
  const s = spec({ id: 'c', def: 7, min: 0, max: 10 });
  assert.equal(clamp(NaN, s), 7);
  assert.equal(clamp(Infinity, s), 7);
  assert.equal(clamp(-Infinity, s), 7);
  assert.equal(clamp(3, s), 3);
  assert.equal(clamp(99, s), 10);
});

test('all() preserves registration order so the panel layout is stable', () => {
  const r = new ParamRegistry();
  r.register(spec({ id: 'z' }));
  r.register(spec({ id: 'a' }));
  r.register(spec({ id: 'm' }));
  assert.deepEqual(r.all().map((s) => s.id), ['z', 'a', 'm']);
});
