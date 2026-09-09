import '../../src/runway-grid.js';

const slidingList = document.getElementById('sliding-list');
const slidingStatus = document.getElementById('sliding-status');

// Number of rows fetched per simulated "page".
const SLIDING_PAGE_SIZE = 100;
// Hard cap on how many rows may be loaded at once - once exceeded, the oldest rows are
// pruned from the head so the array (and WASM vectors) never grow past this size.
const SLIDING_MAX_ROWS = 1000;
// How many rows of runway may still be left in the buffered range before the next page
// is requested, same idea as the plain infinite-scroll example's threshold.
const SLIDING_FETCH_THRESHOLD = 30;

let slidingFetching = false;
// Total rows ever fetched from the "server" - keeps growing forever, even though the
// loaded `rows` array itself is capped at SLIDING_MAX_ROWS. Used as the fetch offset (so
// every row still gets a unique, ever-increasing absolute index) and to display progress.
let slidingTotalFetched = 0;

// Simulates a paginated backend endpoint, same shape as the infinite-scroll example's.
function fetchSlidingPage(offset, limit) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const page = Array.from({ length: limit }, (_, i) => {
        const index = offset + i;
        return { index, lines: 1 + (index % 4) }; // 1-4 lines of body text -> variable height
      });
      resolve(page);
    }, 400);
  });
}

function renderSlidingStatus() {
  const suffix = slidingFetching ? ' - fetching more…' : '';
  slidingStatus.textContent =
      `Loaded ${slidingList.rows.length} of max ${SLIDING_MAX_ROWS} items (${slidingTotalFetched} fetched total)${suffix}`;
}

// Fetches the next page, appends it via appendData(), then immediately prunes the head
// if the cap was exceeded. Both steps happen before renderSlidingStatus() reads back
// rows.length, so the displayed count is always the post-prune, capped size.
async function loadMoreSlidingData() {
  if (slidingFetching) return;
  slidingFetching = true;
  renderSlidingStatus();

  const page = await fetchSlidingPage(slidingTotalFetched, SLIDING_PAGE_SIZE);
  slidingTotalFetched += page.length;

  slidingFetching = false;
  slidingList.appendData(page);

  // Immediately after appending, cap the array at SLIDING_MAX_ROWS by dropping the
  // oldest rows from the top - removeDataFromHead() counter-scrolls the viewport by the
  // exact pixel height removed, so this is completely invisible to the user.
  if (slidingList.rowCount > SLIDING_MAX_ROWS) {
    slidingList.removeDataFromHead(slidingList.rowCount - SLIDING_MAX_ROWS);
  }

  renderSlidingStatus();
}

// Signature: (rowItem, rowIndex, colIndex, rowCount, colCount). `rowIndex` is the row's
// *local* array position, which keeps shifting down as older rows are pruned from the
// head - the stable absolute row number instead comes from the item's own `index`.
slidingList.template = (item) => {
  const paragraph = 'Simulated content fetched from the server. '.repeat(item.lines);
  const hue = (item.index * 47) % 360;

  return `
    <div style="box-sizing: border-box; padding: 12px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--color-border); background: ${item.index % 2 === 0 ? 'var(--color-bg)' : 'var(--color-bg-alt)'};">
      <strong style="color: hsl(${hue}, 65%, 40%);">Row ${item.index}</strong>
      <p style="margin: 0; font-size: 13px; color: var(--color-text-muted); line-height: 1.4;">${paragraph}</p>
    </div>
  `;
};

// Kick off with the first page.
loadMoreSlidingData();

slidingList.addEventListener('rangechange', (e) => {
  renderSlidingStatus();
  // Fetch the next page as soon as the *buffered* (off-screen) range gets close to the
  // end of what's currently loaded - same trigger as the plain infinite-scroll example, just
  // now paired with the head-pruning above so the loaded set never grows past SLIDING_MAX_ROWS.
  if (e.buffered.endRow >= slidingList.rows.length - SLIDING_FETCH_THRESHOLD) {
    loadMoreSlidingData();
  }
});
