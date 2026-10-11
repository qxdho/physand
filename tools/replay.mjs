#!/usr/bin/env node
/**
 * replay.mjs — run the regression scenarios against index.html.
 *
 *   node tools/replay.mjs --record     capture/replace baselines from current index.html
 *   node tools/replay.mjs              compare current index.html against baselines
 *   node tools/replay.mjs --list       list scenarios
 *   node tools/replay.mjs --only=<id>  run a single scenario
 *
 * Exit code 0 = all scenarios match; 1 = at least one regression or error.
 *
 * This is the safety net described in MODULARIZATION.md stage 0. Run it BEFORE
 * and AFTER every refactor step. A modularization that cannot be verified this
 * way should not be attempted.
 *
 * Requires a Chromium that can start; libraries are extracted by
 * tools/fetch-syslibs.sh into .syslibs/ (no root needed).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness, diffSnapshots } from './harness.mjs';
import { SCENARIOS } from './scenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_DIR = join(ROOT, 'tools', 'baselines');

const argv = process.argv.slice(2);
const RECORD = argv.includes('--record');
const LIST = argv.includes('--list');
const ONLY = (argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];

if (LIST) {
  for (const s of SCENARIOS) console.log(`${s.id.padEnd(22)} ${s.doc}`);
  process.exit(0);
}

const selected = ONLY ? SCENARIOS.filter((s) => s.id === ONLY) : SCENARIOS;
if (!selected.length) {
  console.error(`replay: no scenario matches --only=${ONLY}`);
  process.exit(2);
}

mkdirSync(BASE_DIR, { recursive: true });

/** Run one scenario, returning the list of snapshots (one per step group). */
async function runScenario(harness, sc) {
  await harness.page.evaluate(
    (src) => new Function('return (' + src + ')()')(),
    sc.setup.toString()
  );
  const snaps = [];
  for (const step of sc.steps) {
    await harness.step(step.n, step.dt ?? 1 / 60);
    snaps.push(await harness.snapshot());
  }
  return snaps;
}

let failures = 0;

for (const sc of selected) {
  const basePath = join(BASE_DIR, `${sc.id}.json`);
  let harness;
  try {
    harness = await new Harness().launch();
    const snaps = await runScenario(harness, sc);

    if (harness.errors.length) {
      console.error(`✗ ${sc.id}: page errors`);
      for (const e of harness.errors.slice(0, 5)) console.error(`    ${e}`);
      failures++;
      continue;
    }

    if (RECORD) {
      writeFileSync(basePath, JSON.stringify({ id: sc.id, doc: sc.doc, snaps }, null, 1));
      console.log(`recorded ${sc.id} (${snaps.length} snapshots)`);
      continue;
    }

    if (!existsSync(basePath)) {
      console.error(`✗ ${sc.id}: no baseline — run with --record first`);
      failures++;
      continue;
    }

    const base = JSON.parse(readFileSync(basePath, 'utf8'));
    if (base.snaps.length !== snaps.length) {
      console.error(`✗ ${sc.id}: snapshot count ${base.snaps.length} -> ${snaps.length}`);
      failures++;
      continue;
    }

    let diffs = [];
    for (let i = 0; i < snaps.length; i++) {
      diffs = diffs.concat(
        diffSnapshots(base.snaps[i], snaps[i], { label: `step[${i}]`, tol: sc.tol ?? 0.01 })
      );
    }

    if (diffs.length) {
      console.error(`✗ ${sc.id}: ${diffs.length} difference(s)`);
      for (const d of diffs.slice(0, 12)) console.error(`    ${d}`);
      if (diffs.length > 12) console.error(`    … and ${diffs.length - 12} more`);
      failures++;
    } else {
      console.log(`✓ ${sc.id}`);
    }
  } catch (err) {
    console.error(`✗ ${sc.id}: ${err.message.split('\n')[0]}`);
    failures++;
  } finally {
    if (harness) await harness.close();
  }
}

if (RECORD) {
  console.log(`\nbaselines written to tools/baselines/ (${selected.length - failures} recorded)`);
  /* ★2026-10: 原来这里无条件 `process.exit(0)` —— 即使某个场景抛错/页面报错、failures>0，
     也照样报成功。后果很坏：在坏掉的页面上 `--record` 会把**错的**状态录成新基线，
     而调用者看到退出码 0 以为一切正常，从此基线永久错下去。
     现在：有失败就以非零退出，并明确说明「不要把这次结果当成基线」。 */
  if (failures) {
    console.error(`\n✗ ${failures}/${selected.length} scenario(s) FAILED while recording — `
      + `baselines for those scenarios were NOT written.`);
    console.error('  Do not treat this run as a new baseline; fix the failure first.');
    process.exit(1);
  }
  process.exit(0);
}
if (failures) {
  console.error(`\n${failures}/${selected.length} scenario(s) FAILED`);
  process.exit(1);
}
console.log(`\nall ${selected.length} scenario(s) passed`);
