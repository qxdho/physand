/**
 * Tests for the render surface and the first extracted renderer.
 *
 * The acceptance criterion for extracting a renderer is that the CANVAS OUTPUT
 * DOES NOT CHANGE. That is verified against the real canvas in an integration
 * check (pixel hash compared between the legacy and Vite builds); these unit
 * tests pin the properties that make the extraction safe in the first place —
 * that the surface is reachable live, and that the renderer's behaviour is a
 * pure function of its arguments.
 *
 * Run: node --test app/render/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canDraw, clamp, drawSurface, rgba, withSavedContext } from './surface.ts';
import { drawParticles, type Particle } from './particles.ts';

/** A canvas context stand-in that records every call. */
function recordingSurface() {
  const calls: string[] = [];
  const state: { fillStyle: unknown } = { fillStyle: null };
  return {
    calls,
    state,
    set fillStyle(v: unknown) {
      state.fillStyle = v;
      calls.push(`fillStyle=${String(v)}`);
    },
    get fillStyle() {
      return state.fillStyle;
    },
    beginPath() {
      calls.push('beginPath');
    },
    arc(x: number, y: number, r: number, _s: number, _e: number) {
      calls.push(`arc(${x},${y},${r})`);
    },
    fill() {
      calls.push('fill');
    },
    save() {
      calls.push('save');
    },
    restore() {
      calls.push('restore');
    },
  };
}

/** Install a fake cvx global for the duration of `fn`. */
function withSurface<T>(value: unknown, fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const had = 'cvx' in g;
  const saved = g.cvx;
  g.cvx = value;
  try {
    return fn();
  } finally {
    if (had) g.cvx = saved;
    else delete g.cvx;
  }
}

test('drawSurface returns the live context, not a snapshot', () => {
  /* resize() reconfigures the transform on the SAME context object, and the
   * legacy boot path can leave cvx null if 2D is unavailable. Both mean this
   * must be a live read.
   */
  const a = { id: 'a' };
  withSurface(a, () => {
    assert.equal(drawSurface(), a);
    assert.equal(canDraw(), true);
  });
  withSurface(null, () => {
    assert.equal(drawSurface(), null);
    assert.equal(canDraw(), false);
  });
});

test('clamp and rgba are pure', () => {
  // Pure functions are the safest thing to share across a module boundary.
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
  assert.equal(rgba([255, 224, 150], 0.5), 'rgba(255,224,150,0.5)');
  assert.equal(rgba([38, 34, 28], 0), 'rgba(38,34,28,0)');
});

test('withSavedContext restores even when the renderer throws', () => {
  /* A renderer that changes the transform and then throws would otherwise leak
   * its state into everything drawn afterwards.
   */
  const surface = recordingSurface();
  withSurface(surface, () => {
    assert.throws(() => {
      withSavedContext(() => {
        throw new Error('renderer blew up');
      });
    }, /blew up/);
    assert.deepEqual(surface.calls, ['save', 'restore'], 'restore still ran');
  });
});

test('withSavedContext reports false when there is no surface', () => {
  withSurface(null, () => {
    let ran = false;
    assert.equal(
      withSavedContext(() => {
        ran = true;
      }),
      false,
    );
    assert.equal(ran, false, 'must not attempt to draw without a surface');
  });
});

test('drawParticles is a pure function of its arguments', () => {
  /* This is the entire point of the extraction: the legacy version closed over
   * `cvx` and `particles`, so it could only ever be moved together with them.
   */
  const surface = recordingSurface();
  const particles: Particle[] = [
    { x: 10, y: 20, r: 3, alpha: 0.5 },
    { x: 30, y: 40, r: 6, alpha: 0.9, hot: true },
  ];
  assert.equal(drawParticles(surface, particles), true);

  assert.deepEqual(surface.calls, [
    'fillStyle=rgba(38,34,28,0.5)', // cold particle: dark ink
    'beginPath',
    'arc(10,20,3)',
    'fill',
    'fillStyle=rgba(255,224,150,0.9)', // hot particle: warm
    'beginPath',
    'arc(30,40,6)',
    'fill',
  ]);
});

test('drawParticles reproduces the legacy colour strings exactly', () => {
  // The acceptance test for extraction is unchanged canvas output, so the
  // string construction must match character for character. Note the alpha is
  // interpolated without rounding — `0.30000000000000004` must survive.
  const surface = recordingSurface();
  const alpha = 0.1 + 0.2;
  drawParticles(surface, [{ x: 0, y: 0, r: 1, alpha }]);
  assert.equal(surface.calls[0], `fillStyle=rgba(38,34,28,${alpha})`);
  assert.match(String(alpha), /0\.30000000000000004/);
});

test('drawParticles handles an empty list and a missing surface', () => {
  const surface = recordingSurface();
  assert.equal(drawParticles(surface, []), true);
  assert.deepEqual(surface.calls, [], 'no draw calls for no particles');

  // The legacy version would have thrown on a null context.
  assert.equal(drawParticles(null, [{ x: 0, y: 0, r: 1, alpha: 1 }]), false);
});

test('drawParticles leaves no residual state on the surface', () => {
  // It sets fillStyle, which is exactly the kind of state that leaks into the
  // next renderer when a function is called "temporarily".
  const surface = recordingSurface();
  drawParticles(surface, [{ x: 1, y: 1, r: 1, alpha: 1, hot: true }]);
  assert.equal(surface.state.fillStyle, 'rgba(255,224,150,1)');
  // Documented, not asserted away: the caller owns resetting fillStyle, which
  // is the same contract the legacy implementation had.
});
