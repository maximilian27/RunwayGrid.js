/**
 * Scrollbar track and drag event handling for `<runway-grid>`.
 *
 * @module events/track
 */

/**
 * Handles a native `scroll` event on one of the (visible) scrollbar tracks,
 * translating the track's scroll position into the corresponding virtual
 * scroll position and re-rendering. Ignored while a programmatic/DOM update
 * is already in progress to avoid feedback loops.
 *
 * @param {any} grid The grid instance.
 * @param {'vertical'|'horizontal'} axis Which track fired the scroll event.
 */
export function handleTrackScroll(grid, axis) {
  if (grid._isUpdatingDOM || grid._isProgrammaticScroll) return;
  grid._stopMomentum();

  const viewportSize = axis === 'vertical' ? grid.viewport.clientHeight : grid.viewport.clientWidth;
  const track = axis === 'vertical' ? grid.verticalTrack : grid.horizontalTrack;
  const scrollPos = Math.max(0, axis === 'vertical' ? track.scrollTop : track.scrollLeft);

  const virtualPos = grid._trackToVirtual(scrollPos, viewportSize, axis);

  if (axis === 'vertical') grid._virtualScrollTop = virtualPos;
  else grid._virtualScrollLeft = virtualPos;

  grid._beginRangeChangeBatch();
  try {
    grid.calculateIndices();
    grid._settleAtEnd(grid.viewport.clientHeight, grid.viewport.clientWidth);
  } finally {
    grid._endRangeChangeBatch();
  }
}

/**
 * Handles the window-level `mouseup` event, ending a scrollbar-track drag
 * (if one was in progress) and settling/re-syncing the final position.
 *
 * @param {any} grid The grid instance.
 */
export function handleMouseUp(grid) {
  if (grid._isDraggingVertical || grid._isDraggingHorizontal) {
    grid._isDraggingVertical = false;
    grid._isDraggingHorizontal = false;
    grid._settleAtEnd(grid.viewport.clientHeight, grid.viewport.clientWidth);
    grid.updateSpacer();
    grid.syncTrackFromVirtual();
  }
}
