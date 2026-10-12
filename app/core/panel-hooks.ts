/**
 * In-scope hooks for the legacy app.
 *
 * WHY THIS IS A STRING
 * --------------------
 * The legacy source is evaluated as a single function body (see module-bridge),
 * and its functions close over the function-scoped `paramDef` / `paramV` /
 * `applyParam` bindings. Patching `globalThis.paramDef` afterwards has NO effect
 * on those internal callers — verified experimentally:
 *
 *   window.paramDef = () => ['wmass'];   // then
 *   openParams(square);                  // still returns early, panel unchanged
 *
 * So the hook has to run INSIDE that scope, where reassigning the local binding
 * is what `openParams` / `renderParamPanel` actually observe.
 *
 * HOW THE REGISTRY IS REACHED
 * ---------------------------
 * The epilogue runs inside the legacy scope, so it cannot use an ES `import`.
 * It reaches the registry through `globalThis.__paramHooks`, which `main.ts`
 * installs before evaluating the legacy source. If that object is absent the
 * epilogue is a no-op, so the app still boots (important: a failure here must
 * not produce a blank page).
 *
 * WHAT IT WRAPS
 * -------------
 * Only the three panel primitives, and only for ids the registry owns:
 *   - `paramDef`     : append registry-owned ids the legacy list omitted
 *                      (this is what finally surfaces `scale` / resize)
 *   - `paramV`       : read registry-owned ids through their `read`
 *   - `applyParam`   : route registry-owned ids through their `write`
 *
 * Everything else falls through to the original implementation unchanged, so
 * the ~27 not-yet-migrated parameters keep behaving exactly as before.
 */

/** Shape main.ts must install on globalThis before the legacy source runs. */
export interface ParamHooks {
  has(id: string): boolean;
  forBodyIds(b: unknown): string[];
  read(id: string, b: unknown): number;
  write(id: string, b: unknown, value: number): void;
  defaultOf(id: string): number | undefined;
}

export const PARAM_HOOKS_KEY = '__paramHooks';

/**
 * The epilogue source. Kept deliberately small and defensive: the panel is on
 * the critical path for every right-click, so a hook failure must degrade to
 * the original behaviour rather than throw.
 */
export const PANEL_HOOK_EPILOGUE = `
(function(){
  var H = (typeof globalThis!=='undefined') ? globalThis[${JSON.stringify(PARAM_HOOKS_KEY)}] : null;
  if(!H) return;

  var _pd = (typeof paramDef==='function') ? paramDef : null;
  var _pv = (typeof paramV==='function') ? paramV : null;
  var _ap = (typeof applyParam==='function') ? applyParam : null;

  if(_pd){
    paramDef = function(B){
      var ids = _pd(B) || [];
      if(!B) return ids;
      try{
        var extra = H.forBodyIds(B) || [];
        for(var i=0;i<extra.length;i++){
          if(ids.indexOf(extra[i])<0) ids.push(extra[i]);
        }
      }catch(e){}
      return ids;
    };
  }

  if(_pv){
    paramV = function(B,id){
      try{
        if(H.has(id)) return H.read(id,B);
      }catch(e){}
      // A null body must not reach the original reader: it ends in
      // pv(B,key,def) which dereferences B.param, and the throw aborted
      // openParams() mid-build (panel kept showing the previous body's rows).
      if(!B){
        try{
          var d = H.defaultOf(id);
          if(typeof d==='number') return d;
        }catch(e){}
        var spec = PARAM_DEFS[id];
        return (spec && typeof spec.def==='number') ? spec.def : 0;
      }
      return _pv(B,id);
    };
  }

  if(_ap){
    applyParam = function(B,spec,val){
      var id = spec ? spec.key : null;
      if(id){
        try{
          if(H.has(id)){
            if(!B.param) B.param = {};
            B.param[id] = val;      // keep the legacy mirror in sync
            H.write(id,B,val);
            return;
          }
        }catch(e){}
      }
      return _ap(B,spec,val);
    };
  }
})();
`;
