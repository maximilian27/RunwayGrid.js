/**
 * Event handling orchestration and binding for `<runway-grid>`.
 *
 * @module events
 */
import { handleWheel } from './wheel.js';
import {
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  detachTouchTargetListeners,
  startMomentum,
  stopMomentum,
} from './touch.js';
import { handleKeyDown } from './keyboard.js';
import { handleTrackScroll, handleMouseUp } from './track.js';
import { handleResize } from './resize.js';

export {
  handleWheel,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  detachTouchTargetListeners,
  startMomentum,
  stopMomentum,
  handleKeyDown,
  handleTrackScroll,
  handleMouseUp,
  handleResize,
};

/**
 * Wires up all DOM, window, and `ResizeObserver` event listeners used by the component.
 *
 * @param {any} grid The grid instance.
 */
export function bindEvents(grid) {
  grid._handleMouseUp = () => grid._onMouseUp();
  window.addEventListener('mouseup', grid._handleMouseUp);

  grid.verticalTrack.addEventListener('mousedown', () => { grid._isDraggingVertical = true; });
  grid.horizontalTrack.addEventListener('mousedown', () => { grid._isDraggingHorizontal = true; });

  grid.verticalTrack.addEventListener('scroll', () => grid._onTrackScroll('vertical'));
  grid.horizontalTrack.addEventListener('scroll', () => grid._onTrackScroll('horizontal'));

  grid.viewport.addEventListener('wheel', (e) => grid._onWheel(e), { passive: false });
  grid.viewport.addEventListener('keydown', (e) => grid._onKeyDown(e));

  // `touchstart` is passive (it never needs to block native behavior), while `touchmove`
  // and `touchend` must be non-passive so they can call `e.preventDefault()` to prevent
  // browser touch cancellation and unwanted tap triggers when catching momentum.
  grid.viewport.addEventListener('touchstart', (e) => grid._onTouchStart(e), { passive: true });
  grid.viewport.addEventListener('touchmove', (e) => grid._onTouchMove(e), { passive: false });
  grid.viewport.addEventListener('touchend', (e) => grid._onTouchEnd(e), { passive: false });
  grid.viewport.addEventListener('touchcancel', (e) => grid._onTouchCancel(e), { passive: true });

  grid.resizeObserver = new ResizeObserver((entries) => grid._onResize(entries));
  grid.containerObserver = new ResizeObserver(() => {
    if (grid.viewport.clientHeight > 0 || grid.viewport.clientWidth > 0) grid.calculateIndices();
  });
  grid.containerObserver.observe(grid);
}
