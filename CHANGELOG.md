# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).


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
