#!/usr/bin/env node
/**
 * split.mjs — ONE-TIME extraction of src/ from the existing single-file index.html.
 *
 * This is a bootstrap. Run it once on the pristine index.html to create the
 * src/ tree; after that, src/ is the source of truth and index.html is a build
 * artifact. The split is byte-exact so that `node tools/build.mjs --check`
 * passes immediately — proving the pipeline changes nothing.
 *
 * It does NOT attempt to modularize. It only lifts the existing blocks into
 * separate files so the build has something to assemble. Real module boundaries
 * come later (see MODULARIZATION.md).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const INDEX = join(ROOT, 'index.html');

if (existsSync(join(SRC, '10-app.js'))) {
  console.error('split: src/ already exists. Refusing to overwrite.');
  console.error('  (delete src/ first if you really want to re-split)');
  process.exit(2);
}

const html = readFileSync(INDEX, 'utf8');

// Locate the three <script> blocks in order.
const scripts = [];
const re = /<script>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html))) scripts.push({ start: m.index, end: m.index + m[0].length, body: m[1] });

if (scripts.length !== 3) {
  console.error(`split: expected 3 <script> blocks, found ${scripts.length}.`);
  console.error('  The file layout changed — update this script before proceeding.');
  process.exit(2);
}
const [matter, app, boss] = scripts;

const styleEnd = html.indexOf('</style>') + '</style>'.length;
if (styleEnd <= 0) { console.error('split: no </style> found'); process.exit(2); }

// 00-head.html = everything up to and including </style>
const head = html.slice(0, styleEnd);
// 05-body.html = the static DOM between </style> and the first <script>
const body = html.slice(styleEnd, matter.start);
// 50-mid.html = the DOM fragment that sits between the app script and the boss script
const mid = html.slice(app.end, boss.start);
// 99-tail.html = anything after the last script
const tail = html.slice(boss.end);

mkdirSync(join(SRC, 'vendor'), { recursive: true });

writeFileSync(join(SRC, '00-head.html'), head);
writeFileSync(join(SRC, '05-body.html'), body);
writeFileSync(join(SRC, 'vendor/matter.js'), matter.body);
writeFileSync(join(SRC, '10-app.js'), app.body);
writeFileSync(join(SRC, '50-mid.html'), mid);
writeFileSync(join(SRC, '90-boss.js'), boss.body);
writeFileSync(join(SRC, '99-tail.html'), tail);

console.log('split: wrote src/');
console.log(`  00-head.html      ${head.length} bytes`);
console.log(`  05-body.html      ${body.length} bytes`);
console.log(`  vendor/matter.js  ${matter.body.length} bytes`);
console.log(`  10-app.js         ${app.body.length} bytes`);
console.log(`  50-mid.html       ${mid.length} bytes`);
console.log(`  90-boss.js        ${boss.body.length} bytes`);
console.log(`  99-tail.html      ${tail.length} bytes`);
console.log('\nnext: node tools/build.mjs --check');
