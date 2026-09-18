/**
 * WebAssembly initialization and runtime management for the layout engine.
 *
 * @module wasm
 */
import init, { VirtualScrollRegistry } from '../runway_engine/pkg/runway_engine.js';
import { RUNWAY_ENGINE_WASM_BASE64 } from './runway-engine-wasm.js';

/**
 * Upper bound (in pixels) applied to spacer element sizes. Browsers silently clamp/ignore
 * extremely large CSS lengths, so the total scrollable extent reported to the DOM (via the
 * spacer's `height`/`width`) is capped at this value, independent of the true virtual size
 * computed by the WASM engine.
 * @type {number}
 */
export const SAFE_MAX_HEIGHT = 10000000;

/**
 * Decodes a base64 string into a `Uint8Array`, used to turn the embedded
 * `RUNWAY_ENGINE_WASM_BASE64` payload back into raw WASM bytes for `init()`.
 *
 * @param {string} base64 Base64-encoded binary data.
 * @returns {Uint8Array} The decoded bytes.
 */
export function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

/**
 * Cached promise for the WASM module initialization, shared across every
 * `RunwayGrid` instance so the engine is only decoded/instantiated once per page.
 * @type {Promise<unknown>|null}
 */
let wasmInitPromise = null;

/**
 * Lazily initializes the embedded WASM engine exactly once, regardless of how many
 * `RunwayGrid` instances request it.
 *
 * @returns {Promise<unknown>} Resolves once the WASM module is ready to use.
 */
export function ensureWasmInitialized() {
  if (!wasmInitPromise) wasmInitPromise = init(base64ToUint8Array(RUNWAY_ENGINE_WASM_BASE64));
  return wasmInitPromise;
}

export { VirtualScrollRegistry };
