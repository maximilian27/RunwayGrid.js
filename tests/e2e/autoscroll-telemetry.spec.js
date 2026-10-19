import { test, expect } from '@playwright/test';

test.describe('Example 8: Auto-Scroll Telemetry Stream', () => {

  test('loads telemetry page, continuously streams incoming events, and autoscrolls to the last item', async ({ page }) => {
    await page.goto('/examples/08-autoscroll-telemetry.html');

    // Wait until the WASM registry is initialized and rows have rendered
    await page.waitForFunction(() => {
      const grid = document.getElementById('telemetry-grid');
      return grid && grid.registry !== null && grid.renderedNodes.length > 0;
    });

    const pageState = await page.evaluate(() => {
      const grid = document.getElementById('telemetry-grid');
      const firstCell = grid.shadowRoot.querySelector('.runway-grid__cell');
      const telemetryRow = firstCell ? firstCell.querySelector('.telemetry-row') : null;

      return {
        title: document.title,
        rowCount: grid.rowCount,
        renderedCount: grid.renderedNodes.length,
        hasRow: telemetryRow !== null,
        hasTimestamp: telemetryRow ? Boolean(telemetryRow.querySelector('.telemetry-ts')) : false,
        hasSubsys: telemetryRow ? Boolean(telemetryRow.querySelector('.telemetry-subsys')) : false,
        hasBadge: telemetryRow ? Boolean(telemetryRow.querySelector('.telemetry-badge')) : false,
        hasVal: telemetryRow ? Boolean(telemetryRow.querySelector('.telemetry-val')) : false,
      };
    });

    expect(pageState.title).toContain('8. Telemetry log (auto-scroll)');
    expect(pageState.rowCount).toBeGreaterThanOrEqual(25);
    expect(pageState.renderedCount).toBeGreaterThan(0);
    expect(pageState.hasRow).toBe(true);
    expect(pageState.hasTimestamp).toBe(true);
    expect(pageState.hasSubsys).toBe(true);
    expect(pageState.hasBadge).toBe(true);
    expect(pageState.hasVal).toBe(true);

    // Verify continuous streaming: rowCount increases over time
    const initialRowCount = await page.evaluate(() => document.getElementById('telemetry-grid').rowCount);
    await page.waitForFunction((initial) => {
      const grid = document.getElementById('telemetry-grid');
      return grid && grid.rowCount >= initial + 2;
    }, initialRowCount, { timeout: 3000 });

    const newRowCount = await page.evaluate(() => document.getElementById('telemetry-grid').rowCount);
    expect(newRowCount).toBeGreaterThan(initialRowCount);

    // Verify autoscroll tracks tail: scroll top is advancing
    const pos = await page.evaluate(() => document.getElementById('telemetry-grid')._virtualScrollTop);
    expect(pos).toBeGreaterThan(0);
  });

  test('pauses on hover and resumes scrolling on mouseout', async ({ page }) => {
    await page.goto('/examples/08-autoscroll-telemetry.html');

    await page.waitForFunction(() => {
      const grid = document.getElementById('telemetry-grid');
      return grid && grid.registry !== null && grid.renderedNodes.length > 0;
    });

    // Hover over grid to pause
    const gridEl = page.locator('#telemetry-grid');
    await gridEl.hover();

    await page.waitForFunction(() => {
      const grid = document.getElementById('telemetry-grid');
      return grid && grid._autoScrollPaused === true;
    }, { timeout: 2000 });

    await expect(page.locator('#status-text')).toHaveText(/PAUSED/);

    // Move mouse out to resume
    await page.mouse.move(0, 0);

    await page.waitForFunction(() => {
      const grid = document.getElementById('telemetry-grid');
      return grid && grid._autoScrollPaused === false;
    }, { timeout: 2000 });

    await expect(page.locator('#status-text')).toHaveText(/STREAMING/);
  });

  test('interactive controls: autoscroll toggle, stream speed, burst, jump, and tabs work', async ({ page }) => {
    await page.goto('/examples/08-autoscroll-telemetry.html');

    await page.waitForFunction(() => {
      const grid = document.getElementById('telemetry-grid');
      return grid && grid.registry !== null && grid.renderedNodes.length > 0;
    });

    // 1. Test Stop / Follow Tail button
    const toggleAutoscrollBtn = page.locator('#toggle-autoscroll-btn');
    await expect(toggleAutoscrollBtn).toHaveText('⏹ Stop Auto-Scroll');
    await toggleAutoscrollBtn.click();
    await expect(toggleAutoscrollBtn).toHaveText('▶ Follow Tail');

    const stoppedScroll = await page.evaluate(() => document.getElementById('telemetry-grid')._isAutoScrolling);
    expect(stoppedScroll).toBe(false);

    // Resume following tail
    await toggleAutoscrollBtn.click();
    await expect(toggleAutoscrollBtn).toHaveText('⏹ Stop Auto-Scroll');
    const resumedScroll = await page.evaluate(() => document.getElementById('telemetry-grid')._isAutoScrolling);
    expect(resumedScroll).toBe(true);

    // 2. Test Stream Pause / Resume button
    const toggleStreamBtn = page.locator('#toggle-stream-btn');
    await expect(toggleStreamBtn).toHaveText('⏸ Pause Stream');
    await toggleStreamBtn.click();
    await expect(toggleStreamBtn).toHaveText('▶ Resume Stream');
    await toggleStreamBtn.click();
    await expect(toggleStreamBtn).toHaveText('⏸ Pause Stream');

    // 3. Test + Burst (+5) button
    const burstBtn = page.locator('#burst-btn');
    const countBefore = await page.evaluate(() => document.getElementById('telemetry-grid').rowCount);
    await burstBtn.click();
    const countAfter = await page.evaluate(() => document.getElementById('telemetry-grid').rowCount);
    expect(countAfter).toBeGreaterThanOrEqual(countBefore + 5);

    // 4. Test Jump to Top and Jump to Tail
    const jumpStartBtn = page.locator('#jump-start-btn');
    await jumpStartBtn.click();
    const startPos = await page.evaluate(() => document.getElementById('telemetry-grid')._virtualScrollTop);
    expect(startPos).toBe(0);

    const jumpEndBtn = page.locator('#jump-end-btn');
    await jumpEndBtn.click();
    const endPos = await page.evaluate(() => document.getElementById('telemetry-grid')._virtualScrollTop);
    expect(endPos).toBeGreaterThan(0);

    // 5. Test Code tab
    const codeTabBtn = page.locator('.tab-btn[data-tab="code"]');
    await codeTabBtn.click();
    await expect(page.locator('.tab-panel[data-tab="code"]')).toHaveClass(/active/);
    const codeContent = await page.locator('.code-block').textContent();
    expect(codeContent).toContain('startAutoScroll');
    expect(codeContent).toContain('appendData');
  });

  test('landing page links to Example 8 card and navigation matches', async ({ page }) => {
    await page.goto('/index.html');

    const card = page.locator('.card[href="examples/08-autoscroll-telemetry.html"]');
    await expect(card).toBeVisible();
    await expect(card.locator('.card-num')).toHaveText('EXAMPLE 8');
    await expect(card.locator('h3')).toHaveText('Telemetry log (auto-scroll)');

    const navLink = page.locator('.site-nav a[href="examples/08-autoscroll-telemetry.html"]');
    await expect(navLink).toBeVisible();
  });
});
