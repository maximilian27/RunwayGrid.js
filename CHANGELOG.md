# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-10-25

### Added

- **Approach Runway Teleportation for Distant Smooth Scrolls**: Implemented distance-aware approach runway teleportation in `scrollToCell` and `scrollToIndex`. When the target cell is more than 5 viewports away, the virtual scroll position jumps immediately to an approach runway 1–2 viewports ahead of the destination and smoothly animates only the final arrival into the target cell. This eliminates thousands of intermediate DOM node allocations and recycling passes, avoids redundant ResizeObserver invocations, and prevents layout estimation drift across unrendered items while preserving the visual sensation of directional motion.
- Comprehensive end-to-end test suites:
  - `tests/e2e/fenwick-scale.spec.js`: Validates sub-millisecond burst remeasurement performance and dropped-frame prevention across 1,000,000 dynamic-height rows.
  - `tests/e2e/scroll-to-index.spec.js`: Asserts approach runway teleportation behavior, non-traversal of intermediate rows during distant smooth scrolls, seamless near-range smooth scrolls, and symmetrical reverse-direction scrolling.

### Changed

- **Fenwick Tree Layout Engine Migration**: Replaced flat linear prefix-sum arrays in the Rust/WebAssembly layout engine (`runway_engine`) with a Fenwick tree (Binary Indexed Tree) structure (`Fenwick`, storing `tree` and `sizes`). Converted layout size updates (`update_size`) from an $O(N)$ suffix-sum walk into an $O(\log N)$ point update (~1.4 µs per update at 10M rows vs ~6.8 ms linear), eliminating layout thrashing and maximizing aggregate CPU efficiency during scroll-driven remeasurement.
- Updated `resolve_axis` binary search in `runway_engine` to query Fenwick prefix sums directly during range resolution without requiring auxiliary prefix-sum allocations.
- Recompiled and updated the embedded WebAssembly layout engine artifact in `src/runway-engine-wasm.js`.

### Fixed

- Fixed frame drops, sluggish scrolling, and animation stuttering across unmeasured dynamic-height rows at large scale (1M–10M rows) caused by $O(N)$ linear prefix-sum recalculations on ResizeObserver measurements.

## [1.0.0] - 2026-10-19

### Added

- Smooth animated jump-to-index / jump-to-cell: `scrollToIndex(index, options)` and `scrollToCell(rowIndex, colIndex, options)` now accept an optional `options` parameter (`{ behavior: 'smooth' | 'auto' | 'instant', duration?: number, easing?: (t: number) => number }`) or behavior string (`'smooth' | 'auto'`), returning a `Promise<void>` that resolves when the target position has been reached and settled.
- Configurable default scroll behavior: added `scroll-behavior` observed HTML attribute and `scrollBehavior` property (`'auto' | 'smooth'`) on `<runway-grid>`.
- Dynamic coordinate refinement during smooth scrolling: animation frames smoothly adjust target scroll positions as variable row heights and column widths are dynamically measured, settling precisely on the target cell.
- Input cancellation: smooth scroll animations automatically cancel immediately upon user manual input (`wheel`, `touchstart`, scrollbar track dragging, or keyboard navigation) and on element disconnection.

### Fixed

- Fixed render cache poisoning on uncaught cell template errors in `applyChanges`: isolated `renderItem` execution in a localized `try/catch` block and deferred `_renderedVersion`, `data-row`, and `data-col` metadata stamping until rendering completes without throwing. Prevents unhandled exceptions on dirty data from breaking adjacent visible viewport cells or permanently caching broken nodes.

## [1.0.0-rc5] - 2026-10-16

### Added

- Native auto-scroll ("ticker mode"): added public `startAutoScroll(speed = 1)` and `stopAutoScroll()` methods driven by a `requestAnimationFrame` loop that feeds into `_scrollByDelta()`.
- Interactive ticker controls: auto-scroll automatically pauses on `mouseenter` / `touchstart`, resumes on `mouseleave` / `touchend` / `touchcancel`, and cancels immediately upon manual user input (`wheel` and scrollbar track scrolling).
- Configurable touch momentum physics: exposed `momentum-friction` (default `0.955`, clamped to `[0.50, 0.99]`) and `momentum-max-speed` (default `4.0`, clamped to `[0.1, 20.0]`) as observed HTML attributes and property getters/setters on `<runway-grid>`.
- Configurable mouse wheel speed: exposed `wheel-speed` (default `1.0`, clamped to `[0.1, 10.0]`) as an observed HTML attribute and property getter/setter on `<runway-grid>`, applying a configurable multiplier to wheel delta scroll movements.
- Defensive physics safety bounds: added automatic clamping to `momentumFriction` (`[0.50, 0.99]`), `momentumMaxSpeed` (`[0.1, 20.0]`), and `wheelSpeed` (`[0.1, 10.0]`) with NaN/invalid fallback defaults, preventing infinite glide loops, single-frame catapult layout jumps, and inverted or locked scrolling gestures from invalid attribute input.
- In-place view recycling (zero-GC rendering): `applyChanges` passes the native cell `node` as the 6th parameter (`cellNode`) to `renderItem`. When `renderItem` returns `undefined`, the grid assumes the consumer updated the DOM in-place and skips wiping `innerHTML`, preventing template recreation and visual flicker in framework wrappers.
- TypeScript definition updates: updated `RenderItemFunction` to accept `cellNode?: HTMLElement` and return `undefined`, and declared `momentumFriction`, `momentumMaxSpeed`, `wheelSpeed`, `startAutoScroll`, and `stopAutoScroll` on `RunwayGrid`.
- End-to-end test suite (`tests/e2e/v1-features.spec.js`) covering view recycling, momentum configuration, ticker auto-scroll behavior, pause/resume on hover/touch, and manual cancellation.

### Changed

- Updated `startMomentum` in `src/events/touch.js` to read `momentumFriction` and `momentumMaxSpeed` dynamically from the grid instance rather than using fixed constants.
- Updated `handleWheel` in `src/events/wheel.js` to apply `grid.wheelSpeed` multiplier to wheel delta movements.
- Updated cell rendering in `src/runway-grid.js` to only clear `innerHTML` when `renderItem` returns a defined value (`string`, `Node`, `number`, `boolean`, or `null`).
- Updated `disconnectedCallback` in `src/runway-grid.js` to automatically stop any running auto-scroll ticker when `<runway-grid>` is removed from the DOM.

## [1.0.0-rc4] - 2026-10-15

### Fixed

- Fixed `ResizeObserver` loop notification errors (`ResizeObserver loop completed with undelivered notifications`) across Angular and other framework error handlers by batching layout recalculations into `requestAnimationFrame` and observing pooled cell elements only upon creation.

## [1.0.0-rc3] - 2026-10-07

### Added

- Dynamic scroll anchoring in `handleResize` (`src/events/resize.js`): calculates anchor row and column offset deltas before and after applying measured cell sizes, counter-scrolling automatically to eliminate layout jumps and prevent element skipping when scrolling upward or leftward past variable-sized items.
- Momentum gesture suppression controls in `src/events/touch.js`: introduced `MIN_FLING_DISPLACEMENT`, `MIN_FLING_VELOCITY`, `MAX_FLING_PAUSE_TIME`, and a `VELOCITY_SAMPLE_WINDOW` to prevent micro-drags, soft taps, and paused releases from triggering accidental fling animations.
- Dedicated touch interaction end-to-end test suite (`tests/e2e/touch-scroll.spec.js`) validating single and consecutive swipes, gesture reversals, momentum glide, tap-to-stop, pause suppression, soft touches, and multi-axis dynamic scroll anchoring.

### Changed

- Calibrated momentum deceleration physics in `startMomentum`: adjusted friction factor to `0.94`, capped maximum fling velocity at `3.5` px/ms, and raised stopping speed threshold to `0.03` px/ms for more natural and controlled deceleration.
- Improved momentum touch-stop sensitivity: requires an 8px drag threshold before discarding caught-momentum state to reliably halt gliding on tap.
- Updated Playwright dev server configuration (`playwright.config.js`) to pass `--base /`, ensuring consistent asset loading during end-to-end testing regardless of production base paths.

### Fixed

- Fixed layout shifts and skipped items when scrolling backwards past dynamically sized elements by anchoring viewport positions to the first visible row and column during resize remeasurement.
- Fixed accidental momentum flings caused by soft releases or resting fingers prior to touch release.
- Fixed race conditions between scrollbar track events and active touch gestures by ignoring track scroll events during touch scrolling or active momentum animations (`handleTrackScroll`).
- Fixed track drag interruption by stopping running momentum glides immediately on scrollbar track `mousedown`.
- Fixed stale content artifacts in recycled cell DOM nodes by clearing existing children (`node.innerHTML = ''`) before mounting updated item content.


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
