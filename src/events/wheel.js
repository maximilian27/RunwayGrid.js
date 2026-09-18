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

  let hasRoom = false;

  if (grid.verticalEnabled && e.deltaY !== 0) {
    const maxScroll = grid.registry.get_total_height() - grid.viewport.clientHeight;
    if (maxScroll > 0) {
      const before = grid._virtualScrollTop;
      if ((e.deltaY < 0 && before > 0) || (e.deltaY > 0 && before < maxScroll)) hasRoom = true;
    }
  }

  if (grid.horizontalEnabled && e.deltaX !== 0) {
    const maxScroll = grid.registry.get_total_width() - grid.viewport.clientWidth;
    if (maxScroll > 0) {
      const before = grid._virtualScrollLeft;
      if ((e.deltaX < 0 && before > 0) || (e.deltaX > 0 && before < maxScroll)) hasRoom = true;
    }
  }

  // Claim the wheel gesture only when it actually moves the grid on some axis - otherwise
  // let it propagate so an enclosing scroll container (e.g. the page itself) keeps scrolling.
  if (hasRoom) e.preventDefault();

  grid._scrollByDelta(e.deltaX * 0.3, e.deltaY * 0.3);
}
