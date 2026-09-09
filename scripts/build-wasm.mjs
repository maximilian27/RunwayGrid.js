#!/usr/bin/env node
// Runs `wasm-pack build --target web` inside `runway_engine` to (re)generate
// `runway_engine/pkg/*` (the wasm-bindgen JS glue + the compiled `.wasm` binary).
// Run "npm run build:wasm-base64" afterwards to embed the resulting binary as
// base64 into a committed JS module that `src/runway-grid.js` imports.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.resolve(scriptDir, '..', 'runway_engine');

console.log(`[build-wasm] Running "wasm-pack build --target web" in "${engineDir}"...`);

const result = spawnSync('wasm-pack', ['build', '--target', 'web'], {
  cwd: engineDir,
  stdio: 'inherit',
});

if (result.error) {
  console.error('[build-wasm] Failed to start wasm-pack. Is it installed and on your PATH?');
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  console.error('[build-wasm] wasm-pack build failed.');
  process.exit(result.status ?? 1);
}

console.log('[build-wasm] Done.');
