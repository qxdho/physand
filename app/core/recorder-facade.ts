/**
 * Recorder facade — the recorder's view of world state, wired from inside the
 * legacy scope.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase B round 1 built `World.readView()` and this round found it was DEAD
 * INFRASTRUCTURE: nothing consumed it. The recorder still read globals directly,
 * each guarded by its own `typeof X !== 'undefined' ? X : null` check.
 *
 * That is worth stating plainly rather than quietly deleting: building a facade
 * nobody uses produces the *appearance* of migration progress while changing
 * nothing. The progress metric has to be "call sites moved", not "abstractions
 * written".
 *
 * WHAT THE RECORDER ACTUALLY READS
 * --------------------------------
 * Audited from the real code rather than assumed:
 *
 *   recSnap : PHYS_MODE, GRAV, MW (timing), TOOL, bodies
 *   recEnv  : UI_MODE, TOOL, bodies, freeL, MW, paramBody, plus browser globals
 *
 * All of these are scalars or live references. Scalars must be read through
 * accessors because the legacy app reassigns them at runtime — a captured copy
 * goes stale (the same trap documented in module-bridge.ts).
 *
 * WHY AN EPILOGUE RATHER THAN A GLOBAL
 * ------------------------------------
 * The recorder's functions close over the function-scoped legacy bindings, so
 * patching `globalThis` afterwards cannot reach them (proven in round 2: a
 * stub `window.paramDef` had no effect on `openParams`). The hook object is
 * therefore installed before evaluation and read from inside the scope.
 *
 * SAFETY
 * ------
 * `recEnv` is deliberately written to tolerate missing state and emit null: a
 * recording must never be able to crash the app the user is trying to report a
 * bug in. Every accessor here preserves that tolerance.
 */

/** What the recorder facade exposes to the epilogue. */
export interface RecorderFacade {
  physMode(): string | null;
  gravity(): number | null;
  toolDescriptor(): string | null;
  toolContinuous(): boolean | null;
  bodyCount(): number;
  freeLetterCount(): number;
  matterBodyCount(): number | null;
  matterTimestamp(): number | null;
  panelTarget(): string | null;
  uiMode(): string | null;
}

export const RECORDER_FACADE_KEY = '__recorderFacade';

/**
 * The epilogue.
 *
 * Reads the live legacy bindings from inside their own scope and publishes them
 * as plain functions on the facade object. Each accessor is defensive in the
 * same way the original `recEnv` was: a missing global yields null, never a
 * throw.
 */
export const RECORDER_FACADE_EPILOGUE = `
(function(){
  var F = (typeof globalThis!=='undefined') ? globalThis[${JSON.stringify(RECORDER_FACADE_KEY)}] : null;
  if(!F) return;

  F.physMode = function(){ try{ return (typeof PHYS_MODE!=='undefined') ? PHYS_MODE : null; }catch(e){ return null; } };
  F.gravity  = function(){ try{ return (typeof GRAV!=='undefined') ? GRAV : null; }catch(e){ return null; } };
  F.toolDescriptor = function(){
    try{ return (typeof TOOL!=='undefined') ? (TOOL.mode + (TOOL.shape ? ('/'+TOOL.shape) : '')) : null; }
    catch(e){ return null; }
  };
  F.toolContinuous = function(){
    try{ return (typeof TOOL!=='undefined') ? !!TOOL.cont : null; }catch(e){ return null; }
  };
  F.bodyCount = function(){ try{ return bodies.length; }catch(e){ return 0; } };
  F.freeLetterCount = function(){ try{ return freeL.length; }catch(e){ return 0; } };
  F.matterBodyCount = function(){
    try{ return (typeof MW!=='undefined' && MW && MW.engine) ? MW.engine.world.bodies.length : null; }
    catch(e){ return null; }
  };
  F.matterTimestamp = function(){
    try{ return (typeof MW!=='undefined' && MW && MW.engine) ? MW.engine.timing.timestamp : null; }
    catch(e){ return null; }
  };
  /* The recorder normalises the panel target to a readable name: an internal
     code like "W" means nothing to whoever reads the bug report later. */
  F.panelTarget = function(){
    try{ return paramBody ? (paramBody._nm || paramBody.kind || '?') : null; }catch(e){ return null; }
  };
  F.uiMode = function(){ try{ return (typeof UI_MODE!=='undefined') ? UI_MODE : null; }catch(e){ return null; } };
})();
`;
