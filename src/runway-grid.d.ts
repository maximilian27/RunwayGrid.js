/**
 * A single row/column range (start inclusive, end exclusive).
 */
export interface RangeChangeCoordinates {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

/**
 * `rangechange` is fired on a `RunwayGrid` element whenever the range of
 * rendered rows/columns changes (e.g. after scrolling, resizing, or a
 * `data`/`columns`/`template` update). `buffered`/`viewport` are exposed as
 * two distinct coordinate groups directly on the event instance (not nested
 * under `detail`).
 */
export interface RangeChangeEvent extends Event {
  type: 'rangechange';
  /**
   * The buffered render range, including the off-screen `bufferSize` items on
   * each side. Ideal for triggering infinite-scroll data fetches before the
   * user hits the absolute bottom.
   */
  buffered: RangeChangeCoordinates;
  /**
   * The strict range excluding the buffer - only the indices actually
   * intersecting the visible pixels on screen. Ideal for visibility tracking.
   */
  viewport: RangeChangeCoordinates;
}

/**
 * Renders the content of a single cell.
 *
 * @param rowItem  The row's data entry (the element of the `data` array at `rowIndex`).
 * @param rowIndex Zero-based row index of the cell being rendered.
 * @param colIndex Zero-based column index of the cell being rendered.
 * @param rowCount Total number of rows currently known to the component.
 * @param colCount Total number of columns currently known to the component.
 * @returns An HTML string (assigned via `innerHTML`) or a `Node` (appended as-is).
 */
export type RunwayGridTemplate = (
  rowItem: unknown,
  rowIndex: number,
  colIndex: number,
  rowCount: number,
  colCount: number,
) => string | Node | null | undefined;

/**
 * `<runway-grid>` - a high-performance virtual scroll custom element for
 * rendering very large lists and 2D grids (millions of rows/columns) while
 * keeping the DOM small. Layout math is powered by a Rust/WebAssembly engine
 * embedded directly into this module.
 *
 * @fires rangechange - Fired whenever the range of rendered rows/columns changes.
 */
export declare class RunwayGrid extends HTMLElement {
  /**
   * One of `"vertical"` (default), `"horizontal"`, or `"both"`. Reflects the
   * `orientation` attribute and controls which axis (or both) is virtualized.
   */
  readonly orientation: 'vertical' | 'horizontal' | 'both';

  /** Whether the vertical (row) axis is virtualized, derived from `orientation`. */
  readonly verticalEnabled: boolean;

  /** Whether the horizontal (column) axis is virtualized, derived from `orientation`. */
  readonly horizontalEnabled: boolean;

  /** Number of rows currently known to the component. */
  readonly rowCount: number;

  /** Number of columns currently known to the component. */
  readonly colCount: number;

  /** Initial/estimated row height in pixels, from the `row-size` (or legacy `item-size`) attribute. */
  readonly rowSize: number;

  /** Initial/estimated column width in pixels, from the `col-size` attribute. */
  readonly colSize: number;

  /** Number of extra rows/columns rendered outside the visible viewport, from the `buffer-size` attribute. */
  readonly bufferSize: number;

  /**
   * The row data. Setting it (re)builds the internal layout registry and
   * resets the scroll position to the origin.
   */
  set data(rows: readonly unknown[]);

  /**
   * Non-destructively appends rows to the existing data set, e.g. for infinite
   * scroll pagination. Unlike setting `data`, this does not rebuild the
   * layout registry or reset the scroll position.
   *
   * @param newItems The rows to append after the current data set.
   */
  appendData(newItems: readonly unknown[]): void;

  /**
   * The column definitions, or a plain column count. Must be set before
   * `data` when using `orientation="horizontal"` or `orientation="both"`.
   */
  set columns(colsOrCount: readonly unknown[] | number);

  /** Renders a cell's content. See {@link RunwayGridTemplate}. */
  set template(renderFn: RunwayGridTemplate);

  /**
   * Scrolls so that the given row/column cell is visible, snapping precisely
   * to its final measured position.
   *
   * @param rowIndex Zero-based row index to scroll to.
   * @param colIndex Zero-based column index to scroll to (default `0`).
   */
  scrollToCell(rowIndex: number, colIndex?: number): void;

  /**
   * Shorthand for `scrollToCell(index, 0)`, for single-axis (vertical or
   * horizontal) lists.
   *
   * @param index Zero-based row (vertical) or column (horizontal) index to scroll to.
   */
  scrollToIndex(index: number): void;

  addEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (this: RunwayGrid, ev: HTMLElementEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: 'rangechange',
    listener: (this: RunwayGrid, ev: RangeChangeEvent) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;

  removeEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (this: RunwayGrid, ev: HTMLElementEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: 'rangechange',
    listener: (this: RunwayGrid, ev: RangeChangeEvent) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare global {
  interface HTMLElementTagNameMap {
    'runway-grid': RunwayGrid;
  }

  interface HTMLElementEventMap {
    rangechange: RangeChangeEvent;
  }
}
