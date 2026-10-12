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

  // Stage 3: the application. Evaluated as a classic script so every top-level
  // declaration becomes a global, exactly as in the single-file build.
  evaluateAsClassicScript(appSource, LEGACY_GLOBAL_NAMES);

  // Stage 4: the boss animation IIFE, which calls back into the app globals.
  evaluateAsClassicScript(bossSource, []);

  // Fail loudly rather than rendering a blank page if anything did not load.
  assertGlobalsPresent();
}

boot();
