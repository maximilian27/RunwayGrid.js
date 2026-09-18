import { test, expect } from '@playwright/test';

// Regression coverage for: `.runway-grid__viewport` relied on `overflow: hidden` to hide the
// raw DOM pool, so it never accepted native touch-panning - mobile browsers interpreted swipes
// as an attempt to scroll the main document, forcing users to drag the (tiny) scrollbar track
// instead. Fixed by adding `touch-action: none` to the viewport and manually mapping
// `touchstart`/`touchmove` to the virtual scroll position (`_onTouchStart`/`_onTouchMove`),
// mirroring the existing `_onWheel` handling.
test.describe('runway-grid - touch scrolling', () => {
  test.use({ hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');

    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });
  });

  // Playwright's touchscreen helpers don't emit intermediate `touchmove` points, so the
  // gesture is simulated by dispatching real `Touch`/`TouchEvent` objects directly on the
  // viewport - exactly what a mobile browser delivers to `_onTouchStart`/`_onTouchMove`.
  test('a single-finger swipe moves the virtual scroll position by the dragged distance', async ({ page }) => {
    const before = await page.evaluate(() => document.getElementById('my-list')._virtualScrollTop);
    expect(before).toBe(0);

    const swipeDistance = 200;
    const result = await page.evaluate((distance) => {
      const host = document.getElementById('my-list');
      const viewport = host.shadowRoot.querySelector('.runway-grid__viewport');
      const rect = viewport.getBoundingClientRect();
      const startX = rect.x + rect.width / 2;
      const startY = rect.y + rect.height / 2;

      const makeTouchEvent = (type, x, y, cancelable) => {
        const touch = new Touch({ identifier: 1, target: viewport, clientX: x, clientY: y });
        return new TouchEvent(type, { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable });
      };

      viewport.dispatchEvent(makeTouchEvent('touchstart', startX, startY, false));
      let prevented = false;
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const notCancelled = viewport.dispatchEvent(makeTouchEvent('touchmove', startX, startY - (distance / steps) * i, true));
        if (!notCancelled) prevented = true;
      }
      viewport.dispatchEvent(makeTouchEvent('touchend', startX, startY - distance, false));

      return { virtualScrollTop: host._virtualScrollTop, prevented };
    }, swipeDistance);

    expect(result.prevented).toBe(true);
    expect(result.virtualScrollTop).toBe(swipeDistance);
  });

  test('the scrollbar track visually reflects the touch-driven scroll position', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.getElementById('my-list');
      const viewport = host.shadowRoot.querySelector('.runway-grid__viewport');
      const rect = viewport.getBoundingClientRect();
      const startX = rect.x + rect.width / 2;
      const startY = rect.y + rect.height / 2;

      const makeTouchEvent = (type, x, y, cancelable) => {
        const touch = new Touch({ identifier: 1, target: viewport, clientX: x, clientY: y });
        return new TouchEvent(type, { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable });
      };

      viewport.dispatchEvent(makeTouchEvent('touchstart', startX, startY, false));
      for (let i = 1; i <= 10; i++) {
        viewport.dispatchEvent(makeTouchEvent('touchmove', startX, startY - 30 * i, true));
      }
    });

    await page.waitForFunction(() => {
      const host = document.getElementById('my-list');
      const track = host.shadowRoot.querySelector('.runway-grid__track--vertical');
      return track.scrollTop > 0;
    });
  });
});
