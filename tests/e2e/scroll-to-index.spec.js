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

  test('scrollToIndex with behavior: smooth animates across frames and settles at target', async ({ page }) => {
    const TARGET = 5000;

    // Start smooth scrolling and record progress positions
    const positions = await page.evaluate(async (index) => {
      const host = document.getElementById('my-list');
      const sampled = [];
      const timer = setInterval(() => {
        sampled.push(host._virtualScrollTop);
      }, 30);

      await host.scrollToIndex(index, { behavior: 'smooth', duration: 350 });
      clearInterval(timer);
      sampled.push(host._virtualScrollTop);
      return sampled;
    }, TARGET);

    // Verify that multiple intermediate frames were rendered and position monotonically increased
    expect(positions.length).toBeGreaterThanOrEqual(4);
    expect(positions[0]).toBeLessThan(positions[positions.length - 1]);

    // Target row must be rendered and visible in the viewport
    const viewport = page.locator('#my-list .runway-grid__viewport');
    const targetNode = page.locator(`#my-list [data-row="${TARGET}"]`);
    await expect(targetNode).toBeAttached();

    const viewportBox = await viewport.boundingBox();
    const targetBox = await targetNode.boundingBox();
    expect(viewportBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    expect(targetBox.y).toBeGreaterThanOrEqual(viewportBox.y - 1);
    expect(targetBox.y).toBeLessThan(viewportBox.y + viewportBox.height);
  });

  test('Jump to Index demo button smoothly animates to target index', async ({ page }) => {
    const indexInput = page.locator('#index-input');
    await indexInput.fill('2500');

    const jumpBtn = page.locator('#jump-btn');
    await jumpBtn.click();

    const targetNode = page.locator('#my-list [data-row="2500"]');
    await expect(targetNode).toBeAttached({ timeout: 5000 });

    const viewport = page.locator('#my-list .runway-grid__viewport');
    const viewportBox = await viewport.boundingBox();
    const targetBox = await targetNode.boundingBox();
    expect(viewportBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    expect(targetBox.y).toBeGreaterThanOrEqual(viewportBox.y - 1);
    expect(targetBox.y).toBeLessThan(viewportBox.y + viewportBox.height);
  });

  test('smooth scroll cancels immediately on user manual wheel interaction', async ({ page }) => {
    // Start a long smooth scroll towards row 50,000 (target ~1,000,000px)
    await page.evaluate(() => {
      const host = document.getElementById('my-list');
      host.scrollToIndex(50000, { behavior: 'smooth', duration: 3000 });
    });

    // Verify animation RAF is active
    await page.waitForFunction(() => document.getElementById('my-list')._smoothScrollRafId !== null);

    // Simulate user wheel gesture interrupting the animation
    await page.locator('#my-list .runway-grid__viewport').hover();
    await page.mouse.wheel(0, 50);

    // The animation RAF must be cancelled immediately
    const isRunningAfter = await page.evaluate(() => document.getElementById('my-list')._smoothScrollRafId !== null);
    expect(isRunningAfter).toBe(false);

    const posAtCancel = await page.evaluate(() => document.getElementById('my-list')._virtualScrollTop);

    // Wait 300ms: position should stay near posAtCancel and not continue advancing to 50000 (~1,000,000px)
    await page.waitForTimeout(300);
    const { finalPos, targetOffset } = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      const vh = host.viewport.clientHeight;
      return {
        finalPos: host._virtualScrollTop,
        targetOffset: host._clamp(host.registry.get_row_offset(50000), 0, host.registry.get_total_height() - vh),
      };
    });
    expect(finalPos).toBeLessThan(targetOffset);
    expect(Math.abs(finalPos - posAtCancel)).toBeLessThan(500);
  });

  test('scroll-behavior="smooth" attribute enables smooth scrolling by default', async ({ page }) => {
    const behavior = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      host.setAttribute('scroll-behavior', 'smooth');
      return host.scrollBehavior;
    });
    expect(behavior).toBe('smooth');

    const positions = await page.evaluate(async () => {
      const host = document.getElementById('my-list');
      const sampled = [];
      const timer = setInterval(() => {
        sampled.push(host._virtualScrollTop);
      }, 30);

      await host.scrollToIndex(3000);
      clearInterval(timer);
      sampled.push(host._virtualScrollTop);
      return sampled;
    });

    expect(positions.length).toBeGreaterThanOrEqual(3);
    const targetNode = page.locator('#my-list [data-row="3000"]');
    await expect(targetNode).toBeAttached();
  });

  test('approach runway teleportation jumps distant smooth scroll to 1-2 viewports ahead of target without traversing intermediate items', async ({ page }) => {
    const TARGET = 10000;
    const INTERMEDIATE_ROW = 5000;

    const result = await page.evaluate(async ({ target, intermediate }) => {
      const host = document.getElementById('my-list');
      const vh = host.viewport.clientHeight;

      const ranges = [];
      const onRangeChange = (e) => {
        ranges.push({ start: e.buffered.startRow, end: e.buffered.endRow });
      };
      host.addEventListener('rangechange', onRangeChange);

      const sampledPositions = [];
      const initialEstimatedOffset = host._clamp(host.registry.get_row_offset(target), 0, host.registry.get_total_height() - vh);

      const timer = setInterval(() => {
        sampledPositions.push(host._virtualScrollTop);
      }, 25);

      // Trigger distant smooth scroll
      await host.scrollToIndex(target, { behavior: 'smooth', duration: 350 });

      clearInterval(timer);
      host.removeEventListener('rangechange', onRangeChange);

      const finalVirtualTop = host._virtualScrollTop;
      const targetOffset = host._clamp(host.registry.get_row_offset(target), 0, host.registry.get_total_height() - vh);

      // Check if intermediate row was ever included in any rendered buffered range
      const touchedIntermediate = ranges.some((r) => intermediate >= r.start && intermediate <= r.end);

      return {
        sampledPositions,
        touchedIntermediate,
        initialEstimatedOffset,
        firstSampled: sampledPositions[0],
        finalVirtualTop,
        targetOffset,
        vh,
      };
    }, { target: TARGET, intermediate: INTERMEDIATE_ROW });

    // The intermediate row (5000) was never mounted or traversed
    expect(result.touchedIntermediate).toBe(false);

    // The scroll position immediately jumped to the approach runway (within 2 viewports of estimated target)
    // rather than linearly crawling from 0
    expect(result.firstSampled).toBeGreaterThan(150000);
    expect(result.firstSampled).toBeCloseTo(result.initialEstimatedOffset - 2 * result.vh, -2);
    expect(result.finalVirtualTop).toBeCloseTo(result.targetOffset, 0);

    // Target node is rendered and visible
    const targetNode = page.locator(`#my-list [data-row="${TARGET}"]`);
    await expect(targetNode).toBeAttached();
  });

  test('smooth scroll to nearby target (<= 5 viewports) animates smoothly without teleportation', async ({ page }) => {
    const TARGET = 5; // Close to top, well within 5 viewports

    const result = await page.evaluate(async (target) => {
      const host = document.getElementById('my-list');
      const sampledPositions = [];
      const timer = setInterval(() => {
        sampledPositions.push(host._virtualScrollTop);
      }, 20);

      await host.scrollToIndex(target, { behavior: 'smooth', duration: 300 });
      clearInterval(timer);

      return {
        sampledPositions,
        firstSampled: sampledPositions[0],
        finalPos: host._virtualScrollTop,
      };
    }, TARGET);

    // Started from 0 without jumping
    expect(result.firstSampled).toBeLessThan(100);
    expect(result.sampledPositions.length).toBeGreaterThanOrEqual(3);
  });

  test('reverse distant smooth scroll jumps to approach runway above target and animates downward', async ({ page }) => {
    const START_INDEX = 20000;
    const TARGET_INDEX = 100;

    // First jump to 20,000 instantly
    await page.evaluate((idx) => {
      document.getElementById('my-list').scrollToIndex(idx, { behavior: 'auto' });
    }, START_INDEX);

    const result = await page.evaluate(async (target) => {
      const host = document.getElementById('my-list');
      const vh = host.viewport.clientHeight;

      const sampledPositions = [];
      const timer = setInterval(() => {
        sampledPositions.push(host._virtualScrollTop);
      }, 25);

      await host.scrollToIndex(target, { behavior: 'smooth', duration: 350 });
      clearInterval(timer);

      const targetOffset = host._clamp(host.registry.get_row_offset(target), 0, host.registry.get_total_height() - vh);

      return {
        sampledPositions,
        firstSampled: sampledPositions[0],
        targetOffset,
        finalPos: host._virtualScrollTop,
        vh,
      };
    }, TARGET_INDEX);

    // First sampled position jumped from ~400k down to the runway near target (< targetOffset + 3 * vh)
    expect(result.firstSampled).toBeLessThan(result.targetOffset + 3 * result.vh);
    expect(result.finalPos).toBeCloseTo(result.targetOffset, 0);

    const targetNode = page.locator(`#my-list [data-row="${TARGET_INDEX}"]`);
    await expect(targetNode).toBeAttached();
  });
});

test.describe('runway-grid - horizontal smooth jump to index', () => {
  test('horizontal scrollToCell with behavior: smooth animates and settles at target column', async ({ page }) => {
    await page.goto('/examples/03-horizontal-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('h-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const TARGET_COL = 400;

    const positions = await page.evaluate(async (col) => {
      const host = document.getElementById('h-list');
      const sampled = [];
      const timer = setInterval(() => {
        sampled.push(host._virtualScrollLeft);
      }, 30);

      await host.scrollToCell(0, col, { behavior: 'smooth', duration: 350 });
      clearInterval(timer);
      sampled.push(host._virtualScrollLeft);
      return sampled;
    }, TARGET_COL);

    expect(positions.length).toBeGreaterThanOrEqual(4);
    expect(positions[0]).toBeLessThan(positions[positions.length - 1]);

    const targetNode = page.locator(`#h-list [data-col="${TARGET_COL}"]`);
    await expect(targetNode).toBeAttached();

    const viewport = page.locator('#h-list .runway-grid__viewport');
    const viewportBox = await viewport.boundingBox();
    const targetBox = await targetNode.boundingBox();
    expect(viewportBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    expect(targetBox.x).toBeGreaterThanOrEqual(viewportBox.x - 1);
    expect(targetBox.x).toBeLessThan(viewportBox.x + viewportBox.width);
  });
});
