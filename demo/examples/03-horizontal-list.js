import '../../src/runway-grid.js';

const hList = document.getElementById('h-list');
const hIndexInput = document.getElementById('h-index-input');
const hJumpBtn = document.getElementById('h-jump-btn');
const hStartBtn = document.getElementById('h-start-btn');
const hEndBtn = document.getElementById('h-end-btn');

const HORIZONTAL_COUNT = 5000;

// Chip labels of varying length - each one renders to a different natural width.
const hLabels = [
  'New', 'Featured', 'Popular this week', 'Limited Edition', 'Sale',
  'Back in Stock', 'Staff Pick', 'Trending Now', 'Almost Gone', 'Best Seller',
];
const hColors = ['#0070f3', '#ff3333', '#00a86b', '#ff9900', '#8e44ad'];

// `columns` drives colCount (for orientation="horizontal" the column axis is the
// item axis). Must be set before `data` so colCount is known when the registry
// is created.
hList.columns = Array.from({ length: HORIZONTAL_COUNT }, (_, i) => i);

// Row data just needs a single entry: orientation="horizontal" forces rowCount to 1
// regardless of array length, and setting `data` is what triggers registry setup.
hList.data = [null];

// Signature: (rowItem, rowIndex, colIndex, rowCount, colCount)
// Each cell's own DOM width is left unset (auto/shrink-to-fit), so its rendered
// width comes purely from its content - the component measures the actual
// rendered width via ResizeObserver and grows/shrinks the virtual column to match
// (col-size is only the initial estimate used before the real width is known).
hList.template = (rowItem, rowIndex, colIndex, rowCount, colCount) => {
  const label = hLabels[colIndex % hLabels.length];
  const color = hColors[colIndex % hColors.length];
  const isWide = colIndex % 4 === 0;
  const extra = isWide ? ' \u2014 extended description text to force a much wider chip' : '';

  return `
    <div style="box-sizing: border-box; height: 100%; padding: 0 16px; display: flex; align-items: center; white-space: nowrap; border-right: 1px solid var(--color-border); background: var(--color-bg-alt);">
      <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${color}; margin-right: 8px; flex-shrink: 0;"></span>
      <strong style="font-size: 13px; color: var(--color-text);">#${colIndex} ${label}${extra}</strong>
    </div>
  `;
};

hJumpBtn.addEventListener('click', () => {
  const targetIndex = Number(hIndexInput.value);
  hList.scrollToCell(0, targetIndex);
});

hStartBtn.addEventListener('click', () => {
  hList.scrollToCell(0, 0);
});

hEndBtn.addEventListener('click', () => {
  hList.scrollToCell(0, HORIZONTAL_COUNT - 1);
});

hList.addEventListener('rangechange', (e) => {
  console.debug('Horizontal list rendering range:', {
    buffered: `cols ${e.buffered.startCol} to ${e.buffered.endCol}`,
    viewport: `cols ${e.viewport.startCol} to ${e.viewport.endCol}`
  });
});
