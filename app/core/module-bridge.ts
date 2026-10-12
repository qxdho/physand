/**
 * Module bridge — expose the legacy application's top-level declarations on
 * `globalThis`.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Under the legacy single-file build, `src/10-app.js` was a CLASSIC script, so
 * its `var`/`function` declarations landed on the global object. Everything
 * relied on that:
 *
 *   - the replay harness drives the simulation via bare globals
 *     (`typeof bodies !== "undefined"`, `makeGround(...)`, `stepPhysics(...)`)
 *   - `src/90-boss.js` calls into the app the same way
 *   - the in-page recorder and the console-debug workflow both assume it
 *
 * As an ES module, a top-level `var bodies` is MODULE-scoped and creates no
 * global. Verified directly: importing a module containing `var bodies = [1,2,3]`
 * leaves `globalThis.bodies === undefined`.
 *
 * So we cannot simply switch to ESM without either (a) rewriting all ~832
 * declarations into explicit exports, or (b) re-establishing the global surface.
 *
 * Phase A takes (b) deliberately: it is behaviour-neutral (the same names end up
 * in the same place they were before) and it keeps the replay net valid. Phase C
 * replaces this bridge with real imports, subsystem by subsystem, at which point
 * this file shrinks to nothing and is deleted.
 *
 * HOW IT WORKS
 * ------------
 * We import the legacy source as raw text and evaluate it in a controlled way
 * that publishes its top-level bindings. `new Function` with an explicit
 * "publish these names" epilogue keeps the transformation mechanical and
 * auditable — no bundler magic, no hidden semantics.
 *
 * SECURITY NOTE: this evaluates our own bundled source, not user input. It is
 * the same trust level as the classic <script> tag it replaces.
 */

/** Names the replay harness and the boss script need from the app module. */
const REQUIRED_GLOBALS = [
  'bodies',
  'stepPhysics',
  'makeGround',
] as const;

/**
 * Evaluate `source` so that its top-level `var`/`function` declarations become
 * properties of `globalThis`.
 *
 * A classic script gets this for free; a module does not. We reproduce it by
 * wrapping the source in a function and appending an epilogue that copies the
 * declared names out. The wrapper body is NOT strict-mode, so `var` semantics
 * and function hoisting inside the source are unchanged.
 */
/**
 * Evaluate `source` so that its top-level `var`/`function` declarations become
 * properties of `globalThis`, and append `epilogue` inside the SAME scope.
 *
 * WHY THE EPILOGUE IS INSIDE THE SCOPE (important)
 * ------------------------------------------------
 * Patching `globalThis.paramDef` after evaluation does NOT affect the app's
 * internal callers. The legacy source is evaluated as one function body, so its
 * functions close over the *function-scoped* `paramDef` binding — `openParams`
 * calls that binding, not the global. Verified experimentally: replacing
 * `window.paramDef` with a stub that always returns `['wmass']` changed nothing,
 * while the panel still rendered the stale rows.
 *
 * Therefore anything that needs to hook an internal function must do so from
 * inside this scope, where reassigning the local binding is what the other
 * functions actually see. The epilogue runs after all declarations are hoisted
 * and initialised, so it can safely wrap them.
 */
export function evaluateAsClassicScript(
  source: string,
  declaredNames: readonly string[],
  epilogue?: string,
): void {
  /* Publish as LIVE ACCESSORS, not as a one-time value copy.
   *
   * `new Function` gives the source FUNCTION scope, so its `var x` is not a
   * global — it is a local binding inside the wrapper. Copying values once
   * (`globalThis[n] = n`) therefore publishes a SNAPSHOT:
   *
   *   - objects/arrays happen to stay correct, because the copy holds the same
   *     reference and the app mutates in place;
   *   - SCALARS go stale the moment the app reassigns them. Verified:
   *     `openParams()` sets the internal `paramBody`, but `window.paramBody`
   *     still read `null` afterwards — while the legacy single-file build
   *     (where `var` really was global) correctly reported the new body.
   *
   * That silently breaks anything reading state through the global surface,
   * including the replay harness. Defining accessors instead keeps the published
   * name permanently bound to the live local variable, which reproduces the
   * original classic-script semantics exactly.
   */
  const publish = declaredNames
    .map(
      (n) =>
        `try{Object.defineProperty(globalThis,${JSON.stringify(n)},` +
        `{get:function(){return ${n};},set:function(v){${n}=v;},configurable:true});}catch(e){}`,
    )
    .join('\n');

  // `new Function` produces a sloppy-mode function body, matching the original
  // classic-script environment (sloppy mode, function-scoped var).
  const run = new Function(`${source}\n;${publish}\n;${epilogue ?? ''}\n`);
  run();
}

/**
 * Assert the bridge published what the rest of the system depends on, so a
 * silent scoping failure surfaces as a clear error instead of a blank page.
 */
export function assertGlobalsPresent(names: readonly string[] = REQUIRED_GLOBALS): void {
  const g = globalThis as Record<string, unknown>;
  const missing = names.filter((n) => g[n] === undefined);
  if (missing.length) {
    throw new Error(
      `physand: module bridge failed to publish: ${missing.join(', ')}. ` +
        `The legacy app loaded but its globals are not reachable — ` +
        `check app/core/module-bridge.ts and the declaration list.`,
    );
  }
}
