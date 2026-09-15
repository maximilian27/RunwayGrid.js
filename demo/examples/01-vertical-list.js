import '../../src/runway-grid.js';
import { escapeHtml } from '../assets/shared.js';

const virtualScroll = document.getElementById('my-list');
const indexInput = document.getElementById('index-input');
const jumpBtn = document.getElementById('jump-btn');
const startBtn = document.getElementById('start-btn');
const endBtn = document.getElementById('end-btn');

// Generate 1,000,000 items instantly
const mockData = Array.from({ length: 1000000 }, (_, i) => `Item string`);

// Define a highly complex, dynamic layout template.
// Signature: (rowItem, rowIndex, colIndex, rowCount, colCount)
//
// Every string returned below is assigned via `innerHTML` (see the `template` setter), so
// any interpolated value is escaped with `escapeHtml()` first, keeping this pattern safe to
// reuse even if `item` (or any derived value) ends up coming from an untrusted source.
virtualScroll.template = (item, index, colIndex, count) => {
  // Categorize items into 3 distinct layout behaviors
  const isHeader = index % 50 === 0;
  const isCardWithMedia = !isHeader && index % 7 === 0;

  // 1. Dynamic Section Headers
  if (isHeader) {
    return `
      <div class="list-item section-header"
           style="background: var(--color-bg-inset); padding: 15px 10px; border-left: 4px solid var(--color-accent); font-weight: bold; color: var(--color-text); font-family: var(--font-sans); font-size: 14px;">
        ⚡ FEED SEGMENT CRITERIA - BLOCK ${Math.floor(index / 50)}
      </div>
    `;
  }

  // 2. High-Overhead Card Layout (Simulating DOM thrashing with heavy variable text & shapes)
  if (isCardWithMedia) {
    const variableParagraph = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat((index % 3) + 1);
    const mediaHeight = 60 + (index % 4) * 20; // Generates dynamic heights: 60px, 80px, 100px, 120px

    return `
      <div class="list-item interactive-card" data-id="${index}"
           style="padding: 15px; background: var(--color-bg); border-bottom: 2px solid var(--color-border); display: flex; flex-direction: column; gap: 8px; font-family: var(--font-sans); font-size: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="color: var(--color-accent);">#️⃣ System Node ID: ${index}</strong>
          <span style="font-size: 11px; background: #ffeae6; color: #ff3333; padding: 2px 6px; border-radius: 4px; font-family: monospace;">
            HIGH AROUSAL METRIC
          </span>
        </div>
        <p style="margin: 0; font-size: 13px; color: var(--color-text-muted); line-height: 1.4;">${variableParagraph}</p>
        <div style="width: 100%; height: ${mediaHeight}px; background: linear-gradient(135deg, var(--color-accent) 0%, #00dfd8 100%); border-radius: 6px; opacity: 0.85; display: flex; align-items: center; justify-content: center; color: white; font-weight: 500; font-size: 12px;">
          Dynamic Media Block (${mediaHeight}px)
        </div>
        <div style="display: flex; gap: 10px; margin-top: 4px;">
          <button onclick="console.debug('Dispatched packet ${index}')" style="padding: 4px 8px; font-size: 12px; cursor: pointer; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text); border-radius: 4px;">Acknowledge</button>
          <button onclick="this.closest('.interactive-card').style.background='#fdffb6'; console.warn('Bypassed restrictions on ${index}')" style="padding: 4px 8px; font-size: 12px; cursor: pointer; border: 1px solid #ff3333; background: var(--color-bg); color: #ff3333; border-radius: 4px;">Bypass Rules</button>
        </div>
      </div>
    `;
  }

  // 3. Compact Native Baseline Elements
  return `
    <div class="list-item standard-row"
         style="padding: 10px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--color-border); font-size: 14px; background: var(--color-bg-alt); font-family: var(--font-sans);">
      <span style="font-family: monospace; color: var(--color-text-muted);">[Data Entry] ${escapeHtml(item)} -> Pointer ${index}</span>
      <span style="color: var(--color-text-muted); font-size: 12px;">Offset Track: ${(index / count * 100).toFixed(1)}%</span>
    </div>
  `;
};

// Bind the row data (orientation="vertical" -> single column, colCount stays 1)
virtualScroll.data = mockData;

// Hook up the control listeners to test scrollToIndex
jumpBtn.addEventListener('click', () => {
  const targetIndex = Number(indexInput.value);
  virtualScroll.scrollToIndex(targetIndex);
});

startBtn.addEventListener('click', () => {
  virtualScroll.scrollToIndex(0);
});

endBtn.addEventListener('click', () => {
  virtualScroll.scrollToIndex(mockData.length - 1);
});

// Listen to the range changes
virtualScroll.addEventListener('rangechange', (e) => {
  console.debug('Range change:', {
    buffered: `${e.buffered.startRow} to ${e.buffered.endRow}`,
    viewport: `${e.viewport.startRow} to ${e.viewport.endRow}`
  });
});
