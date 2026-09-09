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
</script>
```

The `<runway-grid>` element must be given an explicit size (e.g. `height`/`width` via CSS) since it virtualizes its content within its own viewport.

See the [`demo/`](./demo) folder for complete, runnable examples of all five usage patterns (vertical list, 2D grid, horizontal list, and infinite scroll - both vertical and horizontal - with variable row/column sizes).

## Attributes

| Attribute      | Default    | Description                                                                                   |
|----------------|------------|-----------------------------------------------------------------------------------------------|
| `orientation`  | `vertical` | One of `vertical`, `horizontal`, or `both`. Controls which axis (or both) is virtualized.      |
| `row-size`     | `20`       | Initial/estimated row height in pixels, used before a row's real height is auto-measured.      |
| `col-size`     | `100`      | Initial/estimated column width in pixels, used before a column's real width is auto-measured.  |
| `buffer-size`  | `5`        | Number of extra rows/columns rendered outside the visible viewport, to reduce blank flashes.   |

## Properties

| Property   | Type                                                                 | Description                                                                                                   |
|------------|-----------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| `data`     | `Array`                                                                | The row data. Setting it (re)builds the internal layout registry.                                              |
| `columns`  | `Array \| number`                                                     | The column definitions (or a plain column count). Must be set before `data` when using `horizontal`/`both`.    |
| `template` | `(rowItem, rowIndex, colIndex, rowCount, colCount) => string \| Node`  | Renders a cell's content. Returning a `string` sets `innerHTML`; returning a `Node` appends it.                 |

## Methods

| Method                             | Description                                                                                     |
|-------------------------------------|---------------------------------------------------------------------------------------------------|
| `scrollToCell(rowIndex, colIndex)`  | Scrolls so that the given row/column cell is visible, snapping precisely.                          |
| `scrollToIndex(index)`              | Shorthand for `scrollToCell(index, 0)`, for single-axis lists.                                     |
| `appendData(newItems)`              | Non-destructively appends rows (or columns, for `orientation="horizontal"`), e.g. for infinite scroll, without resetting the scroll position. |

## Events

| Event         | Properties                              | Description                                                                                                                                                        |
|---------------|-------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `rangechange` | `e.buffered`, `e.viewport`                | Fired whenever the rendered range changes. `buffered` (`{ startRow, endRow, startCol, endCol }`) includes the off-screen buffer; `viewport` is the strict on-screen range. Both are exposed directly on the event, not under `e.detail`. |

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
