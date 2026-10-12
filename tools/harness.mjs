/**
 * harness.mjs — headless replay harness for physics-sandbox.
 *
 * WHY
 * ---
 * There are no unit tests and, after the analysis in MODULARIZATION.md, no cheap
 * place to add them: the app is one 375-declaration strongly-connected component
 * hanging off two mutable globals (`W`, `bodies`). The correct test granularity
 * for this codebase is therefore *behavioural replay*, not unit tests.
 *
 * WHAT IT DOES
 * ------------
 * 1. Loads index.html in headless Chromium (file://, exactly as a user would).
 * 2. Freezes the page's own rAF loop so the simulation does not advance on its
 *    own — we drive it ourselves.
 * 3. Runs a *scenario*: a scripted setup + a scripted number of fixed-dt physics
 *    steps.
 * 4. Captures a normalised state snapshot and returns it.
 *
 * Determinism notes
 * -----------------
 * The physics entry points (`stepPhysics`, `stepMatter`, `stepSprings`,
 * `collideBodies`, ...) are called directly with a fixed dt instead of via rAF,
 * so runs do not depend on wall-clock timing. Matter.js's internal
 * `engine.timing.timestamp` still advances, and the spring/rod integrators are
 * substepped, but with a fixed dt sequence the results are reproducible run to
 * run — which is all the harness needs to detect regressions.
 *
 * Snapshots are rounded before comparison so that harmless float noise does not
 * mask real changes (tolerance is configurable per scenario).
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(ROOT, 'index.html');

/**
 * Where to load the app from.
 *
 * During the migration two targets must both stay testable:
 *   - `legacy` (default): the single-file build at index.html, over file://
 *   - `app`: the Vite dev/preview server, via PHYSAND_TEST_URL
 *
 * Keeping both runnable is what lets us prove the new architecture is
 * behaviour-identical to the old one: the same 9 scenarios and the same
 * baselines run against each target.
 */
const TARGET = process.env.PHYSAND_TARGET || 'legacy';
const APP_URL = process.env.PHYSAND_TEST_URL || 'http://127.0.0.1:4173/';

function targetUrl() {
  if (TARGET === 'app') return APP_URL;
  if (TARGET === 'legacy') return 'file://' + INDEX;
  throw new Error(`harness: unknown PHYSAND_TARGET "${TARGET}" (expected "legacy" or "app")`);
}

/** Libraries Chromium needs, extracted without root by tools/fetch-syslibs.sh */
const LIB_DIRS = [
  join(ROOT, '.syslibs/root/usr/lib/x86_64-linux-gnu'),
  join(ROOT, '.syslibs/root/lib/x86_64-linux-gnu'),
];

/** Inject the test API into the page. Kept small and explicit. */
const TEST_API = `
window.__T = (function(){
  /* Set one axis scale factor.
   *
   * Registry-backed parameters exist only in the Vite build (bridgeParamDefs
   * synthesizes their PARAM_DEFS entries there). The frozen legacy single-file
   * build has no such entries, so we fall back to writing the body field and
   * calling refresh() directly — the same effect through the same physics, which
   * keeps both targets runnable and their baselines comparable.
   */
  function setAxisScale(B, specId, field, value){
    var spec = (typeof PARAM_DEFS!=='undefined') ? PARAM_DEFS[specId] : null;
    if(spec && typeof applyParam==='function'){ applyParam(B, spec, value); return; }
    B[field] = value;
    if(typeof refresh==='function') refresh(B);
  }

  /* Set any parameter by id.
   *
   * Registry-backed ids exist in the Vite build; the frozen legacy build may
   * lack some entries. Fall back to a direct field write plus refresh so both
   * targets stay runnable — see setAxisScale above for the same reasoning. The
   * fallbacks below mirror what the legacy applyParam branches did. */
  function setParam(B, specId, value){
    var spec = (typeof PARAM_DEFS!=='undefined') ? PARAM_DEFS[specId] : null;
    if(spec && typeof applyParam==='function'){ applyParam(B, spec, value); return; }
    if(specId==='sk'){ B.ks = value; }
    else if(specId==='rodlen' && typeof setRodLen==='function'){ setRodLen(B, value, true); }
    else if(specId==='slen' && typeof springSetLen==='function'){ springSetLen(B, value); }
    else if(specId==='sdamp'){ B.damp = value; }
    else { B[specId] = value; if(typeof refresh==='function') refresh(B); }
  }

  /* Pin / unpin a body. Mirrors the legacy menu toggle exactly:
   * body flag + Matter setStatic + wake. */
  function setFixed(B, on){
    var spec = (typeof PARAM_DEFS!=='undefined') ? PARAM_DEFS['wfixed'] : null;
    if(spec && typeof applyParam==='function'){ applyParam(B, spec, on?1:0); return; }
    B.fixed = !!on;
    if(B.mb && typeof Matter!=='undefined' && Matter.Body){
      Matter.Body.setStatic(B.mb, !!on);
      if(Matter.Sleeping) Matter.Sleeping.set(B.mb, false);
    }
  }

  // Advance the simulation by n steps of fixed dt.
  // Mirrors the self-evolution half of frame() (see index.html ~L21195).
  function step(n, dt){
    for (var i=0;i<n;i++){
      stepPhysics(dt);
      stepMatter(dt);
      stepSprings(dt);
      collideBodies();
      stepGravity(dt);
      stepField(dt);
      tickOrbs(dt);
      stepExplode(dt);
      stepBlackHole(dt);
      stepFinale(dt);
      stepFormulas(dt);
      stepParticles(dt);
      stepShake(dt);
      stepBoss(dt);
    }
  }

  // Normalised, comparable view of the world.
  // Rounded to 3 decimals; volatile/derived fields are excluded on purpose.
  //
  // NOTE on Infinity: static Matter bodies have mass === Infinity. JSON.stringify
  // turns Infinity into null, so a raw snapshot would round-trip as null and any
  // baseline comparison would report a spurious "null -> Infinity" difference.
  // Encode non-finite numbers as strings so they survive the round trip.
  function snap(){
    function r(v){
      if (v == null) return null;
      if (typeof v !== 'number' || isNaN(v)) return null;
      if (!isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
      return Math.round(v*1000)/1000;
    }
    var out = {n:bodies.length, nfl:freeL.length, bs:[], fl:[]};
    for (var i=0;i<bodies.length;i++){
      var B=bodies[i];
      if(!B) continue;
      var o={i:i, kind:B.kind==null?null:B.kind, dead:B.dead?1:0};
      var mb=B.mb;
      if(mb){ o.x=r(mb.position.x); o.y=r(mb.position.y);
              o.vx=r(mb.velocity.x*60); o.vy=r(mb.velocity.y*60);
              o.a=r(mb.angle); o.w=r(mb.angularVelocity*60); o.m=r(mb.mass); }
      else  { o.x=r(B.x); o.y=r(B.y); o.vx=r(B.vx); o.vy=r(B.vy);
              o.a=r(B.th); o.w=r(B.om); }
      if(B.len!=null) o.len=r(B.len);
      if(B.cur!=null) o.cur=r(B.cur);
      if(B.ks!=null)  o.ks=r(B.ks);
      if(B.fixed) o.fx=1;
      if(B.mem&&B.mem.length){ var s=''; for(var k=0;k<B.mem.length;k++){ if(B.mem[k]&&B.mem[k].type) s+=B.mem[k].type; } o.mem=s; }
      if(B.glyphs&&B.glyphs.length){ var g=''; for(k=0;k<B.glyphs.length;k++){ if(B.glyphs[k]&&B.glyphs[k].ch) g+=B.glyphs[k].ch; } o.gl=g; }
      out.bs.push(o);
    }
    for (var j=0;j<freeL.length;j++){
      var L=freeL[j]; if(!L||L.dead) continue;
      out.fl.push({i:j, ch:L.ch, st:L.state||null, x:r(L.wx), y:r(L.wy)});
    }
    return out;
  }

  return {step:step, snap:snap, setAxisScale:setAxisScale, setFixed:setFixed, setParam:setParam};
})();

/* Scenario setup bodies are compiled with \`new Function('T', ...)\`, so they can
 * reach the helpers either as \`T.setFixed(...)\` or as bare globals. Publishing
 * them keeps scenario source readable and matches how the legacy app's own
 * factory functions (makeGround, makeRod, ...) are already reached. */
window.setAxisScale = window.__T.setAxisScale;
window.setFixed = window.__T.setFixed;
window.setParam = window.__T.setParam;
`;

/**
 * Pre-init freeze: installed BEFORE any page script runs (addInitScript), so the
 * app's own `frame()` loop never advances the world. Without this the page runs a
 * variable number of rAF frames between load and our first evaluate(), leaving a
 * nondeterministic amount of simulated time (observed lastT 146–165ms) and making
 * baselines unreproducible.
 *
 * requestAnimationFrame is replaced with a no-op that returns a valid id and never
 * invokes the callback. The app's `init()` still runs (DOM setup, panel, etc.);
 * only its self-driven simulation loop is stopped.
 */
const PREINIT_FREEZE = `
(function(){
  window.__T_frozen = true;
  window.requestAnimationFrame = function(){ return 0; };
  window.cancelAnimationFrame = function(){};
})();
`;

export class Harness {
  constructor(opts = {}) {
    this.viewport = opts.viewport || { width: 1280, height: 800 };
    this.timeout = opts.timeout || 60000;
  }

  async launch() {
    this.browser = await chromium.launch({
      env: { ...process.env, LD_LIBRARY_PATH: LIB_DIRS.join(':') },
    });
    const ctx = await this.browser.newContext({ viewport: this.viewport });
    this.page = await ctx.newPage();
    this.errors = [];
    this.page.on('pageerror', (e) => this.errors.push('pageerror: ' + e.message));
    this.page.on('console', (m) => {
      if (m.type() === 'error') this.errors.push('console: ' + m.text());
    });
    // must be registered before goto so it applies to the page's own scripts
    await this.page.addInitScript(PREINIT_FREEZE);
    await this.page.goto(targetUrl());
    // ★2026-10: `this.timeout` used to be dead — set in the constructor and never
    // applied anywhere, so a page that never finished booting would hang the whole
    // run forever with no message. Apply it to the boot wait and to the per-scenario
    // stepping call, which are the two places that can actually wedge.
    await this.page.waitForFunction(
      'typeof bodies !== "undefined" && typeof stepPhysics === "function" && typeof makeGround === "function"',
      null,
      { timeout: this.timeout }
    );
    await this.page.evaluate(TEST_API);
    return this;
  }

  async close() {
    if (this.browser) await this.browser.close();
  }

  /** Run a scenario function inside the page, then step and snapshot. */
  async run(scenario) {
    const result = await this.page.evaluate(async (src) => {
      const fn = new Function('T', 'return (' + src + ')(T);');
      return await fn(window.__T);
    }, scenario.toString());
    return result;
  }

  async snapshot() {
    return this.page.evaluate(() => window.__T.snap());
  }

  async step(n, dt = 1 / 60) {
    // bounded by this.timeout (see launch()) so a wedged page fails the run instead
    // of hanging it; the harness's own timeout option was previously ignored.
    await this.page.evaluate(([n, dt]) => window.__T.step(n, dt), [n, dt]);
  }
}

/** Compare two snapshots and return a list of human-readable differences. */
export function diffSnapshots(a, b, opts = {}) {
  const tol = opts.tol ?? 0.01;
  const diffs = [];
  const label = opts.label || 'state';

  if (a.n !== b.n) diffs.push(`${label}: body count ${a.n} -> ${b.n}`);
  if (a.nfl !== b.nfl) diffs.push(`${label}: freeL count ${a.nfl} -> ${b.nfl}`);

  const n = Math.max(a.bs.length, b.bs.length);
  for (let i = 0; i < n; i++) {
    const x = a.bs[i], y = b.bs[i];
    if (!x || !y) { diffs.push(`${label}: body[${i}] ${x ? 'removed' : 'added'}`); continue; }
    for (const k of ['x', 'y', 'vx', 'vy', 'a', 'w', 'm', 'len', 'cur', 'ks']) {
      const xv = x[k], yv = y[k];
      if (xv == null && yv == null) continue;
      if (xv == null || yv == null) { diffs.push(`${label}: body[${i}].${k} ${xv} -> ${yv}`); continue; }
      // non-finite values are encoded as strings (see snap()); compare exactly
      if (typeof xv === 'string' || typeof yv === 'string') {
        if (xv !== yv) diffs.push(`${label}: body[${i}].${k} ${xv} -> ${yv}`);
        continue;
      }
      if (Math.abs(xv - yv) > tol) {
        diffs.push(`${label}: body[${i}].${k} ${xv} -> ${yv} (Δ${(yv - xv).toFixed(4)})`);
      }
    }
    for (const k of ['kind', 'dead', 'fx', 'mem', 'gl']) {
      if (x[k] !== y[k]) diffs.push(`${label}: body[${i}].${k} ${x[k]} -> ${y[k]}`);
    }
  }

  const m = Math.max(a.fl.length, b.fl.length);
  for (let i = 0; i < m; i++) {
    const x = a.fl[i], y = b.fl[i];
    if (!x || !y) { diffs.push(`${label}: freeL[${i}] ${x ? 'removed' : 'added'}`); continue; }
    for (const k of ['ch', 'st']) if (x[k] !== y[k]) diffs.push(`${label}: freeL[${i}].${k} ${x[k]} -> ${y[k]}`);
    for (const k of ['x', 'y']) {
      if (x[k] == null || y[k] == null) continue;
      if (Math.abs(x[k] - y[k]) > tol) diffs.push(`${label}: freeL[${i}].${k} ${x[k]} -> ${y[k]}`);
    }
  }
  return diffs;
}

export { INDEX, ROOT, TEST_API };
