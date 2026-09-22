import { test, expect } from '@playwright/test';

test.describe('Step 4 Performance Optimizations and Reflow Reduction', () => {
  test('verifies _scrollMuteTimer removal, event tagging, and layout query caching', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const results = await page.evaluate(async () => {
      const host = document.getElementById('my-list');

      // 1. Verify _scrollMuteTimer is gone
      const hasTimerProp = '_scrollMuteTimer' in host && host._scrollMuteTimer !== null;

      // 2. Test layout caching
      let viewportClientHeightQueries = 0;
      let verticalTrackClientHeightQueries = 0;
      let verticalTrackScrollHeightQueries = 0;

      const origViewportHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
      const origScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');

      Object.defineProperty(host.viewport, 'clientHeight', {
        get() {
          viewportClientHeightQueries++;
          return origViewportHeight.get.call(this);
        },
        configurable: true,
      });

      Object.defineProperty(host.verticalTrack, 'clientHeight', {
        get() {
          verticalTrackClientHeightQueries++;
          return origViewportHeight.get.call(this);
        },
        configurable: true,
      });

      Object.defineProperty(host.verticalTrack, 'scrollHeight', {
        get() {
          verticalTrackScrollHeightQueries++;
          return origScrollHeight.get.call(this);
        },
        configurable: true,
      });

      host._invalidateLayoutCache();

      // Viewport size caching
      const size1 = host._getViewportSize();
      const size2 = host._getViewportSize();
      const cachedViewportWorks = viewportClientHeightQueries === 1 && size1.height === size2.height;

      // Track extent caching in _axis()
      const axis1 = host._axis('vertical');
      const axis2 = host._axis('vertical');
      const cachedAxisWorks = verticalTrackClientHeightQueries === 1 &&
                              verticalTrackScrollHeightQueries === 1 &&
                              axis1.trackExtent === axis2.trackExtent;

      // Layout queries during scrollByDelta
      viewportClientHeightQueries = 0;
      verticalTrackClientHeightQueries = 0;
      verticalTrackScrollHeightQueries = 0;

      for (let i = 0; i < 20; i++) {
        host._scrollByDelta(0, 10);
      }

      const zeroLayoutQueriesDuringScroll = viewportClientHeightQueries === 0 &&
                                            verticalTrackClientHeightQueries === 0 &&
                                            verticalTrackScrollHeightQueries === 0;

      // Test event-source tagging on programmatic track sync vs user track scroll
      host._virtualScrollTop = 500;
      host.syncTrackFromVirtual();
      const isProgAfterSync = host._isProgrammaticScroll === true;
      const expectedTarget = host._expectedTrackScrollTop;
      const hasExpectedTarget = expectedTarget !== null && expectedTarget !== undefined;

      // Clean up property getters
      delete host.viewport.clientHeight;
      delete host.verticalTrack.clientHeight;
      delete host.verticalTrack.scrollHeight;

      return {
        hasTimerProp,
        cachedViewportWorks,
        cachedAxisWorks,
        zeroLayoutQueriesDuringScroll,
        isProgAfterSync,
        hasExpectedTarget,
      };
    });

    expect(results.hasTimerProp).toBe(false);
    expect(results.cachedViewportWorks).toBe(true);
    expect(results.cachedAxisWorks).toBe(true);
    expect(results.zeroLayoutQueriesDuringScroll).toBe(true);
    expect(results.isProgAfterSync).toBe(true);
    expect(results.hasExpectedTarget).toBe(true);
  });

  test('user track scroll event immediately after programmatic sync is not dropped', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const result = await page.evaluate(async () => {
      const host = document.getElementById('my-list');
      const track = host.shadowRoot.querySelector('.runway-grid__track--vertical');

      // 1. Trigger programmatic sync to position 100
      host._virtualScrollTop = 2000;
      host.syncTrackFromVirtual();

      const expected = host._expectedTrackScrollTop;

      // 2. Programmatic scroll event arrives from browser
      track.scrollTop = expected;
      track.dispatchEvent(new Event('scroll'));

      // Expected target was consumed immediately without waiting 40ms
      const expectedConsumed = host._expectedTrackScrollTop === null;
      const isProgrammaticReset = host._isProgrammaticScroll === false;

      // 3. User immediately clicks/drags track (simulated within same turn/frame)
      const prevVirtual = host._virtualScrollTop;
      track.scrollTop = expected + 200;
      track.dispatchEvent(new Event('scroll'));

      const userScrollProcessed = host._virtualScrollTop !== prevVirtual;

      return {
        expectedConsumed,
        isProgrammaticReset,
        userScrollProcessed,
      };
    });

    expect(result.expectedConsumed).toBe(true);
    expect(result.isProgrammaticReset).toBe(true);
    expect(result.userScrollProcessed).toBe(true);
  });

  test('updateSpacer invalidates trackCache and correctly updates extent', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const result = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      // Populate cache
      host._axis('vertical');
      const hadCache = host._trackCache.vertical !== null;

      // Invalidate on spacer update
      host.updateSpacer();
      const invalidated = host._trackCache.vertical === null;

      // Querying again re-populates cache
      const axis = host._axis('vertical');
      const rePopulated = host._trackCache.vertical !== null && axis.trackExtent > 0;

      return { hadCache, invalidated, rePopulated };
    });

    expect(result.hadCache).toBe(true);
    expect(result.invalidated).toBe(true);
    expect(result.rePopulated).toBe(true);
  });

  test('Rust engine sliding window head removal shrinks virtual size and counter-scrolls correctly', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const result = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      host._virtualScrollTop = 5000;
      const beforeHeight = host.registry.get_total_height();
      const beforeScroll = host._virtualScrollTop;
      const beforeCount = host.rows.length;

      host.removeDataFromHead(20);

      const afterHeight = host.registry.get_total_height();
      const afterScroll = host._virtualScrollTop;
      const afterCount = host.rows.length;

      return {
        beforeCount,
        afterCount,
        beforeHeight,
        afterHeight,
        beforeScroll,
        afterScroll,
      };
    });

    const heightDelta = result.beforeHeight - result.afterHeight;
    expect(result.afterCount).toBe(result.beforeCount - 20);
    expect(result.afterHeight).toBeLessThan(result.beforeHeight);
    expect(result.afterScroll).toBeCloseTo(result.beforeScroll - heightDelta, 1);
  });
});
