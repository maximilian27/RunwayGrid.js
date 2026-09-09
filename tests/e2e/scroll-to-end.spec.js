import { test, expect } from '@playwright/test';

// Mirrors the vertical-list dataset defined in index.html (#my-list, orientation="vertical").
const TOTAL_ITEMS = 1000000;
const LAST_INDEX = TOTAL_ITEMS - 1;

// Regression coverage for the "stuck before the end" / "last element cut in half"
// bugs: every path capable of landing the scroller on its virtual end (scrollbar
// drag, mouse wheel, keyboard End) must reliably reach the TRUE last row, with
// that row's bottom edge fully visible and aligned with the viewport's bottom -
// not truncated by stale/unmeasured row heights.
test.describe('runway-grid - reaching the true end (vertical axis)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Record every `rangechange` event so tests can assert on the last one fired,
    // without racing the component's internal async WASM initialization.
    await page.evaluate(() => {
      window.__lastRange = null;
      document.getElementById('my-list').addEventListener('rangechange', (e) => {
        window.__lastRange = { buffered: e.buffered, viewport: e.viewport };
      });
    });

    // Wait until the WASM registry is ready and the initial range has rendered.
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });
  });

  async function expectLandedFullyAtEnd(page) {
    // The last buffered row must reach the true end of the dataset.
    await page.waitForFunction(
        (total) => window.__lastRange && window.__lastRange.buffered.endRow === total,
        TOTAL_ITEMS,
    );

    const viewport = page.locator('#my-list .virtual-scroll__viewport');
    const lastNode = page.locator(`#my-list [data-row="${LAST_INDEX}"]`);
    await expect(lastNode).toBeAttached();

    const viewportBox = await viewport.boundingBox();
    const lastNodeBox = await lastNode.boundingBox();
    expect(viewportBox).not.toBeNull();
    expect(lastNodeBox).not.toBeNull();

    // The bottom edge of the last row must coincide with the viewport's bottom
    // edge - if row heights were still stale/unmeasured, this would be off and
    // the row would appear cut off instead of fully visible.
    const viewportBottom = viewportBox.y + viewportBox.height;
    const lastNodeBottom = lastNodeBox.y + lastNodeBox.height;
    expect(Math.abs(lastNodeBottom - viewportBottom)).toBeLessThanOrEqual(2);
  }

  test('keyboard End reaches the true last row without clipping', async ({ page }) => {
    await page.locator('#my-list .virtual-scroll__viewport').focus();
    await page.keyboard.press('End');

    await expectLandedFullyAtEnd(page);
  });

  test('mouse wheel scroll-to-bottom reaches the true last row without clipping', async ({ page }) => {
    // A single, very large deltaY mimics an aggressive flick straight to the bottom;
    // the handler clamps the result to the true virtual max regardless of magnitude.
    await page.locator('#my-list .virtual-scroll__viewport').hover();
    await page.mouse.wheel(0, 1_000_000_000);

    await expectLandedFullyAtEnd(page);
  });

  test('dragging the vertical scrollbar track to the bottom reaches the true last row without clipping', async ({ page }) => {
    // Real native-scrollbar thumb dragging isn't reliably simulatable in a headless
    // browser, so we reproduce what a drag-to-bottom physically does at the DOM
    // level: push the vertical track's `scrollTop` to its maximum, which fires the
    // same native `scroll` event the real drag interaction relies on.
    await page.evaluate(() => {
      const host = document.getElementById('my-list');
      const track = host.shadowRoot.querySelector('.virtual-scroll__track--vertical');
      track.scrollTop = track.scrollHeight;
    });

    await expectLandedFullyAtEnd(page);
  });

  test('dragging the vertical scrollbar track a pixel short of the native max still reaches the true last row', async ({ page }) => {
    // A real mouse drag can easily release a pixel or two short of the browser's exact
    // native max scrollTop (sub-pixel layout, DPI/zoom rounding, or simply not overshooting
    // past the track's edge) - the component must still treat that as "at the end" instead
    // of leaving the user stuck slightly before the true last row.
    await page.evaluate(() => {
      const host = document.getElementById('my-list');
      const track = host.shadowRoot.querySelector('.virtual-scroll__track--vertical');
      track.scrollTop = track.scrollHeight - track.clientHeight - 1;
      track.dispatchEvent(new Event('scroll'));
    });

    await expectLandedFullyAtEnd(page);
  });
});
