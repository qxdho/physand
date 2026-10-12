import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Vite config for physand.
 *
 * MIGRATION NOTE (phase A)
 * ------------------------
 * We are moving from "one hand-concatenated index.html" to a real web app.
 * Phase A deliberately keeps the *behaviour* frozen while the *structure*
 * changes, so the 9 replay scenarios must stay green at every step.
 *
 * `root` points at `app/` (the new ESM entry), NOT at the repo root, because
 * the repo root still contains the legacy single-file project (index.html +
 * src/ + tools/) which we keep working until the migration completes.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'app'),
  publicDir: false,
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    // Keep the output readable while the migration is in flight; we are not
    // optimising bundle size yet, we are proving structural equivalence.
    minify: false,
    sourcemap: true,
  },
});
