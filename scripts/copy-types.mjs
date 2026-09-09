#!/usr/bin/env node
// Copies the hand-written `src/runway-grid.d.ts` type declarations into
// `dist/runway-grid.d.ts` after the library build, so published consumers
// get editor autocomplete/type-checking without a full TypeScript rewrite.
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const src = path.join(rootDir, 'src', 'runway-grid.d.ts');
const outDir = path.join(rootDir, 'dist');
const dest = path.join(outDir, 'runway-grid.d.ts');

mkdirSync(outDir, { recursive: true });
copyFileSync(src, dest);

console.log(`[copy-types] Copied "${src}" -> "${dest}".`);
