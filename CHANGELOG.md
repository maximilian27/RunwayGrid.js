# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).


## [1.0.0-rc2] - 2026-09-21

### Added

- Symmetrical property accessors `get data()` and `get columns()` on `<runway-grid>`.
- Direct dataset assignment on horizontal lists via `grid.data = items`, automatically mapping items to columns.
- Dynamic HTML attribute observation (`observedAttributes` / `attributeChangedCallback`) for `orientation`, `row-size`, `col-size`, and `buffer-size`.
- `SAFE_MAX_SPACER_SIZE` constant (aliased to `SAFE_MAX_HEIGHT` for backward compatibility) to accurately describe spacer limits across both axes.
- Scrollbar corner element (`.runway-grid__corner`) and flex-based bottom bar to prevent horizontal and vertical track overlap in dual-axis mode.
- Horizontal `PageUp` and `PageDown` keyboard navigation for `orientation="horizontal"`.
- Comprehensive end-to-end regression tests covering index clamping, horizontal `scrollToIndex`, wheel normalization, cache invalidation, and lifecycle cleanup.

### Changed

- Normalized mouse wheel deltas (`e.deltaMode` scaling line deltas by 16px and page deltas by viewport dimensions) and removed the arbitrary `0.3` multiplier, restoring 1:1 wheel velocity parity across all browsers.
- Replaced the arbitrary 40ms `_scrollMuteTimer` with event-source tagging and RAF tracking, preventing dropped user scrollbar inputs during programmatic synchronization.
- Cached track and viewport dimensions during high-frequency scrolling loops (`_scrollByDelta`, `calculateIndices`) to eliminate layout reflow thrashing.
- Optimized Rust layout engine routines (`build_prefix_sums`, slice updates, and head removal guards), reducing WASM bundle size and overhead during sliding window pruning.

### Fixed

- Fixed integer index clamping in `scrollToCell`, resolving index snapping bugs that prevented scrolling to index 1 or penultimate indices (`count - 2`).
- Fixed `scrollToIndex` for `orientation="horizontal"`, properly navigating along the column axis.
- Fixed WebAssembly linear memory leaks by freeing `VirtualScrollRegistry` instances upon data reassignment and element unmount.
- Fixed DOM listener and observer memory leaks by disconnecting `ResizeObserver`s and managing window `mouseup` listeners strictly during element attachment.
- Fixed stale cell rendering on `data`, `columns`, or `template` reassignments using `_renderVersion` dirty-flag cache invalidation.
- Fixed `TypeError` when `template` returns non-node primitive values (`number`, `boolean`, `0`, `false`).
- Setting `columns` now triggers registry rebuilding and re-rendering automatically.

## [1.0.0-rc1] - 2026-09-18

### Added

- `deploy-pages` workflow.
- Mobile touch-panning support: `touchstart`/`touchmove` on the viewport are now mapped 1:1 to
  the virtual scroll position (mirroring the existing `wheel` handling), so swiping directly on
  the grid scrolls it on touch devices instead of only being scrollable by dragging the (tiny)
  scrollbar track. The viewport now also sets `touch-action: none` to stop the browser from
  fighting the gesture with native pull-to-refresh/page panning.

## [1.0.0-rc0] - 2026-09-15

### Added

- Initial `<runway-grid>` custom element: virtualized vertical lists, horizontal lists, and 2D
  grids backed by a Rust/WebAssembly layout engine (`runway_engine`), with the compiled WASM
  embedded as base64 for zero-config installs.
- Infinite-scroll support: `appendData()`/`removeDataFromHead()` for both vertical and horizontal
  orientations, including a memory-capped "sliding window" pattern.
- Full accessibility support: `role="grid"`/`"row"`/`"gridcell"` for `orientation="both"`,
  `role="list"`/`"listitem"` for single-axis orientations, with ARIA counts/positions kept in
  sync with the true dataset size (not just mounted DOM nodes).
- A keyboard navigation guard clause so interactive elements (inputs/buttons) nested inside cells
  receive keystrokes normally instead of having them hijacked by grid navigation.
- A `<noscript>`-based SEO/crawler fallback pattern, documented in the README.
- A full demo site (`demo/`) covering all seven usage patterns, with light/dark theming
  (system-based, with a manual override toggle) and a syntax-highlighted "Code" tab per example.
- Playwright e2e test suite covering virtualization, scroll-to-index/cell, append/remove data,
  and accessibility.

### Changed

- Renamed all internal `.virtual-scroll__*` CSS classes to `.runway-grid__*` for naming
  consistency with the public element name.
- Batched `rangechange` event dispatch so a single public API call (e.g. `scrollToCell()`) never
  fires more than one event per invocation.
- `_onWheel` now only calls `preventDefault()` on axes that have room to scroll, allowing
  scroll-chaining into a parent scrollable container at the grid's bounds.

### Fixed

- Removed a global `window.history.scrollRestoration` mutation on module import.
- WASM init failures are now caught and surfaced via a `wasmerror` event instead of an unhandled
  rejection.
- Fixed a light/dark theme flash on navigation in the demo site (missing
  `<meta name="color-scheme">`).
- Keyboard navigation (Page Up/Down, Home/End, arrows) no longer hijacks keystrokes from
  interactive elements (inputs/buttons) nested inside cells.
