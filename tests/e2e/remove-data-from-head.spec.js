import { test, expect } from '@playwright/test';

// Covers the non-destructive `removeDataFromHead()` API (sliding-window support): dropping
// items from the front of the data set must shrink the virtual size and counter-scroll the
// viewport by the exact pixel amount removed, so the user never observes a jump - for both
// the row axis (vertical lists) and the column axis (horizontal lists).
test.describe('runway-grid - removeDataFromHead (sliding window)', () => {
  test('vertical: removing rows from the head shrinks the virtual size and counter-scrolls by the exact delta', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    // Scroll far enough away from the origin that the counter-scroll compensation below is
    // guaranteed not to clamp at 0, so the exact pre/post delta can be asserted.
    await page.locator('#my-list .virtual-scroll__viewport').hover();
    await page.mouse.wheel(0, 500_000);
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

    const REMOVE_COUNT = 50;
    const after = await page.evaluate((removeCount) => {
      const host = document.getElementById('my-list');
      host.removeDataFromHead(removeCount);
      return {
        virtualScrollTop: host._virtualScrollTop,
        rowCount: host.rows.length,
        totalHeight: host.registry.get_total_height(),
      };
    }, REMOVE_COUNT);

    // The row count and total virtual size must shrink to reflect the removed rows.
    expect(after.rowCount).toBe(before.rowCount - REMOVE_COUNT);
    expect(after.totalHeight).toBeLessThan(before.totalHeight);

    // The viewport must be counter-scrolled by exactly the pixel height that vanished, so
    // the user's read position stays visually anchored.
    const heightDelta = before.totalHeight - after.totalHeight;
    expect(after.virtualScrollTop).toBeCloseTo(before.virtualScrollTop - heightDelta, 3);

    // The scrollbar spacer must shrink to reflect the new (smaller) virtual size immediately
    // (rounded down to a whole pixel, and capped at the same SAFE_MAX_HEIGHT the component
    // clamps every spacer dimension to, to stay within browser element-size limits).
    const spacerHeight = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      return parseFloat(host.shadowRoot.querySelector('.virtual-scroll__spacer--vertical').style.height);
    });
    expect(spacerHeight).toBe(Math.floor(Math.min(after.totalHeight, 10_000_000)));
  });

  test('horizontal: removing columns from the head shrinks the virtual size and counter-scrolls by the exact delta', async ({ page }) => {
    await page.goto('/examples/03-horizontal-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('h-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    // Scroll far enough away from the origin (deltaX, since #h-list only has the
    // horizontal axis enabled) that the counter-scroll compensation below can't clamp at 0.
    await page.locator('#h-list .virtual-scroll__viewport').hover();
    await page.mouse.wheel(200_000, 0);
    await page.waitForTimeout(100);

    const before = await page.evaluate(() => {
      const host = document.getElementById('h-list');
      return {
        virtualScrollLeft: host._virtualScrollLeft,
        colCount: host.columnsData.length,
        totalWidth: host.registry.get_total_width(),
      };
    });
    expect(before.virtualScrollLeft).toBeGreaterThan(0);

    const REMOVE_COUNT = 50;
    const after = await page.evaluate((removeCount) => {
      const host = document.getElementById('h-list');
      host.removeDataFromHead(removeCount);
      return {
        virtualScrollLeft: host._virtualScrollLeft,
        colCount: host.columnsData.length,
        totalWidth: host.registry.get_total_width(),
      };
    }, REMOVE_COUNT);

    // The column count and total virtual size must shrink to reflect the removed columns.
    expect(after.colCount).toBe(before.colCount - REMOVE_COUNT);
    expect(after.totalWidth).toBeLessThan(before.totalWidth);

    // The viewport must be counter-scrolled by exactly the pixel width that vanished.
    const widthDelta = before.totalWidth - after.totalWidth;
    expect(after.virtualScrollLeft).toBeCloseTo(before.virtualScrollLeft - widthDelta, 3);

    // The scrollbar spacer must shrink to reflect the new (smaller) virtual size immediately
    // (rounded down to a whole pixel, and capped at the same SAFE_MAX_HEIGHT the component
    // clamps every spacer dimension to, to stay within browser element-size limits).
    const spacerWidth = await page.evaluate(() => {
      const host = document.getElementById('h-list');
      return parseFloat(host.shadowRoot.querySelector('.virtual-scroll__spacer--horizontal').style.width);
    });
    expect(spacerWidth).toBe(Math.floor(Math.min(after.totalWidth, 10_000_000)));
  });
});
