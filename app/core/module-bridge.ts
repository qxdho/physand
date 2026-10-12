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
export function evaluateAsClassicScript(
  source: string,
  declaredNames: readonly string[],
): void {
  const publish = declaredNames
    .map((n) => `try{globalThis[${JSON.stringify(n)}]=${n};}catch(e){}`)
    .join('\n');

  // `new Function` produces a sloppy-mode function body, matching the original
  // classic-script environment (sloppy mode, function-scoped var).
  const run = new Function(`${source}\n;${publish}\n`);
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
