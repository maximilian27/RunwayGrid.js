import { test, expect } from '@playwright/test';

test.describe('1.0.0-rc2 Regression and Feature Validation', () => {

  test('index 1 and penultimate index scrolling navigates accurately without snapping', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const checkIndex1 = await page.evaluate(async () => {
      const host = document.getElementById('my-list');
      host.scrollToCell(1, 0);
      await new Promise(r => requestAnimationFrame(r));
      const hasNode1 = host.shadowRoot.querySelector('[data-row="1"]') !== null;
      const top = host._virtualScrollTop;
      return { hasNode1, top };
    });

    expect(checkIndex1.hasNode1).toBe(true);
    expect(checkIndex1.top).toBeGreaterThan(0);

    const checkPenultimate = await page.evaluate(async () => {
      const host = document.getElementById('my-list');
      const count = host.data.length;
      const targetIndex = count - 2;
      host.scrollToCell(targetIndex, 0);
      await new Promise(r => requestAnimationFrame(r));
      const hasPenultimateNode = host.shadowRoot.querySelector(`[data-row="${targetIndex}"]`) !== null;
      const top = host._virtualScrollTop;
      return { hasPenultimateNode, top, targetIndex };
    });

    expect(checkPenultimate.hasPenultimateNode).toBe(true);
    expect(checkPenultimate.top).toBeGreaterThan(0);
  });

  test('horizontal single-axis scrollToIndex navigates the column axis', async ({ page }) => {
    await page.goto('/examples/03-horizontal-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('h-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const scrollResult = await page.evaluate(async () => {
      const host = document.getElementById('h-list');
      host.scrollToIndex(100);
      await new Promise(r => requestAnimationFrame(r));
      const left = host._virtualScrollLeft;
      const hasNode100 = host.shadowRoot.querySelector('[data-col="100"]') !== null;
      return { left, hasNode100 };
    });

    expect(scrollResult.left).toBeGreaterThan(0);
    expect(scrollResult.hasNode100).toBe(true);
  });

  test('wheel event normalizes deltaMode without arbitrary dampener', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const wheelDeltas = await page.evaluate(() => {
      const host = document.getElementById('my-list');
      host.scrollToCell(0, 0);

      // Simulate line mode wheel (deltaMode = 1, deltaY = 3 lines => 48px)
      const lineEvent = new WheelEvent('wheel', {
        deltaY: 3,
        deltaMode: 1, // DOM_DELTA_LINE
        bubbles: true,
        cancelable: true,
      });
      host.viewport.dispatchEvent(lineEvent);
      const posAfterLine = host._virtualScrollTop;

      // Simulate pixel mode wheel (deltaMode = 0, deltaY = 50 => 50px without 0.3 factor)
      const pixelEvent = new WheelEvent('wheel', {
        deltaY: 50,
        deltaMode: 0, // DOM_DELTA_PIXEL
        bubbles: true,
        cancelable: true,
      });
      host.viewport.dispatchEvent(pixelEvent);
      const posAfterPixel = host._virtualScrollTop;

      return { posAfterLine, deltaPixel: posAfterPixel - posAfterLine };
    });

    // In line mode, 3 lines * 16px = 48px
    expect(wheelDeltas.posAfterLine).toBe(48);
    // In pixel mode, delta was 50px (was previously dampended by 0.3 = 15px)
    expect(wheelDeltas.deltaPixel).toBe(50);
  });

  test('stale cell rendering is invalidated immediately when data, columns, or template changes', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const updates = await page.evaluate(async () => {
      const host = document.getElementById('my-list');
      const row1Cell = host.shadowRoot.querySelector('[data-row="1"]');
      const initialText = row1Cell.textContent;

      // 1. Update data in-place
      const updatedData = [...host.data];
      updatedData[1] = 'Updated Second Item Title';
      host.data = updatedData;
      await new Promise(r => requestAnimationFrame(r));
      const cellAfterData = host.shadowRoot.querySelector('[data-row="1"]').textContent;

      // 2. Update template
      host.template = (item, index) => `PREFIX: ${index}`;
      await new Promise(r => requestAnimationFrame(r));
      const cellAfterTemplate = host.shadowRoot.querySelector('[data-row="1"]').textContent;

      return { initialText, cellAfterData, cellAfterTemplate };
    });

    expect(updates.cellAfterData).toContain('Updated Second Item Title');
    expect(updates.cellAfterTemplate).toContain('PREFIX: 1');
  });

  test('defensive rendering converts primitive template return values without throwing', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const results = await page.evaluate(async () => {
      const host = document.getElementById('my-list');

      // Test number 0
      host.template = () => 0;
      await new Promise(r => requestAnimationFrame(r));
      const textZero = host.shadowRoot.querySelector('[data-row="0"]').textContent;

      // Test boolean false
      host.template = () => false;
      await new Promise(r => requestAnimationFrame(r));
      const textFalse = host.shadowRoot.querySelector('[data-row="0"]').textContent;

      // Test number 42
      host.template = () => 42;
      await new Promise(r => requestAnimationFrame(r));
      const textNum = host.shadowRoot.querySelector('[data-row="0"]').textContent;

      return { textZero, textFalse, textNum };
    });

    expect(results.textZero).toBe('0');
    expect(results.textFalse).toBe('false');
    expect(results.textNum).toBe('42');
  });

  test('lifecycle disconnection frees WASM, detaches observers/listeners, and cleans up', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const lifecycleResult = await page.evaluate(async () => {
      const host = document.getElementById('my-list');
      let registryFreed = false;

      // Spy on registry.free
      const originalFree = host.registry.free;
      host.registry.free = function () {
        registryFreed = true;
        return originalFree.apply(this, arguments);
      };

      // Disconnect
      const parent = host.parentNode;
      parent.removeChild(host);

      const isRegistryNull = host.registry === null;

      // Reconnect
      parent.appendChild(host);
      await new Promise(r => requestAnimationFrame(r));

      const reconnectedHasRegistry = host.registry !== null;
      const reconnectedNodesCount = host.renderedNodes.length;

      return {
        registryFreed,
        isRegistryNull,
        reconnectedHasRegistry,
        reconnectedNodesCount,
      };
    });

    expect(lifecycleResult.registryFreed).toBe(true);
    expect(lifecycleResult.isRegistryNull).toBe(true);
    expect(lifecycleResult.reconnectedHasRegistry).toBe(true);
    expect(lifecycleResult.reconnectedNodesCount).toBeGreaterThan(0);
  });

  test('api symmetry: get/set data & columns, and horizontal data assignment', async ({ page }) => {
    await page.goto('/examples/03-horizontal-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('h-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const apiCheck = await page.evaluate(async () => {
      const host = document.getElementById('h-list');

      // Test getters
      const gotColumns = host.columns;
      const gotData = host.data;

      // Test set columns triggering rebuild
      host.columns = 120;
      const colCountAfterSet = host.colCount;

      // Create a fresh horizontal list without explicit columns to verify direct data assignment
      const freshGrid = document.createElement('runway-grid');
      freshGrid.setAttribute('orientation', 'horizontal');
      document.body.appendChild(freshGrid);

      const items = Array.from({ length: 42 }, (_, i) => ({ title: `Item #${i}` }));
      freshGrid.template = (item) => `[${item.title}]`;
      freshGrid.data = items;
      await new Promise(r => requestAnimationFrame(r));

      const freshColCount = freshGrid.colCount;
      const freshFirstCell = freshGrid.shadowRoot.querySelector('[data-col="0"]')?.textContent;

      document.body.removeChild(freshGrid);

      return {
        hasColumnsGetter: gotColumns !== undefined,
        hasDataGetter: Array.isArray(gotData) || gotData === null,
        colCountAfterSet,
        freshColCount,
        freshFirstCell,
      };
    });

    expect(apiCheck.hasColumnsGetter).toBe(true);
    expect(apiCheck.hasDataGetter).toBe(true);
    expect(apiCheck.colCountAfterSet).toBe(120);
    expect(apiCheck.freshColCount).toBe(42);
    expect(apiCheck.freshFirstCell).toBe('[Item #0]');
  });

  test('dynamic observed attributes reactively update configuration', async ({ page }) => {
    await page.goto('/examples/01-vertical-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('my-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const attrResult = await page.evaluate(async () => {
      const host = document.getElementById('my-list');

      host.setAttribute('row-size', '75');
      host.setAttribute('col-size', '150');
      host.setAttribute('buffer-size', '300');

      return {
        rowSize: host.rowSize,
        colSize: host.colSize,
        bufferSize: host.bufferSize,
      };
    });

    expect(attrResult.rowSize).toBe(75);
    expect(attrResult.colSize).toBe(150);
    expect(attrResult.bufferSize).toBe(300);
  });

  test('keyboard PageUp and PageDown page horizontally when orientation="horizontal"', async ({ page }) => {
    await page.goto('/examples/03-horizontal-list.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('h-list');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const keyResult = await page.evaluate(async () => {
      const host = document.getElementById('h-list');
      host.viewport.focus();

      // PageDown
      const pdEvent = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
      host.viewport.dispatchEvent(pdEvent);
      const scrollAfterPD = host._virtualScrollLeft;

      // PageUp
      const puEvent = new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true, cancelable: true });
      host.viewport.dispatchEvent(puEvent);
      const scrollAfterPU = host._virtualScrollLeft;

      return { scrollAfterPD, scrollAfterPU };
    });

    expect(keyResult.scrollAfterPD).toBeGreaterThan(0);
    expect(keyResult.scrollAfterPU).toBeLessThan(keyResult.scrollAfterPD);
  });

  test('corner element exists in dual-axis grid mode', async ({ page }) => {
    await page.goto('/examples/02-grid-2d.html');
    await page.waitForFunction(() => {
      const el = document.getElementById('grid-demo');
      return el && el.registry !== null && el.renderedNodes.length > 0;
    });

    const cornerExists = await page.evaluate(() => {
      const host = document.getElementById('grid-demo');
      const corner = host.shadowRoot.querySelector('.runway-grid__corner');
      const bottomBar = host.shadowRoot.querySelector('.runway-grid__bottom-bar');
      return corner !== null && bottomBar !== null;
    });

    expect(cornerExists).toBe(true);
  });
});
