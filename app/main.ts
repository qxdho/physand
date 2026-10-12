/**
 * main.ts — bootstrap for the Vite build.
 *
 * ORDERING IS LOAD-BEARING
 * ------------------------
 * The legacy `src/10-app.js` reads the DOM at its very top (line 19:
 * `var cv = document.getElementById('cv')`). Under the old build the script
 * tags sat after the markup in one HTML file, so the DOM always existed first.
 * ES module imports are hoisted and evaluated before the importing module body
 * runs, so a plain top-level `import` would run the app against an empty page.
 *
 * We therefore bootstrap in explicit stages:
 *   1. inject the static DOM + CSS                       (synchronous, this module)
 *   2. eval the legacy app as a classic script so its top-level
 *      declarations land on globalThis                   (stage 2 below)
 *   3. eval the boss script the same way
 *
 * Step 2 is what keeps the replay harness working — see app/core/module-bridge.ts
 * for why an ES module would otherwise hide `bodies` and friends.
 */

import bodyHtml from './legacy/body.html?raw';
import midHtml from './legacy/mid.html?raw';
import './legacy/style.css';

import matterSource from '../src/vendor/matter.js?raw';
import appSource from '../src/10-app.js?raw';
import bossSource from '../src/90-boss.js?raw';
import { LEGACY_GLOBAL_NAMES } from './core/legacy-globals.generated';
import { evaluateAsClassicScript, assertGlobalsPresent } from './core/module-bridge';
import { world } from './core/world';
import { params } from './core/param-registry';
import { bridgeParamDefs } from './core/panel-bridge';
import { PANEL_HOOK_EPILOGUE, PARAM_HOOKS_KEY } from './core/panel-hooks';

// Side-effect imports: these modules perform the `params.register(...)` calls.
// Without them the registry is EMPTY at boot, the hook claims no ids, and the
// panel silently keeps its legacy behaviour — with no error anywhere.
import './params/w-body';
import './params/devices';

/**
 * Inject the static markup. The legacy page was a flat list of <div>s directly
 * under <body>; we place them inside #app-root. The wrapper is style-neutral —
 * existing selectors are all id/class based, so nesting depth does not change
 * how anything is found or laid out.
 */
function installStaticDom(): void {
  const root = document.getElementById('app-root');
  if (!root) throw new Error('physand: #app-root missing from index.html');
  root.innerHTML = bodyHtml + midHtml;
}

/**
 * Point the World read facade at the legacy globals.
 *
 * MUST be called after the app is evaluated (it reads live globals) but the
 * properties are getters, so it must NOT be called before — `bodies` etc. are
 * created during app evaluation and reassigned at runtime.
 *
 * Each accessor is defensive by design: the recorder calls these from
 * `recEnv()`, which is explicitly written to tolerate missing state and emit
 * null rather than throw. A recording must never be able to crash the app the
 * user is trying to report a bug in, so we keep that tolerance here.
 */
function attachWorldReadFacade(): void {
  const g = globalThis as unknown as Record<string, any>;
  world.attachLegacySource({
    get bodies() {
      return g.bodies ?? null;
    },
    get freeLetters() {
      return g.freeL ?? null;
    },
    get canvasWidth() {
      return g.W ?? 0;
    },
    get canvasHeight() {
      return g.H ?? 0;
    },
    get matter() {
      return g.MW ?? null;
    },
    get gravity() {
      return g.GRAV ?? 0;
    },
    get pixelsPerMetre() {
      return g.PX_PER_M ?? 0;
    },
    get groundY() {
      return g.groundY ?? 0;
    },
    get physMode() {
      return g.PHYS_MODE ?? null;
    },
    get toolMode() {
      return g.TOOL ? g.TOOL.mode + (g.TOOL.shape ? '/' + g.TOOL.shape : '') : null;
    },
    get uiMode() {
      return g.UI_MODE ?? null;
    },
  } as never);
}

/**
 * Publish the registry hook object that the in-scope epilogue reads.
 *
 * Must run before the legacy source is evaluated. Everything here is defensive:
 * if the registry is empty the hook simply never claims an id, and the panel
 * behaves exactly as it did before the migration.
 */
function installParamHooks(): void {
  /* Fail loudly if the registry is empty. This exact situation happened during
   * development: `app/params/w-body.ts` performs the registrations as an import
   * side effect, and dropping that import left the registry empty. Nothing
   * errored — the hook simply claimed no ids, so the panel quietly reverted to
   * legacy behaviour and the "size is adjustable" fix looked like it had never
   * been written. A silent no-op is the worst possible failure here. */
  if (params.all().length === 0) {
    throw new Error(
      'physand: parameter registry is empty at boot. ' +
        'A module that calls params.register(...) is not being imported — ' +
        'check the side-effect import of app/params/w-body.ts in main.ts.',
    );
  }

  const hook = {
    has: (id: string) => params.has(id),
    forBodyIds: (b: unknown) => params.forBody(b as never).map((s) => s.id),
    read: (id: string, b: unknown) => params.read(id, b as never),
    write: (id: string, b: unknown, value: number) => params.write(id, b as never, value),
    defaultOf: (id: string) => (params.has(id) ? params.get(id).def : undefined),
  };
  (globalThis as unknown as Record<string, unknown>)[PARAM_HOOKS_KEY] = hook;
}

function boot(): void {
  installStaticDom();

  // Stage 2: Matter.js.
  //
  // It is a UMD bundle: with no module system in scope it assigns `window.Matter`.
  // In the legacy single-file build it was the first <script>, so the app always
  // saw it. We must reproduce that ordering — evaluating it as a classic script
  // gives it the same "no module/exports in scope" environment, so it publishes
  // the global the app expects.
  //
  // Declared names list is empty: the bundle installs `Matter` itself.
  evaluateAsClassicScript(matterSource, []);

  // Stage 3: the application.
  //
  // The registry hook must be installed BEFORE this runs, because the epilogue
  // executes inside the same scope and reads it. See app/core/panel-hooks.ts for
  // why the hook cannot be applied afterwards by patching globals.
  installParamHooks();
  evaluateAsClassicScript(appSource, LEGACY_GLOBAL_NAMES, PANEL_HOOK_EPILOGUE);

  // Stage 4: the boss animation IIFE, which calls back into the app globals.
  evaluateAsClassicScript(bossSource, []);

  // Fail loudly rather than rendering a blank page if anything did not load.
  assertGlobalsPresent();

  // Stage 5: wire the typed read facade onto the now-live globals.
  attachWorldReadFacade();

  // Stage 6: give the legacy PARAM_DEFS table any registry-only parameters, so
  // a new knob still renders a labelled row in the panel.
  bridgeParamDefs();

  // Expose for the replay harness and for phase-B verification.
  (globalThis as unknown as Record<string, unknown>).__world = world;
  (globalThis as unknown as Record<string, unknown>).__params = params;
}

boot();
