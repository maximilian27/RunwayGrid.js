import { test, expect } from '@playwright/test';

test.describe('1.0.0 Feature Validation', () => {

  test('in-place view recycling passes cell node as 6th param and skips innerHTML wipe when undefined is returned', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const result = await page.evaluate(async () => {
      const host = document.getElementById('my-list');

      let receivedCellNode = null;

      // Custom template that updates DOM in-place and returns undefined
      host.template = (item, rowIndex, colIndex, rowCount, colCount, cellNode) => {
        receivedCellNode = cellNode;

        // If cellNode already has our child element, update it in place
        let customSpan = cellNode ? cellNode.querySelector('.custom-badge') : null;
        if (!customSpan) {
          customSpan = document.createElement('span');
          customSpan.className = 'custom-badge';
          cellNode.appendChild(customSpan);
        }
        customSpan.textContent = `Item ${item && item.id !== undefined ? item.id : rowIndex}`;

        // Return undefined to indicate in-place update (skip innerHTML = '')
        return undefined;
      };

      // Trigger a re-render
      host.data = [...host.data];
      await new Promise(r => requestAnimationFrame(r));

      const firstCell = host.shadowRoot.querySelector('.runway-grid__cell');
      const badgeBefore = firstCell.querySelector('.custom-badge');
      const textBefore = badgeBefore ? badgeBefore.textContent : null;

      // Scroll slightly and back to trigger another render of the same cell
      host.scrollToCell(1, 0);
      await new Promise(r => requestAnimationFrame(r));
      host.scrollToCell(0, 0);
      await new Promise(r => requestAnimationFrame(r));

      const firstCellAfter = host.shadowRoot.querySelector('[data-row="0"]');
      const badgeAfter = firstCellAfter.querySelector('.custom-badge');
      const textAfter = badgeAfter ? badgeAfter.textContent : null;

      return {
        hasCellNode: receivedCellNode instanceof HTMLElement,
        textBefore,
        textAfter,
        badgePreserved: badgeAfter !== null
      };
    });

    expect(result.hasCellNode).toBe(true);
    expect(result.textBefore).toBe('Item 0');
    expect(result.textAfter).toBe('Item 0');
    expect(result.badgePreserved).toBe(true);
  });

  test('momentum friction and max speed attributes and getters/setters work correctly', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null;
    });

    const physics = await page.evaluate(() => {
      const host = document.getElementById('my-list');

      // Default values
      const defaultFriction = host.momentumFriction;
      const defaultMaxSpeed = host.momentumMaxSpeed;

      // Set via properties
      host.momentumFriction = 0.92;
      host.momentumMaxSpeed = 5.5;
      const attrFriction = host.getAttribute('momentum-friction');
      const attrMaxSpeed = host.getAttribute('momentum-max-speed');
      const propFriction = host.momentumFriction;
      const propMaxSpeed = host.momentumMaxSpeed;

      // Set via attributes
      host.setAttribute('momentum-friction', '0.88');
      host.setAttribute('momentum-max-speed', '3.0');
      const updatedFriction = host.momentumFriction;
      const updatedMaxSpeed = host.momentumMaxSpeed;

      // Defensive clamping: below minimum
      host.momentumFriction = 0.1; // clamp to 0.50
      host.momentumMaxSpeed = 0.01; // clamp to 0.1
      const clampedMinFriction = host.momentumFriction;
      const clampedMinMaxSpeed = host.momentumMaxSpeed;

      // Defensive clamping: above maximum
      host.momentumFriction = 1.5; // clamp to 0.99
      host.momentumMaxSpeed = 50.0; // clamp to 20.0
      const clampedMaxFriction = host.momentumFriction;
      const clampedMaxMaxSpeed = host.momentumMaxSpeed;

      // Fallback on invalid NaN
      host.setAttribute('momentum-friction', 'not-a-number');
      host.setAttribute('momentum-max-speed', 'not-a-number');
      const fallbackFriction = host.momentumFriction;
      const fallbackMaxSpeed = host.momentumMaxSpeed;

      return {
        defaultFriction,
        defaultMaxSpeed,
        attrFriction,
        attrMaxSpeed,
        propFriction,
        propMaxSpeed,
        updatedFriction,
        updatedMaxSpeed,
        clampedMinFriction,
        clampedMinMaxSpeed,
        clampedMaxFriction,
        clampedMaxMaxSpeed,
        fallbackFriction,
        fallbackMaxSpeed,
      };
    });

    expect(physics.defaultFriction).toBe(0.955);
    expect(physics.defaultMaxSpeed).toBe(4.0);
    expect(physics.attrFriction).toBe('0.92');
    expect(physics.attrMaxSpeed).toBe('5.5');
    expect(physics.propFriction).toBe(0.92);
    expect(physics.propMaxSpeed).toBe(5.5);
    expect(physics.updatedFriction).toBe(0.88);
    expect(physics.updatedMaxSpeed).toBe(3.0);
    expect(physics.clampedMinFriction).toBe(0.50);
    expect(physics.clampedMinMaxSpeed).toBe(0.1);
    expect(physics.clampedMaxFriction).toBe(0.99);
    expect(physics.clampedMaxMaxSpeed).toBe(20.0);
    expect(physics.fallbackFriction).toBe(0.955);
    expect(physics.fallbackMaxSpeed).toBe(4.0);
  });

  test('auto-scroll ticker mode scrolls automatically, pauses on mouseenter/touchstart, and cancels on wheel/manual track input', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    // 1. Basic auto-scroll progression
    const scrollProgress = await page.evaluate(async () => {
      const host = document.getElementById('my-list');
      host.scrollToCell(0, 0);
      host.startAutoScroll(2);

      const isAutoScrolling = host._isAutoScrolling;
      const pos0 = host._virtualScrollTop;

      // Wait a few animation frames
      await new Promise(r => setTimeout(r, 80));
      const pos1 = host._virtualScrollTop;

      host.stopAutoScroll();
      const stoppedAutoScrolling = host._isAutoScrolling;

      await new Promise(r => setTimeout(r, 40));
      const pos2 = host._virtualScrollTop;

      return {
        isAutoScrolling,
        pos0,
        pos1,
        stoppedAutoScrolling,
        pos2
      };
    });

    expect(scrollProgress.isAutoScrolling).toBe(true);
    expect(scrollProgress.pos1).toBeGreaterThan(scrollProgress.pos0);
    expect(scrollProgress.stoppedAutoScrolling).toBe(false);
    expect(scrollProgress.pos2).toBe(scrollProgress.pos1);

    // 2. Mouseenter pauses ticker, mouseleave resumes ticker
    const hoverResult = await page.evaluate(async () => {
      const host = document.getElementById('my-list');
      host.scrollToCell(0, 0);
      host.startAutoScroll(2);

      // Simulate mouseenter on viewport
      host.viewport.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      const pausedAfterEnter = host._autoScrollPaused;

      const posWhilePaused = host._virtualScrollTop;
      await new Promise(r => setTimeout(r, 60));
      const posAfterWait = host._virtualScrollTop;

      // Simulate mouseleave
      host.viewport.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      const pausedAfterLeave = host._autoScrollPaused;

      await new Promise(r => setTimeout(r, 60));
      const posResumed = host._virtualScrollTop;

      host.stopAutoScroll();

      return {
        pausedAfterEnter,
        posWhilePaused,
        posAfterWait,
        pausedAfterLeave,
        posResumed
      };
    });

    expect(hoverResult.pausedAfterEnter).toBe(true);
    expect(hoverResult.posAfterWait).toBe(hoverResult.posWhilePaused);
    expect(hoverResult.pausedAfterLeave).toBe(false);
    expect(hoverResult.posResumed).toBeGreaterThan(hoverResult.posAfterWait);

    // 3. Wheel event immediately cancels auto-scroll
    const wheelCancelResult = await page.evaluate(async () => {
      const host = document.getElementById('my-list');
      host.startAutoScroll(2);
      const runningBefore = host._isAutoScrolling;

      // Dispatch wheel event
      host.viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 20, bubbles: true, cancelable: true }));

      const runningAfter = host._isAutoScrolling;
      return { runningBefore, runningAfter };
    });

    expect(wheelCancelResult.runningBefore).toBe(true);
    expect(wheelCancelResult.runningAfter).toBe(false);

    // 4. Track scroll cancels auto-scroll
    const trackCancelResult = await page.evaluate(async () => {
      const host = document.getElementById('my-list');
      host.startAutoScroll(2);
      const runningBefore = host._isAutoScrolling;

      // User scrolls the track manually
      host.verticalTrack.scrollTop += 50;
      host.verticalTrack.dispatchEvent(new Event('scroll'));

      const runningAfter = host._isAutoScrolling;
      return { runningBefore, runningAfter };
    });

    expect(trackCancelResult.runningBefore).toBe(true);
    expect(trackCancelResult.runningAfter).toBe(false);
  });

  test('touch pause and resume for auto-scroll ticker', async ({ page }) => {
    test.use = { hasTouch: true };
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const touchResult = await page.evaluate(async () => {
      const host = document.getElementById('my-list');
      host.startAutoScroll(2);

      const makeTouchEvent = (type) => {
        const touch = new Touch({ identifier: 1, target: host.viewport, clientX: 100, clientY: 100 });
        return new TouchEvent(type, {
          touches: type === 'touchend' ? [] : [touch],
          targetTouches: type === 'touchend' ? [] : [touch],
          changedTouches: [touch],
          bubbles: true
        });
      };

      host.viewport.dispatchEvent(makeTouchEvent('touchstart'));
      const pausedOnTouchStart = host._autoScrollPaused;

      host.viewport.dispatchEvent(makeTouchEvent('touchend'));
      const pausedOnTouchEnd = host._autoScrollPaused;

      host.stopAutoScroll();

      return { pausedOnTouchStart, pausedOnTouchEnd };
    });

    expect(touchResult.pausedOnTouchStart).toBe(true);
    expect(touchResult.pausedOnTouchEnd).toBe(false);
  });

  test('disconnectedCallback stops auto-scroll ticker', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null;
    });

    const disconnectedResult = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      host.startAutoScroll(2);
      const runningBefore = host._isAutoScrolling;

      host.remove();

      const runningAfter = host._isAutoScrolling;
      const rafNull = host._autoScrollRafId === null;

      return { runningBefore, runningAfter, rafNull };
    });

    expect(disconnectedResult.runningBefore).toBe(true);
    expect(disconnectedResult.runningAfter).toBe(false);
    expect(disconnectedResult.rafNull).toBe(true);
  });

  test('wheel speed attribute, property, and event multiplier work correctly', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const result = await page.evaluate(() => {
      const host = document.getElementById('my-list');

      // 1. Defaults and property/attribute reflection
      const defaultSpeed = host.wheelSpeed;

      host.wheelSpeed = 2.5;
      const attrSpeed = host.getAttribute('wheel-speed');
      const propSpeed = host.wheelSpeed;

      host.setAttribute('wheel-speed', '0.5');
      const updatedPropSpeed = host.wheelSpeed;

      host.setAttribute('wheel-speed', 'invalid');
      const fallbackSpeed = host.wheelSpeed;

      // Defensive clamping
      host.wheelSpeed = -5.0; // clamp to 0.1
      const clampedMinSpeed = host.wheelSpeed;

      host.wheelSpeed = 25.0; // clamp to 10.0
      const clampedMaxSpeed = host.wheelSpeed;

      // 2. Functional wheel scrolling with multipliers
      host.scrollToCell(0, 0);
      const startPos = host._virtualScrollTop;

      // At default speed 1.0
      host.wheelSpeed = 1.0;
      host.viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true }));
      const posSpeed1 = host._virtualScrollTop;

      // At double speed 2.0
      host.wheelSpeed = 2.0;
      host.viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true }));
      const posSpeed2 = host._virtualScrollTop;

      // At half speed 0.5
      host.wheelSpeed = 0.5;
      host.viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true }));
      const posSpeedHalf = host._virtualScrollTop;

      return {
        defaultSpeed,
        attrSpeed,
        propSpeed,
        updatedPropSpeed,
        fallbackSpeed,
        clampedMinSpeed,
        clampedMaxSpeed,
        startPos,
        posSpeed1,
        posSpeed2,
        posSpeedHalf,
      };
    });

    expect(result.defaultSpeed).toBe(1.0);
    expect(result.attrSpeed).toBe('2.5');
    expect(result.propSpeed).toBe(2.5);
    expect(result.updatedPropSpeed).toBe(0.5);
    expect(result.fallbackSpeed).toBe(1.0);
    expect(result.clampedMinSpeed).toBe(0.1);
    expect(result.clampedMaxSpeed).toBe(10.0);

    expect(result.startPos).toBe(0);
    expect(result.posSpeed1).toBe(50);
    expect(result.posSpeed2 - result.posSpeed1).toBe(100); // 50 * 2.0
    expect(result.posSpeedHalf - result.posSpeed2).toBe(25); // 50 * 0.5
  });

  test('isolated render error handling prevents cache poisoning and recovers gracefully', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const result = await page.evaluate(async () => {
      const host = document.getElementById('my-list');

      // Set items where item at row 1 is missing required nested property
      const testItems = [
        { id: 0, user: { name: 'Alice' } },
        { id: 1, user: null }, // triggers TypeError on user.name
        { id: 2, user: { name: 'Charlie' } },
        { id: 3, user: { name: 'Dave' } },
      ];

      // Capture console.error in page context
      const errors = [];
      const origError = console.error;
      console.error = (...args) => errors.push(args.join(' '));

      host.template = (item) => `<div>User: ${item.user.name}</div>`;
      host.data = testItems;
      await new Promise(r => requestAnimationFrame(r));

      // Check rendered nodes in DOM
      const cell0 = host.shadowRoot.querySelector('[data-row="0"]');
      const cell2 = host.shadowRoot.querySelector('[data-row="2"]');
      const cell1Tagged = host.shadowRoot.querySelector('[data-row="1"]');

      const text0 = cell0 ? cell0.textContent : null;
      const text2 = cell2 ? cell2.textContent : null;

      // Now fix item at row 1 and re-render
      testItems[1].user = { name: 'Bob' };
      host.data = [...testItems];
      await new Promise(r => requestAnimationFrame(r));

      const cell1Fixed = host.shadowRoot.querySelector('[data-row="1"]');
      const text1Fixed = cell1Fixed ? cell1Fixed.textContent : null;

      console.error = origError;

      return {
        text0,
        text2,
        cell1TaggedBeforeFix: cell1Tagged !== null,
        text1Fixed,
        errorLogged: errors.some(e => e.includes('Error rendering cell at [row 1, col 0]'))
      };
    });

    expect(result.text0).toContain('Alice');
    expect(result.text2).toContain('Charlie');
    expect(result.cell1TaggedBeforeFix).toBe(false);
    expect(result.text1Fixed).toContain('Bob');
    expect(result.errorLogged).toBe(true);
  });
});
