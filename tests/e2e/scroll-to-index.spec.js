import { test, expect } from '@playwright/test';

// Mirrors the vertical-list dataset defined in examples/01-vertical-list.html (#my-list,
// orientation="vertical"). Its `template` produces highly variable row heights (plain rows,
// tall "card" rows, and section headers), so most rows are never measured until actually
// rendered.
const TARGET_INDEX = 50000;

// Regression coverage for: "jump to index does not work correctly on the first attempt -
// only happens if the area was scrolled first, then it is corrected [on a second attempt]".
// Root cause: `scrollToCell()` resolved the target offset via `get_row_offset()` using
// whatever row sizes were *currently known*; jumping into a never-before-rendered region
// (as opposed to incremental wheel/keyboard scrolling, which measures rows along the way)
// used stale/default sizes for that region, landing far from the intended row. A second
// call then "corrected" it because the first call's render had, as a side effect, measured
// the real sizes around the target. The fix folds that re-measure-and-reposition step into
// a single `scrollToCell()` call.
test.describe('runway-grid - jump to index after a prior scroll', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });
  });

  test('a single scrollToIndex call already lands at its fully-settled position', async ({ page }) => {
    // Scroll the area a little first, so the jump target is still an entirely
    // unmeasured, distant region - exactly the reported reproduction scenario.
    await page.locator('#my-list .runway-grid__viewport').hover();
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(100);

    const firstCall = await page.evaluate((index) => {
      const host = document.getElementById('my-list');
      host.scrollToIndex(index);
      return host._virtualScrollTop;
    }, TARGET_INDEX);

    const secondCall = await page.evaluate((index) => {
      const host = document.getElementById('my-list');
      host.scrollToIndex(index);
      return host._virtualScrollTop;
    }, TARGET_INDEX);

    // Before the fix, the first call landed using stale/default row sizes for the
    // never-before-rendered target region, and only the second call (which benefited
    // from the sizes measured as a side effect of the first render) landed correctly -
    // producing a large drift between the two. A single call must now already be settled.
    expect(Math.abs(firstCall - secondCall)).toBeLessThanOrEqual(1);

    // The target row must actually be rendered and fully contained within the viewport
    // (not scrolled past it, not clipped above/below it).
    const viewport = page.locator('#my-list .runway-grid__viewport');
    const targetNode = page.locator(`#my-list [data-row="${TARGET_INDEX}"]`);
    await expect(targetNode).toBeAttached();

    const viewportBox = await viewport.boundingBox();
    const targetBox = await targetNode.boundingBox();
    expect(viewportBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    expect(targetBox.y).toBeGreaterThanOrEqual(viewportBox.y - 1);
    expect(targetBox.y).toBeLessThan(viewportBox.y + viewportBox.height);
  });
});
