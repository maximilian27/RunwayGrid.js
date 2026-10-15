import { test, expect } from '@playwright/test';

test.describe('ResizeObserver stability', () => {
  test('does not emit ResizeObserver loop error when rendering variable-sized cells', async ({ page }) => {
    const errorEvents = [];
    await page.exposeFunction('onGlobalError', (msg) => {
      errorEvents.push(msg);
    });

    await page.addInitScript(() => {
      window.addEventListener('error', (e) => {
        if (e.message && e.message.includes('ResizeObserver')) {
          window.onGlobalError(e.message);
        }
      });
    });

    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    // Scroll up and down across variable-sized items (row % 7 === 0 is tall)
    await page.evaluate(async () => {
      const el = document.getElementById('my-list');
      for (let i = 0; i < 10; i++) {
        el.scrollToIndex(15 * (i + 1));
        await new Promise(r => setTimeout(r, 60));
      }
    });

    await page.waitForTimeout(300);
    expect(errorEvents).toEqual([]);
  });
});
