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
];
