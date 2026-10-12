/**
 * Tests for the symbol registry.
 *
 * Adding one symbol to the legacy app requires editing five kinds of place, two
 * of them duplicated — and the copies have ALREADY drifted (one `kids` list has
 * 15 entries, the other 17; `k` and `x` are missing from the first).
 *
 * These tests check the registry against the legacy structures, so the drift is
 * measured rather than assumed, and the next symbol is added in one place with
 * the derived copies verified instead of remembered.
 *
 * Run: node --test app/symbols/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SYMBOL_DEFINITIONS, symbolByChar, symbolCount, symbolGlobalNames } from './registry.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEGACY = readFileSync(join(ROOT, 'src', '10-app.js'), 'utf8');

/** The legacy `DOCK_ORDER` table as char -> slot. */
function dockOrder(): Map<string, number> {
  const m = /var DOCK_ORDER=\{([^}]*)\}/.exec(LEGACY);
  assert.ok(m, 'DOCK_ORDER must exist');
  const out = new Map<string, number>();
  for (const e of m![1]!.matchAll(/'([^']+)':(\d+)/g)) out.set(e[1]!, Number(e[2]!));
  return out;
}

/** The single-symbol globals declared via `GD('x')`, as globalName -> char. */
function singletons(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of LEGACY.matchAll(/^var ([A-Za-z0-9_]+O)=GD\(([^)]+)\);/gm)) {
    // The argument is either a quoted char or a constant like HALF / MU.
    let ch = m[2]!;
    if (/^'([^']*)'$/.test(ch)) ch = /^'([^']*)'$/.exec(ch)![1]!;
    else if (ch === 'HALF') ch = '½';
    else if (ch === 'MU') ch = 'μ';
    out.set(m[1]!, ch);
  }
  return out;
}

/**
 * The `kids = [...]` lists that enumerate SYMBOL globals.
 *
 * NOTE: matched by requiring at least one entry ending in 'O', because the file
 * also contains unrelated `kids=[]` locals (an empty array of DOM children in
 * an entirely different function). A looser pattern silently picks those up —
 * which is how this helper first reported four lists instead of two.
 */
function kidsLists(): string[][] {
  return [...LEGACY.matchAll(/kids=\[([^\]]*)\]/g)]
    .map((m) => m[1]!.split(',').map((s) => s.trim()).filter(Boolean))
    .filter((list) => list.length > 0 && list.every((n) => /O$/.test(n)));
}

test('every registered symbol exists as a GD singleton', () => {
  const live = singletons();
  const missing = SYMBOL_DEFINITIONS.filter((s) => !live.has(s.globalName)).map((s) => s.globalName);
  assert.deepEqual(missing, [], `registered but never declared: ${missing.join(', ')}`);
});

test('every GD singleton is registered', () => {
  // A singleton nobody registered is a symbol the registry would not know about,
  // which is how the k/x drift stayed invisible.
  const registered = new Set(symbolGlobalNames());
  const unregistered = [...singletons().keys()].filter((g) => !registered.has(g));
  assert.deepEqual(unregistered, [], `declared but not registered: ${unregistered.join(', ')}`);
});

test('characters match what each singleton is created with', () => {
  // The char drives the panel glyph; a mismatch would draw the wrong letter.
  const live = singletons();
  for (const s of SYMBOL_DEFINITIONS) {
    assert.equal(live.get(s.globalName), s.char, `${s.globalName} should be '${s.char}'`);
  }
});

test('slots match the legacy DOCK_ORDER table exactly', () => {
  /* The ordering table is what positions symbols in the panel. It once computed
   * positions by counting existing elements, which produced a one-frame
   * misalignment when clearing during a layout pass; the table replaced that.
   */
  const order = dockOrder();
  assert.equal(order.size, symbolCount(), 'the table and the registry cover the same count');
  for (const s of SYMBOL_DEFINITIONS) {
    assert.equal(order.get(s.char), s.slot, `DOCK_ORDER['${s.char}'] should be ${s.slot}`);
  }
});

test('slots are contiguous from zero', () => {
  // A gap would leave a hole in the panel grid.
  const slots = SYMBOL_DEFINITIONS.map((s) => s.slot).sort((a, b) => a - b);
  assert.deepEqual(slots, slots.map((_, i) => i));
});

test('THE DRIFT: kids lists do not both cover every symbol', () => {
  /* This test documents a REAL, MEASURED inconsistency rather than asserting it
   * away.
   *
   * `sortPanel` and the clear-all rebuild each carry a `kids = [...]` list of
   * symbol globals. They should agree; they do not — one has 15 entries and the
   * other 17, missing `k` and `x` (the two most recently added symbols, which is
   * exactly how such a copy falls behind).
   *
   * The effect today is nil: `dockSlotEl` positions by the ordering table, so k
   * and x still reach the panel through another path. That is what makes it
   * worth recording rather than ignoring — the code is correct only because a
   * different mechanism happens to cover for it, and a future edit to that
   * mechanism would expose the gap with no warning.
   *
   * The assertion below pins the CURRENT state so it cannot get worse silently.
   * When the lists are unified (or driven from this registry), update it.
   */
  const lists = kidsLists();
  assert.equal(lists.length, 2, 'two kids lists exist');

  const registered = new Set(symbolGlobalNames());
  const coverage = lists.map((l) => [...registered].filter((g) => l.includes(g)).length);
  const shortest = Math.min(...coverage);

  assert.equal(
    shortest,
    symbolCount() - 2,
    `expected the known 2-symbol shortfall (k and x in one list); ` +
      `coverage is ${coverage.join(' / ')} of ${symbolCount()}`,
  );

  const shortList = lists.find((l) => l.length === Math.min(...lists.map((x) => x.length)))!;
  const missing = [...registered].filter((g) => !shortList.includes(g));
  assert.deepEqual(missing.sort(), ['kO', 'xO'], 'the shortfall is exactly k and x');
});

test('every kids-list entry is a registered symbol global', () => {
  // A stale name in these lists would be a silent no-op at runtime.
  const registered = new Set(symbolGlobalNames());
  for (const list of kidsLists()) {
    const unknown = list.filter((g) => !registered.has(g));
    assert.deepEqual(unknown, [], `kids entries that are not registered symbols: ${unknown.join(', ')}`);
  }
});

test('symbolByChar finds symbols and rejects unknowns', () => {
  assert.equal(symbolByChar('m')!.globalName, 'mO');
  assert.equal(symbolByChar('x')!.globalName, 'xO');
  assert.equal(symbolByChar('½')!.globalName, 'halfO');
  assert.equal(symbolByChar('Z'), null);
  assert.equal(symbolByChar(''), null);
});
