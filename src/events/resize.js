/**
 * ResizeObserver callbacks and size change handling for `<runway-grid>`.
 *
 * @module events/resize
 */

/**
 * `ResizeObserver` callback for individual rendered cells: re-measures cells
 * whose natural size may have changed, feeds updated sizes back into the
 * WASM registry, counter-scrolls via scroll anchoring so that dynamic size
 * changes in items above or left of the visible viewport do not cause layout
 * shifts or skipped elements, and preserves the "stuck to the end" scroll
 * position if the viewport was scrolled all the way to the bottom/right when
 * sizes changed.
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

  // Identify anchor element before applying size updates so we can counter-scroll
  // against layout shifts caused by unmeasured elements above/left of the visible viewport.
  let anchorRow = 0;
  let oldAnchorRowOffset = 0;
  let anchorCol = 0;
  let oldAnchorColOffset = 0;

  if (grid.registry && (grid._virtualScrollTop > 0 || grid._virtualScrollLeft > 0)) {
    const geom = grid.registry.compute_geometry(
      grid._virtualScrollTop,
      grid._virtualScrollLeft,
      vh,
      vw,
      0,
      grid.verticalEnabled,
      grid.horizontalEnabled,
    );
    if (grid.verticalEnabled && grid.rowCount > 0 && grid._virtualScrollTop > 0) {
      anchorRow = geom.viewport_start_row;
      oldAnchorRowOffset = grid.registry.get_row_offset(anchorRow);
    }
    if (grid.horizontalEnabled && grid.colCount > 0 && grid._virtualScrollLeft > 0) {
      anchorCol = geom.viewport_start_col;
      oldAnchorColOffset = grid.registry.get_col_offset(anchorCol);
    }
    geom.free();
  }

  const { rowMax, colMax } = grid._measureRenderedSizes();
  if (grid._applyMeasuredSizes(rowMax, colMax)) {
    if (grid.verticalEnabled) {
      if (wasAtVEnd) {
        grid._virtualScrollTop = Math.max(0, grid.registry.get_total_height() - vh);
      } else if (grid._virtualScrollTop > 0 && anchorRow > 0) {
        const newAnchorRowOffset = grid.registry.get_row_offset(anchorRow);
        const rowDelta = newAnchorRowOffset - oldAnchorRowOffset;
        if (rowDelta !== 0) {
          const maxScrollV = Math.max(0, grid.registry.get_total_height() - vh);
          grid._virtualScrollTop = Math.min(Math.max(0, grid._virtualScrollTop + rowDelta), maxScrollV);
        }
      }
    }

    if (grid.horizontalEnabled) {
      if (wasAtHEnd) {
        grid._virtualScrollLeft = Math.max(0, grid.registry.get_total_width() - vw);
      } else if (grid._virtualScrollLeft > 0 && anchorCol > 0) {
        const newAnchorColOffset = grid.registry.get_col_offset(anchorCol);
        const colDelta = newAnchorColOffset - oldAnchorColOffset;
        if (colDelta !== 0) {
          const maxScrollH = Math.max(0, grid.registry.get_total_width() - vw);
          grid._virtualScrollLeft = Math.min(Math.max(0, grid._virtualScrollLeft + colDelta), maxScrollH);
        }
      }
    }

    grid.updateSpacer();
    grid.syncTrackFromVirtual();
    grid.calculateIndices();
  }
}
