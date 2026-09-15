import '../../src/runway-grid.js';

const slidingHList = document.getElementById('sliding-h-list');
const slidingHStatus = document.getElementById('sliding-h-status');

// Number of items fetched per simulated "page".
const SLIDING_H_PAGE_SIZE = 100;
// Hard cap on how many columns may be loaded at once - once exceeded, the oldest columns
// are pruned from the head so columnsData (and the WASM column vectors) never grow past
// this size.
const SLIDING_H_MAX_COLS = 1000;
// How many columns of runway may still be left in the buffered range before the next page
// is requested, same idea as the horizontal infinite-scroll example's threshold.
const SLIDING_H_FETCH_THRESHOLD = 30;

let slidingHFetching = false;
// Total items ever fetched from the "server" - keeps growing forever, even though the
// loaded `columnsData` array itself is capped at SLIDING_H_MAX_COLS.
let slidingHTotalFetched = 0;

// Simulates a paginated backend endpoint, same shape as the horizontal infinite-scroll example's.
function fetchSlidingHPage(offset, limit) {
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

function renderSlidingHStatus() {
  const loadedCount = slidingHList.columnsData ? slidingHList.columnsData.length : 0;
  const suffix = slidingHFetching ? ' - fetching more…' : '';
  slidingHStatus.textContent =
      `Loaded ${loadedCount} of max ${SLIDING_H_MAX_COLS} items (${slidingHTotalFetched} fetched total)${suffix}`;
}

// Fetches the next page, appends it via appendData(), then immediately prunes the head
// if the cap was exceeded, mirroring the vertical sliding-window example but along the
// column axis.
async function loadMoreSlidingHData() {
  if (slidingHFetching) return;
  slidingHFetching = true;
  renderSlidingHStatus();

  const page = await fetchSlidingHPage(slidingHTotalFetched, SLIDING_H_PAGE_SIZE);
  slidingHTotalFetched += page.length;

  slidingHFetching = false;
  slidingHList.appendData(page);

  // Immediately after appending, cap columnsData at SLIDING_H_MAX_COLS by dropping the
  // oldest columns from the left - removeDataFromHead() counter-scrolls the horizontal
  // axis by the exact pixel width removed, so this is completely invisible to the user.
  if (slidingHList.colCount > SLIDING_H_MAX_COLS) {
    slidingHList.removeDataFromHead(slidingHList.colCount - SLIDING_H_MAX_COLS);
  }

  renderSlidingHStatus();
}

// Signature: (rowItem, rowIndex, colIndex, rowCount, colCount). `colIndex` is the
// column's *local* array position, which keeps shifting as older columns are pruned
// from the head - the stable absolute column number instead comes from the entry's own
// `index`.
slidingHList.template = (rowItem, rowIndex, colIndex) => {
  const entry = slidingHList.columnsData[colIndex];
  const hue = (entry.index * 47) % 360;
  const label = 'Item '.repeat(entry.widthFactor) + `#${entry.index}`;

  return `
    <div style="box-sizing: border-box; height: 100%; padding: 0 16px; display: flex; align-items: center; white-space: nowrap; border-right: 1px solid var(--color-border); background: ${entry.index % 2 === 0 ? 'var(--color-bg)' : 'var(--color-bg-alt)'};">
      <strong style="color: hsl(${hue}, 65%, 40%);">${label}</strong>
    </div>
  `;
};

// Kick off with the first page.
loadMoreSlidingHData();

slidingHList.addEventListener('rangechange', (e) => {
  renderSlidingHStatus();
  // Fetch the next page as soon as the *buffered* (off-screen) range gets close to the
  // end of what's currently loaded - same trigger as the horizontal infinite-scroll example,
  // just now paired with the head-pruning above so the loaded set never grows past
  // SLIDING_H_MAX_COLS.
  const loadedCount = slidingHList.columnsData ? slidingHList.columnsData.length : 0;
  if (e.buffered.endCol >= loadedCount - SLIDING_H_FETCH_THRESHOLD) {
    loadMoreSlidingHData();
  }
});
