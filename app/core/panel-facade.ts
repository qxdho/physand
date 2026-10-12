/**
 * Panel facade — the parameter panel's state and refresh, as a named interface.
 *
 * WHY THIS EXISTS
 * ---------------
 * The panel owns three pieces of state (`paramBody`, `paramLetter`, `paramRows`)
 * and one operation everyone wants (`re-render`). Before this, they were reached
 * as bare globals from at least three subsystems that are not the panel:
 *
 *   - the parameter read/write paths in `src/10-app.js` (~8920) consult
 *     `paramLetter` to decide whether a grant value lives on the letter or the
 *     host body — this is the dock-template rule from R132-9d;
 *   - `bossLightOn` (~19406) reaches INTO `paramRows` to widen a slider when the
 *     user types `c` for light speed;
 *   - the frame loop and the BOSS teardown call `renderParamPanel()` directly,
 *     nine sites in total, each guarded by its own `if(paramBody)`.
 *
 * That last pattern is the real smell: every caller has to remember both "is a
 * panel open?" and "which function refreshes it". The panel should answer that,
 * not its callers.
 *
 * WHAT THIS IS
 * ------------
 * A typed surface over the still-legacy implementation, in the same style as
 * `core/legacy.ts`: one audited place where the coupling is visible, plus real
 * types. The panel keeps working exactly as before; only the access path is
 * named.
 *
 * The refresh method encodes the guard that was previously duplicated:
 * `refresh()` is a no-op when no panel is open, so callers stop needing to know.
 */

/** A row the panel currently renders. Only the fields outside callers touch. */
export interface ParamRow {
  spec?: { key?: string; [key: string]: unknown };
  /** The slider element, when the row has one. */
  sl?: { max: number | string; value: number | string };
  [key: string]: unknown;
}

export interface PanelFacade {
  /** The body whose parameters are shown, or null when closed. */
  targetBody(): unknown | null;
  /**
   * The letter being edited, or null for a whole-body panel.
   *
   * Shared with the parameter read/write paths: grant values (`v`, `a`, `q`, `t`)
   * live on the letter when one is being edited, and on the body otherwise.
   */
  targetLetter(): Record<string, unknown> | null;
  /** Live rows, for the few callers that need to update a control in place. */
  rows(): ParamRow[];
  /** Whether a panel is currently open. */
  isOpen(): boolean;
  /**
   * Re-render the panel if one is open; no-op otherwise.
   *
   * This is the operation nine call sites were doing by hand, each with its own
   * `if (paramBody)` guard.
   */
  refresh(): void;
  /** Also re-clamp the panel into the viewport, matching the legacy pairing. */
  refreshAndClamp(): void;
}

export const PANEL_FACADE_KEY = '__panelFacade';

/**
 * The epilogue.
 *
 * Read from inside the legacy scope so it closes over the real bindings, and
 * defensive throughout: a failure here must degrade to "panel does not refresh"
 * rather than breaking right-click.
 */
export const PANEL_FACADE_EPILOGUE = `
(function(){
  var F = (typeof globalThis!=='undefined') ? globalThis[${JSON.stringify(PANEL_FACADE_KEY)}] : null;
  if(!F) return;

  F.targetBody   = function(){ try{ return paramBody; }catch(e){ return null; } };
  F.targetLetter = function(){ try{ return paramLetter; }catch(e){ return null; } };
  F.rows         = function(){ try{ return paramRows; }catch(e){ return []; } };
  F.isOpen       = function(){
    try{ return !!(paramBody && pbox && pbox.classList.contains('on')); }catch(e){ return false; }
  };
  F.refresh = function(){
    try{
      if(!paramBody) return;
      if(typeof renderParamPanel==='function') renderParamPanel();
    }catch(e){}
  };
  F.refreshAndClamp = function(){
    try{
      if(!paramBody) return;
      if(typeof renderParamPanel==='function') renderParamPanel();
      if(typeof clampParamPanel==='function') clampParamPanel();
    }catch(e){}
  };
})();
`;
