import { test, expect } from '@playwright/test';

// Regression coverage for: horizontal-list cells were only as tall as their own content
// (text/padding), instead of stretching to fill the viewport's full height the way
// vertical-list cells already stretch to fill the full width. Fixed in `applyChanges()` by
// forcing `rowGroup.style.height` / `node.style.height` to the viewport's `clientHeight`
// whenever the vertical axis is disabled (mirrors the existing width-forcing logic used for
// vertical lists).
test.describe('runway-grid - horizontal list cells fill the full container height', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/03-horizontal-list.html');

    await page.waitForFunction(() => {
      const el = document.getElementById('h-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });
  });

  test('rendered cells stretch to the viewport clientHeight, not just their content height', async ({ page }) => {
    const viewport = page.locator('#h-list .runway-grid__viewport');
    const firstCell = page.locator('#h-list [data-col="0"]').first();
    await expect(firstCell).toBeAttached();

    const viewportHeight = await viewport.evaluate((el) => el.clientHeight);
    const cellBox = await firstCell.boundingBox();
    expect(cellBox).not.toBeNull();

    expect(viewportHeight).toBeGreaterThan(0);
    expect(Math.abs(cellBox.height - viewportHeight)).toBeLessThanOrEqual(1);
  });

  test('row group height also matches the viewport clientHeight', async ({ page }) => {
    const viewportHeight = await page.locator('#h-list .runway-grid__viewport').evaluate((el) => el.clientHeight);
    const rowGroupHeight = await page.evaluate(() => {
      const host = document.getElementById('h-list');
      const rowGroup = host.shadowRoot.querySelector('.runway-grid__rowgroup');
      return rowGroup ? rowGroup.getBoundingClientRect().height : null;
    });

    expect(rowGroupHeight).not.toBeNull();
    expect(Math.abs(rowGroupHeight - viewportHeight)).toBeLessThanOrEqual(1);
  });
});
