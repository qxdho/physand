/**
 * Tests for the formula facade.
 *
 * The property that matters most here is the PAIRING: destroying a floating
 * formula must both detach its glyph DOM and remove it from the array. The
 * legacy code did these as two separate statements at four call sites, with
 * nothing enforcing that both happen — and skipping the first silently leaks
 * DOM nodes that keep costing layout while rendering nothing.
 *
 * Run: node --test app/core/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FORMULA_FACADE_KEY,
  addFormula,
  destroyAllFormulas,
  destroyFormula,
  formulaCount,
  formulas,
  installFormulaFacade,
  type FormulaObject,
  type FormulaFacadeHandle,
} from './formula-facade.ts';

/** Save/restore the globals these tests touch. */
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

/** A formula whose glyph records whether it was detached. */
function fakeFormula(glyphs: { el: { parentNode: unknown } }[] = []): FormulaObject {
  return { x: 0, y: 0, vx: 0, vy: 0, age: 0, glyphs } as FormulaObject;
}

test('formulas() returns the live array by reference', () => {
  // Callers iterate it and remove entries by index while walking backwards; a
  // copy would make those removals silently ineffective.
  const arr: FormulaObject[] = [];
  withGlobals({ formulas: arr }, () => {
    assert.equal(formulas(), arr, 'same reference');
    arr.push(fakeFormula());
    assert.equal(formulaCount(), 1, 'mutation through the original is visible');
  });
});

test('formulas() degrades to an empty array before boot', () => {
  // Callers loop unconditionally, so returning undefined would crash them.
  const g = globalThis as Record<string, unknown>;
  const saved = g.formulas;
  delete g.formulas;
  try {
    assert.deepEqual(formulas(), []);
    assert.equal(formulaCount(), 0);
  } finally {
    if (saved === undefined) delete g.formulas;
    else g.formulas = saved;
  }
});

test('addFormula registers into the live array', () => {
  const arr: FormulaObject[] = [];
  withGlobals({ formulas: arr }, () => {
    const f = fakeFormula();
    addFormula(f);
    assert.deepEqual(arr, [f]);
  });
});

test('destroyFormula BOTH detaches glyph DOM and removes from the array', () => {
  /* This is the pairing the legacy code left to discipline. Verified here so a
   * future edit cannot quietly drop half of it: dropping the DOM step leaks
   * nodes, dropping the array step leaves a dead object being stepped forever.
   */
  const detached: string[] = [];
  const parent = {
    removeChild(el: unknown) {
      detached.push(String((el as { id?: string }).id));
      (el as { parentNode: unknown }).parentNode = null;
    },
  };
  const el = { id: 'g1', parentNode: parent as unknown };

  const arr: FormulaObject[] = [];
  withGlobals(
    {
      formulas: arr,
      // The legacy killFormula walks glyphs and removes attached elements.
      killFormula: (f: FormulaObject) => {
        for (const g of f.glyphs ?? []) {
          if (g.el && g.el.parentNode) {
            (g.el.parentNode as { removeChild(e: unknown): void }).removeChild(g.el);
          }
        }
        f.glyphs = [];
        f.dead = true;
      },
    },
    () => {
      const f = fakeFormula([{ el }]);
      arr.push(f);

      assert.equal(destroyFormula(f), true);
      assert.deepEqual(detached, ['g1'], 'DOM node detached');
      assert.equal(f.dead, true, 'marked dead');
      assert.equal(arr.length, 0, 'removed from the array');
    },
  );
});

test('destroyFormula is tolerant of a formula that is not in the list', () => {
  // Teardown can run twice (e.g. clear-all followed by an expiry tick).
  const arr: FormulaObject[] = [];
  withGlobals({ formulas: arr, killFormula: () => {} }, () => {
    assert.equal(destroyFormula(fakeFormula()), false, 'reports it did nothing');
    assert.equal(arr.length, 0);
  });
});

test('destroyAllFormulas empties the list without skipping entries', () => {
  // The legacy loop walked forward while splicing, which skips elements. Ours
  // walks backwards; this pins the count so a regression is visible.
  const arr: FormulaObject[] = [];
  const killed: FormulaObject[] = [];
  withGlobals(
    {
      formulas: arr,
      killFormula: (f: FormulaObject) => {
        killed.push(f);
        f.dead = true;
      },
    },
    () => {
      const fs = [fakeFormula(), fakeFormula(), fakeFormula(), fakeFormula()];
      arr.push(...fs);

      assert.equal(destroyAllFormulas(), 4, 'all four destroyed');
      assert.equal(arr.length, 0, 'list emptied');
      assert.equal(killed.length, 4, 'every one had its killFormula run');
    },
  );
});

test('the installed facade exposes the four lifecycle operations', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = g[FORMULA_FACADE_KEY];
  try {
    installFormulaFacade();
    const facade = g[FORMULA_FACADE_KEY] as FormulaFacadeHandle;
    assert.ok(facade);
    for (const key of ['add', 'destroy', 'destroyAll', 'count'] as const) {
      assert.equal(typeof facade[key], 'function', `${key} must be callable`);
    }
  } finally {
    if (saved === undefined) delete g[FORMULA_FACADE_KEY];
    else g[FORMULA_FACADE_KEY] = saved;
  }
});

test('formula LAYOUT is deliberately not wrapped', async () => {
  /* An audit this round measured setF / layoutBody / layoutRun / layoutBracket /
   * layoutGrav and found them already self-contained: they operate on the body
   * passed in and reference no shared state. Wrapping them would be indirection
   * without a payoff, so this facade covers lifecycle only.
   *
   * Pinned as a test so the scope decision is visible to the next reader.
   */
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const legacy = readFileSync(join(root, 'src', '10-app.js'), 'utf8');

  for (const name of ['setF', 'layoutBody', 'layoutRun']) {
    const start = legacy.indexOf(`function ${name}(`);
    assert.ok(start > 0, `${name} must exist`);
    let end = legacy.indexOf('\nfunction ', start + 1);
    if (end < 0) end = legacy.length;
    const body = legacy.slice(start, end);

    // These functions must NOT have grown a facade dependency.
    assert.ok(
      !body.includes('__formulaFacade'),
      `${name} should stay self-contained; it has no shared state to consolidate`,
    );
  }
});
