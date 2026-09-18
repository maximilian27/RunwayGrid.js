/**
 * Touch scrolling and momentum/inertial deceleration handling for `<runway-grid>`.
 *
 * @module events/touch
 */

/**
 * Tracks handled touch events to prevent duplicate processing when listening on both
 * initial touch targets and the container viewport.
 * @type {WeakSet<TouchEvent>}
 */
const handledTouchEvents = new WeakSet();

/**
 * Handles `touchstart` on the viewport: stops any running momentum glide,
 * captures initial coordinates and timestamp for velocity tracking, and
 * marks active touch scrolling for single-finger gestures.
 *
 * Multi-touch gestures (e.g. pinch-to-zoom) are ignored so the browser can
 * handle them natively.
 *
 * @param {any} grid The grid instance.
 * @param {TouchEvent} e The touchstart event.
 */
export function onTouchStart(grid, e) {
  if (!grid.registry) return;
  const hadMomentum = grid._momentumRafId !== null;
  grid._stopMomentum();
  grid._detachTouchTargetListeners();

  if (e.touches.length !== 1) {
    grid._isTouchScrolling = false;
    grid._activeTouchId = null;
    return;
  }

  const touch = e.touches[0];
  grid._activeTouchId = touch.identifier;
  grid._lastTouchX = touch.clientX;
  grid._lastTouchY = touch.clientY;
  grid._touchHistory = [{ x: touch.clientX, y: touch.clientY, time: performance.now() }];
  grid._isTouchScrolling = true;
  grid._caughtMomentum = hadMomentum;

  // In a virtualized grid, scrolling causes visible rows to be recycled (node.innerHTML is updated).
  // Under W3C Touch Events, touchmove/touchend events continue to be targeted strictly at the element
  // hit during touchstart; if that element is detached from the DOM during cell recycling, the events
  // no longer bubble to viewport/window. Listening directly on e.target ensures we continue receiving
  // touchmove and touchend events even if the cell content is recycled during the drag.
  if (e.target && e.target !== grid.viewport && typeof e.target.addEventListener === 'function') {
    grid._touchTarget = e.target;
    grid._touchTarget.addEventListener('touchmove', grid._boundTouchMove, { passive: false });
    grid._touchTarget.addEventListener('touchend', grid._boundTouchEnd, { passive: false });
    grid._touchTarget.addEventListener('touchcancel', grid._boundTouchCancel, { passive: true });
  }
}

/**
 * Removes touch gesture listeners from the active touch target.
 *
 * @param {any} grid The grid instance.
 */
export function detachTouchTargetListeners(grid) {
  if (grid._touchTarget) {
    grid._touchTarget.removeEventListener('touchmove', grid._boundTouchMove);
    grid._touchTarget.removeEventListener('touchend', grid._boundTouchEnd);
    grid._touchTarget.removeEventListener('touchcancel', grid._boundTouchCancel);
    grid._touchTarget = null;
  }
}

/**
 * Handles `touchmove` on the viewport, mapping incremental finger deltas
 * directly to the virtual scroll position on enabled axes. Updates recent
 * velocity history and suppresses default browser touch behavior to prevent
 * browser touch cancellation.
 *
 * @param {any} grid The grid instance.
 * @param {TouchEvent} e The touchmove event.
 */
export function onTouchMove(grid, e) {
  if (handledTouchEvents.has(e)) return;
  handledTouchEvents.add(e);

  if (!grid._isTouchScrolling || !grid.registry) return;

  if (e.touches.length > 1) {
    grid._isTouchScrolling = false;
    grid._activeTouchId = null;
    grid._touchHistory = [];
    grid._detachTouchTargetListeners();
    return;
  }

  let touch = null;
  for (let i = 0; i < e.touches.length; i++) {
    if (e.touches[i].identifier === grid._activeTouchId) {
      touch = e.touches[i];
      break;
    }
  }
  if (!touch) return;

  if (e.cancelable && (grid.verticalEnabled || grid.horizontalEnabled)) {
    e.preventDefault();
  }

  grid._caughtMomentum = false;

  const deltaX = grid._lastTouchX - touch.clientX;
  const deltaY = grid._lastTouchY - touch.clientY;
  grid._lastTouchX = touch.clientX;
  grid._lastTouchY = touch.clientY;

  const now = performance.now();
  grid._touchHistory.push({ x: touch.clientX, y: touch.clientY, time: now });
  while (grid._touchHistory.length > 1 && now - grid._touchHistory[0].time > 100) {
    grid._touchHistory.shift();
  }

  grid._scrollByDelta(deltaX, deltaY);
}

/**
 * Handles `touchend` on the viewport: computes release velocity from recent
 * touch movement history and triggers momentum/inertial scrolling when flicked.
 * Also suppresses unwanted click events when tapping to catch a moving list.
 *
 * @param {any} grid The grid instance.
 * @param {TouchEvent} e The touchend event.
 */
export function onTouchEnd(grid, e) {
  if (handledTouchEvents.has(e)) return;
  handledTouchEvents.add(e);

  if (!grid._isTouchScrolling) {
    grid._detachTouchTargetListeners();
    return;
  }

  let activeStillPresent = false;
  for (let i = 0; i < e.touches.length; i++) {
    if (e.touches[i].identifier === grid._activeTouchId) {
      activeStillPresent = true;
      break;
    }
  }
  if (activeStillPresent) return;

  grid._detachTouchTargetListeners();
  grid._isTouchScrolling = false;
  grid._activeTouchId = null;

  if (grid._caughtMomentum) {
    grid._caughtMomentum = false;
    if (e.cancelable) e.preventDefault();
    grid._touchHistory = [];
    return;
  }

  const now = performance.now();
  if (grid._touchHistory.length >= 2) {
    const latest = grid._touchHistory[grid._touchHistory.length - 1];
    if (now - latest.time < 80) {
      const oldest = grid._touchHistory[0];
      const dt = latest.time - oldest.time;
      if (dt >= 10) {
        const vx = (oldest.x - latest.x) / dt;
        const vy = (oldest.y - latest.y) / dt;
        grid._startMomentum(vx, vy);
      }
    }
  }
  grid._touchHistory = [];
}

/**
 * Handles `touchcancel` on the viewport: cancels touch scrolling, stops any
 * momentum animation, and cleans up touch state.
 *
 * @param {any} grid The grid instance.
 * @param {TouchEvent} [e] The touchcancel event.
 */
export function onTouchCancel(grid, e) {
  if (e && handledTouchEvents.has(e)) return;
  if (e) handledTouchEvents.add(e);

  grid._detachTouchTargetListeners();
  grid._isTouchScrolling = false;
  grid._activeTouchId = null;
  grid._touchHistory = [];
  grid._caughtMomentum = false;
  grid._stopMomentum();
}

/**
 * Cancels any running momentum/inertia animation frame.
 *
 * @param {any} grid The grid instance.
 */
export function stopMomentum(grid) {
  if (grid._momentumRafId !== null) {
    cancelAnimationFrame(grid._momentumRafId);
    grid._momentumRafId = null;
  }
}

/**
 * Initiates a momentum/inertia deceleration animation based on release velocity.
 *
 * @param {any} grid The grid instance.
 * @param {number} vx Initial horizontal velocity in pixels per millisecond.
 * @param {number} vy Initial vertical velocity in pixels per millisecond.
 */
export function startMomentum(grid, vx, vy) {
  stopMomentum(grid);

  if (!grid.verticalEnabled) vy = 0;
  if (!grid.horizontalEnabled) vx = 0;

  const speed = Math.hypot(vx, vy);
  if (speed < 0.15) return;

  const maxSpeed = 4.0;
  if (speed > maxSpeed) {
    const scale = maxSpeed / speed;
    vx *= scale;
    vy *= scale;
  }

  let lastTime = performance.now();
  const friction = 0.955;

  const step = () => {
    const now = performance.now();
    const dt = Math.min(now - lastTime, 32);
    lastTime = now;

    if (dt > 0) {
      const decay = Math.pow(friction, dt / 16.67);
      vx *= decay;
      vy *= decay;

      const dx = vx * dt;
      const dy = vy * dt;

      grid._scrollByDelta(dx, dy);

      if (grid.verticalEnabled && Math.abs(vy) > 0.01) {
        const maxV = grid.registry ? grid.registry.get_total_height() - grid.viewport.clientHeight : 0;
        if (grid._virtualScrollTop <= 0 || grid._virtualScrollTop >= maxV) {
          vy = 0;
        }
      }
      if (grid.horizontalEnabled && Math.abs(dx) > 0.01) {
        const maxH = grid.registry ? grid.registry.get_total_width() - grid.viewport.clientWidth : 0;
        if (grid._virtualScrollLeft <= 0 || grid._virtualScrollLeft >= maxH) {
          vx = 0;
        }
      }

      if (Math.hypot(vx, vy) < 0.02 || !grid.registry) {
        stopMomentum(grid);
        return;
      }
    }

    grid._momentumRafId = requestAnimationFrame(step);
  };

  grid._momentumRafId = requestAnimationFrame(step);
}
