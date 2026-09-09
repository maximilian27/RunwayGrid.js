import { test, expect } from '@playwright/test';

// Covers error handling around the embedded WASM engine's initialization (`initWasm()`).
// Before this was handled, a rejection from `ensureWasmInitialized()` (e.g. an unsupported
// browser, a CSP blocking `atob`-decoded binary instantiation, a corrupt build, etc.) was an
// unhandled promise rejection with no fallback - the component just silently never rendered.
// `initWasm()` must now catch that rejection, expose it as `wasmInitError`, and dispatch a
// `wasmerror` event, without ever surfacing as an unhandled rejection (a `pageerror`).
test.describe('runway-grid - WASM initialization error handling', () => {
  test('a failed WASM init sets wasmInitError and dispatches wasmerror, with no unhandled rejection', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    // Simulate an environment where WASM instantiation is impossible (unsupported browser,
    // CSP violation, corrupt binary, etc.) by making the underlying browser API reject. A
    // capturing listener on `document`, installed before any page script runs, records every
    // `wasmerror` regardless of exactly when `initWasm()` settles relative to when the test
    // later attaches its own listener (the event does not bubble, but capture-phase listeners
    // on ancestors still fire for non-bubbling events dispatched on a descendant).
    await page.addInitScript(() => {
      window.__wasmErrors = [];
      document.addEventListener('wasmerror', (e) => {
        window.__wasmErrors.push({ id: e.target.id, message: e.detail && e.detail.error && e.detail.error.message });
      }, true);
      WebAssembly.instantiate = () => Promise.reject(new Error('Simulated WASM instantiation failure'));
    });

    await page.goto('/');

    // The page defines several `runway-grid` elements up-front (demos 1-7); none of them
    // should ever finish initializing, and none should throw synchronously while failing.
    await page.waitForFunction(() => window.__wasmErrors.some((e) => e.id === 'my-list'));

    const result = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      const captured = window.__wasmErrors.find((e) => e.id === 'my-list');
      return {
        wasmInitialized: host.wasmInitialized,
        wasmInitErrorMessage: host.wasmInitError && host.wasmInitError.message,
        detailErrorMessage: captured.message,
        registry: host.registry,
      };
    });

    expect(result.wasmInitialized).toBe(false);
    expect(result.wasmInitErrorMessage).toBe('Simulated WASM instantiation failure');
    expect(result.detailErrorMessage).toBe('Simulated WASM instantiation failure');
    // The registry must never be built once WASM failed to initialize.
    expect(result.registry).toBeNull();

    // Give any other in-flight demo initializations a chance to settle, then confirm the
    // failure never surfaced as an unhandled promise rejection anywhere on the page.
    await page.waitForTimeout(200);
    expect(pageErrors).toEqual([]);
  });
});
