/**
 * Mouse wheel event handling for `<runway-grid>`.
 *
 * @module events/wheel
 */

/**
 * Handles `wheel` events on the viewport, moving the virtual scroll position
 * on whichever axes are enabled and re-rendering/re-syncing the tracks.
 *
 * Only calls `e.preventDefault()` on axes that actually have room left to move in the
 * wheel gesture's direction - once the grid is already at its scroll bound on every
 * enabled axis, the event is left alone so it can bubble up to (and scroll-chain into) a
 * parent scrollable container, instead of just dead-ending the page/container scroll.
 *
 * @param {any} grid The grid instance.
 * @param {WheelEvent} e The wheel event.
 */
export function handleWheel(grid, e) {
  if (!grid.registry) return;
  grid._stopMomentum();

  let deltaX = e.deltaX;
  let deltaY = e.deltaY;

  const { width: vw, height: vh } = grid._getViewportSize ? grid._getViewportSize() : { width: grid.viewport.clientWidth, height: grid.viewport.clientHeight };

  if (e.deltaMode === 1) {
    deltaX *= 16;
    deltaY *= 16;
  } else if (e.deltaMode === 2) {
    deltaX *= vw;
    deltaY *= vh;
  }

  let hasRoom = false;

  if (grid.verticalEnabled && deltaY !== 0) {
    const maxScroll = grid.registry.get_total_height() - vh;
    if (maxScroll > 0) {
      const before = grid._virtualScrollTop;
      if ((deltaY < 0 && before > 0) || (deltaY > 0 && before < maxScroll)) hasRoom = true;
    }
  }

  if (grid.horizontalEnabled && deltaX !== 0) {
    const maxScroll = grid.registry.get_total_width() - vw;
    if (maxScroll > 0) {
      const before = grid._virtualScrollLeft;
      if ((deltaX < 0 && before > 0) || (deltaX > 0 && before < maxScroll)) hasRoom = true;
    }
  }

  // Claim the wheel gesture only when it actually moves the grid on some axis - otherwise
  // let it propagate so an enclosing scroll container (e.g. the page itself) keeps scrolling.
  if (hasRoom) e.preventDefault();

  grid._scrollByDelta(deltaX, deltaY);
}
