/**
 * Architectural guards.
 *
 * These are not behaviour tests — they protect the refactor itself from
 * silently regressing. Each one encodes a rule that, if broken, produces no
 * error and no failing scenario: just a codebase that quietly drifts back to
 * the shape the migration exists to fix.
 *
 * Run: node --test app/core/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every non-test TypeScript source file under app/, with its contents. */
function appSources(): { path: string; rel: string; text: string }[] {
  const out: { path: string; rel: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'legacy') continue; // generated assets
        walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        out.push({ path: full, rel: full.slice(APP.length + 1), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(APP);
  return out;
}

/** Strip comments and string literals so guards test CODE, not prose. */
function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }
      if (c === "'") { state = 'single'; i++; continue; }
      if (c === '"') { state = 'double'; i++; continue; }
      if (c === '`') { state = 'template'; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i++; continue; }
    if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i += 2; } else i++; continue; }
    if (c === '\\') { i += 2; continue; }
    if ((state === 'single' && c === "'") || (state === 'double' && c === '"') || (state === 'template' && c === '`')) {
      state = 'code';
    }
    i++;
  }
  return out;
}

test('the legacy bridge is the ONLY module that reads legacy globals directly', () => {
  /* WHY THIS MATTERS
   * Before this rule, the new modules contained 20+ ad-hoc casts of the form
   * `(globalThis as any).X`, each slightly different. That is how the original
   * code accumulated 211 mutable globals read from everywhere: there was never
   * a single place to see the dependencies.
   *
   * Funnelling them through legacy.ts gives one auditable list, real types (a
   * typo'd name is a compile error instead of a silent `undefined`), and a
   * shrinking file that doubles as the phase-C progress metric.
   */
  const allowed = new Set([
    'core/legacy.ts', // the bridge itself
    'core/module-bridge.ts', // publishes the global surface (does not consume it)
    'core/panel-hooks.ts', // epilogue source string, runs inside the legacy scope
    'main.ts', // boot wiring
  ]);

  const offenders: string[] = [];
  for (const { rel, text } of appSources()) {
    if (allowed.has(rel)) continue;
    const code = stripCommentsAndStrings(text);
    if (!/\bglobalThis\b/.test(code)) continue;

    /* INSTALLING a bridge object is not the same as CONSUMING legacy state.
     * A module that does `globalThis.__myBridge = {...}` is publishing its own
     * surface so the in-scope epilogue can reach it — that is the mechanism this
     * refactor uses, not a coupling. Reading `globalThis.SOMETHING_LEGACY` is the
     * coupling we are preventing.
     *
     * So: every `globalThis` reference in the file must be an assignment target.
     */
    const lines = code.split('\n').filter((l) => l.includes('globalThis'));
    const consuming = lines.filter((l) => !/globalThis\s*\)?\s*(as[^;]*)?\)?\s*\[[^\]]*\]\s*=/.test(l)
      && !/globalThis\s*\)?\s*(as[^;]*)?\.\w+\s*=/.test(l));
    if (consuming.length) offenders.push(`${rel} (${consuming.length} read(s))`);
  }

  assert.deepEqual(
    offenders,
    [],
    `these modules reach for legacy globals directly instead of via ` +
      `core/legacy.ts: ${offenders.join(', ')}. Add a typed accessor to the ` +
      `bridge rather than casting globalThis.`,
  );
});

test('no parameter module declares its own legacy accessor helpers', () => {
  // The `constant`/`call` helper pair was duplicated in devices.ts and
  // formula.ts before being consolidated. Duplicated accessors drift: one gets
  // a NaN guard, the other does not.
  const paramDir = join(APP, 'params');
  const offenders: string[] = [];
  for (const entry of readdirSync(paramDir)) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    const text = readFileSync(join(paramDir, entry), 'utf8');
    if (/function\s+(K|G|call|setG)\s*\(/.test(text)) offenders.push(entry);
  }
  assert.deepEqual(
    offenders,
    [],
    `these modules define local legacy accessors instead of importing from ` +
      `core/legacy.ts: ${offenders.join(', ')}`,
  );
});

test('every parameter module is imported by main.ts', () => {
  /* A parameter module that nobody imports registers nothing. The registry
   * would be missing those parameters and the panel would silently lose rows,
   * with no error anywhere — the exact failure that already happened once when
   * the w-body side-effect import was dropped.
   *
   * main.ts also asserts the registry is non-empty at boot, but that only
   * catches "all modules missing", not "one module missing".
   */
  // NOTE: read the RAW source here. The import paths ARE string literals, so
  // stripping strings would erase exactly what this guard looks for.
  const main = readFileSync(join(APP, 'main.ts'), 'utf8');
  const paramDir = join(APP, 'params');
  const modules = readdirSync(paramDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => f.replace(/\.ts$/, ''));

  // These are SIDE-EFFECT imports (`import './params/x'`), not named imports —
  // the whole point is that merely importing runs the registrations.
  const missing = modules.filter((m) => !main.includes(`./params/${m}`));
  assert.deepEqual(
    missing,
    [],
    `these parameter modules are not imported by main.ts, so their ` +
      `registrations never run: ${missing.join(', ')}`,
  );
});

test('the legacy single-file sources are not modified during the migration', () => {
  /* Phase A-D install new architecture around the legacy app; the physics file
   * is only ever edited deliberately and with its own reasoning. This guard is
   * a tripwire, not a ban: if a change is intended, the assertion is updated in
   * the same commit and the diff makes that explicit.
   *
   * Two intentional edits so far:
   *   - applyInkScale + the null-`fg` crash fix (resize support)
   */
  const app = readFileSync(join(APP, '..', 'src', '10-app.js'), 'utf8');
  assert.ok(
    app.includes('function applyInkScale(B)'),
    'applyInkScale must exist in the legacy app (resize support)',
  );
  assert.ok(
    app.includes('function stepPhysics(dt)'),
    'core physics entry point must still exist',
  );
});

test('every installed bridge object is actually consumed somewhere', () => {
  /* WHY THIS EXISTS
   * `World.readView()` was built in phase B round 1 and found UNUSED later: the
   * recorder read globals directly, and the facade's key was assigned in
   * main.ts but never read by anything. It LOOKED like migration progress while
   * changing nothing.
   *
   * The lesson is that "the abstraction exists" is not progress; "a call site
   * moved" is. So this guard requires each bridge key to be READ somewhere other
   * than its own installation site.
   *
   * WHERE CONSUMPTION LIVES DEPENDS ON THE DESIGN:
   *   - `__recorderFacade` is read from src/10-app.js (the recorder consults it).
   *   - `__paramHooks` is read from an EPILOGUE STRING in app/core/, because the
   *     panel functions must be wrapped from INSIDE the legacy scope; patching
   *     globals provably cannot reach them (verified in an earlier round).
   *
   * Hence: raw source (not comment/string-stripped), because the epilogue IS a
   * string literal and stripping would erase the evidence.
   */
  const legacy = readFileSync(join(APP, '..', 'src', '10-app.js'), 'utf8');
  const appText = appSources()
    .map((s) => s.text)
    .join('\n');

  /** True when `key` is READ somewhere, ignoring its own installation line. */
  function isConsumed(key: string): boolean {
    if (legacy.includes(key)) return true;
    // In app code, count only lines that reference the key WITHOUT assigning to
    // it — an assignment is installation, not consumption.
    return appText.split('\n').some((line) => {
      if (!line.includes(key)) return false;
      const assigningToIt = new RegExp(`globalThis[^;]*=\\s*\\{[^}]*$`).test(line) ||
        new RegExp(`${key}\\s*=`).test(line);
      return !assigningToIt;
    });
  }

  const bridges = [
    { name: '__paramHooks (parameter registry)', key: '__paramHooks' },
    { name: '__recorderFacade (recorder)', key: '__recorderFacade' },
  ];

  const unused = bridges.filter((b) => !isConsumed(b.key)).map((b) => b.name);

  assert.deepEqual(
    unused,
    [],
    `these bridge objects are installed but never read, so they change ` +
      `nothing: ${unused.join(', ')}`,
  );
});

test('body removal goes through the collection module, not a bare splice', () => {
  /* WHY THIS EXISTS (phase C, the `physics` boundary)
   * The lifecycle survey found 13 removal sites: 8 hand-written
   * \`indexOf\`+splice pairs and 5 bare splices inside backwards loops. They now all
   * call one of two helpers, which delegate to app/physics/body-list.ts.
   *
   * A bare splice is easy to reintroduce and hard to notice: it works, it just
   * skips the single place where the "remove by identity, tolerate a double
   * remove" rule lives. So this guard fails on any NEW direct splice.
   *
   * The array itself is not being replaced (≈372 read sites index into it), so
   * reads are still fine — only the mutation has one door.
   */
  const legacy = readFileSync(join(APP, '..', 'src', '10-app.js'), 'utf8');
  const lines = legacy.split('\n');

  /* The two helpers are the intended home for the fallback splice, so their own
   * bodies are the only place it may appear. Located by name rather than by line
   * number so the guard survives edits above them. */
  const allowed = new Set<number>();
  for (const helper of ['function _bodyRemove(B){', 'function _bodyRemoveAt(i){']) {
    const start = lines.findIndex((l) => l.startsWith(helper));
    assert.ok(start > 0, `${helper} must exist`);
    let depth = 0;
    for (let i = start; i < lines.length; i++) {
      allowed.add(i);
      depth += (lines[i]!.match(/{/g) ?? []).length;
      depth -= (lines[i]!.match(/}/g) ?? []).length;
      if (depth <= 0 && i > start) break;
    }
  }

  const offenders: string[] = [];
  lines.forEach((line, i) => {
    if (/^\s*\*|^\s*\/\*/.test(line)) return; // comments may mention it
    if (!/bodies\.splice\(/.test(line)) return;
    if (allowed.has(i)) return; // inside the helpers: the one intended fallback
    offenders.push(`L${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(
    offenders,
    [],
    `these sites remove a body directly instead of via _bodyRemove/_bodyRemoveAt:\n` +
      offenders.join('\n'),
  );
});

test('body liveness is asked through the named query, not a bare indexOf', () => {
  /* WHY THIS EXISTS
   * 23 of the 28 legacy `bodies.indexOf(...)` sites are liveness checks —
   * "is this anchor host still in the world?" — not position lookups. They now
   * call \`_bodyAlive()\`, which delegates to the collection module.
   *
   * The reason to guard it: \`bodies.indexOf(x) >= 0\` and \`bodies.indexOf(x)\` are
   * one keystroke apart, and the second form yields a NUMBER, so it is truthy for
   * every position except -1... which is exactly right until a body sits at
   * index -1, which cannot happen. The failure is subtler than it looks: a site
   * that omits the comparison still works, so nothing points at it.
   *
   * Genuine index uses remain legal — passing the position to a function that
   * wants it, or splicing — so this flags only COMPARISONS against zero.
   */
  const legacy = readFileSync(join(APP, '..', 'src', '10-app.js'), 'utf8');
  const lines = legacy.split('\n');

  /* _bodyAlive itself must contain the raw comparison — that is its FALLBACK
   * for when the bridge is absent. Located by name so the guard survives edits
   * above it. */
  const helperStart = lines.findIndex((l) => l.startsWith('function _bodyAlive(B){'));
  assert.ok(helperStart > 0, '_bodyAlive must exist');
  let helperEnd = helperStart;
  for (let i = helperStart, depth = 0; i < lines.length; i++) {
    depth += (lines[i]!.match(/{/g) ?? []).length;
    depth -= (lines[i]!.match(/}/g) ?? []).length;
    if (depth <= 0 && i > helperStart) { helperEnd = i; break; }
  }

  const offenders: string[] = [];
  lines.forEach((line, i) => {
    if (/^\s*\*|^\s*\/\*/.test(line)) return;
    if (i >= helperStart && i <= helperEnd) return; // the intended fallback
    if (/bodies\.indexOf\([^)]*\)\s*(>=|<)\s*0/.test(line)) {
      offenders.push(`L${i + 1}: ${line.trim()}`);
    }
  });
  assert.deepEqual(
    offenders,
    [],
    'these sites ask whether a body is alive with a raw indexOf comparison ' +
      'instead of _bodyAlive():\n' +
      offenders.join('\n'),
  );
});

test('body iteration bounds come from the collection, not a raw length', () => {
  /* WHY THIS EXISTS
   * 83 legacy loops shared one exact shape — \`for(var i=0;i<bodies.length;i++)\` —
   * and each restated the bound independently. They now read it from the
   * collection module, so a change of storage touches one place.
   *
   * The guard exists because reintroducing the raw form is invisible: it works,
   * and the only symptom would appear later, when the collection's storage
   * changes and this loop silently keeps consulting a global.
   *
   * Only FOR-loop bounds are flagged. A one-off \`bodies.length\` read (a count
   * used in arithmetic, or a backwards initialization) is a different thing and
   * is deliberately not covered.
   */
  const legacy = readFileSync(join(APP, '..', 'src', '10-app.js'), 'utf8');
  const offenders: string[] = [];
  legacy.split('\n').forEach((line, i) => {
    if (/^\s*\*|^\s*\/\*/.test(line)) return;
    if (/for\s*\([^)]*<\s*bodies\.length/.test(line)) {
      offenders.push(`L${i + 1}: ${line.trim()}`);
    }
  });
  assert.deepEqual(
    offenders,
    [],
    'these loops bound themselves on the raw bodies.length instead of ' +
      '_bodyCount():\n' +
      offenders.join('\n'),
  );
});

test('generated files declare themselves as generated', () => {
  // Someone editing a generated file by hand would have their change silently
  // overwritten by the next `npm run gen`. The header is the warning.
  const generated = [
    'core/legacy-globals.generated.ts',
    'legacy/style.css',
    'legacy/body.html',
    'legacy/mid.html',
  ];
  for (const rel of generated) {
    const text = readFileSync(join(APP, rel), 'utf8');
    assert.match(
      text,
      /GENERATED by|generated by/i,
      `${rel} must carry a "generated" header so it is not hand-edited`,
    );
  }
});

test('module code reads canvas geometry through the viewport module, not globals', () => {
  /* WHY THIS EXISTS (phase C)
   * A call-graph analysis found 476 of 555 legacy functions in ONE connected
   * component — there is no clean seam to cut modules along. Drilling in found
   * the glue is largely two variables: `W` (413 references, read by 110
   * functions) and `bodies` (372, read by 104).
   *
   * Geometry is the tractable half: it is written in exactly one place
   * (`resize()`), so it can be read through a named surface immediately. That is
   * what `core/viewport.ts` provides, and it is the prerequisite for extracting
   * rendering and layout groups later.
   *
   * This guard keeps new module code from re-introducing the free-variable
   * dependency that made those groups inseparable in the first place.
   */
  const allowed = new Set([
    'core/legacy.ts', // reads the globals on the module's behalf
    'core/viewport.ts', // owns the geometry surface
  ]);
  /* The geometry globals are all SHORT, which makes a regex-only check prone to
   * false positives: \`H\` is a canvas height AND a perfectly reasonable
   * parameter name for a host body (see render/anchor-geometry.ts). What matters
   * is whether the identifier is a FREE variable or locally bound.
   *
   * So the check first collects every name the file binds — parameters, \`var\`,
   * \`let\`, \`const\`, function declarations, imports — and only flags
   * occurrences of a geometry name that are NOT among them.
   */
  const geometryNames = ['W', 'H', 'groundY', 'PX_PER_M', 'BND_INK', 'CEL_INSET', 'BH_REACH'];
  const bareGeometry = new RegExp(
    '\\b(' + geometryNames.join('|') + ')\\b',
  );
  const notProperty = /(?<![.\w])(W|H|groundY|PX_PER_M|BND_INK|CEL_INSET|BH_REACH)(?![\w(])/;

  /** Names bound anywhere in the file: params, locals, functions, imports. */
  function boundNames(code: string): Set<string> {
    const bound = new Set<string>();
    for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]!);
    for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]!);
    for (const m of code.matchAll(/\bimport\s+([\s\S]*?)\bfrom\b/g)) {
      for (const n of m[1]!.matchAll(/([A-Za-z_$][\w$]*)/g)) bound.add(n[1]!);
    }
    // Function parameters, including destructured-ish simple lists.
    for (const m of code.matchAll(/\(([^()]*)\)\s*(?::[^{;=]*)?=>/g)) {
      for (const n of m[1]!.matchAll(/([A-Za-z_$][\w$]*)/g)) bound.add(n[1]!);
    }
    for (const m of code.matchAll(/function[^(]*\(([^)]*)\)/g)) {
      for (const n of m[1]!.matchAll(/([A-Za-z_$][\w$]*)/g)) bound.add(n[1]!);
    }
    return bound;
  }

  const offenders: string[] = [];
  for (const { rel, text } of appSources()) {
    if (allowed.has(rel)) continue;
    const code = stripCommentsAndStrings(text);
    const bound = boundNames(code);
    for (const line of code.split('\n')) {
      /* Skip only lines that are PURELY an import/export clause. An earlier
       * version skipped every line STARTING with "export", which silently
       * exempted \`export function f(){ return W; }\` — a real free read. */
      if (/^\s*import\b/.test(line)) continue;
      if (/^\s*export\s+(type\s+)?[{*]/.test(line)) continue;
      if (/^\s*export\s+type\b/.test(line)) continue;
      const hits = [...line.matchAll(new RegExp(notProperty.source, 'g'))];
      for (const h of hits) {
        const name = h[1]!;
        if (bound.has(name)) continue; // locally bound: a parameter, not the global
        if (!bareGeometry.test(name)) continue;
        offenders.push(`${rel}: ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these module lines depend on canvas geometry globals instead of ` +
      `core/viewport.ts:\n${offenders.join('\n')}`,
  );
});

test('extracted renderers take their context as a parameter', () => {
  /* WHY THIS EXISTS (phase C, "pluggable rendering")
   * The boundary survey found 476 of 555 legacy functions in one component.
   * Drilling in found 17 draw functions that read the canvas context and write
   * no shared state — genuinely extractable, unlike the rest.
   *
   * The extraction only has value if the moved functions stop closing over
   * globals: a renderer that still reads `cvx` from scope can only ever be moved
   * together with everything else that reads it, which is how the original file
   * became one component. So extracted renderers must RECEIVE the surface.
   */
  const renderDir = join(APP, 'render');
  const files = readdirSync(renderDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  assert.ok(files.length > 0, 'there must be at least one extracted renderer');

  const offenders: string[] = [];
  for (const f of files) {
    const rel = `render/${f}`;
    if (rel === 'render/surface.ts') continue; // the module that OWNS the lookup
    const code = stripCommentsAndStrings(readFileSync(join(renderDir, f), 'utf8'));
    for (const line of code.split('\n')) {
      if (/\bglobalThis\b/.test(line)) offenders.push(`${rel}: ${line.trim()}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `extracted renderers must receive the drawing surface as a parameter ` +
      `instead of reaching for globals:\n${offenders.join('\n')}`,
  );
});

test('geometry-dependent renderers are not extracted yet', () => {
  /* Honesty guard. Only renderers that were VERIFIED to write no shared state
   * have been moved. Functions like `render` and `drawTrails` still read
   * geometry and shared collections, so they stay in the legacy file until their
   * dependencies are narrowed too.
   *
   * If someone moves one of those without doing that work, this fails — which is
   * the intended outcome, because a half-moved renderer would silently depend on
   * boot order.
   */
  const renderDir = join(APP, 'render');
  const extracted = readdirSync(renderDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => f.replace(/\.ts$/, ''));

  // Only these are cleared for extraction; add to this list deliberately.
  /* Cleared by the renderer audit: zero key globals read as values AND zero
   * external function calls. Each was checked individually rather than as a
   * group, since a single shared dependency would make the whole group
   * un-movable.
   *
   *   drawSnapMarker(x,y)   reads nothing
   *   drawRope(B,slack)     B.e0, B.e1, B.len, B.nodes, B.anc
   *   drawHinge(B)          B.e0, B.e1, B.anc
   *   drawBlackHole(B)      B.bh, B.x, B.y
   */
  /* field.ts cleared the same way: zero key globals, and its only external calls
   are to pure helpers (rgba) that were verified stateless. */
  /* Data modules are not renderers: device-spec.ts holds constants and no
   * drawing code at all, so it is exempt from the cleared-for-extraction
   * question rather than being approved through it. */
  // Pure geometry and data have no drawing code, so the renderer-clearance
  // question does not apply to them.
  const dataOnly = new Set(['device-spec', 'anchor-geometry']);
  const approved = new Set(['surface', 'particles', 'devices', 'field', 'bodies', 'spring']);
  const unapproved = extracted.filter((f) => !approved.has(f) && !dataOnly.has(f));
  assert.deepEqual(
    unapproved,
    [],
    `these renderers were extracted without being cleared: ${unapproved.join(', ')}. ` +
      `Check first that they write no shared state.`,
  );
});
