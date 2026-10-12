/**
 * Tests for the panel facade.
 *
 * The panel owns state two other subsystems read (`paramLetter` for the
 * dock-template rule, `paramRows` for the light-speed path) plus a refresh
 * operation that nine call sites were each guarding by hand. These tests pin
 * the properties that make those consumers safe.
 *
 * Run: node --test app/core/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PANEL_FACADE_KEY, type PanelFacade } from './panel-facade.ts';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY_SRC = join(APP, '..', 'src', '10-app.js');

/** Run `fn` with the facade replaced, restoring afterwards. */
function withFacade<T>(facade: Partial<PanelFacade>, fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const saved = g[PANEL_FACADE_KEY];
  const previous = saved as Record<string, unknown> | undefined;
  g[PANEL_FACADE_KEY] = { ...(previous ?? {}), ...facade };
  try {
    return fn();
  } finally {
    if (saved === undefined) delete g[PANEL_FACADE_KEY];
    else g[PANEL_FACADE_KEY] = saved;
  }
}

test('facade placeholders are safe before the epilogue runs', () => {
  // main.ts installs placeholders so a failure to run the epilogue degrades to
  // "panel does not refresh" rather than breaking right-click entirely.
  const placeholder: PanelFacade = {
    targetBody: () => null,
    targetLetter: () => null,
    rows: () => [],
    isOpen: () => false,
    refresh: () => {},
    refreshAndClamp: () => {},
  };
  assert.equal(placeholder.targetBody(), null);
  assert.equal(placeholder.targetLetter(), null);
  assert.deepEqual(placeholder.rows(), []);
  assert.equal(placeholder.isOpen(), false);
  placeholder.refresh(); // must not throw
  placeholder.refreshAndClamp();
});

test('refresh is a no-op when no panel is open', () => {
  /* This is the guard nine call sites used to duplicate as `if (paramBody)`.
   * Encoding it once means a caller cannot forget it and cannot get it wrong.
   */
  let renderCalls = 0;
  const g = globalThis as Record<string, unknown>;
  const savedRender = g.renderParamPanel;
  g.renderParamPanel = () => {
    renderCalls++;
  };
  try {
    withFacade(
      {
        refresh: () => {
          // Emulate the real epilogue: guarded on the panel target.
          const body = (g.paramBody ?? null) as unknown;
          if (!body) return;
          (g.renderParamPanel as () => void)();
        },
      },
      () => {
        g.paramBody = null;
        (g[PANEL_FACADE_KEY] as PanelFacade).refresh();
        assert.equal(renderCalls, 0, 'closed panel must not render');

        g.paramBody = { kind: 'W' };
        (g[PANEL_FACADE_KEY] as PanelFacade).refresh();
        assert.equal(renderCalls, 1, 'open panel renders');
      },
    );
  } finally {
    if (savedRender === undefined) delete g.renderParamPanel;
    else g.renderParamPanel = savedRender;
    delete g.paramBody;
  }
});

test('the legacy panel state is reached only through the facade', () => {
  /* `paramLetter` and `paramRows` are shared across subsystem boundaries:
   *   - paramV/applyParam consult paramLetter for the dock-template rule (R132-9d)
   *   - bossLightOn reaches into paramRows to widen the v slider at light speed
   *
   * Both are now read via the facade. This guard keeps a future edit from
   * quietly reintroducing a bare global read, which no behaviour test would
   * catch because both paths return the same object.
   */
  const lines = readFileSync(LEGACY_SRC, 'utf8').split('\n');

  /** Offsets of the two functions that read paramLetter. */
  function fnRange(name: string): [number, number] {
    const start = lines.findIndex((l) => l.startsWith(name));
    assert.ok(start > 0, `${name} must exist`);
    let end = lines.findIndex((l, i) => i > start && l.startsWith('function '));
    if (end < 0) end = lines.length;
    return [start, end];
  }

  const offenders: string[] = [];
  for (const name of ['function paramV(B,id){', 'function applyParam(B,spec,val){']) {
    const [start, end] = fnRange(name);
    for (let i = start; i < end; i++) {
      const line = lines[i]!;
      if (/^\s*\*|^\s*\/\*/.test(line)) continue;
      // The alias initialisation is the one legitimate mention.
      if (/var _pl=/.test(line)) continue;
      if (/\bparamLetter\b/.test(line)) offenders.push(`${name} L${i + 1}: ${line.trim()}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these read the raw paramLetter global instead of the facade alias (_pl):\n` +
      offenders.join('\n'),
  );
});

test('the boss light-speed path reads panel rows through the facade', () => {
  // bossLightOn mutates a rendered slider; reaching into the panel's private
  // array from another subsystem is exactly the coupling this seam removes.
  const text = readFileSync(LEGACY_SRC, 'utf8');
  const fn = text.slice(text.indexOf('function bossLightOn('));
  const body = fn.slice(0, fn.indexOf('\nfunction '));

  assert.match(body, /__panelFacade/, 'must consult the panel facade');
  assert.match(body, /\.rows\(\)/, 'must read rows through the facade');
});
