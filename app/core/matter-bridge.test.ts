/**
 * Tests for the Matter bridge.
 *
 * This is the highest-risk seam in phase B so far: it decides which Matter
 * composite a mirror body is attached to. Getting it wrong is SILENT — the body
 * is added, nothing throws, and it simply never collides. Several legacy call
 * sites were wrapped in try/catch, which turns a mistake into a no-op rather
 * than a failure.
 *
 * So these tests care most about two things: the layer choice, and the fact that
 * a failed operation reports failure instead of lying.
 *
 * Run: node --test app/core/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MATTER_BRIDGE_KEY,
  installMatterBridge,
  matterAttach,
  matterDetach,
  matterEngineWorld,
  matterMoveToWorld,
  matterReady,
  setMatterGravity,
  type MatterBridgeHandle,
} from './matter-bridge.ts';

/** A stand-in for the two composites the app uses. */
function fakeMatterSetup() {
  const worldBodies: unknown[] = [];
  const wallBodies: unknown[] = [];
  const world = { bodies: worldBodies };
  const wLayer = { bodies: wallBodies };
  const added: string[] = [];
  const removed: string[] = [];

  const Matter = {
    Composite: {
      add: (composite: unknown, body: unknown) => {
        if (composite === world) {
          worldBodies.push(body);
          added.push('world');
        } else if (composite === wLayer) {
          wallBodies.push(body);
          added.push('wall');
        } else {
          throw new Error('unknown composite');
        }
      },
      remove: (composite: unknown, body: unknown) => {
        const list = composite === world ? worldBodies : wallBodies;
        const i = list.indexOf(body);
        if (i < 0) throw new Error('not attached');
        list.splice(i, 1);
        removed.push(composite === world ? 'world' : 'wall');
      },
    },
  };

  const MW = { engine: { world, gravity: { y: 2.6 } }, wLayer };

  return { MW, Matter, worldBodies, wallBodies, added, removed };
}

/** Install fake globals for a test body, restoring afterwards. */
function withFakeMatter<T>(setup: ReturnType<typeof fakeMatterSetup>, fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const saved = { MW: g.MW, Matter: g.Matter };
  g.MW = setup.MW;
  g.Matter = setup.Matter;
  try {
    return fn();
  } finally {
    g.MW = saved.MW;
    g.Matter = saved.Matter;
  }
}

test('attach defaults to the wall layer, where drawn bodies belong', () => {
  // `wLayer` is a SUB-composite added into engine.world. Drawn W bodies, rod
  // mirrors and spring end caps live there; the static frame lives in the root.
  const s = fakeMatterSetup();
  withFakeMatter(s, () => {
    const body = { id: 1 };
    assert.equal(matterAttach(body), true);
    assert.deepEqual(s.wallBodies, [body], 'landed in the wall layer');
    assert.deepEqual(s.worldBodies, [], 'must NOT land in the root world');
  });
});

test('attach can target the root world explicitly', () => {
  const s = fakeMatterSetup();
  withFakeMatter(s, () => {
    const body = { id: 2 };
    assert.equal(matterAttach(body, 'world'), true);
    assert.deepEqual(s.worldBodies, [body]);
    assert.deepEqual(s.wallBodies, []);
  });
});

test('detach removes from the named layer only', () => {
  const s = fakeMatterSetup();
  withFakeMatter(s, () => {
    const body = { id: 3 };
    matterAttach(body);
    assert.equal(s.wallBodies.length, 1);

    assert.equal(matterDetach(body), true);
    assert.equal(s.wallBodies.length, 0);
  });
});

test('detaching something not attached reports false instead of throwing', () => {
  // Teardown paths detach bodies that may never have been added. Throwing here
  // would take the page down during a delete, which is exactly what the legacy
  // try/catch wrappers were papering over.
  const s = fakeMatterSetup();
  withFakeMatter(s, () => {
    assert.equal(matterDetach({ id: 'never-added' }), false);
    assert.equal(matterDetach(null), false);
    assert.equal(matterAttach(null), false);
  });
});

test('a throwing composite does not propagate', () => {
  // Attaching an already-parented body can throw inside Matter. The bridge must
  // report failure, not crash the interaction that triggered it.
  const g = globalThis as Record<string, unknown>;
  const saved = { MW: g.MW, Matter: g.Matter };
  g.MW = { engine: { world: {} }, wLayer: {} };
  g.Matter = {
    Composite: {
      add: () => {
        throw new Error('body already added');
      },
      remove: () => {
        throw new Error('cannot remove');
      },
    },
  };
  try {
    assert.equal(matterAttach({ id: 1 }), false, 'attach failure reported');
    assert.equal(matterDetach({ id: 1 }), false, 'detach failure reported');
  } finally {
    g.MW = saved.MW;
    g.Matter = saved.Matter;
  }
});

test('operations are no-ops before the app boots', () => {
  // During boot these run before MW exists; the legacy code early-returned.
  const g = globalThis as Record<string, unknown>;
  const saved = { MW: g.MW, Matter: g.Matter };
  delete g.MW;
  try {
    assert.equal(matterAttach({ id: 1 }), false);
    assert.equal(matterDetach({ id: 1 }), false);
    assert.equal(matterReady(), false);
    assert.equal(matterEngineWorld(), undefined);
  } finally {
    g.MW = saved.MW;
    g.Matter = saved.Matter;
  }
});

test('moveToWorld detaches from the wall AND attaches to the world', () => {
  // A half-done move would leave the body attached to both composites or
  // neither — both silent, both wrong.
  const s = fakeMatterSetup();
  withFakeMatter(s, () => {
    const body = { id: 4 };
    matterAttach(body);
    assert.equal(s.wallBodies.length, 1);

    assert.equal(matterMoveToWorld(body), true);
    assert.equal(s.wallBodies.length, 0, 'gone from the wall layer');
    assert.equal(s.worldBodies.length, 1, 'present in the world');
  });
});

test('setMatterGravity writes the engine copy that Matter actually simulates with', () => {
  // GRAV is the app's number; Matter keeps its own gravity.y. They must agree or
  // the panel and the visible physics drift apart.
  const s = fakeMatterSetup();
  withFakeMatter(s, () => {
    setMatterGravity(3);
    assert.equal(s.MW.engine.gravity.y, 3);
  });
});

test('the installed bridge object exposes all four layer operations', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = g[MATTER_BRIDGE_KEY];
  try {
    installMatterBridge();
    const bridge = g[MATTER_BRIDGE_KEY] as MatterBridgeHandle;
    assert.ok(bridge);
    for (const key of ['attachToWall', 'detachFromWall', 'attachToWorld', 'detachFromWorld'] as const) {
      assert.equal(typeof bridge[key], 'function', `${key} must be callable`);
    }
  } finally {
    if (saved === undefined) delete g[MATTER_BRIDGE_KEY];
    else g[MATTER_BRIDGE_KEY] = saved;
  }
});

test('matterReady requires BOTH the world handle and the Matter namespace', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { MW: g.MW, Matter: g.Matter };
  const s = fakeMatterSetup();
  try {
    g.MW = s.MW;
    delete g.Matter;
    assert.equal(matterReady(), false, 'no Matter namespace -> not ready');

    g.Matter = s.Matter;
    assert.equal(matterReady(), true, 'both present -> ready');

    delete g.MW;
    assert.equal(matterReady(), false, 'no world -> not ready');
  } finally {
    g.MW = saved.MW;
    g.Matter = saved.Matter;
  }
});
