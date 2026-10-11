# tools/ — build pipeline + replay safety net

Development-only. **Nothing in here ships.** The product is still the single
`index.html` at the repo root, and it must stay that way (see the note on
`file://` below).

This directory implements **stage 0** of [MODULARIZATION.md](../MODULARIZATION.md):
the safety net that has to exist *before* any refactoring is attempted.

---

## Why these tools exist

The codebase is one 21,395-line `index.html` containing 832 top-level
declarations. Its main script (`src/10-app.js`) has a single strongly-connected
component of **165 functions**, which together reference ~211 mutable globals —
about **375 declarations** in total (that combined figure was previously
mis-stated as a 375-node SCC; see MODULARIZATION.md §1.2). The coupling is
diffuse rather than hub-based: removing the largest single function only shrinks
the SCC from 165 to 144. The worst-referenced globals are `grab` (568
references), `W` (409) and `bodies` (372) — all read/written across the file.

That has two consequences this tooling exists to handle:

1. **There is no cheap place to put unit tests.** Everything depends on global
   mutable state. The correct granularity here is *behavioural replay*: set up a
   world, step the simulation deterministically, compare against a recorded
   baseline.
2. **You cannot safely move code without a net.** Every refactor step must be
   provably behaviour-neutral, or the 101-entry bug list becomes unserviceable.

---

## The one hard constraint

**`index.html` must remain a single self-contained file that runs from
`file://`.** The README promises "download it and double-click". ES modules are
blocked by CORS under `file://`, so `import`/`export` cannot be used in the
shipped artifact.

The build therefore does **deterministic concatenation**, not bundling:
`src/` → one `index.html`. No transpiler, no minifier for our own code, no new
runtime dependency.

---

## Layout

```
src/
  00-head.html        <!DOCTYPE> … <style>…</style>
  05-body.html        static DOM (panels, toolbar, overlays) up to the first <script>
  vendor/matter.js    Matter.js v0.20.0, verbatim (never hand-edited)
  10-app.js           the main application (~924 KB)
  50-mid.html         DOM fragment between the app script and the boss script
  90-boss.js          the boss-animation IIFE
  99-tail.html        trailing markup (</body></html>)

tools/
  split.mjs           ONE-TIME: extract src/ from an existing index.html
  build.mjs           src/ → index.html   (--check verifies byte-exactness)
  harness.mjs         headless Chromium driver + snapshot/diff primitives
  scenarios.mjs       the regression scenarios
  replay.mjs          run scenarios: --record to capture, default to compare
  baselines/*.json    recorded expected states (COMMIT THESE)
  fetch-syslibs.sh    extract Chromium's shared libs without root
  run.sh              wrapper: sets LD_LIBRARY_PATH / browser path, runs a script
```

---

## Usage

```bash
cd tools
npm install                     # playwright (once)

# build
node build.mjs                  # write index.html from src/
node build.mjs --check          # fail if src/ does not reproduce index.html exactly

# replay tests
bash run.sh replay.mjs --list   # list scenarios
bash run.sh replay.mjs          # compare index.html against baselines
bash run.sh replay.mjs --record # re-record baselines (only when the change is intended)
bash run.sh replay.mjs --only=shape-freefall
```

`run.sh` handles the environment automatically. On a slim container with no
root, the first run will fetch ~30 shared libraries (`libglib`, `libnss`, …)
into `.syslibs/` — see *Headless Chromium* below.

---

## The safe workflow

```bash
# 1. make sure you start from green
node tools/build.mjs --check
bash tools/run.sh replay.mjs

# 2. edit src/*.js        (NOT index.html — it is a build artifact now)

# 3. rebuild and verify
node tools/build.mjs
bash tools/run.sh replay.mjs

# 4. if the replay is green, the change is behaviour-neutral.
#    If it is red and the change was SUPPOSED to alter behaviour,
#    review the diff, then re-record:
bash tools/run.sh replay.mjs --record
```

**Rule of thumb:** during a refactor, `--record` should never be needed. If you
find yourself re-recording to make a *refactor* pass, the refactor changed
behaviour and needs investigating.

---

## What the harness does and does not do

**Does**

- Loads `index.html` over `file://`, exactly as a user would.
- Freezes the page's own `requestAnimationFrame` loop **before any page script
  runs** (`addInitScript`), then drives the physics with a fixed `dt` sequence.
  This is what makes runs reproducible — without it the page runs a variable
  number of frames during load (observed `lastT` 146–165 ms) and baselines do
  not reproduce.
- Snapshots a normalised view (position, velocity, angle, mass, rod length /
  spring `k`, formula memory, glyphs, free letters) rounded to 3 decimals.

**Does not (yet)**

- **Replay real user recordings from the bug list.** Those encode absolute
  client coordinates tied to a specific viewport/DPR, and this harness drives
  physics directly rather than injecting pointer events. Pointer-level replay is
  a separate, later capability — it is the natural stage-1 extension, and the
  recorder's payload (`recPayload()`) already contains everything needed
  (`events[]` with `x`/`y`/`type`, plus `init` and `frames`).
- Cover the UI, rendering, or the boss/black-hole state machine. Trails, panels
  and formula assembly are untouched by the current scenarios.

These limits are deliberate: the scenarios target the **simulation core**, which
is what a modularization of the physics is most likely to break.

**Still uncovered after the 2026-10 additions** (be aware of these before a
refactor): the UI, rendering, the boss/black-hole state machine, trails, panels,
formula assembly, rope, and the belt's traction behaviour. Of the ten largest
functions, `renderParamPanel`, `buildMatterBody`, `bossBuildPlat`, `refreshHover`
and `applyParam` have no direct scenario coverage at all. See the warning in the
Scenarios section for why "the suite is green" is not by itself evidence.

---

## Scenarios

| id | what it pins down |
|---|---|
| `empty-steady` | startup/global init — nothing appears or moves by itself |
| `shape-freefall` | gravity + integration on a drawn body |
| `shape-rest-on-ground` | contact resolution and settling |
| `two-shapes-stack` | contact ordering with multiple dynamic bodies |
| `circle-roll` | the analytic circle collision shell |
| `rod-static-anchors` | rods must not drift when unanchored |
| `belt-static` | devices stay static (a belt must not fall) |
| `rod-anchored-swing` | a rod pinned to a host swings without stretching (R106 length conservation) |
| `spring-hanging-mass` | a ball on a spring oscillates to equilibrium |

Add a scenario whenever you fix a physics bug — that is how the net grows.

> **Read this before trusting the net.** The last two scenarios were added in
> 2026-10 to close a **severe blind spot**, and the story matters more than the
> entries. The original 7 scenarios could not execute `rodSyncAnchors` at all:
> `rod-static-anchors` builds its rod via `makeRod(400,300,0,0)`, which leaves
> `B.anc = [null,null]`, so `rodSyncAnchors` returns at its second line
> (`if(!B.anc[0] && !B.anc[1]) return false;`, src/10-app.js:1518) and its
> ~368-line body never runs. Injecting `if(1)return false;` at the top of that
> function left the suite **7/7 green**. There was also no spring scenario at all.
>
> After adding the two scenarios, the same injection fails immediately with
> precise deltas.
>
> **The lesson: coverage is not "how many scenarios", it is "does the target code
> actually execute".** When you add a scenario, verify it drives the function you
> mean to protect — a green run over a function that early-returns proves nothing.

---

## Verified properties

These were checked when the tooling was built, and are worth re-checking if you
change the harness:

- **`build --check` is byte-exact.** `src/` reproduces the committed
  `index.html` exactly; splitting fresh and rebuilding leaves `index.html`
  untouched (`git diff` empty).
- **Runs are reproducible.** Three consecutive independent full runs: 9/9 pass.
  (The two anchored scenarios were each verified deterministic across three
  independent runs before their baselines were recorded.)
- **The net catches real regressions.** Changing `GRAV` from 2600 to 2500 (a
  ~4 % change) fails 4/7 scenarios with precise deltas
  (`vy 1300 → 1250`, i.e. exactly `ΔGRAV/60`). Injecting `if(1)return false;`
  into `rodSyncAnchors` fails `rod-anchored-swing`; the same into `stepSprings`
  fails `spring-hanging-mass`.
- **The net does not fire spuriously.** A comment-only change to `10-app.js`
  passes all scenarios.

---

## Headless Chromium without root

The container has no `libglib-2.0.so.0`, `libnss3.so`, etc., and `apt-get` needs
root. `fetch-syslibs.sh` walks the Debian package index, resolves the
**dependency closure** of the needed libraries, downloads the `.deb`s and
extracts them into `.syslibs/root/` with `dpkg-deb -x` (no root, no install).

```bash
./tools/fetch-syslibs.sh                # already invoked automatically by run.sh
```

Browser binary:

```bash
PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers npx playwright install chromium
```

Both `.syslibs/` and `.browsers/` are gitignored — they are large and
regenerable.

---

## Known gaps

- Scenarios drive physics only; UI/pointer interactions are not covered.
- Snapshot comparison is exact within tolerance — there is no notion of
  "acceptable" drift for a chaotic system. Scenarios are kept short (~5 s of
  simulated time) and single-purpose to stay in the linear regime.
- `50-mid.html` and `99-tail.html` are tiny DOM fragments. They exist so the
  build is byte-exact and so a future module split has somewhere to put markup.
