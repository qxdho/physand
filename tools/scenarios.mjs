/**
 * scenarios.mjs — the regression scenarios the harness replays.
 *
 * Each scenario:
 *   id       stable name; baselines are stored under baselines/<id>.json
 *   setup    runs in-page before stepping; must be deterministic
 *   steps    list of {n, dt?} — fixed-dt physics advances, snapshotted after each
 *   tol      absolute tolerance for float comparison (default 0.01 px)
 *
 * SCOPE / HONEST LIMITS
 * ---------------------
 * These scenarios exercise the *simulation core* (spawn -> integrate -> collide ->
 * settle). They deliberately do NOT attempt to replay real user recordings from
 * the bug list: those encode absolute client coordinates tied to a specific
 * viewport/DPR, and this harness drives physics directly rather than injecting
 * pointer events. Pointer-level replay is a separate, later capability.
 *
 * What they DO give you: if a refactor changes how bodies fall, rest, collide or
 * conserve energy, these go red. That is exactly the safety net a modularization
 * needs. Add a scenario here whenever you fix a physics bug.
 */

export const SCENARIOS = [
  {
    id: 'empty-steady',
    doc: 'Empty world: nothing should appear or move. Catches startup/global-init damage.',
    setup: () => true,
    steps: [{ n: 60 }, { n: 60 }],
  },

  {
    id: 'shape-freefall',
    doc: 'A drawn closed square free-falls under gravity. Catches integrator/gravity changes.',
    setup: () => {
      mkBoundary([[400, 150], [480, 150], [480, 210], [400, 210]], { shape: 'poly', closed: true });
      return true;
    },
    steps: [{ n: 15 }, { n: 15 }, { n: 30 }],
  },

  {
    id: 'shape-rest-on-ground',
    doc: 'Drawn square falls onto a fixed ground and comes to rest. Catches collision/solver changes.',
    setup: () => {
      makeGround(640, 700, 900);
      mkBoundary([[400, 150], [480, 150], [480, 210], [400, 210]], { shape: 'poly', closed: true });
      return true;
    },
    steps: [{ n: 30 }, { n: 90 }, { n: 120 }],
  },

  {
    id: 'two-shapes-stack',
    doc: 'Two shapes dropped in sequence stack on the ground. Catches contact-ordering/sleep changes.',
    setup: () => {
      makeGround(640, 720, 1000);
      mkBoundary([[400, 120], [480, 120], [480, 180], [400, 180]], { shape: 'poly', closed: true });
      mkBoundary([[430, 20], [500, 20], [500, 70], [430, 70]], { shape: 'poly', closed: true });
      return true;
    },
    steps: [{ n: 40 }, { n: 80 }, { n: 180 }],
  },

  {
    id: 'circle-roll',
    doc: 'A drawn circle falls onto the ground. Catches circle-collision (analytic shell) changes.',
    setup: () => {
      makeGround(640, 700, 1200);
      mkBoundary(
        Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          return [400 + Math.cos(a) * 40, 180 + Math.sin(a) * 40];
        }),
        { shape: 'circle', rad: 40, closed: true }
      );
      return true;
    },
    steps: [{ n: 30 }, { n: 120 }, { n: 120 }],
  },

  {
    id: 'rod-static-anchors',
    doc: 'A rod spawned with no anchors must not drift. Catches rod anchor/resync regressions.',
    setup: () => {
      makeGround(640, 720, 900);
      makeRod(400, 300, 0, 0);
      return true;
    },
    steps: [{ n: 60 }, { n: 60 }],
  },

  {
    id: 'belt-static',
    doc: 'A conveyor belt is a fixed device: it must not fall or drift under gravity.',
    setup: () => {
      makeBelt(400, 500);
      return true;
    },
    steps: [{ n: 60 }, { n: 120 }],
  },

  /* ------------------------------------------------------------------------
   * ANCHORED ROD + SPRING
   *
   * WHY THESE TWO EXIST (added after the blind-spot finding)
   * -------------------------------------------------------
   * `rod-static-anchors` above is NOT sufficient to cover the rod subsystem.
   * It builds its rod with `makeRod(400, 300, 0, 0)`, which leaves
   * `B.anc = [null, null]` — and `rodSyncAnchors` (src/10-app.js:1518) opens with
   * `if(!B.anc[0] && !B.anc[1]) return false;`. So that scenario only ever
   * exercises the early-return guard: the ~368-line constraint body never runs.
   * Verified by experiment — `if(1)return false;` injected at the top of
   * `rodSyncAnchors` still passed 7/7, because no scenario ever anchors a rod.
   *
   * These scenarios anchor for real, via the same entry point the UI uses
   * (`rodTryAnchor` / `springTryAnchor`), so the constraint solver is on the
   * hot path. The rod case also pins the R106 length-conservation invariant
   * (`len` must stay exactly 170 while swinging) — the exact class of bug that
   * motivated that fix.
   *
   * Both were verified deterministic across three consecutive independent runs.
   * ------------------------------------------------------------------------ */

  {
    id: 'rod-anchored-swing',
    doc: 'A rod pinned at one end to a fixed host swings under gravity without stretching. ' +
         'Covers rodSyncAnchors beyond its no-anchor early return (R106 length conservation).',
    setup: () => {
      // Fixed host: its lower face sits at y = 300 + 9 = 309 (GROUND_TH/2 == 9).
      makeGround(420, 300, 200);
      const rod = makeRod(420, 394, 0, 0);
      // Stand the rod upright so its upper end lands exactly on the host's lower face
      // (centre y 394 +/- half-length 85 => ends at y 309 and y 479).
      rod.th = Math.PI / 2;
      rodTryAnchor(rod);           // snaps end [1] (y=309) onto the host
      rod.vx = 300;                // kick it so the joint solver actually works
      return true;
    },
    steps: [{ n: 30 }, { n: 30 }, { n: 60 }, { n: 120 }],
  },

  {
    id: 'spring-hanging-mass',
    doc: 'A ball hangs from a fixed host on a spring and oscillates to equilibrium. ' +
         'Covers stepSprings anchor-following (no spring scenario existed before).',
    setup: () => {
      makeGround(420, 200, 200);   // lower face at y = 209
      // 16-gon == the analytic circle shell, same construction as `circle-roll`.
      mkBoundary(
        Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          return [420 + Math.cos(a) * 30, 420 + Math.sin(a) * 30];
        }),
        { shape: 'circle', rad: 30, closed: true }
      );
      const spr = makeSpring(420, 209, 420, 390);
      springTryAnchor(spr);        // end [0] -> host, end [1] -> ball
      return true;
    },
    steps: [{ n: 60 }, { n: 60 }, { n: 120 }],
  },

  /* ------------------------------------------------------------------------
   * RESIZE A DRAWN SHAPE
   *
   * WHY THIS EXISTS
   * ---------------
   * "I can't make a placed block bigger" turned out to be two separate bugs,
   * both invisible to the previous 9 scenarios:
   *
   *   1. The size knob was only offered when the body carried an `r` glyph, so a
   *      shape you just drew had no size row. (Panel-level; covered by unit
   *      tests in app/params/w-body.test.ts.)
   *
   *   2. `refresh()` CRASHED on any drawn shape with no glyph — `B.fg` is null,
   *      and `layoutField` unconditionally did `B.glyphs=[B.fg]` plus
   *      `B.fg.body=...`. Verified to throw on the legacy build too, so this
   *      was a long-standing latent crash, not a regression. It went unnoticed
   *      precisely BECAUSE of bug 1: only `r`-carrying bodies could be resized,
   *      and those always have an `fg`.
   *
   *   3. Even once it stopped crashing, resizing did nothing: the `scaleParam`
   *      application lives in the formula-body branch of `refresh()`, and drawn
   *      `W` bodies return early from `layoutField`. So the geometry was never
   *      actually scaled.
   *
   * This scenario pins the observable outcome: resizing must change the physics,
   * must be proportional (not cumulative), and must return to the original state.
   * ------------------------------------------------------------------------ */

  {
    id: 'shape-resize-scaled',
    doc: 'A drawn square resized to 2x falls and rests; the collider must actually grow. ' +
         'Covers applyInkScale + the null-`fg` crash in layoutField.',
    setup: () => {
      makeGround(640, 700, 1200);
      const sq = mkBoundary(
        [[380, 140], [460, 140], [460, 200], [380, 200]],
        { shape: 'poly', closed: true },
      );
      // 2x via the same entry point the panel uses.
      applyParam(sq, PARAM_DEFS['scale'], 2);
      return true;
    },
    steps: [{ n: 30 }, { n: 90 }, { n: 120 }],
  },

  {
    id: 'shape-resize-identity',
    doc: 'Resizing to 2x then back to 1x must restore the exact original geometry. ' +
         'Catches cumulative-growth bugs in the scale path (the "gets bigger every time" class).',
    setup: () => {
      makeGround(640, 700, 1200);
      const sq = mkBoundary(
        [[380, 140], [460, 140], [460, 200], [380, 200]],
        { shape: 'poly', closed: true },
      );
      applyParam(sq, PARAM_DEFS['scale'], 2);
      applyParam(sq, PARAM_DEFS['scale'], 1);   // must return to the original box
      return true;
    },
    steps: [{ n: 30 }, { n: 90 }, { n: 120 }],
  },

  /* ------------------------------------------------------------------------
   * NON-UNIFORM RESIZE + FIXED TOGGLE
   *
   * These cover the parameters added for "参数调节并不丰富": independent width
   * and height (uniform `scale` alone cannot turn a square into a plank), and a
   * fixed/pin toggle that previously existed only in the right-click menu.
   *
   * The stretched case matters physically, not just visually: the collider is
   * rebuilt from the scaled ink points, so a wrong `hull` invalidation would
   * leave the body resting at the wrong height or falling through.
   *
   * TARGET NOTE: `wscaleX` / `wscaleY` / `wfixed` are registry-only parameters,
   * so they exist in the Vite build (where `bridgeParamDefs()` synthesizes their
   * PARAM_DEFS entries) but NOT in the frozen legacy single-file build. The
   * helpers below therefore guard on availability and fall back to writing the
   * body field directly, which keeps both targets runnable and comparable —
   * the legacy build simply exercises the same physics through the raw field.
   * ------------------------------------------------------------------------ */

  {
    id: 'shape-stretch-width',
    doc: 'A square stretched 3x wide (height unchanged) must rest on the ground with the ' +
         'STRETCHED collider — catches hull-cache invalidation bugs in non-uniform resize.',
    setup: () => {
      makeGround(640, 720, 1200);
      const sq = mkBoundary(
        [[400, 140], [460, 140], [460, 180], [400, 180]],
        { shape: 'poly', closed: true },
      );
      setAxisScale(sq, 'wscaleX', 'wScaleX', 3);
      return true;
    },
    steps: [{ n: 30 }, { n: 90 }, { n: 120 }],
  },

  {
    id: 'shape-stretch-identity',
    doc: 'Stretching both axes then restoring must return to the exact original geometry. ' +
         'Guards against cumulative growth across the two axis factors.',
    setup: () => {
      makeGround(640, 720, 1200);
      const sq = mkBoundary(
        [[400, 140], [460, 140], [460, 180], [400, 180]],
        { shape: 'poly', closed: true },
      );
      setAxisScale(sq, 'wscaleX', 'wScaleX', 2.5);
      setAxisScale(sq, 'wscaleY', 'wScaleY', 1.8);
      setAxisScale(sq, 'wscaleX', 'wScaleX', 1);
      setAxisScale(sq, 'wscaleY', 'wScaleY', 1);
      return true;
    },
    steps: [{ n: 30 }, { n: 90 }, { n: 120 }],
  },

  {
    id: 'shape-fixed-holds',
    doc: 'A body toggled to fixed must hang in mid-air instead of falling. ' +
         'Covers the parameter-panel path for the pin toggle (previously menu-only).',
    setup: () => {
      makeGround(640, 720, 1200);
      const sq = mkBoundary(
        [[400, 200], [480, 200], [480, 260], [400, 260]],
        { shape: 'poly', closed: true },
      );
      setFixed(sq, true);
      return true;
    },
    steps: [{ n: 60 }, { n: 120 }],
  },

  /* ------------------------------------------------------------------------
   * DEVICE PARAMETERS
   *
   * The device knobs (spring k / L0 / damping, rod length / mass, ground length,
   * belt speed) went through the same registry migration as the shape knobs.
   * These scenarios pin the OBSERVABLE physics, not the plumbing: a stiffness
   * change must change how far a hanging mass sags, and a rod-length change must
   * change the rod's actual geometry.
   *
   * Both matter because the legacy write paths were not plain field writes —
   * they must go through choke points that rebuild the collision mirror
   * (`springSetLen`, `setRodLen`). Writing the field alone produced bodies that
   * were "visible but not touchable" (legacy R98-1 measured the rod's collision
   * plate stuck at its original width).
   * ------------------------------------------------------------------------ */

  {
    id: 'spring-soft-sag',
    doc: 'A soft spring (low k) must let the hanging mass sag far. Pairs with ' +
         'spring-stiff-sag to prove the k parameter actually reaches the solver.',
    setup: () => {
      makeGround(420, 200, 200);
      const ball = mkBoundary(
        Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          return [420 + Math.cos(a) * 25, 420 + Math.sin(a) * 25];
        }),
        { shape: 'circle', rad: 25, closed: true },
      );
      const spr = makeSpring(420, 209, 420, 390);
      springTryAnchor(spr);
      setParam(spr, 'sk', 30);      // soft
      return true;
    },
    steps: [{ n: 60 }, { n: 90 }, { n: 120 }],
  },

  {
    id: 'spring-stiff-sag',
    doc: 'A stiff spring (high k) must barely sag under the same mass. The contrast ' +
         'with spring-soft-sag is the regression signal for the k write path.',
    setup: () => {
      makeGround(420, 200, 200);
      const ball = mkBoundary(
        Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          return [420 + Math.cos(a) * 25, 420 + Math.sin(a) * 25];
        }),
        { shape: 'circle', rad: 25, closed: true },
      );
      const spr = makeSpring(420, 209, 420, 390);
      springTryAnchor(spr);
      setParam(spr, 'sk', 500);     // stiff
      return true;
    },
    steps: [{ n: 60 }, { n: 90 }, { n: 120 }],
  },

  {
    id: 'rod-length-changed',
    doc: 'Changing rod length must move the actual endpoints (and rebuild the collider). ' +
         'Covers setRodLen as the choke point for rod geometry.',
    setup: () => {
      makeGround(640, 720, 1200);
      const rod = makeRod(600, 300, 0, 0);
      setParam(rod, 'rodlen', 300);   // 170 -> 300
      return true;
    },
    steps: [{ n: 60 }, { n: 120 }],
  },
];
