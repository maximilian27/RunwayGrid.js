import '../../src/runway-grid.js';

const infiniteList = document.getElementById('infinite-list');
const infiniteStatus = document.getElementById('infinite-status');

// Number of rows fetched per simulated "page".
const INFINITE_PAGE_SIZE = 40;
// How many rows of runway may still be left in the buffered range before the next page
// is requested - large enough that the (simulated) network round-trip resolves and gets
// appended well before the user's viewport actually reaches the unloaded tail.
const INFINITE_FETCH_THRESHOLD = 15;

let infiniteFetching = false;

// Simulates a paginated backend endpoint: resolves after a short network-like delay with
// a page of items whose rendered height will vary from row to row (variable line count).
function fetchInfinitePage(offset, limit) {
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

function renderInfiniteStatus() {
  infiniteStatus.textContent = infiniteFetching
      ? `Loaded ${infiniteList.rows.length} items - fetching more…`
      : `Loaded ${infiniteList.rows.length} items`;
}

// Fetches the next page and appends it via `appendData()` - preserving the current
// scroll position instead of resetting it like assigning `data` would. Also used to
// load the very first page, since `appendData()` builds the registry on first use.
async function loadMoreInfiniteData() {
  if (infiniteFetching) return;
  infiniteFetching = true;
  renderInfiniteStatus();

  const offset = infiniteList.rows.length;
  const page = await fetchInfinitePage(offset, INFINITE_PAGE_SIZE);

  infiniteFetching = false;
  infiniteList.appendData(page);
  renderInfiniteStatus();
}

// Signature: (rowItem, rowIndex, colIndex, rowCount, colCount)
infiniteList.template = (item, index) => {
  const paragraph = 'Simulated content fetched from the server. '.repeat(item.lines);
  const hue = (index * 47) % 360;

  return `
    <div style="box-sizing: border-box; padding: 12px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--color-border); background: ${index % 2 === 0 ? 'var(--color-bg)' : 'var(--color-bg-alt)'};">
      <strong style="color: hsl(${hue}, 65%, 40%);">Row ${index}</strong>
      <p style="margin: 0; font-size: 13px; color: var(--color-text-muted); line-height: 1.4;">${paragraph}</p>
    </div>
  `;
};

// Kick off with the first page.
loadMoreInfiniteData();

infiniteList.addEventListener('rangechange', (e) => {
  renderInfiniteStatus();
  // Fetch the next page as soon as the *buffered* (off-screen) range gets close to the
  // end of what's currently loaded - i.e. before the user actually hits the true bottom.
  if (e.buffered.endRow >= infiniteList.rows.length - INFINITE_FETCH_THRESHOLD) {
    loadMoreInfiniteData();
  }
});
