import { test, expect } from '@playwright/test';

// Mirrors the 2D grid dataset defined in examples/02-grid-2d.html (#grid-demo, orientation="both").
const GRID_ROWS = 100000;
const GRID_COLS = 500;

// Regression coverage for the code-review findings around ARIA roles/counts and `rangechange`
// batching: `role="grid"` is only used for the genuinely two-axis `orientation="both"` (paired
// with an owning `role="row"` between the grid and its `gridcell`s); single-axis orientations use
// `role="list"`/`"listitem"` instead, since arrow-key/wheel handling here moves the *scroll
// position*, not cell focus. `aria-rowcount`/`aria-colcount`/`aria-setsize` must also stay in sync
// with the true dataset size after `appendData()`, not just the size of the first page loaded.
test.describe('runway-grid - accessibility (ARIA roles/counts) and rangechange batching', () => {
  test('single-axis list (orientation="vertical") uses role="list"/"listitem" with aria-posinset/aria-setsize', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const info = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      const cell = host.shadowRoot.querySelector('[data-row="0"]');
      return {
        viewportRole: host.viewport.getAttribute('role'),
        viewportHasGridCounts: host.viewport.hasAttribute('aria-rowcount') || host.viewport.hasAttribute('aria-colcount'),
        cellRole: cell.getAttribute('role'),
        posinset: cell.getAttribute('aria-posinset'),
        setsize: cell.getAttribute('aria-setsize'),
        rowGroupRole: cell.parentElement.getAttribute('role'),
      };
    });

    expect(info.viewportRole).toBe('list');
    expect(info.viewportHasGridCounts).toBe(false);
    expect(info.cellRole).toBe('listitem');
    expect(info.posinset).toBe('1');
    expect(info.setsize).toBe('1000000');
    // The per-row wrapper element must stay transparent to assistive tech between the
    // `list` and its `listitem`s.
    expect(info.rowGroupRole).toBe('presentation');
  });

  test('two-axis grid (orientation="both") uses role="grid"/"row"/"gridcell" with aria-rowcount/aria-colcount', async ({ page }) => {
    await page.goto('/examples/02-grid-2d.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('grid-demo');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const info = await page.evaluate(() => {
      const host = document.getElementById('grid-demo');
      const cell = host.shadowRoot.querySelector('[data-row="0"][data-col="0"]');
      return {
        viewportRole: host.viewport.getAttribute('role'),
        rowCount: host.viewport.getAttribute('aria-rowcount'),
        colCount: host.viewport.getAttribute('aria-colcount'),
        cellRole: cell.getAttribute('role'),
        rowIndex: cell.getAttribute('aria-rowindex'),
        colIndex: cell.getAttribute('aria-colindex'),
        rowGroupRole: cell.parentElement.getAttribute('role'),
        rowGroupIndex: cell.parentElement.getAttribute('aria-rowindex'),
      };
    });

    expect(info.viewportRole).toBe('grid');
    expect(info.rowCount).toBe(String(GRID_ROWS));
    expect(info.colCount).toBe(String(GRID_COLS));
    expect(info.cellRole).toBe('gridcell');
    expect(info.rowIndex).toBe('1');
    expect(info.colIndex).toBe('1');
    // Cells must be grouped under an owning `role="row"` element, matching the standard
    // ARIA grid pattern (`grid` -> `row` -> `gridcell`) instead of `gridcell`s sitting
    // directly under `grid` with no owning row in between.
    expect(info.rowGroupRole).toBe('row');
    expect(info.rowGroupIndex).toBe('1');
  });

  test('aria-setsize on already-rendered (non-rebound) cells is refreshed after appendData', async ({ page }) => {
    await page.goto('/examples/04-infinite-vertical.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('infinite-list');
      return el && el.registry !== null && el.rows.length > 0;
    });

    // Read the current setsize, then append more rows and re-read it, all synchronously in a
    // single page context turn - so no concurrently in-flight simulated fetch (this example
    // auto-fetches more pages via `setTimeout`) can race between the two reads.
    const result = await page.evaluate(() => {
      const host = document.getElementById('infinite-list');
      const cell = () => host.shadowRoot.querySelector('[data-row="0"]');
      const before = cell().getAttribute('aria-setsize');
      const rowCountBefore = host.rows.length;
      host.appendData(Array.from({ length: 10 }, (_, i) => ({ index: rowCountBefore + i, lines: 1 })));
      const after = cell().getAttribute('aria-setsize');
      return { before, after, expectedAfter: String(rowCountBefore + 10) };
    });

    // Row 0 stays on-screen and is never re-bound by the append (its row/col index didn't
    // change), so without the fix its `aria-setsize` would still report the pre-append count.
    expect(result.before).toBe(String(Number(result.expectedAfter) - 10));
    expect(result.after).toBe(result.expectedAfter);
  });

  // Regression coverage for: `scrollToCell()` internally calls `calculateIndices()` up to 4
  // times (directly, via `_applyMeasuredSizes`/`_settleAtEnd`, and again at the end) as the
  // target position is refined against freshly measured row sizes - each call used to dispatch
  // its own `rangechange`, so a single public `scrollToIndex()`/`scrollToCell()` call could fire
  // up to 4 redundant events. Only the final, settled one should ever be dispatched.
  test('scrollToIndex dispatches exactly one rangechange event per call', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const dispatchCount = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      let count = 0;
      const handler = () => { count++; };
      host.addEventListener('rangechange', handler);
      host.scrollToIndex(500000);
      host.removeEventListener('rangechange', handler);
      return count;
    });

    expect(dispatchCount).toBe(1);
  });
});
