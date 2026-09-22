/**
 * `<runway-grid>` - a high-performance virtual scroll custom element for rendering
 * very large lists and 2D grids (millions of rows/columns) while keeping the DOM
 * small. Layout math (offsets, ranges, auto-measured row/column sizes) is delegated
 * to a Rust/WebAssembly engine (`VirtualScrollRegistry`), which is embedded directly
 * into this module as a base64 string so the component is fully self-contained.
 *
 * @module runway-grid
 */
import { ensureWasmInitialized, SAFE_MAX_HEIGHT, SAFE_MAX_SPACER_SIZE, VirtualScrollRegistry } from './wasm.js';
import { COMPONENT_TEMPLATE } from './template.js';
import {
  bindEvents,
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
} from './events/index.js';

export { SAFE_MAX_HEIGHT, SAFE_MAX_SPACER_SIZE, VirtualScrollRegistry };

/**
 * The `<runway-grid>` custom element. See the module doc for an overview.
 *
 * @fires rangechange - Fired whenever the range of rendered rows/columns changes
 *   (e.g. after scrolling, resizing, or a `data`/`columns`/`template` update), exposing
 *   `buffered` and `viewport` directly on the event (not nested under `detail`), where each
 *   is `{ startRow, endRow, startCol, endCol }`. `buffered` includes the off-screen
 *   `bufferSize` items on each side (ideal for triggering infinite scroll data fetches);
 *   `viewport` is the strict range that excludes the buffer, i.e. only the indices
 *   currently intersecting the visible pixels on screen.
 * @fires wasmerror - Fired if the embedded WASM engine fails to initialize (e.g. an
 *   unsupported browser, a Content-Security-Policy blocking instantiation of the
 *   `atob`-decoded binary, or a corrupt/incompatible build), with the caught error exposed
 *   as `e.detail.error`. The component never renders in this case - listen for this event to
 *   implement a fallback (e.g. rendering a plain, non-virtualized list instead).
 */
export class RunwayGrid extends HTMLElement {
  static get observedAttributes() {
    return ['orientation', 'row-size', 'col-size', 'buffer-size'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(COMPONENT_TEMPLATE.content.cloneNode(true));

    // DOM References
    /** @type {HTMLElement} */
    this.viewport = this.shadowRoot.querySelector('.runway-grid__viewport');
    /** @type {HTMLElement} */
    this.wrapper = this.shadowRoot.querySelector('.runway-grid__wrapper');
    /** @type {HTMLElement} */
    this.verticalTrack = this.shadowRoot.querySelector('.runway-grid__track--vertical');
    /** @type {HTMLElement} */
    this.verticalSpacer = this.shadowRoot.querySelector('.runway-grid__spacer--vertical');
    /** @type {HTMLElement} */
    this.horizontalTrack = this.shadowRoot.querySelector('.runway-grid__track--horizontal');
    /** @type {HTMLElement} */
    this.horizontalSpacer = this.shadowRoot.querySelector('.runway-grid__spacer--horizontal');
    /** @type {HTMLElement} */
    this.bottomBar = this.shadowRoot.querySelector('.runway-grid__bottom-bar');
    /** @type {HTMLElement} */
    this.corner = this.shadowRoot.querySelector('.runway-grid__corner');

    // Internal State
    this.rows = [];
    this.columnsData = null;
    this._colCount = 1;
    this._hasExplicitColumns = false;
    this.renderedNodes = []; // 2D matrix
    this.renderedRowGroups = []; // one wrapper element per rendered row, grouping its cells for ARIA/positioning
    this.registry = null;
    this._renderVersion = 0;

    // The wrapper is a purely structural positioning container between the viewport
    // (role="grid"/"list") and the row groups/cells (role="row"/"gridcell" or "listitem") -
    // marking it `presentation` keeps it transparent to the accessibility tree.
    this.wrapper.setAttribute('role', 'presentation');

    this.wasmInitialized = false;
    this.wasmInitError = null;
    this._initialLayoutDone = false;
    this._isUpdatingDOM = false;
    this._isProgrammaticScroll = false;
    this._programmaticScrollRaf = null;
    this._expectedTrackScrollTop = null;
    this._expectedTrackScrollLeft = null;
    this._isDraggingVertical = false;
    this._isDraggingHorizontal = false;
    this._trackCache = { vertical: null, horizontal: null };
    this._viewportSizeCache = { width: null, height: null };

    this._virtualScrollTop = 0;
    this._virtualScrollLeft = 0;

    /** @type {ResizeObserver|null} */
    this.resizeObserver = null;
    /** @type {ResizeObserver|null} */
    this.containerObserver = null;
    /** @type {EventListener|null} */
    this._handleMouseUp = null;

    // Touch scrolling and momentum inertia state:
    // Tracks touch movement incrementally (mirroring wheel deltas) and drives
    // smooth deceleration flings via requestAnimationFrame on touchend.
    this._isTouchScrolling = false;
    this._activeTouchId = null;
    this._touchTarget = null;
    this._lastTouchX = 0;
    this._lastTouchY = 0;
    this._touchHistory = [];
    this._momentumRafId = null;
    this._caughtMomentum = false;
    this._boundTouchMove = (e) => this._onTouchMove(e);
    this._boundTouchEnd = (e) => this._onTouchEnd(e);
    this._boundTouchCancel = (e) => this._onTouchCancel(e);

    // `rangechange` batching: while `_batchDepth > 0`, `calculateIndices()` stores its
    // freshly computed event on `_pendingRangeChangeEvent` instead of dispatching it
    // immediately, so a public method that internally calls `calculateIndices()` several
    // times in a row (e.g. `scrollToCell()`) only ever dispatches the final, settled one.
    this._batchDepth = 0;
    this._pendingRangeChangeEvent = null;

    this._updateCornerVisibility();
    this._bindEvents();
    this.initWasm();
  }

  // --- COMPONENT LIFECYCLE & SETUP ---

  /**
   * Custom element attribute lifecycle callback: reacts to dynamic runtime changes
   * to `orientation`, `row-size`, `col-size`, and `buffer-size`.
   *
   * @param {string} name
   * @param {string|null} oldValue
   * @param {string|null} newValue
   */
  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    this._invalidateLayoutCache();
    if (!this.verticalTrack || !this.horizontalTrack) return;

    if (name === 'orientation') {
      this.verticalTrack.classList.toggle('runway-grid__track--disabled', !this.verticalEnabled);
      this.horizontalTrack.classList.toggle('runway-grid__track--disabled', !this.horizontalEnabled);
      this._updateCornerVisibility();
      if (this.orientation === 'horizontal' && !this._hasExplicitColumns && this.rows && this.rows.length) {
        this.columnsData = this.rows;
        this._colCount = this.rows.length;
      }
      if (!this.verticalEnabled) {
        this._virtualScrollTop = 0;
        if (this.verticalTrack) this.verticalTrack.scrollTop = 0;
      }
      if (!this.horizontalEnabled) {
        this._virtualScrollLeft = 0;
        if (this.horizontalTrack) this.horizontalTrack.scrollLeft = 0;
      }
      this.setupRegistry();
    } else if (name === 'row-size' || name === 'col-size') {
      this.setupRegistry();
    } else if (name === 'buffer-size') {
      this.calculateIndices();
    }
  }

  /**
   * Synchronizes the visibility of the bottom bar container and the corner element
   * based on the active orientation.
   * @private
   */
  _updateCornerVisibility() {
    if (this.bottomBar) {
      this.bottomBar.style.display = this.horizontalEnabled ? 'flex' : 'none';
    }
    if (this.corner) {
      this.corner.classList.toggle('runway-grid__corner--visible', this.orientation === 'both');
    }
  }

  /**
   * Wires up all DOM/`ResizeObserver` event listeners used by the component.
   * Called once from the constructor.
   * @private
   */
  _bindEvents() {
    bindEvents(this);
  }

  /**
   * Custom element lifecycle callback: removes the window-level `mouseup`
   * listener, disconnects observers, frees WASM resources, and arrests any
   * running momentum animation or drag states to avoid leaking once removed from the DOM.
   */
  disconnectedCallback() {
    this._stopMomentum();
    this._detachTouchTargetListeners();
    this._isTouchScrolling = false;
    this._activeTouchId = null;
    this._touchHistory = [];
    this._isDraggingVertical = false;
    this._isDraggingHorizontal = false;
    if (this._programmaticScrollRaf !== null) {
      cancelAnimationFrame(this._programmaticScrollRaf);
      this._programmaticScrollRaf = null;
    }
    this._isProgrammaticScroll = false;
    this._expectedTrackScrollTop = null;
    this._expectedTrackScrollLeft = null;
    this._invalidateLayoutCache();
    if (this._handleMouseUp) {
      window.removeEventListener('mouseup', this._handleMouseUp);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.containerObserver) {
      this.containerObserver.disconnect();
    }
    if (this.registry) {
      this.registry.free();
      this.registry = null;
    }
  }

  /**
   * Custom element lifecycle callback: resets scroll position and track state,
   * binds the window-level `mouseup` listener, reconnects observers,
   * toggles the enabled/disabled state of each scrollbar track based on
   * {@link RunwayGrid#orientation}, restores the WASM registry if needed,
   * and triggers the layout pass.
   */
  connectedCallback() {
    this._invalidateLayoutCache();
    this._stopMomentum();
    if (this._handleMouseUp) {
      window.removeEventListener('mouseup', this._handleMouseUp);
      window.addEventListener('mouseup', this._handleMouseUp);
    }
    if (this.containerObserver) {
      this.containerObserver.observe(this);
    }
    if (this.verticalTrack) this.verticalTrack.scrollTop = 0;
    if (this.horizontalTrack) this.horizontalTrack.scrollLeft = 0;
    this._virtualScrollTop = 0;
    this._virtualScrollLeft = 0;
    this.verticalTrack.classList.toggle('runway-grid__track--disabled', !this.verticalEnabled);
    this.horizontalTrack.classList.toggle('runway-grid__track--disabled', !this.horizontalEnabled);
    this._updateCornerVisibility();
    if (this.wasmInitialized && !this.registry) {
      this.setupRegistry();
    } else {
      this.calculateIndices();
    }
  }

  /**
   * Awaits the shared WASM engine initialization and, once ready, builds the
   * layout registry if `data`/`columns` were already assigned before the
   * engine finished loading.
   *
   * If the shared WASM engine fails to initialize (e.g. an unsupported browser, a
   * Content-Security-Policy blocking instantiation of the `atob`-decoded binary, or a
   * corrupt/incompatible build), the rejection is caught here so it never surfaces as an
   * unhandled promise rejection: `wasmInitError` is set and a `wasmerror` event is
   * dispatched, giving consumers a chance to react/render a fallback instead of the
   * component just silently never rendering.
   * @returns {Promise<void>}
   */
  async initWasm() {
    try {
      await ensureWasmInitialized();
    } catch (error) {
      this.wasmInitError = error;
      console.error('runway-grid: failed to initialize the embedded WASM engine; the component will not render.', error);
      this.dispatchEvent(new CustomEvent('wasmerror', { detail: { error } }));
      return;
    }
    this.wasmInitialized = true;
    if (this.rows.length || this._colCount > 1 || (this.orientation === 'horizontal' && this.colCount > 0)) this.setupRegistry();
  }

  /**
   * (Re)creates the WASM `VirtualScrollRegistry` for the current row/column
   * counts and initial sizes, then recomputes the spacer size and the
   * currently rendered range. No-op until the WASM engine is initialized and
   * the enabled axes have a non-zero row/column count.
   */
  setupRegistry() {
    if (!this.wasmInitialized) return;
    this._invalidateLayoutCache();

    if (this.registry) {
      this.registry.free();
      this.registry = null;
    }

    if ((this.verticalEnabled && this.rowCount === 0) || (this.horizontalEnabled && this.colCount === 0)) {
      while (this.renderedNodes.length > 0) {
        const rowNodes = this.renderedNodes.pop();
        if (this.resizeObserver) {
          for (const el of rowNodes) this.resizeObserver.unobserve(el);
        }
      }
      while (this.renderedRowGroups.length > 0) {
        this.wrapper.removeChild(this.renderedRowGroups.pop());
      }
      this.updateSpacer();
      return;
    }

    this._renderVersion++;
    this.registry = new VirtualScrollRegistry(this.rowCount || 1, this.colCount || 1, this.rowSize, this.colSize);
    this._applyContainerAria();
    this.updateSpacer();
    this.calculateIndices();
  }

  /**
   * Applies (or refreshes) the ARIA container role/counts on the viewport, based on
   * {@link RunwayGrid#orientation}: single-axis orientations (`"vertical"`/`"horizontal"`) get
   * `role="list"`, since this component's keyboard/wheel handling moves the *scroll position*,
   * not cell focus - the roving-tabindex cell-navigation contract implied by `role="grid"` would
   * overpromise there. Only the genuinely two-axis `orientation="both"` gets `role="grid"` plus
   * `aria-rowcount`/`aria-colcount` set to the *true* {@link RunwayGrid#rowCount}/{@link RunwayGrid#colCount}
   * (not the number of DOM nodes actually mounted). Called whenever the registry is (re)built and
   * whenever the true row/column count changes ({@link RunwayGrid#appendData}/{@link RunwayGrid#removeDataFromHead}),
   * so these never go stale.
   * @private
   */
  _applyContainerAria() {
    if (this.orientation === 'both') {
      this.viewport.setAttribute('role', 'grid');
      this.viewport.setAttribute('aria-rowcount', String(this.rowCount));
      this.viewport.setAttribute('aria-colcount', String(this.colCount));
    } else {
      this.viewport.setAttribute('role', 'list');
      this.viewport.removeAttribute('aria-rowcount');
      this.viewport.removeAttribute('aria-colcount');
    }
  }

  /**
   * Refreshes ARIA attributes that depend on the total row/column count after
   * {@link RunwayGrid#appendData}/{@link RunwayGrid#removeDataFromHead} change that count: the
   * viewport's `aria-rowcount`/`aria-colcount` (for `orientation="both"`), or every
   * currently-rendered cell's `aria-setsize` (for single-axis orientations) - since a cell whose
   * row/column index didn't change is never re-bound by {@link RunwayGrid#applyChanges} and would
   * otherwise keep reporting the size of the first page loaded.
   * @private
   */
  _refreshAriaCounts() {
    this._applyContainerAria();
    if (this.orientation === 'both') return;
    const setSize = String(this.orientation === 'horizontal' ? this.colCount : this.rowCount);
    for (const rowNodes of this.renderedNodes) {
      for (const node of rowNodes) node.setAttribute('aria-setsize', setSize);
    }
  }

  /**
   * Begins a `rangechange` dispatch batch: while any batch is active, {@link RunwayGrid#calculateIndices}
   * defers dispatching its event, so nested/repeated calls made by a single public method invocation
   * only ever result in one dispatch (of the last, settled range) once the outermost batch ends.
   * @private
   */
  _beginRangeChangeBatch() {
    this._batchDepth++;
  }

  /**
   * Ends a `rangechange` dispatch batch started by {@link RunwayGrid#_beginRangeChangeBatch},
   * dispatching the last pending event once the outermost batch has closed.
   * @private
   */
  _endRangeChangeBatch() {
    this._batchDepth = Math.max(0, this._batchDepth - 1);
    if (this._batchDepth === 0 && this._pendingRangeChangeEvent) {
      const evt = this._pendingRangeChangeEvent;
      this._pendingRangeChangeEvent = null;
      this.dispatchEvent(evt);
    }
  }

  // --- EVENT HANDLERS ---

  /**
   * Handles a native `scroll` event on one of the (visible) scrollbar tracks,
   * translating the track's scroll position into the corresponding virtual
   * scroll position and re-rendering.
   *
   * @param {'vertical'|'horizontal'} axis Which track fired the scroll event.
   */
  _onTrackScroll(axis) {
    handleTrackScroll(this, axis);
  }

  /**
   * Applies an incremental scroll delta to the virtual scroll position on
   * enabled axes, clamping to content boundaries, re-rendering visible cells,
   * settling tail alignment, and re-syncing the scrollbar tracks.
   *
   * @param {number} deltaX Pixel distance to scroll along the horizontal axis.
   * @param {number} deltaY Pixel distance to scroll along the vertical axis.
   * @returns {boolean} `true` if the virtual scroll position actually moved on at least one axis.
   * @private
   */
  _scrollByDelta(deltaX, deltaY) {
    if (!this.registry) return false;

    let moved = false;
    const { width: vw, height: vh } = this._getViewportSize();

    if (this.verticalEnabled && deltaY !== 0) {
      const maxScroll = this.registry.get_total_height() - vh;
      if (maxScroll > 0) {
        const before = this._virtualScrollTop;
        const after = this._clamp(before + deltaY, 0, maxScroll);
        if (after !== before) {
          this._virtualScrollTop = after;
          moved = true;
        }
      }
    }

    if (this.horizontalEnabled && deltaX !== 0) {
      const maxScroll = this.registry.get_total_width() - vw;
      if (maxScroll > 0) {
        const before = this._virtualScrollLeft;
        const after = this._clamp(before + deltaX, 0, maxScroll);
        if (after !== before) {
          this._virtualScrollLeft = after;
          moved = true;
        }
      }
    }

    if (moved) {
      this._beginRangeChangeBatch();
      try {
        this.calculateIndices();
        this._settleAtEnd(vh, vw);
        this.syncTrackFromVirtual();
      } finally {
        this._endRangeChangeBatch();
      }
    }

    return moved;
  }

  /**
   * Handles `wheel` events on the viewport, moving the virtual scroll position
   * on whichever axes are enabled and re-rendering/re-syncing the tracks.
   *
   * @param {WheelEvent} e The wheel event.
   */
  _onWheel(e) {
    handleWheel(this, e);
  }

  /**
   * Handles `touchstart` on the viewport: stops any running momentum glide,
   * captures initial coordinates and timestamp for velocity tracking, and
   * marks active touch scrolling for single-finger gestures.
   *
   * @param {TouchEvent} e The touchstart event.
   */
  _onTouchStart(e) {
    onTouchStart(this, e);
  }

  /**
   * Removes touch gesture listeners from the active touch target.
   * @private
   */
  _detachTouchTargetListeners() {
    detachTouchTargetListeners(this);
  }

  /**
   * Handles `touchmove` on the viewport, mapping incremental finger deltas
   * directly to the virtual scroll position on enabled axes.
   *
   * @param {TouchEvent} e The touchmove event.
   */
  _onTouchMove(e) {
    onTouchMove(this, e);
  }

  /**
   * Handles `touchend` on the viewport: computes release velocity from recent
   * touch movement history and triggers momentum/inertial scrolling when flicked.
   *
   * @param {TouchEvent} e The touchend event.
   */
  _onTouchEnd(e) {
    onTouchEnd(this, e);
  }

  /**
   * Handles `touchcancel` on the viewport: cancels touch scrolling, stops any
   * momentum animation, and cleans up touch state.
   *
   * @param {TouchEvent} [e] The touchcancel event.
   */
  _onTouchCancel(e) {
    onTouchCancel(this, e);
  }

  /**
   * Cancels any running momentum/inertia animation frame.
   * @private
   */
  _stopMomentum() {
    stopMomentum(this);
  }

  /**
   * Initiates a momentum/inertia deceleration animation based on release velocity.
   *
   * @param {number} vx Initial horizontal velocity in pixels per millisecond.
   * @param {number} vy Initial vertical velocity in pixels per millisecond.
   * @private
   */
  _startMomentum(vx, vy) {
    startMomentum(this, vx, vy);
  }

  /**
   * Handles keyboard navigation on the viewport (arrow keys, Page Up/Down,
   * Home/End), updating the virtual scroll position on the enabled axes.
   *
   * @param {KeyboardEvent} e The keydown event.
   */
  _onKeyDown(e) {
    handleKeyDown(this, e);
  }

  /**
   * Handles the window-level `mouseup` event, ending a scrollbar-track drag
   * (if one was in progress) and settling/re-syncing the final position.
   */
  _onMouseUp() {
    handleMouseUp(this);
  }

  /**
   * `ResizeObserver` callback for individual rendered cells: re-measures cells
   * whose natural size may have changed, feeds updated sizes back into the
   * WASM registry, and preserves the "stuck to the end" scroll position.
   *
   * @param {ResizeObserverEntry[]} entries Entries reported by the observer.
   */
  _onResize(entries) {
    handleResize(this, entries);
  }

  // --- CORE LOGIC & MATH ---

  /**
   * Returns cached client dimensions of the viewport (`clientWidth` / `clientHeight`),
   * querying the DOM lazily and caching until invalidated by resize/reconnection.
   * Eliminates synchronous layout reflow thrashing during active scrolling gestures.
   *
   * @returns {{width: number, height: number}} Viewport width and height in CSS pixels.
   */
  _getViewportSize() {
    let { width, height } = this._viewportSizeCache;
    if (width === null || height === null || (width === 0 && height === 0)) {
      width = this.viewport ? this.viewport.clientWidth : 0;
      height = this.viewport ? this.viewport.clientHeight : 0;
      if (width > 0 || height > 0) {
        this._viewportSizeCache.width = width;
        this._viewportSizeCache.height = height;
      }
    }
    return { width, height };
  }

  /**
   * Invalidates cached layout queries (viewport client dimensions and scrollbar track extents).
   * Called on resize, container resize, spacer updates, and reconnection.
   */
  _invalidateLayoutCache() {
    this._trackCache = { vertical: null, horizontal: null };
    this._viewportSizeCache = { width: null, height: null };
  }

  /**
   * Clamps `value` to the `[min, max]` range, snapping to the boundary whenever
   * `value` is already within 1px of it (so near-boundary floating point noise
   * settles exactly at the boundary instead of leaving a residual gap).
   *
   * @param {number} value Value to clamp.
   * @param {number} min Lower bound.
   * @param {number} max Upper bound.
   * @returns {number} The clamped value.
   */
  _clamp(value, min, max) {
    if (value <= min + 1) return min;
    if (value >= max - 1) return max;
    return value;
  }

  /**
   * Resolves the DOM/registry properties relevant to a given axis, so the
   * scroll-conversion helpers below can stay axis-agnostic.
   * Caches track extents to avoid synchronous layout reflow queries during scrolling.
   *
   * @param {'vertical'|'horizontal'} axis Axis to resolve.
   * @returns {{track: HTMLElement, trackExtent: number, trackClientExtent: number, totalExtent: number}}
   *   The scrollbar track element, its scrollable extent (`scrollHeight`/`scrollWidth`),
   *   its visible client extent, and the total virtual extent for that axis.
   */
  _axis(axis) {
    if (axis === 'vertical') {
      if (!this._trackCache.vertical) {
        const trackExtent = this.verticalTrack ? this.verticalTrack.scrollHeight : 0;
        const trackClientExtent = this.verticalTrack ? this.verticalTrack.clientHeight : 0;
        if (trackExtent > 0 || trackClientExtent > 0) {
          this._trackCache.vertical = { trackExtent, trackClientExtent };
        }
        return {
          track: this.verticalTrack,
          trackExtent,
          trackClientExtent,
          totalExtent: this.registry ? this.registry.get_total_height() : 0,
        };
      }
      return {
        track: this.verticalTrack,
        trackExtent: this._trackCache.vertical.trackExtent,
        trackClientExtent: this._trackCache.vertical.trackClientExtent,
        totalExtent: this.registry ? this.registry.get_total_height() : 0,
      };
    }

    if (!this._trackCache.horizontal) {
      const trackExtent = this.horizontalTrack ? this.horizontalTrack.scrollWidth : 0;
      const trackClientExtent = this.horizontalTrack ? this.horizontalTrack.clientWidth : 0;
      if (trackExtent > 0 || trackClientExtent > 0) {
        this._trackCache.horizontal = { trackExtent, trackClientExtent };
      }
      return {
        track: this.horizontalTrack,
        trackExtent,
        trackClientExtent,
        totalExtent: this.registry ? this.registry.get_total_width() : 0,
      };
    }
    return {
      track: this.horizontalTrack,
      trackExtent: this._trackCache.horizontal.trackExtent,
      trackClientExtent: this._trackCache.horizontal.trackClientExtent,
      totalExtent: this.registry ? this.registry.get_total_width() : 0,
    };
  }

  /**
   * Converts a native scrollbar-track scroll position into the corresponding
   * virtual scroll position over the (potentially much larger) virtual content.
   *
   * @param {number} trackScrollPos Current `scrollTop`/`scrollLeft` of the track element.
   * @param {number} viewportSize Visible size (`clientHeight`/`clientWidth`) of the viewport.
   * @param {'vertical'|'horizontal'} axis Axis being converted.
   * @returns {number} The equivalent virtual scroll position.
   */
  _trackToVirtual(trackScrollPos, viewportSize, axis) {
    const { trackExtent, trackClientExtent, totalExtent } = this._axis(axis);
    const maxTrackScroll = trackExtent - trackClientExtent;
    const maxVirtualScroll = totalExtent - viewportSize;

    if (maxVirtualScroll <= 0) return 0;
    if (maxTrackScroll <= 0 || trackScrollPos >= maxTrackScroll - 3) return maxVirtualScroll;

    return (trackScrollPos / maxTrackScroll) * maxVirtualScroll;
  }

  /**
   * Converts a virtual scroll position into the equivalent native
   * scrollbar-track scroll position, the inverse of {@link RunwayGrid#_trackToVirtual}.
   *
   * @param {number} virtualScrollPos Current virtual scroll position.
   * @param {number} viewportSize Visible size (`clientHeight`/`clientWidth`) of the viewport.
   * @param {'vertical'|'horizontal'} axis Axis being converted.
   * @returns {number} The equivalent `scrollTop`/`scrollLeft` value for the track element.
   */
  _virtualToTrack(virtualScrollPos, viewportSize, axis) {
    const { trackExtent, trackClientExtent, totalExtent } = this._axis(axis);
    const maxVirtualScroll = totalExtent - viewportSize;
    const maxTrackScroll = trackExtent - trackClientExtent;

    if (maxVirtualScroll <= 0 || maxTrackScroll <= 0) return 0;
    if (Math.abs(virtualScrollPos - maxVirtualScroll) < 1) return maxTrackScroll;

    return Math.floor((virtualScrollPos / maxVirtualScroll) * maxTrackScroll);
  }

  /**
   * Synchronizes both scrollbar tracks' native `scrollTop`/`scrollLeft` to
   * reflect the current virtual scroll position, skipping any axis that is
   * currently being dragged by the user or already mid-DOM-update.
   */
  syncTrackFromVirtual() {
    if (!this.registry) return;
    const { width: vw, height: vh } = this._getViewportSize();
    if (this.verticalEnabled && !this._isUpdatingDOM && !this._isDraggingVertical) {
      this._syncOneTrack('vertical', this._virtualScrollTop, vh, this.verticalTrack, 'scrollTop');
    }
    if (this.horizontalEnabled && !this._isUpdatingDOM && !this._isDraggingHorizontal) {
      this._syncOneTrack('horizontal', this._virtualScrollLeft, vw, this.horizontalTrack, 'scrollLeft');
    }
  }

  /**
   * Programmatically updates a single scrollbar track's scroll position to
   * match the given virtual scroll position, muting the resulting native
   * `scroll` event briefly so it isn't misinterpreted as user-driven input.
   *
   * @param {'vertical'|'horizontal'} axis Axis being synced.
   * @param {number} virtualScrollPos Current virtual scroll position for the axis.
   * @param {number} viewportSize Visible size (`clientHeight`/`clientWidth`) of the viewport.
   * @param {HTMLElement} trackEl The scrollbar track element to update.
   * @param {'scrollTop'|'scrollLeft'} scrollProp Which scroll property on `trackEl` to set.
   */
  _syncOneTrack(axis, virtualScrollPos, viewportSize, trackEl, scrollProp) {
    const targetScrollPos = this._virtualToTrack(virtualScrollPos, viewportSize, axis);
    if (targetScrollPos === 0 && trackEl[scrollProp] === 0) return;

    if (Math.abs(trackEl[scrollProp] - targetScrollPos) >= 1) {
      if (axis === 'vertical') {
        this._expectedTrackScrollTop = targetScrollPos;
      } else {
        this._expectedTrackScrollLeft = targetScrollPos;
      }
      this._isProgrammaticScroll = true;
      this._isUpdatingDOM = true;
      trackEl[scrollProp] = targetScrollPos;
      this._isUpdatingDOM = false;

      if (this._programmaticScrollRaf !== null) {
        cancelAnimationFrame(this._programmaticScrollRaf);
      }
      this._programmaticScrollRaf = requestAnimationFrame(() => {
        this._isProgrammaticScroll = false;
        this._expectedTrackScrollTop = null;
        this._expectedTrackScrollLeft = null;
        this._programmaticScrollRaf = null;
      });
    }
  }

  /**
   * Resizes the vertical/horizontal spacer elements so each scrollbar track's
   * native scrollable extent matches the total virtual content size (capped at
   * {@link SAFE_MAX_SPACER_SIZE}), which is what gives the native scrollbars their
   * correct thumb size/travel range. Skipped on an axis currently being dragged.
   */
  updateSpacer() {
    this._trackCache.vertical = null;
    this._trackCache.horizontal = null;
    if (!this.registry) {
      if (this.verticalSpacer) this.verticalSpacer.style.height = '0px';
      if (this.horizontalSpacer) this.horizontalSpacer.style.width = '0px';
      return;
    }
    if (this.verticalEnabled && !this._isDraggingVertical) {
      this.verticalSpacer.style.height = `${Math.floor(Math.min(this.registry.get_total_height(), SAFE_MAX_SPACER_SIZE))}px`;
    }
    if (this.horizontalEnabled && !this._isDraggingHorizontal) {
      this.horizontalSpacer.style.width = `${Math.floor(Math.min(this.registry.get_total_width(), SAFE_MAX_SPACER_SIZE))}px`;
    }
  }

  /**
   * Core render-scheduling step: asks the WASM registry to compute the visible
   * row/column range and wrapper translation for the current scroll position
   * and viewport size, applies the (rounded) wrapper transform, dispatches the
   * `rangechange` event, and delegates DOM reconciliation to
   * {@link RunwayGrid#applyChanges}.
   */
  calculateIndices() {
    if (!this.renderItem || !this.registry) return;
    if (this.verticalEnabled && this.rowCount === 0) return;
    if (this.horizontalEnabled && this.colCount === 0) return;

    const { width: vw, height: vh } = this._getViewportSize();
    if (vh === 0 && vw === 0 && !this._initialLayoutDone) return;
    this._initialLayoutDone = true;

    const geometry = this.registry.compute_geometry(
        this._virtualScrollTop,
        this._virtualScrollLeft,
        vh,
        vw,
        this.bufferSize,
        this.verticalEnabled,
        this.horizontalEnabled,
    );

    const {
      translate_x, translate_y, start_row, end_row, start_col, end_col,
      viewport_start_row, viewport_end_row, viewport_start_col, viewport_end_col,
    } = geometry;
    geometry.free();

    const roundedTranslateX = Math.round(translate_x);
    const roundedTranslateY = Math.round(translate_y);

    this.wrapper.style.transform = `translate3d(${roundedTranslateX}px, ${roundedTranslateY}px, 0)`;

    // Note: `buffered`/`viewport` are attached directly on the event instance (rather than
    // nested under `detail`) since plain properties passed to the `CustomEvent` constructor
    // are otherwise silently dropped - only `detail` is a recognized `CustomEventInit` member.
    /** @type {import('./runway-grid.d.ts').RangeChangeEvent} */
    const rangeChangeEvent = /** @type {any} */ (new CustomEvent('rangechange'));
    // Buffered range (includes off-screen `bufferSize` items on each side). Ideal for
    // triggering infinite-scroll data fetches before the user hits the absolute bottom.
    rangeChangeEvent.buffered = { startRow: start_row, endRow: end_row, startCol: start_col, endCol: end_col };
    // Strict range excluding the buffer - only the indices actually intersecting the
    // visible pixels on screen. Ideal for visibility tracking (e.g. impression logging).
    rangeChangeEvent.viewport = { startRow: viewport_start_row, endRow: viewport_end_row, startCol: viewport_start_col, endCol: viewport_end_col };
    // While a `rangechange` batch is active (see `_beginRangeChangeBatch`), defer dispatching:
    // only the last event computed before the batch closes actually gets dispatched, so a
    // public method that calls `calculateIndices()` several times per invocation (e.g.
    // `scrollToCell()`, or a handler that re-settles via `_settleAtEnd()`) never fires more
    // than one `rangechange` per call.
    if (this._batchDepth > 0) this._pendingRangeChangeEvent = rangeChangeEvent;
    else this.dispatchEvent(rangeChangeEvent);
    this.applyChanges(start_row, end_row, start_col, end_col, translate_y, roundedTranslateY, translate_x, roundedTranslateX);
  }

  /**
   * Reconciles the pool of rendered cell DOM nodes with the newly computed
   * row/column range: grows/shrinks the pooled node matrix, positions each
   * cell (`top`/`left`, rounded to whole pixels) relative to the rounded
   * wrapper translation, and (re)renders content only for cells whose
   * row/column index actually changed, reusing nodes otherwise.
   *
   * @param {number} startRow Inclusive first row index to render.
   * @param {number} endRow Exclusive last row index to render.
   * @param {number} startCol Inclusive first column index to render.
   * @param {number} endCol Exclusive last column index to render.
   * @param {number} translateYRaw Raw (unrounded) vertical wrapper translation from the geometry engine.
   * @param {number} translateYRounded Rounded vertical wrapper translation actually applied to the DOM.
   * @param {number} translateXRaw Raw (unrounded) horizontal wrapper translation from the geometry engine.
   * @param {number} translateXRounded Rounded horizontal wrapper translation actually applied to the DOM.
   */
  applyChanges(startRow, endRow, startCol, endCol, translateYRaw, translateYRounded, translateXRaw, translateXRounded) {
    const requiredRows = Math.max(0, endRow - startRow);
    const requiredCols = Math.max(0, endCol - startCol);
    // Only the genuinely two-axis `orientation="both"` uses the ARIA grid pattern
    // (`grid` -> `row` -> `gridcell`); single-axis orientations use `list` -> `listitem`,
    // since this component's arrow-key handling moves the *scroll position*, not cell focus.
    const isGrid = this.orientation === 'both';
    this._isUpdatingDOM = true;

    try {
      while (this.renderedNodes.length > requiredRows) {
        const rowNodes = this.renderedNodes.pop();
        if (this.resizeObserver) {
          for (const el of rowNodes) this.resizeObserver.unobserve(el);
        }
        this.wrapper.removeChild(this.renderedRowGroups.pop());
      }
      while (this.renderedNodes.length < requiredRows) {
        // Every row's cells are grouped under their own wrapper element so the DOM mirrors
        // the standard ARIA grid pattern (`grid` -> `row` -> `gridcell`) instead of putting
        // `gridcell`s directly under `grid` with no owning `row` in between. For single-axis
        // orientations this wrapper carries no semantic role of its own (`presentation`), so
        // it stays transparent to assistive tech between the `list` and its `listitem`s.
        const rowGroup = document.createElement('div');
        rowGroup.classList.add('runway-grid__rowgroup');
        rowGroup.setAttribute('role', isGrid ? 'row' : 'presentation');
        this.wrapper.appendChild(rowGroup);
        this.renderedRowGroups.push(rowGroup);
        this.renderedNodes.push([]);
      }

      for (let r = 0; r < requiredRows; r++) {
        const rowNodes = this.renderedNodes[r];
        const rowGroup = this.renderedRowGroups[r];
        while (rowNodes.length > requiredCols) {
          const el = rowNodes.pop();
          if (this.resizeObserver) this.resizeObserver.unobserve(el);
          rowGroup.removeChild(el);
        }
        while (rowNodes.length < requiredCols) {
          const el = document.createElement('div');
          el.classList.add('runway-grid__cell');
          el.setAttribute('part', 'cell');
          rowGroup.appendChild(el);
          rowNodes.push(el);
        }
      }

      // Recover the exact (possibly clamped) scroll position the engine used to compute
      // `translateYRaw`/`translateXRaw` - `rowBase`/`colBase` are the *raw* offsets of the
      // first buffered row/column, so subtracting the raw translate isolates the scroll
      // position itself. Anchoring each cell's rounding to this shared scroll position (rather
      // than rounding the row-to-row delta) guarantees every cell's on-screen offset is the
      // nearest whole pixel to its true position, instead of compounding two independent
      // roundings (translate + delta) which could otherwise drift by up to a full pixel.
      const rowBase = this.registry.get_row_offset(startRow);
      const colBase = this.registry.get_col_offset(startCol);
      const clampedScrollTop = rowBase - translateYRaw;
      const clampedScrollLeft = colBase - translateXRaw;
      const { width: fullRowWidth, height: fullRowHeight } = this._getViewportSize();

      for (let r = 0; r < requiredRows; r++) {
        const rowIndex = startRow + r;
        const rowTop = Math.round(this.registry.get_row_offset(rowIndex) - clampedScrollTop) - translateYRounded;
        const rowGroup = this.renderedRowGroups[r];
        rowGroup.style.top = `${rowTop}px`;
        if (!this.verticalEnabled) rowGroup.style.height = `${fullRowHeight}px`;
        if (isGrid) rowGroup.setAttribute('aria-rowindex', String(rowIndex + 1));

        for (let c = 0; c < requiredCols; c++) {
          const colIndex = startCol + c;
          const node = this.renderedNodes[r][c];

          // The cell's own `top` stays at the `.runway-grid__cell` default (`0`) - it's
          // positioned relative to its row group, which now carries the vertical offset.
          node.style.left = `${Math.round(this.registry.get_col_offset(colIndex) - clampedScrollLeft) - translateXRounded}px`;
          node.style.width = this.horizontalEnabled ? '' : `${fullRowWidth}px`;
          node.style.height = this.verticalEnabled ? '' : `${fullRowHeight}px`;

          const oldRow = node.getAttribute('data-row');
          const oldCol = node.getAttribute('data-col');
          if (oldRow === String(rowIndex) && oldCol === String(colIndex) && node._renderedVersion === this._renderVersion) {
            if (this.resizeObserver) this.resizeObserver.observe(node);
            continue;
          }

          node._renderedVersion = this._renderVersion;
          node.setAttribute('data-row', rowIndex);
          node.setAttribute('data-col', colIndex);
          if (isGrid) {
            node.setAttribute('role', 'gridcell');
            node.setAttribute('aria-rowindex', String(rowIndex + 1));
            node.setAttribute('aria-colindex', String(colIndex + 1));
          } else {
            const posIndex = this.orientation === 'horizontal' ? colIndex : rowIndex;
            const setSize = this.orientation === 'horizontal' ? this.colCount : this.rowCount;
            node.setAttribute('role', 'listitem');
            node.setAttribute('aria-posinset', String(posIndex + 1));
            node.setAttribute('aria-setsize', String(setSize));
          }
          node.innerHTML = '';

          const item = this.orientation === 'horizontal'
            ? (this.columnsData ? this.columnsData[colIndex] : (this.rows ? this.rows[colIndex] : undefined))
            : (this.rows ? this.rows[rowIndex] : undefined);
          const newContent = this.renderItem(item, rowIndex, colIndex, this.rowCount, this.colCount);
          if (typeof newContent === 'string') {
            node.innerHTML = newContent;
          } else if (typeof newContent === 'number' || typeof newContent === 'boolean') {
            node.textContent = String(newContent);
          } else if (newContent instanceof Node) {
            node.appendChild(newContent);
          }

          if (this.resizeObserver) this.resizeObserver.observe(node);
        }
      }
    } catch (err) {
      console.warn('runway-grid: render failed', err);
    } finally {
      this._isUpdatingDOM = false;
    }
  }

  // --- MEASUREMENT & ALIGNMENT ---

  /**
   * Measures the actual rendered (natural) height/width of every currently
   * rendered cell, keeping the largest measurement seen per row/column index.
   *
   * @returns {{rowMax: Map<number, number>, colMax: Map<number, number>}}
   *   Maps of row index -> max measured height and column index -> max measured width.
   */
  _measureRenderedSizes() {
    const rowMax = new Map(), colMax = new Map();
    for (const rowNodes of this.renderedNodes) {
      for (const node of rowNodes) {
        const rIdx = parseInt(node.getAttribute('data-row'), 10);
        const cIdx = parseInt(node.getAttribute('data-col'), 10);
        if (isNaN(rIdx) || isNaN(cIdx)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.height > 0) rowMax.set(rIdx, Math.max(rowMax.get(rIdx) || 0, rect.height));
        if (rect.width > 0) colMax.set(cIdx, Math.max(colMax.get(cIdx) || 0, rect.width));
      }
    }
    return { rowMax, colMax };
  }

  /**
   * Feeds measured row heights/column widths into the WASM registry.
   *
   * @param {Map<number, number>} rowMax Row index -> measured height map.
   * @param {Map<number, number>} colMax Column index -> measured width map.
   * @returns {boolean} `true` if any row height or column width actually changed.
   */
  _applyMeasuredSizes(rowMax, colMax) {
    let changed = false;
    this._isUpdatingDOM = true;
    try {
      if (this.verticalEnabled) for (const [r, h] of rowMax) if (this.registry.update_row_height(r, h)) changed = true;
      if (this.horizontalEnabled) for (const [c, w] of colMax) if (this.registry.update_col_width(c, w)) changed = true;
    } finally {
      this._isUpdatingDOM = false;
    }
    return changed;
  }

  /**
   * Corrects the residual sub-pixel gap that can appear when the viewport is
   * scrolled to (or very near) the end of the content.
   *
   * @param {number} vh Current viewport `clientHeight`.
   * @param {number} vw Current viewport `clientWidth`.
   */
  _settleAtEnd(vh, vw) {
    if (!this.registry || !this.renderedNodes.length) return;
    const maxV = Math.max(0, this.registry.get_total_height() - vh);
    const maxH = Math.max(0, this.registry.get_total_width() - vw);
    if ((!this.verticalEnabled || Math.abs(this._virtualScrollTop - maxV) >= 1) &&
        (!this.horizontalEnabled || Math.abs(this._virtualScrollLeft - maxH) >= 1)) return;

    const { rowMax, colMax } = this._measureRenderedSizes();
    if (this._applyMeasuredSizes(rowMax, colMax)) {
      if (this.verticalEnabled && Math.abs(this._virtualScrollTop - maxV) < 1) this._virtualScrollTop = Math.max(0, this.registry.get_total_height() - vh);
      if (this.horizontalEnabled && Math.abs(this._virtualScrollLeft - maxH) < 1) this._virtualScrollLeft = Math.max(0, this.registry.get_total_width() - vw);
      this.calculateIndices();
    }
  }

  /**
   * Scrolls so that the given row/column cell is visible, snapping precisely
   * to its final measured position.
   *
   * @param {number} rowIndex Zero-based row index to scroll to.
   * @param {number} [colIndex=0] Zero-based column index to scroll to.
   */
  scrollToCell(rowIndex, colIndex = 0) {
    if (!this.registry) return;
    this._stopMomentum();
    const { width: vw, height: vh } = this._getViewportSize();
    rowIndex = Math.max(0, Math.min(this.rowCount - 1, Math.floor(rowIndex)));
    colIndex = Math.max(0, Math.min(this.colCount - 1, Math.floor(colIndex)));

    const position = () => {
      if (this.verticalEnabled) this._virtualScrollTop = this._clamp(this.registry.get_row_offset(rowIndex), 0, this.registry.get_total_height() - vh);
      if (this.horizontalEnabled) this._virtualScrollLeft = this._clamp(this.registry.get_col_offset(colIndex), 0, this.registry.get_total_width() - vw);
    };

    // `calculateIndices()` below runs up to 4 times as the target position/measured sizes are
    // refined - batch them so consumers wiring infinite-scroll fetches off `rangechange` only
    // ever see the one final, settled event per `scrollToCell()` call, not up to 4 redundant ones.
    this._beginRangeChangeBatch();
    try {
      position();
      this.calculateIndices();

      const { rowMax, colMax } = this._measureRenderedSizes();
      if (this._applyMeasuredSizes(rowMax, colMax)) {
        position();
        this.calculateIndices();
      }

      this._settleAtEnd(vh, vw);
      position(); // Snap exactly to boundaries if we just measured the tail

      this.calculateIndices();
      this.updateSpacer();
      this.syncTrackFromVirtual();
    } finally {
      this._endRangeChangeBatch();
    }
  }

  /**
   * Shorthand for `scrollToCell(index, 0)` (vertical) or `scrollToCell(0, index)`
   * (horizontal), for single-axis lists.
   *
   * @param {number} index Zero-based row (vertical) or column (horizontal) index to scroll to.
   */
  scrollToIndex(index) {
    if (this.orientation === 'horizontal') {
      this.scrollToCell(0, index);
    } else {
      this.scrollToCell(index, 0);
    }
  }

  // --- PROPERTIES ---

  /**
   * Which axis (or axes) are virtualized, from the `orientation` attribute.
   * Defaults to `'vertical'` for any unrecognized/missing value.
   * @returns {'vertical'|'horizontal'|'both'}
   */
  get orientation() { const v = this.getAttribute('orientation'); return v === 'horizontal' || v === 'both' ? v : 'vertical'; }
  set orientation(val) {
    if (val) this.setAttribute('orientation', val);
    else this.removeAttribute('orientation');
  }

  /** @returns {boolean} Whether the vertical (row) axis is virtualized. */
  get verticalEnabled() { return this.orientation === 'vertical' || this.orientation === 'both'; }

  /** @returns {boolean} Whether the horizontal (column) axis is virtualized. */
  get horizontalEnabled() { return this.orientation === 'horizontal' || this.orientation === 'both'; }

  /** @returns {number} Number of rows currently known to the component (`1` when the vertical axis is disabled). */
  get rowCount() { return this.verticalEnabled ? (this.rows ? this.rows.length : 0) : 1; }

  /** @returns {number} Number of columns currently known to the component (`1` when the horizontal axis is disabled). */
  get colCount() {
    if (!this.horizontalEnabled) return 1;
    if (this.orientation === 'horizontal' && !this._hasExplicitColumns) {
      return this.rows ? this.rows.length : 0;
    }
    if (this.columnsData) {
      return this.columnsData.length;
    }
    return this._colCount || 0;
  }

  /** @returns {number} Initial/estimated row height in pixels, from the `row-size` (or legacy `item-size`) attribute. */
  get rowSize() { return parseInt(this.getAttribute('row-size') || this.getAttribute('item-size') || '20', 10); }
  set rowSize(val) { this.setAttribute('row-size', String(val)); }

  /** @returns {number} Initial/estimated column width in pixels, from the `col-size` attribute. */
  get colSize() { return parseInt(this.getAttribute('col-size') || '100', 10); }
  set colSize(val) { this.setAttribute('col-size', String(val)); }

  /** @returns {number} Number of extra rows/columns rendered outside the visible viewport, from the `buffer-size` attribute. */
  get bufferSize() { return parseInt(this.getAttribute('buffer-size') || '5', 10); }
  set bufferSize(val) { this.setAttribute('buffer-size', String(val)); }

  /**
   * The row data array.
   * @returns {Array<unknown>}
   */
  get data() {
    return this.rows;
  }

  /**
   * Sets the row data. (Re)builds the internal layout registry and resets the
   * scroll position back to the origin. For single-axis horizontal lists, automatically
   * populates columns if `columns` was omitted.
   * @param {Array<unknown>} newRows The row data array.
   */
  set data(newRows) {
    this._stopMomentum();
    this._isTouchScrolling = false;
    this._detachTouchTargetListeners();
    this._renderVersion++;
    this.rows = newRows || [];
    if (this.orientation === 'horizontal' && !this._hasExplicitColumns) {
      this.columnsData = Array.isArray(newRows) ? newRows : null;
      this._colCount = this.columnsData ? this.columnsData.length : 1;
    }
    this._virtualScrollTop = 0;
    this._virtualScrollLeft = 0;
    this.setupRegistry();
  }

  /**
   * Non-destructively appends items to the existing data set, e.g. for infinite
   * scroll pagination.
   *
   * @param {Array<unknown>} newItems The rows (or, for `orientation="horizontal"`, columns) to append after the current data set.
   */
  appendData(newItems) {
    if (!newItems || !newItems.length) return;
    const count = newItems.length;

    if (this.orientation === 'horizontal') {
      this.columnsData = (this.columnsData || []).concat(newItems);
      this._colCount = this.columnsData.length;
      if (!this._hasExplicitColumns) {
        this.rows = this.columnsData;
      }

      if (!this.registry) { this.setupRegistry(); return; }

      this.registry.append_cols(count, this.colSize);
    } else {
      this.rows = this.rows.concat(newItems);

      if (!this.registry) { this.setupRegistry(); return; }

      this.registry.append_rows(count, this.rowSize);
    }

    this.updateSpacer();
    this.calculateIndices();
    this._refreshAriaCounts();
  }

  /**
   * Non-destructively drops the first `count` items from the existing data set,
   * e.g. to cap memory usage ("sliding window") once an infinite-scroll list has
   * grown past some limit.
   *
   * @param {number} count Number of items to remove from the head of the data set.
   */
  removeDataFromHead(count) {
    if (!count || count <= 0 || !this.registry) return;
    this._renderVersion++;

    if (this.orientation === 'horizontal') {
      const removeCount = Math.min(count, this.columnsData ? this.columnsData.length : 0);
      if (removeCount <= 0) return;

      this.columnsData = this.columnsData.slice(removeCount);
      this._colCount = this.columnsData.length;
      if (!this._hasExplicitColumns) {
        this.rows = this.columnsData;
      }

      const widthDelta = this.registry.remove_cols_from_head(removeCount);
      this._virtualScrollLeft = Math.max(0, this._virtualScrollLeft - widthDelta);
    } else {
      const removeCount = Math.min(count, this.rows.length);
      if (removeCount <= 0) return;

      this.rows = this.rows.slice(removeCount);

      const heightDelta = this.registry.remove_rows_from_head(removeCount);
      this._virtualScrollTop = Math.max(0, this._virtualScrollTop - heightDelta);
    }

    this.updateSpacer();
    this.syncTrackFromVirtual();
    this.calculateIndices();
    this._refreshAriaCounts();
  }

  /**
   * The column definitions array, or a numeric column count if definitions were not provided.
   * @returns {Array<unknown>|number}
   */
  get columns() {
    return this.columnsData ?? this._colCount;
  }

  /**
   * Sets the column definitions, or a plain column count. (Re)builds the internal
   * layout registry and triggers a re-render.
   * @param {Array<unknown>|number} colsOrCount An array of column definitions, or a column count.
   */
  set columns(colsOrCount) {
    this._stopMomentum();
    this._isTouchScrolling = false;
    this._detachTouchTargetListeners();
    this._hasExplicitColumns = colsOrCount != null;
    this._renderVersion++;
    if (Array.isArray(colsOrCount)) {
      this.columnsData = colsOrCount;
      this._colCount = colsOrCount.length || 1;
    } else if (colsOrCount != null) {
      this.columnsData = null;
      this._colCount = parseInt(String(colsOrCount), 10) || 1;
    } else {
      this.columnsData = null;
      this._colCount = 1;
    }
    this.setupRegistry();
  }

  /**
   * Sets the cell rendering function, then immediately re-renders.
   *
   * @param {(rowItem: unknown, rowIndex: number, colIndex: number, rowCount: number, colCount: number) => (string|Node|number|boolean|null|undefined)} renderFn
   *   Renders a single cell's content: return an HTML string (assigned via `innerHTML`), a `Node` (appended as-is), or a primitive number/boolean (assigned via `textContent`).
   */
  set template(renderFn) { this._renderVersion++; this.renderItem = renderFn; this.calculateIndices(); }
}

if (!customElements.get('runway-grid')) {
  customElements.define('runway-grid', RunwayGrid);
}
