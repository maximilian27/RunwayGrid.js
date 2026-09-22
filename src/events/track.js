/**
 * Scrollbar track and drag event handling for `<runway-grid>`.
 *
 * @module events/track
 */

/**
 * Handles a native `scroll` event on one of the (visible) scrollbar tracks,
 * translating the track's scroll position into the corresponding virtual
 * scroll position and re-rendering. Uses event-source tracking to ignore
 * programmatic scroll syncs without blocking subsequent user inputs.
 *
 * @param {any} grid The grid instance.
 * @param {'vertical'|'horizontal'} axis Which track fired the scroll event.
 */
export function handleTrackScroll(grid, axis) {
  if (grid._isUpdatingDOM) return;

  const track = axis === 'vertical' ? grid.verticalTrack : grid.horizontalTrack;
  const scrollPos = Math.max(0, axis === 'vertical' ? track.scrollTop : track.scrollLeft);

  const expectedPos = axis === 'vertical' ? grid._expectedTrackScrollTop : grid._expectedTrackScrollLeft;
  if (expectedPos !== null && expectedPos !== undefined) {
    if (Math.abs(scrollPos - expectedPos) <= 1) {
      if (axis === 'vertical') {
        grid._expectedTrackScrollTop = null;
      } else {
        grid._expectedTrackScrollLeft = null;
      }
      if (grid._expectedTrackScrollTop === null && grid._expectedTrackScrollLeft === null) {
        grid._isProgrammaticScroll = false;
      }
      return;
    }
    // Real user interaction during pending sync
    if (axis === 'vertical') {
      grid._expectedTrackScrollTop = null;
    } else {
      grid._expectedTrackScrollLeft = null;
    }
    grid._isProgrammaticScroll = false;
  } else if (grid._isProgrammaticScroll) {
    grid._isProgrammaticScroll = false;
    return;
  }

  grid._stopMomentum();

  const { width: vw, height: vh } = grid._getViewportSize ? grid._getViewportSize() : { width: grid.viewport.clientWidth, height: grid.viewport.clientHeight };
  const viewportSize = axis === 'vertical' ? vh : vw;

  const virtualPos = grid._trackToVirtual(scrollPos, viewportSize, axis);

  if (axis === 'vertical') grid._virtualScrollTop = virtualPos;
  else grid._virtualScrollLeft = virtualPos;

  grid._beginRangeChangeBatch();
  try {
    grid.calculateIndices();
    grid._settleAtEnd(vh, vw);
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
    const { width: vw, height: vh } = grid._getViewportSize ? grid._getViewportSize() : { width: grid.viewport.clientWidth, height: grid.viewport.clientHeight };
    grid._settleAtEnd(vh, vw);
    grid.updateSpacer();
    grid.syncTrackFromVirtual();
  }
}
