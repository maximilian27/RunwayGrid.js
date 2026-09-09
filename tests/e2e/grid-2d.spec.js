import { test, expect } from '@playwright/test';

// Mirrors the 2D grid dataset defined in examples/02-grid-2d.html (#grid-demo, orientation="both").
const GRID_ROWS = 100000;
const GRID_COLS = 500;
const LAST_ROW = GRID_ROWS - 1;
const LAST_COL = GRID_COLS - 1;

test.describe('runway-grid - 2D grid (independent vertical + horizontal panning)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/02-grid-2d.html');

    // Wait until the WASM registry is ready and the initial range has rendered before
    // attaching the listener - deferred module scripts (like this page's) run before
    // `DOMContentLoaded`, so anything gated on that event would already miss the very
    // first `rangechange`. Forcing one fresh `calculateIndices()` call right after
    // attaching guarantees an up-to-date event to observe from a known starting point.
    await page.waitForFunction(() => {
      const el = document.getElementById('grid-demo');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    await page.evaluate(() => {
      window.__lastGridRange = null;
      document.getElementById('grid-demo').addEventListener('rangechange', (e) => {
        window.__lastGridRange = { buffered: e.buffered, viewport: e.viewport };
      });
      document.getElementById('grid-demo').calculateIndices();
    });

    await page.waitForFunction(() => window.__lastGridRange !== null);
  });

  test('both native scroll tracks are present and active for orientation="both"', async ({ page }) => {
    const verticalTrack = page.locator('#grid-demo .virtual-scroll__track--vertical');
    const horizontalTrack = page.locator('#grid-demo .virtual-scroll__track--horizontal');

    await expect(verticalTrack).toBeVisible();
    await expect(horizontalTrack).toBeVisible();
    await expect(verticalTrack).not.toHaveClass(/virtual-scroll__track--disabled/);
    await expect(horizontalTrack).not.toHaveClass(/virtual-scroll__track--disabled/);
  });

  test('panning the horizontal axis does not move the vertical axis, and vice versa', async ({ page }) => {
    const initialRange = await page.evaluate(() => window.__lastGridRange.buffered);
    expect(initialRange.startRow).toBe(0);
    expect(initialRange.startCol).toBe(0);

    // Drag the horizontal track forward - only the column window should move.
    await page.evaluate(() => {
      const host = document.getElementById('grid-demo');
      const track = host.shadowRoot.querySelector('.virtual-scroll__track--horizontal');
      track.scrollLeft = Math.floor(track.scrollWidth / 2);
    });

    await page.waitForFunction(() => window.__lastGridRange && window.__lastGridRange.buffered.startCol > 0);
    const afterHorizontalPan = await page.evaluate(() => window.__lastGridRange.buffered);
    expect(afterHorizontalPan.startRow).toBe(0);
    expect(afterHorizontalPan.startCol).toBeGreaterThan(0);

    // Now drag the vertical track forward - only the row window should move, the
    // column window reached by the previous pan must stay put.
    await page.evaluate(() => {
      const host = document.getElementById('grid-demo');
      const track = host.shadowRoot.querySelector('.virtual-scroll__track--vertical');
      track.scrollTop = Math.floor(track.scrollHeight / 2);
    });

    await page.waitForFunction(() => window.__lastGridRange && window.__lastGridRange.buffered.startRow > 0);
    const afterVerticalPan = await page.evaluate(() => window.__lastGridRange.buffered);
    expect(afterVerticalPan.startRow).toBeGreaterThan(0);
    expect(afterVerticalPan.startCol).toBe(afterHorizontalPan.startCol);
  });

  test('scrollToCell reaches the true bottom-right cell without clipping on either axis', async ({ page }) => {
    await page.locator('#grid-bottom-right-btn').click();

    await page.waitForFunction(
        ({ rows, cols }) => window.__lastGridRange
            && window.__lastGridRange.buffered.endRow === rows
            && window.__lastGridRange.buffered.endCol === cols,
        { rows: GRID_ROWS, cols: GRID_COLS },
    );

    const viewport = page.locator('#grid-demo .virtual-scroll__viewport');
    const lastCell = page.locator(`#grid-demo [data-row="${LAST_ROW}"][data-col="${LAST_COL}"]`);
    await expect(lastCell).toBeAttached();

    const viewportBox = await viewport.boundingBox();
    const cellBox = await lastCell.boundingBox();
    expect(viewportBox).not.toBeNull();
    expect(cellBox).not.toBeNull();

    const viewportBottom = viewportBox.y + viewportBox.height;
    const viewportRight = viewportBox.x + viewportBox.width;
    const cellBottom = cellBox.y + cellBox.height;
    const cellRight = cellBox.x + cellBox.width;

    expect(Math.abs(cellBottom - viewportBottom)).toBeLessThanOrEqual(2);
    expect(Math.abs(cellRight - viewportRight)).toBeLessThanOrEqual(2);
  });

  // Regression coverage for: dragging the horizontal scrollbar all the way right left the
  // last column(s) slightly clipped, even though `scrollToCell`'s bottom-right jump always
  // landed correctly. Root cause: the horizontal track is a sibling of the row containing
  // the viewport + vertical track, so it spans the *full* container width - 16px wider than
  // the viewport whenever the vertical track is present. The track<->virtual conversion used
  // the viewport's width as a stand-in for the track's own width when computing the native
  // scroll ceiling, so "dragged to the end" was detected 16px too late. Fixed by deriving the
  // track's scroll ceiling from its own `clientWidth` instead of the viewport's.
  test('dragging the horizontal scrollbar track to the right reaches the true last column without clipping', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.getElementById('grid-demo');
      const track = host.shadowRoot.querySelector('.virtual-scroll__track--horizontal');
      track.scrollLeft = track.scrollWidth;
    });

    await page.waitForFunction(
        (cols) => window.__lastGridRange && window.__lastGridRange.buffered.endCol === cols,
        GRID_COLS,
    );

    const viewport = page.locator('#grid-demo .virtual-scroll__viewport');
    const lastColNode = page.locator(`#grid-demo [data-col="${LAST_COL}"]`).first();
    await expect(lastColNode).toBeAttached();

    const viewportBox = await viewport.boundingBox();
    const nodeBox = await lastColNode.boundingBox();
    expect(viewportBox).not.toBeNull();
    expect(nodeBox).not.toBeNull();

    const viewportRight = viewportBox.x + viewportBox.width;
    const nodeRight = nodeBox.x + nodeBox.width;
    expect(Math.abs(nodeRight - viewportRight)).toBeLessThanOrEqual(2);
  });
});
