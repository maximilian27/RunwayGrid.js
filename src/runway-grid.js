/**
 * `<runway-grid>` - a high-performance virtual scroll custom element for rendering
 * very large lists and 2D grids (millions of rows/columns) while keeping the DOM
 * small. Layout math (offsets, ranges, auto-measured row/column sizes) is delegated
 * to a Rust/WebAssembly engine (`VirtualScrollRegistry`), which is embedded directly
 * into this module as a base64 string so the component is fully self-contained.
 *
 * @module runway-grid
 */
import init, { VirtualScrollRegistry } from '../runway_engine/pkg/runway_engine.js';
import { RUNWAY_ENGINE_WASM_BASE64 } from './runway-engine-wasm.js';

/**
 * Upper bound (in pixels) applied to spacer element sizes. Browsers silently clamp/ignore
 * extremely large CSS lengths, so the total scrollable extent reported to the DOM (via the
 * spacer's `height`/`width`) is capped at this value, independent of the true virtual size
 * computed by the WASM engine.
 * @type {number}
 */
const SAFE_MAX_HEIGHT = 10000000;

/**
 * Decodes a base64 string into a `Uint8Array`, used to turn the embedded
 * `RUNWAY_ENGINE_WASM_BASE64` payload back into raw WASM bytes for `init()`.
 *
 * @param {string} base64 Base64-encoded binary data.
 * @returns {Uint8Array} The decoded bytes.
 */
function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

if ('history' in window && 'scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

/**
 * Cached promise for the WASM module initialization, shared across every
 * `RunwayGrid` instance so the engine is only decoded/instantiated once per page.
 * @type {Promise<unknown>|null}
 */
let wasmInitPromise = null;

/**
 * Lazily initializes the embedded WASM engine exactly once, regardless of how many
 * `RunwayGrid` instances request it.
 *
 * @returns {Promise<unknown>} Resolves once the WASM module is ready to use.
 */
function ensureWasmInitialized() {
  if (!wasmInitPromise) wasmInitPromise = init(base64ToUint8Array(RUNWAY_ENGINE_WASM_BASE64));
  return wasmInitPromise;
}

// 1. STATIC TEMPLATE: Parsed once by the browser for faster instantiation
const COMPONENT_TEMPLATE = document.createElement('template');
COMPONENT_TEMPLATE.innerHTML = `
  <style>
      :host {
        display: block;
        position: relative;
        contain: strict;
        height: 100%;
        --runway-grid-scrollbar-size: 10px;
      }
      .virtual-scroll__container { display: flex; flex-direction: column; width: 100%; height: 100%; position: relative; }
      .virtual-scroll__row { display: flex; flex: 1; min-height: 0; min-width: 0; position: relative; }
      .virtual-scroll__viewport { flex: 1; min-width: 0; overflow: hidden; position: relative; outline: none; }
      .virtual-scroll__wrapper { position: absolute; top: 0; left: 0; will-change: transform; }
      .virtual-scroll__cell { position: absolute; top: 0; left: 0; }
      .virtual-scroll__track--vertical { 
        flex-shrink: 0; 
        overflow-y: scroll; 
        overflow-x: hidden;
        scrollbar-width: thin;
        width: var(--runway-grid-scrollbar-size, 10px);
       }
      .virtual-scroll__spacer--vertical { width: 1px; will-change: height; }
      .virtual-scroll__track--horizontal {
        flex-shrink: 0;
        height: var(--runway-grid-scrollbar-size, 10px);
        overflow-x: scroll; 
        overflow-y: hidden; 
        scrollbar-width: thin;
      }
      .virtual-scroll__spacer--horizontal { height: 1px; will-change: width; }
      .virtual-scroll__track--disabled { display: none; }
  </style>
  <div class="virtual-scroll__container" part="container">
      <div class="virtual-scroll__row" part="row">
          <div class="virtual-scroll__viewport" part="viewport" tabindex="0">
              <div class="virtual-scroll__wrapper" part="wrapper"></div>
          </div>
          <div class="virtual-scroll__track virtual-scroll__track--vertical" part="track track-vertical">
              <div class="virtual-scroll__spacer virtual-scroll__spacer--vertical" part="spacer spacer-vertical"></div>
          </div>
      </div>
      <div class="virtual-scroll__track virtual-scroll__track--horizontal" part="track track-horizontal">
          <div class="virtual-scroll__spacer virtual-scroll__spacer--horizontal" part="spacer spacer-horizontal"></div>
      </div>
  </div>
`;

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
 */
export class RunwayGrid extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(COMPONENT_TEMPLATE.content.cloneNode(true));

    // DOM References
    /** @type {HTMLElement} */
    this.viewport = this.shadowRoot.querySelector('.virtual-scroll__viewport');
    /** @type {HTMLElement} */
    this.wrapper = this.shadowRoot.querySelector('.virtual-scroll__wrapper');
    /** @type {HTMLElement} */
    this.verticalTrack = this.shadowRoot.querySelector('.virtual-scroll__track--vertical');
    /** @type {HTMLElement} */
    this.verticalSpacer = this.shadowRoot.querySelector('.virtual-scroll__spacer--vertical');
    /** @type {HTMLElement} */
    this.horizontalTrack = this.shadowRoot.querySelector('.virtual-scroll__track--horizontal');
    /** @type {HTMLElement} */
    this.horizontalSpacer = this.shadowRoot.querySelector('.virtual-scroll__spacer--horizontal');

    // Internal State
    this.rows = [];
    this.columnsData = null;
    this._colCount = 1;
    this.renderedNodes = []; // 2D matrix
    this.registry = null;

    this.wasmInitialized = false;
    this._initialLayoutDone = false;
    this._isUpdatingDOM = false;
    this._isProgrammaticScroll = false;
    this._scrollMuteTimer = null;
    this._isDraggingVertical = false;
    this._isDraggingHorizontal = false;

    this._virtualScrollTop = 0;
    this._virtualScrollLeft = 0;

    this._bindEvents();
    this.initWasm();
  }

  // --- COMPONENT LIFECYCLE & SETUP ---

  /**
   * Wires up all DOM/`ResizeObserver` event listeners used by the component.
   * Called once from the constructor.
   * @private
   */
  _bindEvents() {
    this._handleMouseUp = this._onMouseUp.bind(this);
    window.addEventListener('mouseup', this._handleMouseUp);

    this.verticalTrack.addEventListener('mousedown', () => { this._isDraggingVertical = true; });
    this.horizontalTrack.addEventListener('mousedown', () => { this._isDraggingHorizontal = true; });

    this.verticalTrack.addEventListener('scroll', () => this._onTrackScroll('vertical'));
    this.horizontalTrack.addEventListener('scroll', () => this._onTrackScroll('horizontal'));

    this.viewport.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    this.viewport.addEventListener('keydown', this._onKeyDown.bind(this));

    this.resizeObserver = new ResizeObserver(this._onResize.bind(this));
    this.containerObserver = new ResizeObserver(() => {
      if (this.viewport.clientHeight > 0 || this.viewport.clientWidth > 0) this.calculateIndices();
    });
    this.containerObserver.observe(this);
  }

  /**
   * Custom element lifecycle callback: removes the window-level `mouseup`
   * listener registered in {@link RunwayGrid#_bindEvents} to avoid leaking it
   * once the element is removed from the DOM.
   */
  disconnectedCallback() {
    window.removeEventListener('mouseup', this._handleMouseUp);
  }

  /**
   * Custom element lifecycle callback: resets scroll position and track state,
   * toggles the enabled/disabled state of each scrollbar track based on
   * {@link RunwayGrid#orientation}, and triggers the initial layout pass.
   */
  connectedCallback() {
    if (this.verticalTrack) this.verticalTrack.scrollTop = 0;
    if (this.horizontalTrack) this.horizontalTrack.scrollLeft = 0;
    this._virtualScrollTop = 0;
    this._virtualScrollLeft = 0;
    this.verticalTrack.classList.toggle('virtual-scroll__track--disabled', !this.verticalEnabled);
    this.horizontalTrack.classList.toggle('virtual-scroll__track--disabled', !this.horizontalEnabled);
    this.calculateIndices();
  }

  /**
   * Awaits the shared WASM engine initialization and, once ready, builds the
   * layout registry if `data`/`columns` were already assigned before the
   * engine finished loading.
   * @returns {Promise<void>}
   */
  async initWasm() {
    await ensureWasmInitialized();
    this.wasmInitialized = true;
    if (this.rows.length || this._colCount > 1) this.setupRegistry();
  }

  /**
   * (Re)creates the WASM `VirtualScrollRegistry` for the current row/column
   * counts and initial sizes, then recomputes the spacer size and the
   * currently rendered range. No-op until the WASM engine is initialized and
   * the enabled axes have a non-zero row/column count.
   */
  setupRegistry() {
    if (!this.wasmInitialized) return;
    if (this.verticalEnabled && this.rowCount === 0) return;
    if (this.horizontalEnabled && this.colCount === 0) return;

    this.registry = new VirtualScrollRegistry(this.rowCount || 1, this.colCount || 1, this.rowSize, this.colSize);
    this.updateSpacer();
    this.calculateIndices();
  }

  // --- EVENT HANDLERS ---

  /**
   * Handles a native `scroll` event on one of the (visible) scrollbar tracks,
   * translating the track's scroll position into the corresponding virtual
   * scroll position and re-rendering. Ignored while a programmatic/DOM update
   * is already in progress to avoid feedback loops.
   *
   * @param {'vertical'|'horizontal'} axis Which track fired the scroll event.
   */
  _onTrackScroll(axis) {
    if (this._isUpdatingDOM || this._isProgrammaticScroll) return;

    const viewportSize = axis === 'vertical' ? this.viewport.clientHeight : this.viewport.clientWidth;
    const track = axis === 'vertical' ? this.verticalTrack : this.horizontalTrack;
    const scrollPos = Math.max(0, axis === 'vertical' ? track.scrollTop : track.scrollLeft);

    const virtualPos = this._trackToVirtual(scrollPos, viewportSize, axis);

    if (axis === 'vertical') this._virtualScrollTop = virtualPos;
    else this._virtualScrollLeft = virtualPos;

    this.calculateIndices();
    this._settleAtEnd(this.viewport.clientHeight, this.viewport.clientWidth);
  }

  /**
   * Handles `wheel` events on the viewport, moving the virtual scroll position
   * on whichever axes are enabled and re-rendering/re-syncing the tracks.
   *
   * @param {WheelEvent} e The wheel event.
   */
  _onWheel(e) {
    e.preventDefault();
    if (!this.registry) return;

    let moved = false;

    if (this.verticalEnabled) {
      const maxScroll = this.registry.get_total_height() - this.viewport.clientHeight;
      if (maxScroll > 0) {
        this._virtualScrollTop = this._clamp(this._virtualScrollTop + (e.deltaY * 0.3), 0, maxScroll);
        moved = true;
      }
    }

    if (this.horizontalEnabled) {
      const maxScroll = this.registry.get_total_width() - this.viewport.clientWidth;
      if (maxScroll > 0) {
        this._virtualScrollLeft = this._clamp(this._virtualScrollLeft + (e.deltaX * 0.3), 0, maxScroll);
        moved = true;
      }
    }

    if (moved) {
      this.calculateIndices();
      this._settleAtEnd(this.viewport.clientHeight, this.viewport.clientWidth);
      this.syncTrackFromVirtual();
    }
  }

  /**
   * Handles keyboard navigation on the viewport (arrow keys, Page Up/Down,
   * Home/End), updating the virtual scroll position on the enabled axes.
   *
   * @param {KeyboardEvent} e The keydown event.
   */
  _onKeyDown(e) {
    if (!this.registry) return;
    const maxV = this.registry.get_total_height() - this.viewport.clientHeight;
    const maxH = this.registry.get_total_width() - this.viewport.clientWidth;
    let changed = true;

    switch (e.key) {
      case 'ArrowDown': if (!this.verticalEnabled) { changed = false; break; } e.preventDefault(); this._virtualScrollTop += this.rowSize; break;
      case 'ArrowUp': if (!this.verticalEnabled) { changed = false; break; } e.preventDefault(); this._virtualScrollTop -= this.rowSize; break;
      case 'ArrowRight': if (!this.horizontalEnabled) { changed = false; break; } e.preventDefault(); this._virtualScrollLeft += this.colSize; break;
      case 'ArrowLeft': if (!this.horizontalEnabled) { changed = false; break; } e.preventDefault(); this._virtualScrollLeft -= this.colSize; break;
      case 'PageDown': if (!this.verticalEnabled) { changed = false; break; } e.preventDefault(); this._virtualScrollTop += this.viewport.clientHeight; break;
      case 'PageUp': if (!this.verticalEnabled) { changed = false; break; } e.preventDefault(); this._virtualScrollTop -= this.viewport.clientHeight; break;
      case 'Home': e.preventDefault(); if (this.verticalEnabled) this._virtualScrollTop = 0; if (this.horizontalEnabled) this._virtualScrollLeft = 0; break;
      case 'End': e.preventDefault(); if (this.verticalEnabled) this._virtualScrollTop = maxV; if (this.horizontalEnabled) this._virtualScrollLeft = maxH; break;
      default: changed = false; break;
    }

    if (changed) {
      if (this.verticalEnabled) this._virtualScrollTop = this._clamp(this._virtualScrollTop, 0, maxV);
      if (this.horizontalEnabled) this._virtualScrollLeft = this._clamp(this._virtualScrollLeft, 0, maxH);
      this.calculateIndices();
      this._settleAtEnd(this.viewport.clientHeight, this.viewport.clientWidth);
      this.syncTrackFromVirtual();
    }
  }

  /**
   * Handles the window-level `mouseup` event, ending a scrollbar-track drag
   * (if one was in progress) and settling/re-syncing the final position.
   */
  _onMouseUp() {
    if (this._isDraggingVertical || this._isDraggingHorizontal) {
      this._isDraggingVertical = false;
      this._isDraggingHorizontal = false;
      this._settleAtEnd(this.viewport.clientHeight, this.viewport.clientWidth);
      this.updateSpacer();
      this.syncTrackFromVirtual();
    }
  }

  /**
   * `ResizeObserver` callback for individual rendered cells: re-measures cells
   * whose natural size may have changed, feeds updated sizes back into the
   * WASM registry, and preserves the "stuck to the end" scroll position if the
   * viewport was scrolled all the way to the bottom/right when sizes changed.
   *
   * @param {ResizeObserverEntry[]} entries Entries reported by the observer (unused; sizes are re-measured directly from the DOM).
   */
  _onResize(entries) {
    if (!this.registry || this._isUpdatingDOM) return;

    const vh = this.viewport.clientHeight;
    const vw = this.viewport.clientWidth;
    const wasAtVEnd = this.verticalEnabled && Math.abs(this._virtualScrollTop - (this.registry.get_total_height() - vh)) < 1;
    const wasAtHEnd = this.horizontalEnabled && Math.abs(this._virtualScrollLeft - (this.registry.get_total_width() - vw)) < 1;

    const { rowMax, colMax } = this._measureRenderedSizes();
    if (this._applyMeasuredSizes(rowMax, colMax)) {
      if (wasAtVEnd) this._virtualScrollTop = Math.max(0, this.registry.get_total_height() - vh);
      if (wasAtHEnd) this._virtualScrollLeft = Math.max(0, this.registry.get_total_width() - vw);
      this.updateSpacer();
      this.syncTrackFromVirtual();
      this.calculateIndices();
    }
  }

  // --- CORE LOGIC & MATH ---

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
   *
   * @param {'vertical'|'horizontal'} axis Axis to resolve.
   * @returns {{track: HTMLElement, trackExtent: number, trackClientExtent: number, totalExtent: number}}
   *   The scrollbar track element, its scrollable extent (`scrollHeight`/`scrollWidth`),
   *   its visible client extent, and the total virtual extent for that axis.
   */
  _axis(axis) {
    return axis === 'vertical' ? {
      track: this.verticalTrack,
      trackExtent: this.verticalTrack.scrollHeight,
      trackClientExtent: this.verticalTrack.clientHeight,
      totalExtent: this.registry.get_total_height(),
    } : {
      track: this.horizontalTrack,
      trackExtent: this.horizontalTrack.scrollWidth,
      trackClientExtent: this.horizontalTrack.clientWidth,
      totalExtent: this.registry.get_total_width(),
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
    if (this.verticalEnabled && !this._isUpdatingDOM && !this._isDraggingVertical) {
      this._syncOneTrack('vertical', this._virtualScrollTop, this.viewport.clientHeight, this.verticalTrack, 'scrollTop');
    }
    if (this.horizontalEnabled && !this._isUpdatingDOM && !this._isDraggingHorizontal) {
      this._syncOneTrack('horizontal', this._virtualScrollLeft, this.viewport.clientWidth, this.horizontalTrack, 'scrollLeft');
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
      this._isProgrammaticScroll = true;
      this._isUpdatingDOM = true;
      trackEl[scrollProp] = targetScrollPos;
      this._isUpdatingDOM = false;

      clearTimeout(this._scrollMuteTimer);
      this._scrollMuteTimer = setTimeout(() => { this._isProgrammaticScroll = false; }, 40);
    }
  }

  /**
   * Resizes the vertical/horizontal spacer elements so each scrollbar track's
   * native scrollable extent matches the total virtual content size (capped at
   * {@link SAFE_MAX_HEIGHT}), which is what gives the native scrollbars their
   * correct thumb size/travel range. Skipped on an axis currently being dragged.
   */
  updateSpacer() {
    if (!this.registry) return;
    if (this.verticalEnabled && !this._isDraggingVertical) {
      this.verticalSpacer.style.height = `${Math.floor(Math.min(this.registry.get_total_height(), SAFE_MAX_HEIGHT))}px`;
    }
    if (this.horizontalEnabled && !this._isDraggingHorizontal) {
      this.horizontalSpacer.style.width = `${Math.floor(Math.min(this.registry.get_total_width(), SAFE_MAX_HEIGHT))}px`;
    }
  }

  /**
   * Core render-scheduling step: asks the WASM registry to compute the visible
   * row/column range and wrapper translation for the current scroll position
   * and viewport size, applies the (rounded) wrapper transform, dispatches the
   * `rangechange` event, and delegates DOM reconciliation to
   * {@link RunwayGrid#applyChanges}. No-op until a `template` and registry exist,
   * the enabled axes have a non-zero row/column count, and (for the very first
   * call) the viewport has been laid out at least once.
   */
  calculateIndices() {
    if (!this.renderItem || !this.registry) return;
    if (this.verticalEnabled && this.rowCount === 0) return;
    if (this.horizontalEnabled && this.colCount === 0) return;

    if (this.viewport.clientHeight === 0 && this.viewport.clientWidth === 0 && !this._initialLayoutDone) return;
    this._initialLayoutDone = true;

    const geometry = this.registry.compute_geometry(
        this._virtualScrollTop,
        this._virtualScrollLeft,
        this.viewport.clientHeight,
        this.viewport.clientWidth,
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
    this.dispatchEvent(rangeChangeEvent);
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
    this._isUpdatingDOM = true;

    try {
      while (this.renderedNodes.length > requiredRows) {
        const rowNodes = this.renderedNodes.pop();
        for (const el of rowNodes) { this.resizeObserver.unobserve(el); this.wrapper.removeChild(el); }
      }
      while (this.renderedNodes.length < requiredRows) this.renderedNodes.push([]);

      for (let r = 0; r < requiredRows; r++) {
        const rowNodes = this.renderedNodes[r];
        while (rowNodes.length > requiredCols) {
          const el = rowNodes.pop(); this.resizeObserver.unobserve(el); this.wrapper.removeChild(el);
        }
        while (rowNodes.length < requiredCols) {
          const el = document.createElement('div');
          el.classList.add('virtual-scroll__cell');
          el.setAttribute('part', 'cell');
          this.wrapper.appendChild(el);
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
      const fullRowWidth = this.viewport.clientWidth;

      for (let r = 0; r < requiredRows; r++) {
        const rowIndex = startRow + r;
        const rowTop = Math.round(this.registry.get_row_offset(rowIndex) - clampedScrollTop) - translateYRounded;

        for (let c = 0; c < requiredCols; c++) {
          const colIndex = startCol + c;
          const node = this.renderedNodes[r][c];

          node.style.top = `${rowTop}px`;
          node.style.left = `${Math.round(this.registry.get_col_offset(colIndex) - clampedScrollLeft) - translateXRounded}px`;
          node.style.width = this.horizontalEnabled ? '' : `${fullRowWidth}px`;

          const oldRow = node.getAttribute('data-row');
          const oldCol = node.getAttribute('data-col');
          if (oldRow === String(rowIndex) && oldCol === String(colIndex)) {
            this.resizeObserver.observe(node);
            continue;
          }

          node.setAttribute('data-row', rowIndex);
          node.setAttribute('data-col', colIndex);
          node.innerHTML = '';

          const newContent = this.renderItem(this.rows[rowIndex], rowIndex, colIndex, this.rowCount, this.colCount);
          if (typeof newContent === 'string') node.innerHTML = newContent;
          else if (newContent) node.appendChild(newContent);

          this.resizeObserver.observe(node);
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
   * Used to feed real content sizes back into the WASM registry for
   * auto-sizing rows/columns whose size wasn't explicitly fixed.
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
   * Feeds measured row heights/column widths (from {@link RunwayGrid#_measureRenderedSizes})
   * into the WASM registry, updating each axis's auto-measured sizes.
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
   * scrolled to (or very near) the end of the content: re-measures rendered
   * cells, applies any resulting size changes to the registry, and - if the
   * scroll position was at the end - re-snaps it to the newly recomputed end
   * position before re-rendering.
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
   * to its final measured position (re-measuring and re-applying sizes as
   * needed so that cells with auto/natural sizing don't leave the target
   * slightly out of view).
   *
   * @param {number} rowIndex Zero-based row index to scroll to.
   * @param {number} [colIndex=0] Zero-based column index to scroll to.
   */
  scrollToCell(rowIndex, colIndex = 0) {
    if (!this.registry) return;
    const vh = this.viewport.clientHeight, vw = this.viewport.clientWidth;
    rowIndex = this._clamp(rowIndex, 0, this.rowCount - 1);
    colIndex = this._clamp(colIndex, 0, this.colCount - 1);

    const position = () => {
      if (this.verticalEnabled) this._virtualScrollTop = this._clamp(this.registry.get_row_offset(rowIndex), 0, this.registry.get_total_height() - vh);
      if (this.horizontalEnabled) this._virtualScrollLeft = this._clamp(this.registry.get_col_offset(colIndex), 0, this.registry.get_total_width() - vw);
    };

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
  }

  /**
   * Shorthand for `scrollToCell(index, 0)`, for single-axis (vertical or
   * horizontal) lists.
   *
   * @param {number} index Zero-based row (vertical) or column (horizontal) index to scroll to.
   */
  scrollToIndex(index) { this.scrollToCell(index, 0); }

  // --- PROPERTIES ---

  /**
   * Which axis (or axes) are virtualized, from the `orientation` attribute.
   * Defaults to `'vertical'` for any unrecognized/missing value.
   * @returns {'vertical'|'horizontal'|'both'}
   */
  get orientation() { const v = this.getAttribute('orientation'); return v === 'horizontal' || v === 'both' ? v : 'vertical'; }

  /** @returns {boolean} Whether the vertical (row) axis is virtualized. */
  get verticalEnabled() { return this.orientation === 'vertical' || this.orientation === 'both'; }

  /** @returns {boolean} Whether the horizontal (column) axis is virtualized. */
  get horizontalEnabled() { return this.orientation === 'horizontal' || this.orientation === 'both'; }

  /** @returns {number} Number of rows currently known to the component (`1` when the vertical axis is disabled). */
  get rowCount() { return this.verticalEnabled ? (this.rows ? this.rows.length : 0) : 1; }

  /** @returns {number} Number of columns currently known to the component (`1` when the horizontal axis is disabled). */
  get colCount() { return this.horizontalEnabled ? (this._colCount || 1) : 1; }

  /** @returns {number} Initial/estimated row height in pixels, from the `row-size` (or legacy `item-size`) attribute. */
  get rowSize() { return parseInt(this.getAttribute('row-size') || this.getAttribute('item-size') || '20', 10); }

  /** @returns {number} Initial/estimated column width in pixels, from the `col-size` attribute. */
  get colSize() { return parseInt(this.getAttribute('col-size') || '100', 10); }

  /** @returns {number} Number of extra rows/columns rendered outside the visible viewport, from the `buffer-size` attribute. */
  get bufferSize() { return parseInt(this.getAttribute('buffer-size') || '5', 10); }

  /**
   * Sets the row data. (Re)builds the internal layout registry and resets the
   * scroll position back to the origin.
   * @param {Array<unknown>} newRows The row data array.
   */
  set data(newRows) { this.rows = newRows || []; this._virtualScrollTop = 0; this._virtualScrollLeft = 0; this.setupRegistry(); }

  /**
   * Non-destructively appends items to the existing data set, e.g. for infinite
   * scroll pagination. Unlike {@link RunwayGrid#data}/{@link RunwayGrid#columns},
   * this does not rebuild the WASM registry or reset the scroll position: new
   * default-sized rows/columns are pushed onto the registry's corresponding axis
   * (preserving every previously auto-measured row height/column width), the
   * spacer is resized so the native scrollbar track immediately reflects the new
   * virtual size, and the viewport stays locked at the user's current read position.
   *
   * For `orientation="horizontal"`, items are appended along the column axis
   * (mirroring {@link RunwayGrid#columns}, which is what drives `colCount` for a
   * horizontal list); for `orientation="vertical"`/`"both"`, items are appended
   * along the row axis (mirroring {@link RunwayGrid#data}).
   *
   * @param {Array<unknown>} newItems The rows (or, for `orientation="horizontal"`, columns) to append after the current data set.
   */
  appendData(newItems) {
    if (!newItems || !newItems.length) return;
    const count = newItems.length;

    if (this.orientation === 'horizontal') {
      this.columnsData = (this.columnsData || []).concat(newItems);
      this._colCount = this.columnsData.length;

      if (!this.registry) { this.setupRegistry(); return; }

      this.registry.append_cols(count, this.colSize);
    } else {
      this.rows = this.rows.concat(newItems);

      if (!this.registry) { this.setupRegistry(); return; }

      this.registry.append_rows(count, this.rowSize);
    }

    this.updateSpacer();
    this.calculateIndices();
  }

  /**
   * Non-destructively drops the first `count` items from the existing data set,
   * e.g. to cap memory usage ("sliding window") once an infinite-scroll list has
   * grown past some limit. Splices the removed items out of the JS-side array,
   * removes the matching slots from the WASM registry, and counter-scrolls the
   * viewport by the exact pixel amount that vanished - so the user never sees a
   * jump, even though the underlying array just shrank.
   *
   * For `orientation="horizontal"`, items are removed from the column axis
   * (mirroring {@link RunwayGrid#appendData}); for `orientation="vertical"`/`"both"`,
   * items are removed from the row axis. The `_virtualScrollTop`/`_virtualScrollLeft`
   * compensation, `updateSpacer()`, `syncTrackFromVirtual()`, and `calculateIndices()`
   * all happen synchronously in this same call, so the browser repaints the shifted
   * grid in a single frame with no visible jump.
   *
   * @param {number} count Number of items to remove from the head of the data set.
   */
  removeDataFromHead(count) {
    if (!count || count <= 0 || !this.registry) return;

    if (this.orientation === 'horizontal') {
      const removeCount = Math.min(count, this.columnsData ? this.columnsData.length : 0);
      if (removeCount <= 0) return;

      this.columnsData = this.columnsData.slice(removeCount);
      this._colCount = this.columnsData.length;

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
  }

  /**
   * Sets the column definitions, or a plain column count. Must be set before
   * `data` when using `orientation="horizontal"` or `orientation="both"`.
   * @param {Array<unknown>|number} colsOrCount An array of column definitions, or a column count.
   */
  set columns(colsOrCount) {
    if (Array.isArray(colsOrCount)) { this.columnsData = colsOrCount; this._colCount = colsOrCount.length || 1; }
    else { this.columnsData = null; this._colCount = parseInt(String(colsOrCount), 10) || 1; }
  }

  /**
   * Sets the cell rendering function, then immediately re-renders.
   * @param {(rowItem: unknown, rowIndex: number, colIndex: number, rowCount: number, colCount: number) => (string|Node|null|undefined)} renderFn
   *   Renders a single cell's content: return an HTML string (assigned via `innerHTML`) or a `Node` (appended as-is).
   */
  set template(renderFn) { this.renderItem = renderFn; this.calculateIndices(); }
}

if (!customElements.get('runway-grid')) {
  customElements.define('runway-grid', RunwayGrid);
}
