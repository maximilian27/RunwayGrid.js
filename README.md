# runway-grid

A high-performance virtual scroll `<runway-grid>` custom element for rendering very large lists and 2D grids (millions of rows/columns) while keeping the DOM small. The layout math is powered by a Rust/WebAssembly engine (`runway_engine`), compiled and embedded directly into the published JavaScript - no separate `.wasm` file to host or fetch.

Supports:
- Vertical lists (single column, variable row heights)
- Horizontal lists (single row, variable column widths)
- 2D grids with independent vertical + horizontal panning (variable row heights and column widths)

## Installation

```sh
npm install runway-grid
```

## Usage

```js
import 'runway-grid';
```

```html
<runway-grid id="my-list" orientation="vertical" row-size="20" buffer-size="5"></runway-grid>

<script type="module">
  const list = document.getElementById('my-list');

  // Template signature: (rowItem, rowIndex, colIndex, rowCount, colCount)
  list.template = (item, index) => `<div style="padding: 10px;">${item}</div>`;

  // Setting `data` triggers (re)creation of the underlying registry.
  list.data = Array.from({ length: 1_000_000 }, (_, i) => `Item ${i}`);

  list.addEventListener('rangechange', (e) => {
    console.log(`Rendering rows ${e.buffered.startRow} to ${e.buffered.endRow}`);
  });

  // Fired if the embedded WASM engine fails to initialize (unsupported browser, a CSP
  // blocking instantiation of the atob-decoded binary, a corrupt build, etc.) - without a
  // listener like this, the component just silently never renders. See "Error handling" below.
  list.addEventListener('wasmerror', (e) => {
    console.error('runway-grid failed to initialize, falling back to a plain list:', e.detail.error);
  });
</script>
```

The `<runway-grid>` element must be given an explicit size (e.g. `height`/`width` via CSS) since it virtualizes its content within its own viewport.

See the [`demo/`](./demo) folder for complete, runnable examples of all seven usage patterns (vertical list, 2D grid, horizontal list, infinite scroll - both vertical and horizontal - with variable row/column sizes, and infinite scroll with a memory-capped sliding window - both vertical and horizontal).

### Browser support

`runway-grid` relies on Custom Elements, Shadow DOM, `ResizeObserver`, and WebAssembly - all
broadly supported in modern evergreen browsers (recent Chrome/Edge/Firefox/Safari), but there is
**no IE11 support** and no polyfills/fallbacks are bundled.

## Attributes

Attributes are only read once, when the element is constructed/connected (there is no
`attributeChangedCallback`); changing them afterwards has no clean, consistent effect. In
practice: `buffer-size` is actually re-read on every scroll/resize, so changing it later does
take effect on the next render; `row-size`/`col-size` are re-read for keyboard-scroll increments
and as the default size for newly `appendData`-ed rows/columns, but never retroactively resize
rows/columns that already exist; changing `orientation` after creation does **not** rebuild the
underlying registry and will leave it in an inconsistent state. If you need to change any of
these, recreate the element instead of mutating its attributes in place.

| Attribute      | Default    | Description                                                                                   |
|----------------|------------|-----------------------------------------------------------------------------------------------|
| `orientation`  | `vertical` | One of `vertical`, `horizontal`, or `both`. Controls which axis (or both) is virtualized.      |
| `row-size`     | `20`       | Initial/estimated row height in pixels, used before a row's real height is auto-measured. Falls back to the legacy `item-size` attribute (deprecated - use `row-size` instead) if `row-size` is absent. |
| `col-size`     | `100`      | Initial/estimated column width in pixels, used before a column's real width is auto-measured.  |
| `buffer-size`  | `5`        | Number of extra rows/columns rendered outside the visible viewport, to reduce blank flashes.   |

## Properties

| Property   | Type                                                                 | Description                                                                                                   |
|------------|-----------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| `data`             | `Array`                                                                | The row data. Setting it (re)builds the internal layout registry.                                              |
| `columns`          | `Array \| number`                                                     | The column definitions (or a plain column count). Must be set before `data` when using `horizontal`/`both`.    |
| `template`         | `(rowItem, rowIndex, colIndex, rowCount, colCount) => string \| Node`  | Renders a cell's content. Returning a `string` sets `innerHTML`; returning a `Node` appends it. **See the "Security: `innerHTML` and XSS" section below.** |
| `rows`             | `Array` (readonly)                                                     | The row data currently held internally, as set via `data` or grown/shrunk via `appendData`/`removeDataFromHead`. |
| `columnsData`      | `Array \| null` (readonly)                                            | The column definitions currently held internally (as set via `columns`), or `null` when `columns` was set to a plain count. |
| `rowCount`         | `number` (readonly)                                                    | Number of rows currently known to the component - the reliable way to read the loaded row count (`rows.length` when the vertical axis is enabled, `1` otherwise). |
| `colCount`         | `number` (readonly)                                                    | Number of columns currently known to the component - the reliable way to read the loaded column count (`1` when the horizontal axis is disabled). |
| `wasmInitialized`  | `boolean` (readonly)                                                   | Whether the shared embedded WASM engine finished initializing successfully.                                     |
| `wasmInitError`    | `unknown` (readonly)                                                   | The error caught while initializing the WASM engine, or `null` if it hasn't failed. Also available as `e.detail.error` on the `wasmerror` event. |

## Methods

| Method                             | Description                                                                                     |
|-------------------------------------|---------------------------------------------------------------------------------------------------|
| `scrollToCell(rowIndex, colIndex)`  | Scrolls so that the given row/column cell is visible, snapping precisely.                          |
| `scrollToIndex(index)`              | Shorthand for `scrollToCell(index, 0)`, for single-axis lists.                                     |
| `appendData(newItems)`              | Non-destructively appends rows (or columns, for `orientation="horizontal"`), e.g. for infinite scroll, without resetting the scroll position. |
| `removeDataFromHead(count)`         | Non-destructively drops the first `count` rows (or columns, for `orientation="horizontal"`), e.g. to cap memory usage for a "sliding window" list, counter-scrolling so nothing jumps. |

## Events

| Event         | Properties                              | Description                                                                                                                                                        |
|---------------|-------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `rangechange` | `e.buffered`, `e.viewport`                | Fired whenever the rendered range changes. `buffered` (`{ startRow, endRow, startCol, endCol }`) includes the off-screen buffer; `viewport` is the strict on-screen range. Both are exposed directly on the event, not under `e.detail`. |
| `wasmerror`   | `e.detail.error`                          | Fired if the embedded WASM engine fails to initialize (unsupported browser, CSP blocking `atob`-decoded binary instantiation, corrupt/incompatible build, etc.). The component never renders in this case; without a listener the failure would otherwise be an unhandled promise rejection with no visible fallback. See "Error handling" below. |

## Error handling

On construction, every `<runway-grid>` element asynchronously initializes the shared embedded
WASM engine (`initWasm()`). This can fail - e.g. in a browser without WebAssembly support, when
a Content-Security-Policy blocks instantiating the `atob`-decoded binary, or if the embedded
build is somehow corrupt/incompatible. That failure is caught internally (so it never surfaces
as an unhandled promise rejection), and instead:

- `wasmInitError` is set to the caught error (readable any time afterwards).
- A `wasmerror` event is dispatched, with the error available as `e.detail.error`.

Without a `wasmerror` listener, a failed component simply never renders and stays empty - so
for any production usage, listen for it and render a fallback (e.g. a plain, non-virtualized
list, or an error message) instead of leaving the user with a blank element:

```js
list.addEventListener('wasmerror', (e) => {
  // e.g. render `list.data` as a plain, non-virtualized <ul> here.
  console.error('runway-grid failed to initialize:', e.detail.error);
});
```

## Security: `innerHTML` and XSS

When a `template` function returns a `string`, it is assigned to the cell's `innerHTML` -
**not** escaped or treated as plain text. If that string interpolates any value that can be
influenced by an untrusted source (user-submitted text, data from a third-party API, URL
parameters, etc.), this is a **cross-site scripting (XSS) vulnerability**: an attacker-controlled
value such as `<img src=x onerror=alert(1)>` would execute as HTML/JS in the page.

The [`demo/`](./demo) folder demonstrates the safe pattern: it defines a small `escapeHtml()`
helper and runs every interpolated data-derived string (e.g. `${item}` in demo 1's baseline row)
through it before interpolating it into a template string. When `rowItem` (or any derived value)
may contain untrusted content, either:

- Escape it before interpolating (e.g. replace `&`, `<`, `>`, `"`, `'` with their HTML entities), or
- Avoid `innerHTML` entirely: build and return a `Node`/`DocumentFragment` instead, setting
  untrusted text via `textContent` (which is never parsed as HTML).

## TypeScript

`runway-grid` is authored in plain JavaScript, but ships a hand-written declaration file (`dist/runway-grid.d.ts`, wired up via `package.json`'s `types`/`exports.types` fields) describing the `RunwayGrid` class, its attributes/properties/methods, the `rangechange` event's `buffered`/`viewport` properties, and the `<runway-grid>` tag itself (via `HTMLElementTagNameMap`), so `document.createElement('runway-grid')`/`querySelector('runway-grid')` and `import { RunwayGrid } from 'runway-grid'` are fully typed out of the box - no `@types/*` package needed.

For contributors: `npm run typecheck` runs TypeScript (`tsc`, via a `tsconfig.json` with `allowJs`/`checkJs`) directly over `src/*.js`, using the JSDoc comments already on `src/runway-grid.js` as type annotations. This doesn't generate or replace `dist/runway-grid.d.ts` - it's a safety net that flags places where the implementation and its JSDoc types have drifted apart, so it should be run (and kept clean) after changing `src/runway-grid.js`.

## Styling

The component renders into a closed-off shadow tree, so page-level CSS can't reach inside by default. Two standard mechanisms are exposed for customization:

- **[CSS Shadow Parts](https://developer.mozilla.org/en-US/docs/Web/CSS/::part)** (`::part()`) - target specific internal elements from your page's stylesheet:

  | Part               | Element                                            |
  |---------------------|-----------------------------------------------------|
  | `container`         | Outer flex container                                |
  | `viewport`          | Scrollable viewport hosting rendered cells           |
  | `wrapper`           | Translated wrapper positioning the rendered cells    |
  | `cell`              | Each individual rendered cell                        |
  | `track`             | Both scrollbar tracks (vertical + horizontal)        |
  | `track-vertical`    | The vertical scrollbar track only                    |
  | `track-horizontal`  | The horizontal scrollbar track only                  |
  | `spacer`            | Both scrollbar spacers (vertical + horizontal)       |
  | `spacer-vertical`   | The vertical scrollbar spacer only                   |
  | `spacer-horizontal` | The horizontal scrollbar spacer only                 |

  ```css
  runway-grid::part(cell) { border-bottom: 1px solid #eee; }
  runway-grid::part(track) { background: #f5f5f5; }
  runway-grid::part(track-vertical) { background: #eaeaea; }
  ```

- **CSS custom properties** - for simple numeric theming that pierces the shadow boundary natively:

  | Property                        | Default | Description                                            |
  |----------------------------------|---------|----------------------------------------------------------|
  | `--runway-grid-scrollbar-size`  | `10px`  | Width of the vertical track / height of the horizontal track. |

  ```css
  runway-grid { --runway-grid-scrollbar-size: 6px; }
  ```

## License

[Apache-2.0](./LICENSE)
