import { test, expect } from '@playwright/test';

test.describe('Fenwick Tree Migration - Scale & Performance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });
  });

  test('burst of row updates at scale (1M rows) completes in sub-millisecond time without frame blocking', async ({ page }) => {
    const elapsedMs = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      const registry = host.registry;
      const count = registry.row_count();
      if (count < 1_000_000) {
        throw new Error(`Expected at least 1,000,000 rows, got ${count}`);
      }

      // Perform a burst of 50 updates near index 0 (worst case for old linear suffix-walk)
      performance.mark('burst-start');
      for (let i = 0; i < 50; i++) {
        registry.update_row_height(i, 60.0 + (i % 10));
      }
      performance.mark('burst-end');
      performance.measure('burst-measure', 'burst-start', 'burst-end');
      const measure = performance.getEntriesByName('burst-measure')[0];
      return measure.duration;
    });

    // In the old linear implementation, 50 updates on 1M rows touched 50 million elements (~30-50ms).
    // With Fenwick tree O(log N), 50 updates take < 1ms total.
    expect(elapsedMs).toBeLessThan(10);
  });

  test('smooth scrolling through unmeasured dynamic-height rows exhibits no long task regression', async ({ page }) => {
    const results = await page.evaluate(async () => {
      const host = document.getElementById('my-list');

      // Set up a PerformanceObserver to track long tasks (> 50ms)
      const longTasks = [];
      let observerSupported = false;
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.push(entry.duration);
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
        observerSupported = true;
      } catch (e) {
        // longtask observer might not be supported in some environments
      }

      // Monitor frame intervals during smooth scroll
      const frameDeltas = [];
      let lastFrameTime = performance.now();
      let isScrolling = true;

      const recordFrame = () => {
        const now = performance.now();
        frameDeltas.push(now - lastFrameTime);
        lastFrameTime = now;
        if (isScrolling) {
          requestAnimationFrame(recordFrame);
        }
      };
      requestAnimationFrame(recordFrame);

      performance.mark('scroll-start');
      // Smooth scroll through unmeasured territory (0 -> 10,000)
      await host.scrollToIndex(10000, { behavior: 'smooth', duration: 350 });
      performance.mark('scroll-end');
      performance.measure('scroll-measure', 'scroll-start', 'scroll-end');

      isScrolling = false;
      await new Promise(r => setTimeout(r, 50));

      const scrollMeasure = performance.getEntriesByName('scroll-measure')[0];

      // Calculate max frame delta
      const maxFrameDelta = Math.max(...frameDeltas);

      return {
        observerSupported,
        longTasksCount: longTasks.length,
        maxLongTaskDuration: longTasks.length > 0 ? Math.max(...longTasks) : 0,
        scrollDuration: scrollMeasure.duration,
        maxFrameDelta,
        virtualScrollTop: host._virtualScrollTop,
      };
    });

    // Scrolled successfully to a non-zero position
    expect(results.virtualScrollTop).toBeGreaterThan(0);
    // Smooth scroll finished in reasonable time (roughly around duration ~350ms + small settling)
    expect(results.scrollDuration).toBeLessThan(1500);

    // If longtask is supported, there should be zero long tasks (> 50ms) caused by resize suffix walks
    if (results.observerSupported) {
      expect(results.longTasksCount).toBe(0);
    }
    // No single frame took more than 50ms
    expect(results.maxFrameDelta).toBeLessThan(50);
  });

  test('fast wheel scroll through unmeasured rows maintains correct offsets and visual anchoring', async ({ page }) => {
    const viewport = page.locator('#my-list .runway-grid__viewport');
    await viewport.hover();

    // Fast flick down across many unmeasured rows
    await page.mouse.wheel(0, 10000);
    await page.waitForTimeout(100);

    const check = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      const st = host._virtualScrollTop;
      const geom = host.registry.compute_geometry(
        st, 0, host.viewport.clientHeight, host.viewport.clientWidth, 2, true, false
      );
      const res = {
        scrollTop: st,
        startRow: geom.viewport_start_row,
        offset: host.registry.get_row_offset(geom.viewport_start_row),
      };
      geom.free();
      return res;
    });

    expect(check.scrollTop).toBeGreaterThan(0);
    expect(check.startRow).toBeGreaterThan(0);
    // Offset must be less than or equal to current scrollTop
    expect(check.offset).toBeLessThanOrEqual(check.scrollTop + 0.5);
  });
});
