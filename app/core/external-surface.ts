/**
 * External surface — the names the app must keep reachable from OUTSIDE itself.
 *
 * WHY THIS EXISTS (phase C, the last step)
 * ----------------------------------------
 * Phase C's final goal is to replace the module bridge with real imports and
 * delete `legacy-globals.generated.ts`. Assessing that honestly means answering
 * a narrower question first: **who actually needs the global surface, and for
 * what?**
 *
 * The answer, measured rather than assumed:
 *
 *   - The bridge publishes 951 names.
 *   - A full physics + device + render cycle driven from the page touches
 *     FIFTEEN of them (probed by installing getters on all 951 and recording
 *     reads). The app's own internals do not go through globals at all — they
 *     close over the legacy scope, which is why only externally-initiated calls
 *     show up.
 *   - `tools/harness.mjs` and `src/90-boss.js` reference NINE names directly,
 *     identifiable as identifiers rather than property accesses.
 *   - The replay scenarios call physics entry points by bare name, because their
 *     bodies are compiled with `new Function` and therefore run in global scope.
 *
 * So the surface cannot simply be deleted: the regression harness and the boss
 * script are genuine external consumers, and they are the safety net this whole
 * refactor depends on. What CAN be done — and is done here — is to state the
 * surface EXPLICITLY, so that:
 *
 *   1. it stops being "951 names, we are not sure which matter", and
 *   2. a new external dependency is a visible edit rather than an accident.
 *
 * WHY NOT REWRITE EVERYTHING INTO IMPORTS
 * ---------------------------------------
 * 843 top-level declarations and ~20.5k lines remain in the legacy file. Turning
 * them into ESM exports is a single all-at-once change touching every function
 * in the project, with the harness unable to run until it is complete. This
 * refactor's whole method has been the opposite: migrate one seam at a time,
 * prove each one behaviour-neutral, and keep the regression net green throughout.
 * The honest position is that the bridge stays until subsystems move out of the
 * legacy file for real — which 26 extracted modules have begun, not finished.
 */

/** A name the harness or another external consumer reaches for. */
export interface ExternalEntry {
  name: string;
  /** Who needs it. */
  consumer: 'harness' | 'boss' | 'scenarios' | 'browser-console';
  /** Why it must stay reachable. */
  purpose: string;
}

/**
 * The measured external surface.
 *
 * Every entry was confirmed by reading the consumer, not by guessing. Names that
 * merely LOOK external (short identifiers like `p`, `t`, `run` that also occur
 * as property names or inside words) were checked with identifier-boundary
 * matching so they are not mistaken for real dependencies.
 */
export const EXTERNAL_SURFACE: readonly ExternalEntry[] = [
  // --- Physics entry points the replay harness steps directly -------------
  { name: 'stepPhysics', consumer: 'harness', purpose: 'the fixed-dt gravity sub-step' },
  { name: 'stepMatter', consumer: 'harness', purpose: 'the Matter mirror step' },
  { name: 'stepSprings', consumer: 'harness', purpose: 'the spring integrator' },
  { name: 'stepGravity', consumer: 'harness', purpose: 'the inverse-square pass' },
  { name: 'collideBodies', consumer: 'harness', purpose: 'the custom body solver' },
  { name: 'stepField', consumer: 'harness', purpose: 'field/charge integration' },
  { name: 'stepBlackHole', consumer: 'harness', purpose: 'black-hole integration' },
  { name: 'stepFormulas', consumer: 'harness', purpose: 'floating-formula ageing' },
  { name: 'stepParticles', consumer: 'harness', purpose: 'particle ageing' },
  { name: 'stepShake', consumer: 'harness', purpose: 'screen-shake decay' },
  { name: 'stepBoss', consumer: 'harness', purpose: 'boss sequence stepping' },
  { name: 'stepFinale', consumer: 'harness', purpose: 'finale stepping' },
  { name: 'stepExplode', consumer: 'harness', purpose: 'fragment stepping' },
  { name: 'tickOrbs', consumer: 'harness', purpose: 'orb state ticking' },

  // --- World access the harness snapshots --------------------------------
  { name: 'bodies', consumer: 'harness', purpose: 'the body list scenarios assert on' },
  { name: 'freeL', consumer: 'harness', purpose: 'free letters, for state snapshots' },

  // --- Device factories scenarios spawn ----------------------------------
  { name: 'makeGround', consumer: 'scenarios', purpose: 'spawn a ground/wall slab' },
  { name: 'makeRod', consumer: 'scenarios', purpose: 'spawn a light rod' },
  { name: 'makeSpring', consumer: 'scenarios', purpose: 'spawn a spring' },
  { name: 'makeBelt', consumer: 'scenarios', purpose: 'spawn a conveyor belt' },
  { name: 'mkBoundary', consumer: 'scenarios', purpose: 'spawn a drawn shape' },

  // --- Parameter / refresh paths the harness drives ----------------------
  { name: 'applyParam', consumer: 'harness', purpose: 'write a parameter through the real path' },
  { name: 'PARAM_DEFS', consumer: 'harness', purpose: 'resolve a parameter spec by id' },
  { name: 'refresh', consumer: 'harness', purpose: 'rebuild derived geometry after a write' },
  { name: 'rodSyncAnchors', consumer: 'scenarios', purpose: 're-sync rod anchors after a length change' },
  { name: 'rodTryAnchor', consumer: 'scenarios', purpose: 'anchor a rod end for a scenario' },
  { name: 'springTryAnchor', consumer: 'scenarios', purpose: 'anchor a spring end for a scenario' },
  { name: 'springSetLen', consumer: 'scenarios', purpose: 'set a spring natural length' },
  { name: 'setRodLen', consumer: 'scenarios', purpose: 'set a rod length' },
  { name: 'layoutField', consumer: 'scenarios', purpose: 're-layout a field body' },
  { name: 'applyInkScale', consumer: 'scenarios', purpose: 'apply an ink scale change' },
  { name: 'resize', consumer: 'scenarios', purpose: 're-derive canvas geometry' },

  /* NOT LISTED ON PURPOSE
   * \`W\` and \`init\` appear in the harness and scenarios, but only inside
   * COMMENTS (the source explains that geometry used to hang off \`W\`, and that
   * \`init()\` still runs). They are not dependencies, and listing them would make
   * this manifest claim more than it can defend — the tests here check the
   * consumers, so a name that is only mentioned in prose fails.
   */
  // --- Boss script --------------------------------------------------------
  { name: 'BOSS', consumer: 'boss', purpose: 'boss sequence state' },
  { name: 'bossPlatLayout', consumer: 'boss', purpose: 'position the boss platforms' },
  { name: 'groundY', consumer: 'boss', purpose: 'the floor line' },
  { name: 'H', consumer: 'boss', purpose: 'canvas height' },
  { name: 'slots', consumer: 'boss', purpose: 'the letter slot table' },
];

/** How many names the bridge currently publishes. */
export const PUBLISHED_NAME_COUNT = 951;

/** Names required by external consumers, as a set for quick membership tests. */
export function externalNames(): Set<string> {
  return new Set(EXTERNAL_SURFACE.map((e) => e.name));
}
