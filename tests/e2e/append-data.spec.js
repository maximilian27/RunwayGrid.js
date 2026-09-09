import { test, expect } from '@playwright/test';

// Mirrors the vertical-list dataset defined in examples/01-vertical-list.html (#my-list,
// orientation="vertical"). Covers the non-destructive `appendData()` API (infinite scroll support): appending new
// rows must extend the virtual size without rebuilding the registry or resetting the user's
// current scroll position, and the `rangechange` event must expose both a buffered and a
// strict viewport coordinate group.
test.describe('runway-grid - appendData (non-destructive infinite scroll)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });
  });

  test('appending rows preserves scroll position and extends the virtual size', async ({ page }) => {
    // Scroll away from the origin first, so a reset back to 0 would be observable.
    await page.locator('#my-list .virtual-scroll__viewport').hover();
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(100);

    const before = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      return {
        virtualScrollTop: host._virtualScrollTop,
        rowCount: host.rows.length,
        totalHeight: host.registry.get_total_height(),
      };
    });
    expect(before.virtualScrollTop).toBeGreaterThan(0);

    const after = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      host.appendData(Array.from({ length: 1000 }, (_, i) => `Appended ${i}`));
      return {
        virtualScrollTop: host._virtualScrollTop,
        rowCount: host.rows.length,
        totalHeight: host.registry.get_total_height(),
      };
    });

    // Scroll position must stay exactly where the user left it.
    expect(after.virtualScrollTop).toBe(before.virtualScrollTop);
    // The row count and total virtual size must grow to reflect the appended rows.
    expect(after.rowCount).toBe(before.rowCount + 1000);
    expect(after.totalHeight).toBeGreaterThan(before.totalHeight);

    // The scrollbar spacer must be resized to reflect the new virtual size immediately.
    const spacerHeight = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      return parseFloat(host.shadowRoot.querySelector('.virtual-scroll__spacer--vertical').style.height);
    });
    expect(spacerHeight).toBeGreaterThan(0);
  });

  test('rangechange exposes both a buffered and a strict viewport coordinate group', async ({ page }) => {
    const range = await page.evaluate(() => new Promise((resolve) => {
      const host = document.getElementById('my-list');
      host.addEventListener('rangechange', (e) => resolve({ buffered: e.buffered, viewport: e.viewport }), { once: true });
      host.calculateIndices();
    }));

    expect(range.buffered).toBeDefined();
    expect(range.viewport).toBeDefined();

    for (const coords of [range.buffered, range.viewport]) {
      expect(typeof coords.startRow).toBe('number');
      expect(typeof coords.endRow).toBe('number');
      expect(typeof coords.startCol).toBe('number');
      expect(typeof coords.endCol).toBe('number');
    }

    // The buffered range pads the strict viewport range on both sides (or is equal if the
    // buffer is clamped against the edges of the dataset).
    expect(range.buffered.startRow).toBeLessThanOrEqual(range.viewport.startRow);
    expect(range.buffered.endRow).toBeGreaterThanOrEqual(range.viewport.endRow);
  });
});
