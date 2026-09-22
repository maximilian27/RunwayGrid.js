/**
 * ResizeObserver callbacks and size change handling for `<runway-grid>`.
 *
 * @module events/resize
 */

/**
 * `ResizeObserver` callback for individual rendered cells: re-measures cells
 * whose natural size may have changed, feeds updated sizes back into the
 * WASM registry, and preserves the "stuck to the end" scroll position if the
 * viewport was scrolled all the way to the bottom/right when sizes changed.
 *
 * @param {any} grid The grid instance.
 * @param {ResizeObserverEntry[]} entries Entries reported by the observer (unused; sizes are re-measured directly from the DOM).
 */
export function handleResize(grid, entries) {
  if (!grid.registry || grid._isUpdatingDOM) return;
  if (grid._invalidateLayoutCache) grid._invalidateLayoutCache();

  const { width: vw, height: vh } = grid._getViewportSize ? grid._getViewportSize() : { width: grid.viewport.clientWidth, height: grid.viewport.clientHeight };
  const wasAtVEnd = grid.verticalEnabled && Math.abs(grid._virtualScrollTop - (grid.registry.get_total_height() - vh)) < 1;
  const wasAtHEnd = grid.horizontalEnabled && Math.abs(grid._virtualScrollLeft - (grid.registry.get_total_width() - vw)) < 1;

  const { rowMax, colMax } = grid._measureRenderedSizes();
  if (grid._applyMeasuredSizes(rowMax, colMax)) {
    if (wasAtVEnd) grid._virtualScrollTop = Math.max(0, grid.registry.get_total_height() - vh);
    if (wasAtHEnd) grid._virtualScrollLeft = Math.max(0, grid.registry.get_total_width() - vw);
    grid.updateSpacer();
    grid.syncTrackFromVirtual();
    grid.calculateIndices();
  }
}
