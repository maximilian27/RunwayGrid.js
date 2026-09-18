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

  test('reversing drag direction reacts immediately with zero dead-zone freeze', async ({ page }) => {
    const result = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      const viewport = host.shadowRoot.querySelector('.runway-grid__viewport');
      const rect = viewport.getBoundingClientRect();
      const startX = rect.x + rect.width / 2;
      const startY = rect.y + rect.height / 2;

      const makeTouchEvent = (type, x, y, cancelable) => {
        const touch = new Touch({ identifier: 1, target: viewport, clientX: x, clientY: y });
        return new TouchEvent(type, { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable });
      };

      // 1. Touch start at origin (virtualScrollTop is 0)
      viewport.dispatchEvent(makeTouchEvent('touchstart', startX, startY, false));

      // 2. Drag downwards past the upper boundary (overscroll attempt)
      // clientY increases -> deltaY is negative -> stays clamped at 0
      for (let i = 1; i <= 5; i++) {
        viewport.dispatchEvent(makeTouchEvent('touchmove', startX, startY + 20 * i, true));
      }
      const atBoundary = host._virtualScrollTop;

      // 3. Immediately reverse direction and drag upwards by 50px
      // clientY decreases from startY + 100 to startY + 50
      viewport.dispatchEvent(makeTouchEvent('touchmove', startX, startY + 50, true));
      const afterReverse = host._virtualScrollTop;

      viewport.dispatchEvent(makeTouchEvent('touchend', startX, startY + 50, false));

      return { atBoundary, afterReverse };
    });

    expect(result.atBoundary).toBe(0);
    expect(result.afterReverse).toBe(50);
  });

  test('flicking with velocity launches smooth momentum scrolling past the release point', async ({ page }) => {
    // Perform a timed swipe with real delays between touchmove events to build velocity
    await page.evaluate(async () => {
      const host = document.getElementById('my-list');
      const viewport = host.shadowRoot.querySelector('.runway-grid__viewport');
      const rect = viewport.getBoundingClientRect();
      const startX = rect.x + rect.width / 2;
      const startY = rect.y + rect.height / 2;

      const makeTouchEvent = (type, x, y, cancelable, touches) => {
        const touch = new Touch({ identifier: 1, target: viewport, clientX: x, clientY: y });
        return new TouchEvent(type, {
          touches: touches !== undefined ? touches : [touch],
          targetTouches: touches !== undefined ? touches : [touch],
          changedTouches: [touch],
          bubbles: true,
          cancelable,
        });
      };

      viewport.dispatchEvent(makeTouchEvent('touchstart', startX, startY, false));

      // Move 40px every 16ms for 5 steps (total 200px drag at ~2.5 px/ms velocity)
      for (let i = 1; i <= 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 16));
        viewport.dispatchEvent(makeTouchEvent('touchmove', startX, startY - 40 * i, true));
      }

      // Record scroll position right at release
      host._scrollAtRelease = host._virtualScrollTop;

      // End touch (empty touches list, changedTouches has ending touch)
      viewport.dispatchEvent(makeTouchEvent('touchend', startX, startY - 200, false, []));
    });

    const releasePos = await page.evaluate(() => document.getElementById('my-list')._scrollAtRelease);
    expect(releasePos).toBe(200);

    // Wait for momentum animation to glide further down
    await page.waitForFunction(
      (pos) => {
        const host = document.getElementById('my-list');
        return host && host._virtualScrollTop > pos + 100;
      },
      releasePos,
      { timeout: 3000 }
    );

    const glidedPos = await page.evaluate(() => document.getElementById('my-list')._virtualScrollTop);
    expect(glidedPos).toBeGreaterThan(releasePos);
  });

  test('touching the viewport during momentum scrolling immediately arrests the glide', async ({ page }) => {
    // 1. Launch a flick
    await page.evaluate(async () => {
      const host = document.getElementById('my-list');
      const viewport = host.shadowRoot.querySelector('.runway-grid__viewport');
      const rect = viewport.getBoundingClientRect();
      const startX = rect.x + rect.width / 2;
      const startY = rect.y + rect.height / 2;

      const makeTouchEvent = (type, x, y, cancelable, touches) => {
        const touch = new Touch({ identifier: 1, target: viewport, clientX: x, clientY: y });
        return new TouchEvent(type, {
          touches: touches !== undefined ? touches : [touch],
          targetTouches: touches !== undefined ? touches : [touch],
          changedTouches: [touch],
          bubbles: true,
          cancelable,
        });
      };

      viewport.dispatchEvent(makeTouchEvent('touchstart', startX, startY, false));
      for (let i = 1; i <= 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 16));
        viewport.dispatchEvent(makeTouchEvent('touchmove', startX, startY - 40 * i, true));
      }
      viewport.dispatchEvent(makeTouchEvent('touchend', startX, startY - 200, false, []));
    });

    // 2. Wait until momentum is actively running
    await page.waitForFunction(() => {
      const host = document.getElementById('my-list');
      return host && host._momentumRafId !== null;
    });

    // 3. Touch down to catch the momentum
    await page.evaluate(() => {
      const host = document.getElementById('my-list');
      const viewport = host.shadowRoot.querySelector('.runway-grid__viewport');
      const rect = viewport.getBoundingClientRect();
      const touch = new Touch({ identifier: 2, target: viewport, clientX: rect.x + 50, clientY: rect.y + 50 });
      viewport.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true }));
      host._capturedAt = host._virtualScrollTop;
    });

    // 4. Verify momentum RAF was cancelled immediately
    const isRunning = await page.evaluate(() => document.getElementById('my-list')._momentumRafId !== null);
    expect(isRunning).toBe(false);

    // 5. Wait 100ms and verify scroll position didn't drift
    await page.waitForTimeout(100);
    const posAfterWait = await page.evaluate(() => document.getElementById('my-list')._virtualScrollTop);
    const capturedAt = await page.evaluate(() => document.getElementById('my-list')._capturedAt);
    expect(posAfterWait).toBe(capturedAt);
  });

  test('touchcancel cleanly resets touch state and arrests momentum', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.getElementById('my-list');
      const viewport = host.shadowRoot.querySelector('.runway-grid__viewport');
      const rect = viewport.getBoundingClientRect();

      const touch = new Touch({ identifier: 1, target: viewport, clientX: rect.x + 50, clientY: rect.y + 50 });
      viewport.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true }));

      // Move a bit
      const touchMove = new Touch({ identifier: 1, target: viewport, clientX: rect.x + 50, clientY: rect.y + 30 });
      viewport.dispatchEvent(new TouchEvent('touchmove', { touches: [touchMove], targetTouches: [touchMove], changedTouches: [touchMove], bubbles: true, cancelable: true }));

      // Cancel
      viewport.dispatchEvent(new TouchEvent('touchcancel', { touches: [], targetTouches: [], changedTouches: [touchMove], bubbles: true }));
    });

    const isTouchScrolling = await page.evaluate(() => document.getElementById('my-list')._isTouchScrolling);
    const momentumRaf = await page.evaluate(() => document.getElementById('my-list')._momentumRafId);
    expect(isTouchScrolling).toBe(false);
    expect(momentumRaf).toBeNull();
  });

  test('multiple consecutive real touch swipes continue to scroll smoothly', async ({ page, context }) => {
    const client = await context.newCDPSession(page);

    async function swipe(startY, endY, steps = 10, stepDelay = 16) {
      const box = await page.evaluate(() => {
        const host = document.getElementById('my-list');
        const r = host.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y };
      });
      const x = box.x;
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y: box.y + startY, id: 0 }]
      });
      for (let i = 1; i <= steps; i++) {
        await new Promise(r => setTimeout(r, stepDelay));
        const curY = box.y + startY + (endY - startY) * (i / steps);
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: curY, id: 0 }]
        });
      }
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: []
      });
    }

    const pos0 = await page.evaluate(() => document.getElementById('my-list')._virtualScrollTop);

    // Swipe 1
    await swipe(200, 50, 10, 16);
    await page.waitForTimeout(500);
    const pos1 = await page.evaluate(() => document.getElementById('my-list')._virtualScrollTop);
    expect(pos1).toBeGreaterThan(pos0 + 100);

    // Swipe 2 (verifies gesture works even after DOM recycling detaches previous targets)
    await swipe(200, 50, 10, 16);
    await page.waitForTimeout(500);
    const pos2 = await page.evaluate(() => document.getElementById('my-list')._virtualScrollTop);
    expect(pos2).toBeGreaterThan(pos1 + 100);

    // Swipe 3
    await swipe(200, 50, 10, 16);
    await page.waitForTimeout(500);
    const pos3 = await page.evaluate(() => document.getElementById('my-list')._virtualScrollTop);
    expect(pos3).toBeGreaterThan(pos2 + 100);
  });
});

test.describe('runway-grid - 2D grid touch scrolling', () => {
  test.use({ hasTouch: true });

  test('a diagonal swipe moves both vertical and horizontal scroll positions', async ({ page }) => {
    await page.goto('/examples/02-grid-2d.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('grid-demo');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const swipeDistance = 150;
    const result = await page.evaluate((distance) => {
      const host = document.getElementById('grid-demo');
      const viewport = host.shadowRoot.querySelector('.runway-grid__viewport');
      const rect = viewport.getBoundingClientRect();
      const startX = rect.x + rect.width / 2;
      const startY = rect.y + rect.height / 2;

      const makeTouchEvent = (type, x, y, cancelable) => {
        const touch = new Touch({ identifier: 1, target: viewport, clientX: x, clientY: y });
        return new TouchEvent(type, { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable });
      };

      viewport.dispatchEvent(makeTouchEvent('touchstart', startX, startY, false));
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        viewport.dispatchEvent(makeTouchEvent('touchmove', startX - (distance / steps) * i, startY - (distance / steps) * i, true));
      }
      viewport.dispatchEvent(makeTouchEvent('touchend', startX - distance, startY - distance, false));

      return {
        virtualScrollTop: host._virtualScrollTop,
        virtualScrollLeft: host._virtualScrollLeft,
      };
    }, swipeDistance);

    expect(result.virtualScrollTop).toBe(swipeDistance);
    expect(result.virtualScrollLeft).toBe(swipeDistance);
  });
});
