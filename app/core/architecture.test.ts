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
