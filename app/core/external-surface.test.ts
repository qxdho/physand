/**
 * Tests for the external surface manifest.
 *
 * Two things must hold, and both are cheap to get wrong:
 *   1. every claimed name really is published by the bridge, and
 *   2. every name really is referenced by the consumer it is attributed to.
 *
 * A manifest that lists a name nobody uses, or attributes one to the wrong
 * consumer, is worse than no manifest — it would be a confident-looking
 * document that sends the next reader somewhere wrong.
 *
 * Run: node --test app/core/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXTERNAL_SURFACE, externalNames } from './external-surface.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GENERATED = readFileSync(join(ROOT, 'app', 'core', 'legacy-globals.generated.ts'), 'utf8');

/** The names the bridge publishes. */
function publishedNames(): Set<string> {
  return new Set([...GENERATED.matchAll(/^  '([^']+)',$/gm)].map((m) => m[1]!));
}

/** Strip comments and string literals so identifier matching is meaningful. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, ' ');
}

/** True when `name` appears as a free identifier (not a property access). */
function referencesIdentifier(code: string, name: string): boolean {
  const esc = name.replace(/\$/g, '\\$');
  return new RegExp(`(?<![.\\w$])${esc}(?![\\w$])`).test(code);
}

test('every listed name is actually published by the bridge', () => {
  // A name that does not exist cannot be depended on; listing it would make the
  // manifest fiction.
  const published = publishedNames();
  const missing = EXTERNAL_SURFACE.map((e) => e.name).filter((n) => !published.has(n));
  assert.deepEqual(missing, [], `these names are listed but never published: ${missing.join(', ')}`);
});

test('every name attributed to the boss script is referenced by it', () => {
  const boss = codeOnly(readFileSync(join(ROOT, 'src', '90-boss.js'), 'utf8'));
  const claimed = EXTERNAL_SURFACE.filter((e) => e.consumer === 'boss').map((e) => e.name);
  assert.ok(claimed.length > 0, 'the boss script is a consumer');
  const wrong = claimed.filter((n) => !referencesIdentifier(boss, n));
  assert.deepEqual(wrong, [], `attributed to the boss script but not found there: ${wrong.join(', ')}`);
});

test('every name attributed to the harness is referenced by it', () => {
  /* NOTE: do NOT strip template literals here. The harness steps physics from
   * inside a template string (\`TEST_API\`), which is the in-page script — that
   * is where the step functions are actually called. Stripping it would hide
   * every name this test is checking.
   */
  const harness = readFileSync(join(ROOT, 'tools', 'harness.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  const claimed = EXTERNAL_SURFACE.filter((e) => e.consumer === 'harness').map((e) => e.name);
  assert.ok(claimed.length > 0, 'the harness is a consumer');
  const wrong = claimed.filter((n) => !referencesIdentifier(harness, n));
  assert.deepEqual(wrong, [], `attributed to the harness but not found there: ${wrong.join(', ')}`);
});

test('scenario-attributed names appear in the scenario file or its helpers', () => {
  /* Scenario bodies are compiled with `new Function`, so they run in global
   * scope and call physics by bare name. The names appear in scenarios.mjs and
   * in the harness's in-page TEST_API, which those bodies also use.
   */
  const stripKeepTemplates = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const sources = [
    stripKeepTemplates(readFileSync(join(ROOT, 'tools', 'scenarios.mjs'), 'utf8')),
    stripKeepTemplates(readFileSync(join(ROOT, 'tools', 'harness.mjs'), 'utf8')),
  ].join('\n');
  const claimed = EXTERNAL_SURFACE.filter((e) => e.consumer === 'scenarios').map((e) => e.name);
  assert.ok(claimed.length > 0);
  const wrong = claimed.filter((n) => !referencesIdentifier(sources, n));
  assert.deepEqual(wrong, [], `attributed to scenarios but not found: ${wrong.join(', ')}`);
});

test('the surface is a small fraction of what is published', () => {
  /* The measured result is the point of this manifest: the bridge publishes 951
   * names, but only a few dozen are reachable from outside. If this ever grows
   * to match the published count, the manifest has stopped distinguishing
   * anything and should be reconsidered.
   */
  const published = publishedNames().size;
  const surface = externalNames().size;
  assert.ok(surface > 0, 'there is a real surface');
  assert.ok(
    surface < published / 4,
    `external surface (${surface}) should stay far below published (${published})`,
  );
});

test('no duplicate entries', () => {
  const names = EXTERNAL_SURFACE.map((e) => e.name);
  assert.equal(new Set(names).size, names.length, 'each name appears once');
});

test('every entry explains itself', () => {
  // The purpose field is what makes this readable rather than a bare list.
  for (const e of EXTERNAL_SURFACE) {
    assert.ok(e.purpose.length > 10, `${e.name} needs a real purpose, got "${e.purpose}"`);
  }
});
