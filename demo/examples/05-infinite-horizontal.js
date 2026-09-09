import '../../src/runway-grid.js';

const infiniteHList = document.getElementById('infinite-h-list');
const infiniteHStatus = document.getElementById('infinite-h-status');

// Number of items fetched per simulated "page".
const INFINITE_H_PAGE_SIZE = 40;
// How many columns of runway may still be left in the buffered range before the next page
// is requested - large enough that the (simulated) network round-trip resolves and gets
// appended well before the user's viewport actually reaches the unloaded tail.
const INFINITE_H_FETCH_THRESHOLD = 15;

let infiniteHFetching = false;

// Simulates a paginated backend endpoint, same shape as the vertical example's, but each
// item carries a variable "width factor" instead of a line count, so the auto-measured
// column width (rather than row height) is what ends up varying from item to item.
function fetchInfiniteHPage(offset, limit) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const page = Array.from({ length: limit }, (_, i) => {
        const index = offset + i;
        return { index, widthFactor: 1 + (index % 4) }; // 1-4x label repeats -> variable width
      });
      resolve(page);
    }, 400);
  });
}

function renderInfiniteHStatus() {
  const loadedCount = infiniteHList.columnsData ? infiniteHList.columnsData.length : 0;
  infiniteHStatus.textContent = infiniteHFetching
      ? `Loaded ${loadedCount} items - fetching more…`
      : `Loaded ${loadedCount} items`;
}

// Fetches the next page and appends it via `appendData()`. For `orientation="horizontal"`
// this grows the *column* axis (`columnsData`) instead of `rows`, preserving the current
// horizontal scroll position instead of resetting it like assigning `columns` would. Also
// used to load the very first page, since `appendData()` builds the registry on first use.
async function loadMoreInfiniteHData() {
  if (infiniteHFetching) return;
  infiniteHFetching = true;
  renderInfiniteHStatus();

  const offset = infiniteHList.columnsData ? infiniteHList.columnsData.length : 0;
  const page = await fetchInfiniteHPage(offset, INFINITE_H_PAGE_SIZE);

  infiniteHFetching = false;
  infiniteHList.appendData(page);
  renderInfiniteHStatus();
}

// Signature: (rowItem, rowIndex, colIndex, rowCount, colCount). `rowItem` is unused here
// (rows is just a fixed single placeholder for a horizontal list) - the actual per-item
// data lives in `columnsData`, indexed by `colIndex`.
infiniteHList.template = (rowItem, rowIndex, colIndex) => {
  const entry = infiniteHList.columnsData[colIndex];
  const hue = (colIndex * 47) % 360;
  const label = 'Item '.repeat(entry.widthFactor) + `#${entry.index}`;

  return `
    <div style="box-sizing: border-box; height: 100%; padding: 0 16px; display: flex; align-items: center; white-space: nowrap; border-right: 1px solid var(--color-border); background: ${colIndex % 2 === 0 ? 'var(--color-bg)' : 'var(--color-bg-alt)'};">
      <strong style="color: hsl(${hue}, 65%, 40%);">${label}</strong>
    </div>
  `;
};

// Kick off with the first page.
loadMoreInfiniteHData();

infiniteHList.addEventListener('rangechange', (e) => {
  renderInfiniteHStatus();
  // Fetch the next page as soon as the *buffered* (off-screen) range gets close to the
  // end of what's currently loaded - i.e. before the user actually hits the true right edge.
  const loadedCount = infiniteHList.columnsData ? infiniteHList.columnsData.length : 0;
  if (e.buffered.endCol >= loadedCount - INFINITE_H_FETCH_THRESHOLD) {
    loadMoreInfiniteHData();
  }
});
