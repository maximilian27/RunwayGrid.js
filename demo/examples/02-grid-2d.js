import '../../src/runway-grid.js';

const gridDemo = document.getElementById('grid-demo');
const GRID_ROWS = 100000;
const GRID_COLS = 500;

// Column definitions (drives colCount = 500). Must be set before `data` so both
// axes are known when the registry is created.
gridDemo.columns = Array.from({ length: GRID_COLS }, (_, c) => `Col ${c}`);

// Row data - each row just needs to exist; actual cell content is computed from
// (rowIndex, colIndex) inside the template below.
const gridRows = Array.from({ length: GRID_ROWS }, (_, r) => ({ id: r }));

// Note: `runway-grid` renders cell content inside its own Shadow DOM, so
// page-level stylesheet classes (like the light-DOM `.list-item` class) never actually
// apply to it - only inline styles (and inherited properties) do. Each cell's box is
// individually absolutely-positioned to support independent row/column virtualization,
// so an explicit inline `width` matching `col-size` (120px here) is required, otherwise
// it shrinks-to-fit around its unstyled text content instead.
gridDemo.template = (rowItem, rowIndex, colIndex, rowCount, colCount) => {
  // Make every 10th row much taller, and every 5th column much wider
  const isTallRow = rowIndex % 10 === 0;
  const isWideCol = colIndex % 5 === 0;

  const height = isTallRow ? '150px' : '40px';
  const width = isWideCol ? '300px' : '120px';

  return `
    <div style="box-sizing: border-box; width: ${width}; height: ${height}; padding: 8px; border: 1px solid var(--color-border); color: var(--color-text);">
      R${rowIndex} x C${colIndex}
    </div>
  `;
};

gridDemo.data = gridRows;

document.getElementById('grid-top-left-btn').addEventListener('click', () => {
  gridDemo.scrollToCell(0, 0);
});

document.getElementById('grid-bottom-right-btn').addEventListener('click', () => {
  gridDemo.scrollToCell(GRID_ROWS - 1, GRID_COLS - 1);
});

gridDemo.addEventListener('rangechange', (e) => {
  console.debug('Grid rendering range:', {
    buffered: `rows ${e.buffered.startRow}-${e.buffered.endRow}, cols ${e.buffered.startCol}-${e.buffered.endCol}`,
    viewport: `rows ${e.viewport.startRow}-${e.viewport.endRow}, cols ${e.viewport.startCol}-${e.viewport.endCol}`
  });
});
