/**
 * Panel integration — make registry-owned parameters usable from the real panel.
 *
 * TWO MECHANISMS, AND WHY ONLY ONE OF THEM WORKS
 * ----------------------------------------------
 * 1. `bridgeParamDefs()` — adds a legacy `PARAM_DEFS` entry for any registry
 *    parameter that has none. The panel renders a row by looking up
 *    `PARAM_DEFS[id]` for its label/min/max/step, so without this a new knob
 *    would render blank. Lives here because it touches the legacy global.
 *
 * 2. The function hooks (`paramDef` / `paramV` / `applyParam`) live in
 *    `panel-hooks.ts` and are injected INSIDE the legacy script scope, not
 *    patched onto globals. That distinction is load-bearing and was established
 *    experimentally:
 *
 *      window.paramDef = () => ['wmass'];
 *      openParams(square);          // still returns early; panel unchanged
 *
 *    The legacy source is evaluated as one function body, so its functions close
 *    over the function-scoped `paramDef` binding. `openParams` calls that
 *    binding. Replacing the global has no effect on it, which is why an earlier
 *    global-patching version of this file silently did nothing.
 */

import { params } from '../core/param-registry.ts';

/**
 * Give every registry parameter a `PARAM_DEFS` entry, so the panel can render it.
 *
 * Existing ids are left untouched on purpose: their legacy entry may carry
 * display extras (`siK` unit scaling, `bool` switch rendering, symbolic
 * defaults) that the simulation still depends on. Overwriting them would change
 * behaviour for parameters that have not been migrated yet.
 */
export function bridgeParamDefs(): void {
  const g = globalThis as unknown as Record<string, any>;
  const defs = g.PARAM_DEFS as Record<string, any> | undefined;
  if (!defs) {
    throw new Error('bridgeParamDefs: PARAM_DEFS not found on globalThis');
  }
  for (const spec of params.all()) {
    if (defs[spec.id]) continue;
    defs[spec.id] = {
      key: spec.id,
      label: spec.label,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      unit: spec.unit ?? '',
      def: spec.def,
      ...(spec.siK !== undefined ? { siK: spec.siK } : {}),
    };
  }
}
