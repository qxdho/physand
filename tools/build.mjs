#!/usr/bin/env node
/**
 * build.mjs — assemble src/ into the single-file index.html
 *
 * WHY THIS EXISTS
 * ---------------
 * The product promise is "one index.html you can double-click and run offline"
 * (README). That promise must survive the modularization. ES modules cannot be
 * used directly because `file://` blocks them via CORS. So:
 *
 *     src/*.js  --(this script)-->  index.html   (still ONE file, still offline)
 *
 * The build is a deterministic concatenation, not a bundler. No transpiling,
 * no minifying of our own code, no new runtime dependencies. The only
 * third-party code is the vendored Matter.js, which is carried through verbatim.
 *
 * FAITHFUL MODE (default)
 * -----------------------
 * `--check` verifies that rebuilding from src/ reproduces the current
 * index.html byte-for-byte. That is how we prove the pipeline itself is
 * behaviour-neutral BEFORE any code is moved. Do not refactor until --check
 * is green.
 *
 * Layout:
 *   src/00-head.html      everything up to and including <style>...</style>
 *   src/vendor/matter.js  verbatim Matter.js bundle (never edited by hand)
 *   src/10-app.js         the main application script
 *   src/90-boss.js        the boss-animation IIFE (third script block)
 *   src/99-tail.html      everything after the last script block
 *
 * Usage:
 *   node tools/build.mjs            # write index.html
 *   node tools/build.mjs --check    # verify src/ reproduces index.html exactly
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'index.html');

const PARTS = {
  head: '00-head.html',
  body: '05-body.html',
  matter: 'vendor/matter.js',
  app: '10-app.js',
  mid: '50-mid.html',
  boss: '90-boss.js',
  tail: '99-tail.html',
};

function read(rel) {
  const p = join(SRC, rel);
  if (!existsSync(p)) {
    console.error(`build: missing ${rel}\n` +
      `  run: node tools/split.mjs   (one-time, extracts src/ from index.html)`);
    process.exit(2);
  }
  return readFileSync(p, 'utf8');
}

/**
 * Assemble the single-file artifact.
 *
 * IMPORTANT: each script body part already begins and ends with a newline
 * (it is the raw slice between <script> and </script>). The tags are therefore
 * emitted WITHOUT added newlines, or the output gains bytes. Likewise the
 * html parts (body/mid/tail) are raw slices and carry their own newlines.
 * This is what makes --check byte-exact.
 */
export function build() {
  return read(PARTS.head)
    + read(PARTS.body)
    + '<script>' + read(PARTS.matter) + '</script>\n'
    + '<script>' + read(PARTS.app) + '</script>\n'
    + read(PARTS.mid).replace(/^\n/, '')
    + '<script>' + read(PARTS.boss) + '</script>'
    + read(PARTS.tail);
}

const isCheck = process.argv.includes('--check');
const built = build();

if (isCheck) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current === built) {
    console.log('build --check: OK — src/ reproduces index.html byte-for-byte');
    process.exit(0);
  }
  console.error('build --check: MISMATCH — src/ does not reproduce index.html');
  console.error(`  index.html: ${current.length} bytes`);
  console.error(`  rebuilt   : ${built.length} bytes`);
  // show first divergence
  const n = Math.min(current.length, built.length);
  for (let i = 0; i < n; i++) {
    if (current[i] !== built[i]) {
      const ctx = (s) => JSON.stringify(s.slice(Math.max(0, i - 60), i + 60));
      console.error(`  first diff at byte ${i}`);
      console.error(`    index.html: ${ctx(current)}`);
      console.error(`    rebuilt   : ${ctx(built)}`);
      break;
    }
  }
  process.exit(1);
}

writeFileSync(OUT, built);
console.log(`build: wrote index.html (${built.length} bytes)`);
