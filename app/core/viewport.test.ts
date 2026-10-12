/**
 * Tests for the viewport module.
 *
 * This module exists because a call-graph analysis found 476 of 555 functions in
 * one connected component, glued partly by canvas geometry (`W` is referenced
 * 413 times and read by 110 functions). Naming the geometry is the prerequisite
 * for cutting real module boundaries in phase C.
 *
 * Run: node --test app/core/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  boundLeft,
  boundRight,
  inViewport,
  renderContext,
  viewport,
} from './viewport.ts';

/** Install legacy globals for a test, restoring afterwards. */
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

const BASE = { W: 1280, H: 800, groundY: 640, PX_PER_M: 100, BND_INK: 2.325, CEL_INSET: 24 };

test('viewport reports the live canvas geometry', () => {
  withGlobals(BASE, () => {
    const v = viewport();
    assert.equal(v.width, 1280);
    assert.equal(v.height, 800);
    assert.equal(v.groundY, 640);
    assert.equal(v.pixelsPerMetre, 100);
  });
});

test('derived values are computed, not read', () => {
  // centreX/centreY are the derivations the legacy code writes out as `W/2`
  // hundreds of times; naming them is the point of this module.
  withGlobals(BASE, () => {
    const v = viewport();
    assert.equal(v.centreX, 640);
    assert.equal(v.centreY, 400);
  });
});

test('boundary inset adds both frame contributions', () => {
  // The frame has two parts: ink thickness plus cell inset. Reading only one is
  // an easy mistake that would shift every boundary calculation.
  withGlobals(BASE, () => {
    assert.equal(viewport().boundaryInset, 2.325 + 24);
    assert.equal(boundLeft(), 26.325);
    assert.equal(boundRight(), 1280 - 26.325);
  });
});

test('geometry is re-read on every call, so a resize is visible', () => {
  /* This is the property that matters most. Every field except the insets
   * changes on resize, and `resize()` writes W/H/groundY directly. A frozen
   * snapshot would silently keep using the old canvas size — the same staleness
   * trap documented for the module bridge and the recorder facade.
   */
  const g = globalThis as Record<string, unknown>;
  withGlobals(BASE, () => {
    assert.equal(viewport().width, 1280);

    // Simulate resize() rewriting the globals.
    g.W = 800;
    g.H = 600;
    g.groundY = 480;

    const v = viewport();
    assert.equal(v.width, 800, 'saw the new width');
    assert.equal(v.centreX, 400, 'derived value followed');
    assert.equal(v.groundY, 480);
  });
});

test('missing geometry degrades to zero rather than NaN', () => {
  // Before boot these globals do not exist. Returning NaN would poison every
  // position computed from it, and NaN propagates silently through arithmetic.
  const g = globalThis as Record<string, unknown>;
  const saved = { W: g.W, H: g.H, groundY: g.groundY };
  delete g.W;
  delete g.H;
  delete g.groundY;
  try {
    const v = viewport();
    assert.equal(v.width, 0);
    assert.equal(v.height, 0);
    assert.equal(v.centreX, 0);
    assert.equal(v.groundY, 0);
    assert.ok(Number.isFinite(v.centreX));
  } finally {
    g.W = saved.W;
    g.H = saved.H;
    g.groundY = saved.groundY;
  }
});

test('renderContext groups the geometry a renderer needs', () => {
  // An extracted rendering module should take one parameter rather than close
  // over five globals.
  withGlobals(BASE, () => {
    assert.deepEqual(renderContext(), {
      width: 1280,
      height: 800,
      cx: 640,
      cy: 400,
      groundY: 640,
      pxPerM: 100,
    });
  });
});

test('inViewport accepts the edges inclusively', () => {
  withGlobals(BASE, () => {
    assert.equal(inViewport(640, 400), true);
    assert.equal(inViewport(0, 0), true, 'top-left corner is inside');
    assert.equal(inViewport(1280, 800), true, 'bottom-right corner is inside');
    assert.equal(inViewport(-1, 400), false);
    assert.equal(inViewport(400, -1), false);
    assert.equal(inViewport(1281, 400), false);
    assert.equal(inViewport(400, 801), false);
  });
});
