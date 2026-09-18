/**
 * Keyboard navigation event handling for `<runway-grid>`.
 *
 * @module events/keyboard
 */

/**
 * Handles keyboard navigation on the viewport (arrow keys, Page Up/Down,
 * Home/End), updating the virtual scroll position on the enabled axes.
 *
 * @param {any} grid The grid instance.
 * @param {KeyboardEvent} e The keydown event.
 */
export function handleKeyDown(grid, e) {
  // GUARD: Only intercept keys if the user is focused directly on the grid viewport.
  // This allows inputs/textareas inside cells to function normally.
  if (e.target !== grid.viewport) return;
  grid._stopMomentum();

  if (!grid.registry) return;
  const maxV = grid.registry.get_total_height() - grid.viewport.clientHeight;
  const maxH = grid.registry.get_total_width() - grid.viewport.clientWidth;
  let changed = true;

  switch (e.key) {
    case 'ArrowDown': if (!grid.verticalEnabled) { changed = false; break; } e.preventDefault(); grid._virtualScrollTop += grid.rowSize; break;
    case 'ArrowUp': if (!grid.verticalEnabled) { changed = false; break; } e.preventDefault(); grid._virtualScrollTop -= grid.rowSize; break;
    case 'ArrowRight': if (!grid.horizontalEnabled) { changed = false; break; } e.preventDefault(); grid._virtualScrollLeft += grid.colSize; break;
    case 'ArrowLeft': if (!grid.horizontalEnabled) { changed = false; break; } e.preventDefault(); grid._virtualScrollLeft -= grid.colSize; break;
    case 'PageDown': if (!grid.verticalEnabled) { changed = false; break; } e.preventDefault(); grid._virtualScrollTop += grid.viewport.clientHeight; break;
    case 'PageUp': if (!grid.verticalEnabled) { changed = false; break; } e.preventDefault(); grid._virtualScrollTop -= grid.viewport.clientHeight; break;
    case 'Home': e.preventDefault(); if (grid.verticalEnabled) grid._virtualScrollTop = 0; if (grid.horizontalEnabled) grid._virtualScrollLeft = 0; break;
    case 'End': e.preventDefault(); if (grid.verticalEnabled) grid._virtualScrollTop = maxV; if (grid.horizontalEnabled) grid._virtualScrollLeft = maxH; break;
    default: changed = false; break;
  }

  if (changed) {
    if (grid.verticalEnabled) grid._virtualScrollTop = grid._clamp(grid._virtualScrollTop, 0, maxV);
    if (grid.horizontalEnabled) grid._virtualScrollLeft = grid._clamp(grid._virtualScrollLeft, 0, maxH);
    grid._beginRangeChangeBatch();
    try {
      grid.calculateIndices();
      grid._settleAtEnd(grid.viewport.clientHeight, grid.viewport.clientWidth);
      grid.syncTrackFromVirtual();
    } finally {
      grid._endRangeChangeBatch();
    }
  }
}
