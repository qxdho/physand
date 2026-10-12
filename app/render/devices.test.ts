/**
 * Tests for the device renderers.
 *
 * These four were selected by an audit that measured, per renderer, which shared
 * globals it reads as VALUES and which external functions it CALLS. These came
 * out cleanest: zero key globals, zero external calls — every input is a
 * parameter or a field of one.
 *
 * The acceptance criterion for the extraction is unchanged canvas output, which
 * is verified against the real canvas in an integration check (pixel hash
 * compared between the legacy and Vite builds, across every branch). These tests
 * pin the behaviour that makes each branch reachable, so a future edit cannot
 * silently drop one.
 *
 * Run: node --test app/render/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawBlackHole, drawHinge, drawRope, drawSnapMarker } from './devices.ts';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDER_DIR = dirname(fileURLToPath(import.meta.url));

/** A context stand-in that records drawing calls. */
function recorder() {
  const calls: string[] = [];
  const grad = {
    stops: [] as string[],
    addColorStop(t: number, c: string) {
      this.stops.push(`${t}:${c}`);
    },
  };
  const surface: Record<string, unknown> = {
    calls,
    grad,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineJoin: '',
    lineCap: '',
    beginPath: () => calls.push('beginPath'),
    moveTo: (x: number, y: number) => calls.push(`moveTo(${x},${y})`),
    lineTo: (x: number, y: number) => calls.push(`lineTo(${x},${y})`),
    quadraticCurveTo: (a: number, b: number, x: number, y: number) =>
      calls.push(`quad(${a},${b},${x},${y})`),
    arc: (x: number, y: number, r: number) => calls.push(`arc(${x},${y},${r})`),
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
    createRadialGradient: () => grad,
  };
  return surface as never as Parameters<typeof drawRope>[0] & { calls: string[]; grad: typeof grad };
}

test('drawSnapMarker draws the ring and the dot', () => {
  const s = recorder();
  assert.equal(drawSnapMarker(s, 150, 150), true);
  assert.deepEqual((s as unknown as { calls: string[] }).calls, [
    'beginPath',
    'arc(150,150,6)',
    'stroke',
    'beginPath',
    'arc(150,150,1.9)',
    'fill',
  ]);
});

test('drawRope uses the parabola branch when there are no nodes', () => {
  // A rope with slack but no simulated chain: drawn as one quadratic curve.
  const s = recorder();
  const rope = { e0: { x: 0, y: 0 }, e1: { x: 100, y: 0 }, len: 300, anc: [null, null] };
  assert.equal(drawRope(s, rope, 0), true);
  const calls = (s as unknown as { calls: string[] }).calls;
  assert.ok(calls.some((c) => c.startsWith('quad(')), 'sagging rope uses a curve');
  assert.equal(calls.filter((c) => c === 'stroke').length, 1);
});

test('drawRope stays straight when there is no slack', () => {
  // slack <= 0.5 takes the straight-line branch; a curve here would be visible.
  const s = recorder();
  const rope = { e0: { x: 0, y: 0 }, e1: { x: 100, y: 0 }, len: 100, anc: [null, null] };
  drawRope(s, rope, 0);
  const calls = (s as unknown as { calls: string[] }).calls;
  assert.ok(!calls.some((c) => c.startsWith('quad(')), 'taut rope is a straight line');
  assert.ok(calls.includes('lineTo(100,0)'));
});

test('drawRope uses the chain branch when nodes exist', () => {
  /* Quadratic curves through adjacent midpoints: each node is a control point.
   * This is what makes a flexible rope read as smooth rather than as a few
   * broken segments, so the branch must stay reachable.
   */
  const s = recorder();
  const rope = {
    e0: { x: 0, y: 0 },
    e1: { x: 100, y: 0 },
    len: 120,
    nodes: [{ x: 30, y: 20 }, { x: 60, y: 25 }],
    anc: [null, null],
  };
  drawRope(s, rope, 0);
  const calls = (s as unknown as { calls: string[] }).calls;
  // Two nodes means two smoothing curves (one per intermediate segment).
  assert.equal(calls.filter((c) => c.startsWith('quad(')).length, 2);
});

test('drawRope caps only the anchored ends', () => {
  // Uncapped ends are the visual signal that a rope is not attached there.
  const oneAnchored = recorder();
  drawRope(oneAnchored, { e0: { x: 0, y: 0 }, e1: { x: 10, y: 0 }, len: 10, anc: [{}, null] }, 0);
  const a = (oneAnchored as unknown as { calls: string[] }).calls.filter((c) => c === 'fill');
  assert.equal(a.length, 1, 'exactly one cap');

  const bothAnchored = recorder();
  drawRope(bothAnchored, { e0: { x: 0, y: 0 }, e1: { x: 10, y: 0 }, len: 10, anc: [{}, {}] }, 0);
  const bb = (bothAnchored as unknown as { calls: string[] }).calls.filter((c) => c === 'fill');
  assert.equal(bb.length, 2, 'two caps');

  const neither = recorder();
  drawRope(neither, { e0: { x: 0, y: 0 }, e1: { x: 10, y: 0 }, len: 10, anc: [null, null] }, 0);
  const nn = (neither as unknown as { calls: string[] }).calls.filter((c) => c === 'fill');
  assert.equal(nn.length, 0, 'no caps');
});

test('drawHinge draws arms when NOT doubly anchored', () => {
  /* The arm condition was arrived at through two regressions and is
   * load-bearing: a stub hinge with anc=[null,null] must still draw its arms,
   * which is why "both anchored" is the WRONG test here.
   */
  const stub = recorder();
  drawHinge(stub, { e0: { x: 0, y: 0 }, e1: { x: 100, y: 0 }, anc: [null, null] });
  const stubCalls = (stub as unknown as { calls: string[] }).calls;
  assert.ok(stubCalls.includes('lineTo(50,0)'), 'stub hinge draws arms');

  const separated = recorder();
  drawHinge(separated, { e0: { x: 0, y: 0 }, e1: { x: 100, y: 0 }, anc: [{}, null] });
  assert.ok(
    (separated as unknown as { calls: string[] }).calls.includes('lineTo(50,0)'),
    'half-anchored hinge draws arms',
  );
});

test('drawHinge suppresses arms when doubly anchored AND separated', () => {
  // Both ends anchored means the hinge is, by definition, converged. A measured
  // gap here is solver lag, and drawing it as a long arm reads as "the hinge
  // came off but is still dragging a line" — the exact complaint this fixes.
  const s = recorder();
  drawHinge(s, { e0: { x: 0, y: 0 }, e1: { x: 100, y: 0 }, anc: [{}, {}] });
  const calls = (s as unknown as { calls: string[] }).calls;
  assert.ok(!calls.includes('lineTo(50,0)'), 'no arms when both ends are anchored');
  // The pin is still drawn.
  assert.ok(calls.includes('arc(50,0,4.6)'));
});

test('drawHinge omits arms when the ends coincide', () => {
  // A gap of <= 1.5px is not worth an arm even when unanchored.
  const s = recorder();
  drawHinge(s, { e0: { x: 10, y: 10 }, e1: { x: 11, y: 10 }, anc: [null, null] });
  const calls = (s as unknown as { calls: string[] }).calls;
  assert.ok(!calls.some((c) => c.startsWith('lineTo(')), 'coincident ends need no arm');
});

test('drawBlackHole draws lens rings, streaks, swirl and the core', () => {
  const s = recorder();
  assert.equal(drawBlackHole(s, { x: 200, y: 200, bh: { r: 20, spin: 1.25 } }), true);
  const calls = (s as unknown as { calls: string[] }).calls;
  const grad = (s as unknown as { grad: { stops: string[] } }).grad;

  // 5 lensed rings + 8 streaks + 3 accretion arcs + 1 core + 1 photon ring
  assert.equal(calls.filter((c) => c === 'stroke').length, 5 + 8 + 3 + 1);
  assert.equal(calls.filter((c) => c === 'fill').length, 1, 'one filled core');

  // The gradient must be a soft monochrome falloff, not a hard edge.
  assert.deepEqual(grad.stops, [
    '0:rgba(0,0,0,1)',
    '0.78:rgba(12,10,14,0.96)',
    '1:rgba(20,18,22,0)',
  ]);
});

test('drawBlackHole enforces a minimum radius', () => {
  // A hole with r near zero would otherwise draw nothing but the falloff.
  const s = recorder();
  drawBlackHole(s, { x: 0, y: 0, bh: { r: 0, spin: 0 } });
  const calls = (s as unknown as { calls: string[] }).calls;
  assert.ok(
    calls.some((c) => c.startsWith('arc(0,0,4')),
    'clamped to r=4 so the hole stays visible',
  );
});

test('every renderer tolerates a missing surface', () => {
  // The legacy boot path can leave the context null; throwing there would take
  // down the whole frame rather than skipping one decoration.
  assert.equal(drawSnapMarker(null, 0, 0), false);
  assert.equal(drawRope(null, { e0: { x: 0, y: 0 }, e1: { x: 1, y: 0 }, len: 1 }, 0), false);
  assert.equal(drawHinge(null, { e0: { x: 0, y: 0 }, e1: { x: 1, y: 0 } }), false);
  assert.equal(drawBlackHole(null, { x: 0, y: 0, bh: { r: 1, spin: 0 } }), false);
});

test('renderers do not depend on any global', () => {
  /* The whole reason these could be extracted is that they read no shared state.
   * Pinned as a source check because a future edit could add `W` or `bodies`
   * without any behavioural test noticing, and that would make the module
   * un-movable again.
   */
  const files = ['devices.ts', 'particles.ts'];
  for (const f of files) {
    const text = readFileSync(join(RENDER_DIR, f), 'utf8');
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    assert.ok(!/\bglobalThis\b/.test(code), `${f} must not read globals`);

    /* Note on cvx: the modules use it as a LOCAL ALIAS for the surface parameter
     * (const cvx = surface as DeviceSurface), which is exactly right — the point
     * is that the value arrives as an argument. So distinguish a local binding
     * from a free variable instead of merely looking for the name.
     */
    const aliasedLocally = /\b(?:const|let|var)\s+cvx\b/.test(code);
    const freeState = /(?<![.\w])(W|H|groundY|bodies)(?![\w(])/;
    assert.ok(!freeState.test(code), `${f} must not read app state`);
    if(/\bcvx\b/.test(code)){
      assert.ok(aliasedLocally,
        `${f} uses cvx without binding it locally — it must receive the surface as a parameter instead of closing over the global`);
    }
  }
});
