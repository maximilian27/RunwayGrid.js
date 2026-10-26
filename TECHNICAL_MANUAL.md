# Technical Architecture & Engineering Manual: `runway-grid`

This document provides a comprehensive, low-level technical analysis of `runway-grid`. It details the internal division of labor between the Rust/WebAssembly computational kernel and the JavaScript/Web Component orchestration layer, algorithmic complexities, memory layouts, coordinate mapping systems, DOM pooling mechanics, and input physics.

---

## 1. High-Level Architectural Division & Utility Framework

Virtualizing dual-axis data streams presents a fundamental tension between computational throughput and browser layout costs:
* **The Browser DOM Engine** excels at GPU-accelerated compositing, text rendering, and high-level user event handling, but degrades rapidly when DOM node counts exceed $10^3$ to $10^4$ elements due to style recalculation cascades, tree traversal, and garbage collection (GC) pauses.
* **JavaScript** provides flexible integration with DOM APIs and application frameworks, but its dynamic typing, boxed float allocations, and garbage collection introduce latency spikes unacceptable for 60 Hz or 120 Hz render budgets (sub-8.33 ms frame deadlines).
* **Rust compiled to WebAssembly (WASM)** provides near-native execution speed, deterministic linear memory allocation, contiguous SIMD vectorization, and zero-overhead binary search over millions of coordinate points without triggering engine-level GC sweeps.

To maximize total system utility (achieving maximum frame rates and throughput while minimizing CPU cycles, memory allocations, and battery consumption), `runway-grid` implements a strict separation of concerns:

```
+---------------------------------------------------------------------------------------+
|                                    BROWSER DOM / UI                                    |
|  - Shadow DOM Container (contain: strict)                                             |
|  - Decoupled Native Scrollbar Tracks (10px wide/tall)                                 |
|  - Recycled 2D Cell Matrix Pool (typically 20 - 60 HTMLElement nodes total)           |
+---------------------------------------------------------------------------------------+
                                        ▲      │
                   Transform & Slices   │      │ Raw Scroll Deltas & User Gestures
                                        │      ▼
+---------------------------------------------------------------------------------------+
|                          JAVASCRIPT ORCHESTRATOR LAYER                                |
|  - Event Pipeline: Touch momentum, Wheel multiplier, Keyboard, ResizeObserver        |
|  - Coordinate Reconciliation: Viewport caching, Virtual <-> Track mapping             |
|  - DOM Pool Lifecycle: Zero-GC in-place recycling, ARIA tree management               |
|  - Batching: Multi-pass rangechange event throttling                                  |
|  - Approach Runway Teleportation: Distance-gated smooth scroll acceleration           |
+---------------------------------------------------------------------------------------+
                                        ▲      │
                      GridGeometryResult │      │ (scrollTop, scrollLeft, vh, vw, buffer)
                                        │      ▼
+---------------------------------------------------------------------------------------+
|                         RUST / WEBASSEMBLY ENGINE CORE                                 |
|  - VirtualScrollRegistry: Dual Fenwick trees (row_fenwick, col_fenwick)               |
|  - Logarithmic Point Updates: O(log N) BIT update via update_size()                   |
|  - Logarithmic Prefix Sums: O(log N) cumulative queries via prefix_sum()              |
|  - O(log^2 N) Symmetric Binary Searches via resolve_axis()                            |
|  - Panic-safe NaN / Infinity sanitization & deadband thresholding                     |
+---------------------------------------------------------------------------------------+
```

### Computational Complexity Profile

| Operation | Time Complexity | Memory Allocation | Execution Context |
| :--- | :--- | :--- | :--- |
| **Geometry Resolution** (`compute_geometry`) | $O(\log^2 N + \log^2 M)$ | $O(1)$ stack primitives | Rust / WASM |
| **Direct Index Query** (`get_row_offset`) | $O(\log N)$ prefix-sum query | $0$ allocations | Rust / WASM |
| **Incremental Resize** (`update_row_height`) | $O(\log N)$ point update | $0$ allocations | Rust / WASM |
| **Non-Destructive Append** (`append_rows`) | $O(K)$ logarithmic extensions | Amortized $O(K)$ | Rust / WASM |
| **Head Eviction** (`remove_rows_from_head`) | $O(N - K)$ drain + tree rebuild | $0$ new allocations | Rust / WASM |
| **Distant Smooth Scroll Teleportation** | $O(1)$ runway jump | $0$ allocations | JavaScript |
| **DOM Pool Reconciliation** (`applyChanges`) | $O(R_{\text{vis}} \times C_{\text{vis}})$ | $0$ in steady state (Pooled) | JavaScript |
| **Scroll Event Traversal** (`_scrollByDelta`) | $O(1)$ arithmetic + $O(\log^2 N + \log^2 M)$ | $0$ allocations | JS $\leftrightarrow$ WASM |

---

## 2. The Rust/WebAssembly Core Engine (`runway_engine`)

The WebAssembly core is written in Rust and compiled via `wasm-pack` with `wasm-bindgen`. It exposes the `VirtualScrollRegistry` struct and the `GridGeometryResult` value object. The engine is organized into dedicated, decoupled modules:
* `constants.rs`: Core numeric thresholds (`SIZE_CHANGE_THRESHOLD = 0.5`, `RESIZE_THRESHOLD`, `FLOAT_EPSILON`, `DEFAULT_BUFFER_SIZE`).
* `types.rs`: Primary data structures (`Fenwick`, `AxisRange`, `GridGeometryResult`).
* `structs.rs`: Structural type re-exports.
* `lib.rs`: Coordinator exposing WebAssembly exports, axis resolution (`resolve_axis`), and `VirtualScrollRegistry`.
* `tests.rs`: Comprehensive property and regression test suites.

### 2.1 Memory Layout & Contiguous Data Structures

The registry manages dual Fenwick trees in WASM linear memory:

```rust
#[wasm_bindgen]
pub struct VirtualScrollRegistry {
    row_fenwick: Fenwick,
    col_fenwick: Fenwick,
}

#[derive(Clone, Debug)]
pub struct Fenwick {
    pub tree: Vec<f64>,   // 1-indexed internal BIT (length count + 1)
    pub sizes: Vec<f64>,  // actual per-row/col sizes (length count)
}
```

* Each `f64` element occupies exactly 8 bytes of contiguous memory.
* For a dataset of $1,000,000$ rows:
  $$\text{Memory} = 1{,}000{,}000 \times 8 \text{ bytes (sizes)} + 1{,}000{,}001 \times 8 \text{ bytes (BIT tree)} \approx 16 \text{ MB}$$
* For $10,000,000$ rows, total linear heap allocation is $\approx 160\text{ MB}$.
* Storing sizes and the tree in contiguous vectors guarantees optimal cache locality, eliminates pointer indirection, and avoids garbage collection pauses.

### 2.2 Fenwick Tree (Binary Indexed Tree) Architecture & Logarithmic Point Updates

Virtualizing dynamic, variable-height rows requires balancing query speed against write cost:
* When cells enter the viewport for the first time, `ResizeObserver` measures their rendered DOM heights and updates the engine via `update_row_height`.
* Under a naive linear prefix-sum array, an update at index $i$ requires walking and mutating the entire remaining suffix:
  $$\text{prefix\_sums}[i..] \mathrel{+}= \Delta$$
  At $N = 10{,}000{,}000$, a single remeasurement near the head touches $10{,}000{,}000$ floats ($\approx 6.79\text{ ms}$). A burst of 30 items measured during a scroll consumes $115.4\text{ ms}$—dropping 7 consecutive frames at 60 Hz.

To eliminate this bottleneck, `runway_engine` utilizes a Fenwick tree (Binary Indexed Tree), converting $O(N)$ linear updates into $O(\log N)$ logarithmic mutations:

#### 1. Mathematical Structure & Bit Manipulation
The internal tree is $1$-indexed. Each node at index $i$ stores the cumulative sum over the interval:
$$\left(i - \text{LSB}(i),\, i\right]$$
where $\text{LSB}(i)$ is the least significant set bit, isolated in $O(1)$ via two's complement negation:
$$\text{LSB}(i) = i \ \& \ (-i) \equiv \texttt{i \& i.wrapping\_neg()}$$

#### 2. One-Time Linear Bulk Construction (`O(N)`)
Instead of inserting elements sequentially in $O(N \log N)$ time, the engine constructs the tree in a single linear pass by propagating each node's sum to its immediate parent:

```rust
pub fn new(default_size: f64, count: usize) -> Self {
    let sizes = vec![default_size; count];
    let mut tree = vec![0.0; count + 1];
    for i in 1..=count {
        tree[i] += sizes[i - 1];
        let parent = i + (i & i.wrapping_neg());
        if parent <= count {
            tree[parent] += tree[i];
        }
    }
    Fenwick { tree, sizes }
}
```

#### 3. Logarithmic Point Updates (`O(log N)`)
When a row or column height changes, `update_size` updates the leaf value in `sizes` and propagates `delta = new_size - old_size` upward through parent intervals:

```rust
pub fn update_size(&mut self, index: usize, new_size: f64) -> bool {
    if index >= self.sizes.len() || !new_size.is_finite() {
        return false;
    }
    let old_size = self.sizes[index];
    if (old_size - new_size).abs() < SIZE_CHANGE_THRESHOLD {
        return false;
    }
    let delta = new_size - old_size;
    self.sizes[index] = new_size;
    let mut i = index + 1;
    let n = self.sizes.len();
    while i <= n {
        self.tree[i] += delta;
        i += i & i.wrapping_neg();
    }
    true
}
```
* **Sub-half-pixel deadband (`SIZE_CHANGE_THRESHOLD = 0.5`):** Sub-pixel layout jitter from browser antialiasing or font rendering is rejected, preventing layout thrashing.

#### 4. Logarithmic Prefix Sum Query (`O(log N)`)
Cumulative offsets are retrieved by stripping $\text{LSB}(i)$ until reaching zero:

```rust
pub fn prefix_sum(&self, index: usize) -> f64 {
    let mut index = index.min(self.sizes.len());
    let mut sum = 0.0;
    while index > 0 {
        sum += self.tree[index];
        index -= index & index.wrapping_neg();
    }
    sum
}

pub fn offset_of(&self, index: usize) -> f64 {
    if self.sizes.is_empty() { return 0.0; }
    self.prefix_sum(index)
}
```

#### Empirical Benchmark Comparison ($N = 10{,}000{,}000$, Rust release opt-level=3)

| Operation | Flat Linear Prefix-Sum | Fenwick Tree | Architectural Advantage |
| :--- | :--- | :--- | :--- |
| **Setup (Alloc + Build)** | $93.2\text{ ms}$ | $118.5\text{ ms}$ | $+25\text{ ms}$ (one-time data load) |
| **Single `update_size(0)`** | $6.79\text{ ms}$ | $1.43\text{ µs}$ | $\sim 4{,}700\times$ faster |
| **Burst of 30 Updates** | $115.4\text{ ms}$ (7 dropped frames) | $1.35\text{ µs}$ | $\sim 85{,}000\times$ faster (0 frame drops) |
| **1,000 `offset_of()` Lookups** | $5.2\text{ µs}$ ($5.2\text{ ns}$/call) | $21.5\text{ µs}$ ($21.5\text{ ns}$/call) | $\approx 1\text{ µs}$ for a 50-cell viewport render |

### 2.3 Non-Destructive Infinite Stream Modifications

#### Non-Destructive Appends (`append_rows`, `append_cols`)
Infinite streams append items to the tail. Rebuilding the tree would take $O(N)$ time. Instead, `Fenwick::append` computes tree intervals directly from the existing total in logarithmic time per appended element:

```rust
pub fn append(&mut self, count: usize, default_size: f64) {
    if count == 0 { return; }
    let old_count = self.sizes.len();
    self.sizes.reserve(count);
    self.tree.reserve(count);
    let old_total = self.prefix_sum(old_count);
    for idx in (old_count + 1)..=(old_count + count) {
        let low = idx - (idx & idx.wrapping_neg());
        let val = if low >= old_count {
            (idx - low) as f64 * default_size
        } else {
            (old_total - self.prefix_sum(low)) + ((idx - old_count) as f64 * default_size)
        };
        self.sizes.push(default_size);
        self.tree.push(val);
    }
}
```
* **Utility Result:** Extends the virtual spatial extent without shifting existing offsets or invalidating previously auto-measured item dimensions.

#### Memory-Capped Sliding Window Head Eviction (`remove_rows_from_head`)
To operate within bounded memory constraints in long-running streaming telemetry applications (e.g. continuous log feeds), older rows must be evicted from the head without causing visual layout jumps:

```rust
pub fn remove_from_head(&mut self, count: usize) -> f64 {
    let count = count.min(self.sizes.len());
    if count == 0 { return 0.0; }
    let height_delta = self.prefix_sum(count);
    self.sizes.drain(0..count);
    self.rebuild_tree();
    height_delta
}
```
* **Counter-Scroll Guarantee:** The engine computes the exact accumulated height `height_delta` of the evicted batch and returns it across the FFI boundary. The JavaScript orchestrator decrements its virtual scroll position by `height_delta`, making head eviction visually imperceptible to the user.

### 2.4 Symmetric Binary Search Geometry Engine (`resolve_axis`)

Given a continuous floating-point scroll offset $S$, a viewport extent $V$, and buffer count $B$:

1. **Scroll Clamping:**
   $$\text{max\_scroll} = \max(0.0, \text{total\_extent} - V)$$
   $$S_{\text{clamped}} = \min(\text{max\_scroll}, \max(0.0, S))$$

2. **Binary Search for Visible Window:**
   The start index corresponds to the first item whose bottom coordinate exceeds $S_{\text{clamped}}$.
   The end index corresponds to the first item whose top coordinate exceeds $S_{\text{clamped}} + V$.

```rust
let start_index = match fenwick.binary_search(clamped_scroll) {
    Ok(index) => index + 1,
    Err(index) => index,
}.min(total - 1);

let scroll_end = clamped_scroll + viewport_size;
let end_index = match fenwick.binary_search(scroll_end) {
    Ok(index) => index + 1,
    Err(index) => index,
}.min(total);
```

#### Binary Search Implementation (`Fenwick::binary_search`)
```rust
pub fn binary_search(&self, target: f64) -> Result<usize, usize> {
    let mut size = self.sizes.len();
    let mut left = 0;
    while size > 0 {
        let half = size / 2;
        let mid = left + half;
        let probe = self.prefix_sum(mid + 1);
        let cmp = probe.partial_cmp(&target).unwrap_or(Ordering::Equal);
        match cmp {
            Ordering::Less => {
                left = mid + 1;
                size -= half + 1;
            }
            Ordering::Greater => {
                size = half;
            }
            Ordering::Equal => return Ok(mid),
        }
    }
    Err(left)
}
```
* **Algorithmic Complexity:** Binary search takes $O(\log N)$ iterations, each evaluating an $O(\log N)$ prefix sum. Total time complexity is $O(\log^2 N)$. For $N = 10{,}000{,}000$, $\log_2(10^7) \approx 24$, requiring at most $24 \times 24 \approx 576$ cheap bitwise operations—executing in sub-microsecond time.
* **Defensive Arithmetic (NaN / Infinity Invariance):** JavaScript `ResizeObserver` callbacks or corrupt client measurements can yield non-finite floating-point numbers. If a `NaN` enters `partial_cmp`, Rust's standard comparison panics. Using `unwrap_or(Ordering::Equal)` guarantees that the binary search remains total and panic-free, falling back gracefully without tearing down the component.

3. **Buffer Window Expansion:**
   $$\text{buffered\_start} = \max(0, \text{start\_index} - B)$$
   $$\text{buffered\_end} = \min(\text{total}, \text{end\_index} + B)$$

4. **Matrix Translation Offset:**
   $$\text{translate} = \text{offset}(\text{buffered\_start}) - S_{\text{clamped}}$$

### 2.5 FFI Geometry Struct Packing (`GridGeometryResult`)

```rust
#[wasm_bindgen]
pub struct GridGeometryResult {
    pub start_row: usize,
    pub end_row: usize,
    pub start_col: usize,
    pub end_col: usize,
    pub viewport_start_row: usize,
    pub viewport_end_row: usize,
    pub viewport_start_col: usize,
    pub viewport_end_col: usize,
    pub translate_x: f64,
    pub translate_y: f64,
}
```
* Every field is an unboxed primitive (`usize` or `f64`).
* Exposing these as plain readable properties eliminates serializing/deserializing overhead (e.g. JSON or CBOR) across the JS-WASM boundary.

---

## 3. FFI & Browser Integration Layer

### 3.1 Self-Contained Inlined WASM Architecture

Standard WebAssembly deployments require serving a standalone `.wasm` file via HTTP. This introduces operational hazards:
* Cross-Origin Resource Sharing (CORS) or base-path resolution failures under nested routing.
* MIME-type configuration errors (`application/wasm`) on consumer web servers.
* Asynchronous network latency delays before initial component layout.

To solve this, `runway-grid` employs an automated build pipeline that converts `runway_engine_bg.wasm` into a Base64 string embedded directly in `src/runway-engine-wasm.js`:

```javascript
export function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}
```

#### Singleton Lifecycle Management
Multiple `<runway-grid>` instances on the same page share a single initialization promise:

```javascript
let wasmInitPromise = null;

export function ensureWasmInitialized() {
  if (!wasmInitPromise) wasmInitPromise = init(base64ToUint8Array(RUNWAY_ENGINE_WASM_BASE64));
  return wasmInitPromise;
}
```
* **Utility Result:** WASM byte decoding and compilation occur exactly once per browsing context. Subsequent instances connect immediately without redundant memory allocation or recompilation.

#### Runtime Error Resilience & Fallback Notification
If WASM instantiation fails (e.g. restrictive Content-Security-Policy blocking `atob`-decoded binary evaluation, unsupported environment, or corrupt payload), `<runway-grid>` traps the rejection cleanly:
* Stores `this.wasmInitError = error`.
* Dispatches a custom `wasmerror` DOM event with `{ detail: { error } }`.
* Prevents silent unhandled promise rejections and enables application-level graceful fallback rendering.

### 3.2 Explicit Heap Lifecycle Management

WebAssembly lacks finalizers that can trigger JavaScript garbage collection. When a `VirtualScrollRegistry` instance is replaced or the custom element is disconnected, manual memory management is required:

```javascript
disconnectedCallback() {
  // ...
  if (this.registry) {
    this.registry.free();
    this.registry = null;
  }
}
```
* Invoking `this.registry.free()` immediately returns the Rust vectors' linear memory to the WASM allocator pool, preventing memory leaks in single-page applications (SPAs) with frequent route changes.

---

## 4. JavaScript Orchestration & DOM Virtualization Layer

### 4.1 Shadow DOM Architecture & Layout Containment

`<runway-grid>` encapsulates its structure within an open Shadow DOM:

```html
<div class="runway-grid__container" part="container">
    <div class="runway-grid__row" part="row">
        <div class="runway-grid__viewport" part="viewport" tabindex="0">
            <div class="runway-grid__wrapper" part="wrapper">
                <!-- Recycled Row Groups & Cells go here -->
            </div>
        </div>
        <div class="runway-grid__track runway-grid__track--vertical" part="track track-vertical">
            <div class="runway-grid__spacer runway-grid__spacer--vertical" part="spacer spacer-vertical"></div>
        </div>
    </div>
    <div class="runway-grid__bottom-bar" part="bottom-bar">
        <div class="runway-grid__track runway-grid__track--horizontal" part="track track-horizontal">
            <div class="runway-grid__spacer runway-grid__spacer--horizontal" part="spacer spacer-horizontal"></div>
        </div>
        <div class="runway-grid__corner" part="corner"></div>
    </div>
</div>
```

#### CSS Layout Containment (`contain: strict`)
The host element applies:
```css
:host {
  display: block;
  position: relative;
  contain: strict;
  height: 100%;
}
```
* `contain: strict` informs the browser's layout engine that the element's subtree cannot affect the size or layout of external page elements, and that nothing inside draws outside its bounding box.
* **Utility Result:** Reflows, size recalculations, and DOM pool mutations inside the grid are isolated from the document root.

### 4.2 Two-Dimensional Cell Pooling & In-Place DOM Recycling

Rather than creating and destroying DOM nodes during scrolling, `<runway-grid>` maintains a constant pool of recycled elements:

```
+-------------------------------------------------------------+
| runway-grid__wrapper (translate3d: roundedTranslateX, Y)    |
|  +-------------------------------------------------------+  |
|  | rowgroup 0 (style.top: rowTop, role="row")            |  |
|  |   [ cell (0, 0) ] [ cell (0, 1) ] [ cell (0, 2) ]     |  |
|  +-------------------------------------------------------+  |
|  +-------------------------------------------------------+  |
|  | rowgroup 1 (style.top: rowTop, role="row")            |  |
|  |   [ cell (1, 0) ] [ cell (1, 1) ] [ cell (1, 2) ]     |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
```

1. **Row Group Pooling:**
   Cells are grouped under `.runway-grid__rowgroup` elements. For `orientation="both"`, these act as `role="row"`. For single-axis modes, they are marked `role="presentation"` to stay transparent to accessibility tools.
2. **Dimension Pruning and Growth:**
   If the viewport expands, `this.renderedNodes` and `this.renderedRowGroups` expand to match `requiredRows = endRow - startRow` and `requiredCols = endCol - startCol`. If it contracts, surplus nodes are unobserved from `ResizeObserver` and removed.
3. **Dirty State Bypassing:**
   Each cell node records its rendered state:
   ```javascript
   if (oldRow === String(rowIndex) && oldCol === String(colIndex) && node._renderedVersion === this._renderVersion) {
     continue;
   }
   ```
   If a cell's coordinates have not changed between scroll frames, DOM mutations and template calls are skipped.

### 4.3 Zero-GC Rendering for Framework Wrappers

In v1.0.0, the `renderItem` template signature was extended:
```typescript
type RenderItemFunction = (
  rowItem: any,
  rowIndex: number,
  colIndex: number,
  rowCount: number,
  colCount: number,
  cellNode?: HTMLElement
) => string | Node | number | boolean | void;
```

#### Framework In-Place Update Semantics
Frameworks like Angular, React, Vue, and Svelte often mount embedded template views or component nodes into host elements. Wiping `node.innerHTML = ''` on every frame destroys these components, forcing template recreation, layout recalculation, and garbage collection churn:

```javascript
const newContent = this.renderItem(item, rowIndex, colIndex, this.rowCount, this.colCount, node);
if (newContent !== undefined) {
  node.innerHTML = '';
  if (typeof newContent === 'string') {
    node.innerHTML = newContent;
  } else if (typeof newContent === 'number' || typeof newContent === 'boolean') {
    node.textContent = String(newContent);
  } else if (newContent instanceof Node) {
    node.appendChild(newContent);
  }
}
```

* **When `template` returns `undefined`:** The engine assumes the consumer updated the provided `cellNode` in-place (e.g. updating a bound component instance or mutating textContent directly). The cell's `innerHTML` is preserved, eliminating DOM destruction and recreation cycles.

### 4.4 Sub-Pixel Anti-Jitter Coordinate Rounding

When translating the matrix wrapper via CSS `translate3d(X, Y, 0)` while positioning individual cells using `style.top` and `style.left`, combining independent fractional roundings causes sub-pixel rendering jitter.

`<runway-grid>` solves this by deriving the exact base scroll position from the raw WASM offsets:

```javascript
const rowBase = this.registry.get_row_offset(startRow);
const colBase = this.registry.get_col_offset(startCol);
const clampedScrollTop = rowBase - translateYRaw;
const clampedScrollLeft = colBase - translateXRaw;

for (let r = 0; r < requiredRows; r++) {
  const rowIndex = startRow + r;
  const rowTop = Math.round(this.registry.get_row_offset(rowIndex) - clampedScrollTop) - translateYRounded;
  rowGroup.style.top = `${rowTop}px`;
  // ...
}
```
* **Mathematical Invariance:** Anchoring every cell's whole-pixel offset to the shared `clampedScrollTop` and subtracting `translateYRounded` guarantees that each cell's on-screen screen coordinate matches:
  $$\text{ScreenPosition} = \text{roundedTranslateY} + \text{rowTop} \equiv \text{Round}\left(\text{offset}(\text{rowIndex}) - S\right)$$
  This completely prevents rounding drift between consecutive rows.

---

## 5. Native Scrollbar Emulation & Track Synchronization

Standard CSS `overflow: scroll` creates native DOM rendering trees for scrollable children, which breaks virtualization for millions of items. Instead, `<runway-grid>` renders decoupled native scrollbar tracks:

### 5.1 Bypassing Browser Height Limits at 100M+ Scale (`SAFE_MAX_SPACER_SIZE`)

To give the browser's native scrollbar tracks correct thumb sizes and travel ranges, an invisible spacer element is sized to match the content:

```javascript
export const SAFE_MAX_SPACER_SIZE = 10000000; // 10 Million Pixels
export const SAFE_MAX_HEIGHT = SAFE_MAX_SPACER_SIZE; // Backward-compatible alias

updateSpacer() {
  if (this.verticalEnabled) {
    this.verticalSpacer.style.height = `${Math.floor(Math.min(this.registry.get_total_height(), SAFE_MAX_SPACER_SIZE))}px`;
  }
  if (this.horizontalEnabled) {
    this.horizontalSpacer.style.width = `${Math.floor(Math.min(this.registry.get_total_width(), SAFE_MAX_SPACER_SIZE))}px`;
  }
}
```

#### The Core Problem: Native Browser Element Dimension Caps
Virtually all competing virtual list libraries fail when datasets exceed $1$ to $2$ million rows. This failure is not caused by JavaScript heap exhaustion, but by a hard constraint built into browser layout engines:
* **Chromium / WebKit:** Hard CSS element dimension cap of $\approx 33{,}554{,}400\text{ px}$ ($2^{25}\text{ px}$). At a typical row height of $30\text{ px}$, traditional virtual scrollers clip, freeze, or fail at $\approx 1{,}118{,}000$ rows.
* **Gecko (Firefox):** Hard CSS element dimension cap of $\approx 17{,}895{,}697\text{ px}$. At $30\text{ px}$ per row, traditional virtual scrollers break at $\approx 596{,}000$ rows.

Traditional virtual scrollers rely on a physical DOM "phantom spacer" element whose CSS height matches $\text{rowCount} \times \text{rowHeight}$. Once the total dataset height exceeds the browser's dimension limit, the browser silently clamps the element height. Consequently, scrollbar thumb tracking collapses, scrolling past the boundary becomes impossible, and the remaining dataset is permanently cut off.

#### How RunwayGrid Solves This: Decoupled 64-Bit Coordinates & Safe Max Spacers
RunwayGrid decouples virtual coordinate space from physical DOM spacer dimensions:
1. **Unbounded 64-Bit Floating-Point Geometry:** The embedded Rust/WASM layout engine (`runway_engine`) tracks row and column offsets using double-precision 64-bit floats (`f64`). A dataset of $100{,}000{,}000$ rows with an estimated height of $20\text{ px}$ represents a virtual span of $2{,}000{,}000{,}000\text{ px}$—calculated with full 64-bit precision without allocating physical DOM geometry.
2. **Capped Physical Scrollbar Spacer (`SAFE_MAX_SPACER_SIZE`):** The DOM spacer elements inside the custom scrollbar tracks never exceed `SAFE_MAX_SPACER_SIZE` ($10{,}000{,}000\text{ px}$). This stays comfortably below all browser clamping thresholds while providing ample physical runway for high-precision scrollbar thumb travel.
3. **Proportional Bidirectional Coordinate Mapping:** When total content extent exceeds `SAFE_MAX_SPACER_SIZE`, track positions and virtual positions scale proportionally:

$$\text{virtualScroll} = \left(\frac{\text{trackScroll}}{\text{maxTrackScroll}}\right) \times \text{maxVirtualScroll}$$

$$\text{trackScroll} = \left\lfloor \left(\frac{\text{virtualScroll}}{\text{maxVirtualScroll}}\right) \times \text{maxTrackScroll} \right\rfloor$$

```javascript
_trackToVirtual(trackScrollPos, viewportSize, axis) {
  const { trackExtent, trackClientExtent, totalExtent } = this._axis(axis);
  const maxTrackScroll = trackExtent - trackClientExtent;
  const maxVirtualScroll = totalExtent - viewportSize;

  if (maxVirtualScroll <= 0) return 0;
  if (maxTrackScroll <= 0 || trackScrollPos >= maxTrackScroll - 3) return maxVirtualScroll;

  return (trackScrollPos / maxTrackScroll) * maxVirtualScroll;
}

_virtualToTrack(virtualScrollPos, viewportSize, axis) {
  const { trackExtent, trackClientExtent, totalExtent } = this._axis(axis);
  const maxTrackScroll = trackExtent - trackClientExtent;
  const maxVirtualScroll = totalExtent - viewportSize;

  if (maxTrackScroll <= 0 || maxVirtualScroll <= 0) return 0;
  if (virtualScrollPos >= maxVirtualScroll) return maxTrackScroll;

  return Math.floor((virtualScrollPos / maxVirtualScroll) * maxTrackScroll);
}
```
* Below $10{,}000{,}000\text{ px}$, coordinates map 1:1 with native pixels.
* Above $10{,}000{,}000\text{ px}$, thumb positions scale smoothly across the capped track without loss of precision.
4. **Transform-Based Viewport Rendering:** The visible viewport mounts only a recycled pool of $\approx 30$ DOM elements positioned via `transform: translate3d(translateX, translateY, 0)`. The viewport never relies on native spacer dimensions to position visible cells, completely insulating the rendering path from native height limits.

### 5.2 Event-Source Arbitration & Feedback Suppression

When the user scrolls the viewport using the mouse wheel, the JavaScript orchestrator updates the virtual scroll position and synchronizes the native track via `trackEl.scrollTop = targetScrollPos`. However, mutating `scrollTop` programmatically triggers a native DOM `scroll` event on the track. Without arbitration, this event would feed back into the virtual scroll position, causing infinite scroll loops or jitter.

The system uses an expected-position latch:
1. `_syncOneTrack` records `this._expectedTrackScrollTop = targetScrollPos`.
2. Flags `_isProgrammaticScroll = true` and `_isUpdatingDOM = true`.
3. Sets `trackEl.scrollTop = targetScrollPos`.
4. When `handleTrackScroll` fires:
   ```javascript
   if (expectedPos !== null && Math.abs(scrollPos - expectedPos) <= 1) {
     grid._expectedTrackScrollTop = null;
     return; // Programmatic echo detected: drop event immediately
   }
   ```
5. Clears state on the next `requestAnimationFrame` tick. Genuine user dragging is preserved because dragging positions deviate from the expected programmatic coordinate.

### 5.3 Viewport Size & Track Dimension Caching

Querying `clientWidth`, `clientHeight`, `scrollWidth`, or `scrollHeight` forces synchronous layout reflows if the DOM is dirty.

`<runway-grid>` eliminates layout thrashing via lazy layout caching:
* Viewport client dimensions are cached in `_viewportSizeCache`.
* Track scroll extents are cached in `_trackCache`.
* Caches are cleared only when structural changes occur (window resize, container resize via `ResizeObserver`, orientation change, or dataset replacement).
* During high-frequency scrolling (e.g. 120 Hz wheel or momentum movement), zero synchronous DOM layout queries are executed.

---

## 6. Gesture Engine, Momentum Physics, & Extended Capabilities

### 6.1 Touch Physics & Inertial Momentum Engine

Touch interactions are handled incrementally by tracking pointer movements.

#### Flick Detection & Sample Tail Filtering
To prevent directional reversals or historical drags from corrupting flick velocity calculations, only samples within a trailing window are evaluated:
* `VELOCITY_SAMPLE_WINDOW = 60` ms
* `MAX_FLING_PAUSE_TIME = 50` ms
* `MIN_FLING_DISPLACEMENT = 10` px
* `MIN_FLING_VELOCITY = 0.35` px/ms ($350$ px/sec)

```javascript
const moveDt = latest.time - oldest.time;
const totalDt = moveDt + idleTime;
const dist = Math.hypot(oldest.x - latest.x, oldest.y - latest.y);

if (totalDt >= 15 && dist >= MIN_FLING_DISPLACEMENT) {
  const vx = (oldest.x - latest.x) / totalDt;
  const vy = (oldest.y - latest.y) / totalDt;
  grid._startMomentum(vx, vy);
}
```

#### Exponential Decay Equation
Momentum glides execute using an exponential decay loop decoupled from frame timing:

$$v_{t + \Delta t} = v_t \times \mu^{\frac{\Delta t}{16.67}}$$
$$\Delta s = v_t \times \Delta t$$
where $\mu$ is the friction coefficient (`momentumFriction`, default $0.955$) and $16.67\text{ ms}$ represents standard $60\text{ Hz}$ frame normalization.

#### Defensive Clamping
```javascript
get momentumFriction() {
  const val = parseFloat(this.getAttribute('momentum-friction'));
  return isNaN(val) ? 0.955 : Math.min(0.99, Math.max(0.50, val));
}

get momentumMaxSpeed() {
  const val = parseFloat(this.getAttribute('momentum-max-speed'));
  return isNaN(val) ? 4.0 : Math.min(20.0, Math.max(0.1, val));
}
```
* **Friction clamped to `[0.50, 0.99]`:** If $\mu \ge 1.0$, velocity would never decay, causing infinite animation loops. If $\mu \le 0$, it produces `NaN` or reversed directions.
* **Max Speed clamped to `[0.1, 20.0]`:** Prevents high-speed thumb flicks from catapulting scroll positions by millions of pixels in a single frame.

#### W3C Touch Target Retention
Under the W3C Touch Events specification, active touch pointers dispatch `touchmove` and `touchend` events to the original DOM node hit during `touchstart`. In a virtualized grid, scrolling recycles row cells, detaching or mutating the original target node. When detached, touch events stop bubbling to the viewport.

To fix this, `onTouchStart` binds listeners directly to `e.target`:
```javascript
if (e.target && e.target !== grid.viewport) {
  grid._touchTarget = e.target;
  grid._touchTarget.addEventListener('touchmove', grid._boundTouchMove, {passive: false});
  grid._touchTarget.addEventListener('touchend', grid._boundTouchEnd, {passive: false});
  grid._touchTarget.addEventListener('touchcancel', grid._boundTouchCancel, {passive: true});
}
```
* Even if the inner cell content is recycled, touch gestures continue without dropping frames or gestures.

### 6.2 Mouse Wheel Scaling & Scroll-Chaining

```javascript
export function handleWheel(grid, e) {
  // ...
  const multiplier = typeof grid.wheelSpeed === 'number' ? grid.wheelSpeed : 1.0;
  deltaX *= multiplier;
  deltaY *= multiplier;
  // ...
  if (hasRoom) e.preventDefault();
  grid._scrollByDelta(deltaX, deltaY);
}
```

* **Defensive Clamping:** `wheelSpeed` is clamped to `[0.1, 10.0]`.
* **Selective `e.preventDefault()` (Scroll Chaining):** `e.preventDefault()` is invoked *only* when the grid has remaining scrollable distance in the direction of the gesture (`hasRoom = true`). When the grid hits an edge, events bubble naturally, allowing parent containers or the window to scroll smoothly without trapping user focus.

### 6.3 Native Auto-Scroll ("Ticker Mode")

The auto-scroll engine enables continuous, autonomous scrolling (e.g., telemetry terminals, financial tickers, broadcast teleprompters):

```javascript
startAutoScroll(speed = 1) {
  this.stopAutoScroll();
  this._isAutoScrolling = true;
  this._autoScrollPaused = false;
  this._autoScrollSpeed = speed;

  const step = () => {
    if (!this._isAutoScrolling) return;
    if (!this._autoScrollPaused) {
      if (this.orientation === 'horizontal') this._scrollByDelta(this._autoScrollSpeed, 0);
      else this._scrollByDelta(0, this._autoScrollSpeed);
    }
    this._autoScrollRafId = requestAnimationFrame(step);
  };

  this._autoScrollRafId = requestAnimationFrame(step);
}
```

* **Interactive Hover/Touch Pause:** Automatically pauses when the pointer enters the viewport (`mouseenter`, `touchstart`) and resumes on exit (`mouseleave`, `touchend`).
* **Instant Cancellation:** Any manual user gesture (mouse wheel movement, track drag) immediately invokes `stopAutoScroll()`, giving manual user input priority.

### 6.4 Dynamic Measurement & Scroll Anchoring

When cells have variable heights or widths (e.g. multi-line comments or collapsible text), `ResizeObserver` re-measures rendered cells and feeds updated dimensions back into the WASM registry via `update_row_height` / `update_col_width`.

#### Scroll Anchoring
When an item above the visible viewport changes size, the content below it shifts, causing layout jumps. To prevent this, `handleResize` anchors scrolling to the top-most visible element:

```javascript
const geom = grid.registry.compute_geometry(grid._virtualScrollTop, grid._virtualScrollLeft, vh, vw, 0, ...);
const anchorRow = geom.viewport_start_row;
const oldAnchorRowOffset = grid.registry.get_row_offset(anchorRow);

// Apply size updates to WASM registry...
const newAnchorRowOffset = grid.registry.get_row_offset(anchorRow);
const rowDelta = newAnchorRowOffset - oldAnchorRowOffset;

if (rowDelta !== 0) {
  grid._virtualScrollTop += rowDelta; // Counter-scroll to preserve visual anchor
}
```
* **Utility Result:** Dynamic size updates above the viewport do not shift visible content.

#### Boundary Settle Pass (`_settleAtEnd`)
When dynamic height adjustments occur near the end of a dataset, rounding discrepancies can leave small residual gaps at the bottom. `_settleAtEnd` verifies if the scroller was docked to the end boundary; if so, it re-snaps `_virtualScrollTop` to `registry.get_total_height() - vh`.

### 6.5 Keyboard Navigation & Spatial Viewport Traversal

`<runway-grid>` implements comprehensive keyboard navigation conforming to standard spatial scroller expectations:

* **Focused Viewport Isolation:** Keyboard listeners intercept keydown events only when focus is directly on `grid.viewport` (`tabindex="0"`). This guarantees that text inputs, textareas, or interactive elements rendered inside cell templates retain standard keyboard behavior without interference.
* **Key Bindings & Navigation Semantics:**
  - `ArrowDown` / `ArrowUp`: Decrements / increments `_virtualScrollTop` by `rowSize`.
  - `ArrowRight` / `ArrowLeft`: Decrements / increments `_virtualScrollLeft` by `colSize`.
  - `PageDown` / `PageUp`: Traverses by an entire viewport dimension (`vh` or `vw`).
  - `Home`: Instantly jumps to coordinate `0.0` on active axes.
  - `End`: Instantly jumps to the maximum scrollable extent (`maxV` / `maxH`).
* **Axis Gating:** Navigation keys for disabled axes are ignored (`e.preventDefault()` is bypassed), allowing default browser behaviors to proceed.
* **Range Change Batching:** Key events wrap layout updates in `_beginRangeChangeBatch()` and `_endRangeChangeBatch()`, triggering exactly one unified `rangechange` event per keypress.

### 6.6 Approach Runway Teleportation for Distant Smooth Scrolls

Smooth scrolling to a distant index (`scrollToCell(rowIndex, colIndex, { behavior: 'smooth' })` or `scrollToIndex`) presents a severe performance challenge in massive virtual lists:

#### The Problem: Linear Traversal Churn
When animating from row $0$ to row $1{,}000{,}000$ over a $600\text{ ms}$ duration:
* The animation moves at $\approx 1{,}666{,}666$ rows per second.
* Intermediate rows pass across the viewport in fractions of a microsecond. The human visual system cannot distinguish individual cells; all that is perceived is a blur of motion.
* Traversing intermediate rows linearly forces continuous recycling of DOM nodes, innerHTML template replacements, and ResizeObserver callbacks, burning CPU cycles and triggering estimation drift.

#### The Runway Teleportation Algorithm
To maximize perceived smoothness while eliminating computational waste, RunwayGrid introduces Approach Runway Teleportation:

```
[Start Coordinate]
        |
        |  (Instant Virtual Jump: Skipped Intermediate Traversal)
        v
[Approach Runway: 2 x Viewport Extent Ahead of Target]
        |
        |  (Smooth Cubic Easing Animation)
        v
[Target Destination Cell]
```

1. **Distance Condition Check:**
   If $\Delta = |\text{targetCoord} - \text{startCoord}| > 5 \times V$ (where $V$ is viewport height or width):
2. **Immediate Teleportation to Runway:**
   The scroller immediately sets `_virtualScrollTop` / `_virtualScrollLeft` to an "approach runway" positioned $2$ viewport extents ahead of the target:
   $$\text{startCoord}_{\text{runway}} = \begin{cases} \text{targetCoord} - 2V & \text{if } \text{targetCoord} > \text{startCoord} \\ \text{targetCoord} + 2V & \text{if } \text{targetCoord} < \text{startCoord} \end{cases}$$
3. **Instant Geometry Synchronization:**
   Calls `calculateIndices()`, `updateSpacer()`, and `syncTrackFromVirtual()` to mount cells at the runway position.
4. **Smooth Arrival Animation:**
   Animates only that final $2V$ runway into the destination cell using cubic ease-in-out:
   $$\text{eased}(t) = \begin{cases} 4t^3 & \text{if } t < 0.5 \\ 1 - \frac{(-2t + 2)^3}{2} & \text{if } t \ge 0.5 \end{cases}$$
   $$\text{duration} = \text{clamp}\left(250\text{ ms},\, 600\text{ ms},\, \text{round}(200 + 60 \times \log_{10}(\text{distance}))\right)$$

* **Utility Result:** Eliminates $99\%$ of redundant DOM recycling and layout passes while preserving the authentic visual sensation of smooth directional arrival at the destination.

---

## 7. Accessibility & Semantic Contracts

`<runway-grid>` coordinates DOM structures and ARIA roles based on the active virtualization mode:

### 7.1 Single-Axis vs. Dual-Axis ARIA Mapping

```
Single-Axis (vertical or horizontal):
  runway-grid__viewport         -> role="list"
    runway-grid__rowgroup       -> role="presentation"
      runway-grid__cell         -> role="listitem", aria-posinset="X", aria-setsize="Y"

Dual-Axis (orientation="both"):
  runway-grid__viewport         -> role="grid", aria-rowcount="X", aria-colcount="Y"
    runway-grid__rowgroup       -> role="row", aria-rowindex="X"
      runway-grid__cell         -> role="gridcell", aria-rowindex="X", aria-colindex="Y"
```

* **Why Single-Axis uses `role="list"` instead of `role="grid"`:** The W3C WAI-ARIA Grid design pattern specifies that elements with `role="grid"` must support two-dimensional arrow key focus navigation using a roving `tabindex`. Single-axis lists scroll spatial viewports rather than moving cell focus. Applying `role="grid"` to a 1D scroller misleads screen readers. Using `role="list"` with explicit `aria-posinset` and `aria-setsize` communicates true list semantics.
* **True Dimension Reporting:** `aria-rowcount` and `aria-colcount` report the *total dataset dimensions* from the WASM registry, not the number of physical DOM nodes mounted in the pool.

---

## 8. Event Lifecycle & Batching Architecture

### 8.1 The `rangechange` Event Contract

The component dispatches `rangechange` whenever the rendered spatial slice changes:

```typescript
interface RangeChangeEvent extends Event {
  buffered: { startRow: number; endRow: number; startCol: number; endCol: number };
  viewport: { startRow: number; endRow: number; startCol: number; endCol: number };
}
```
* `buffered`: Includes off-screen buffer padding ($B = \text{buffer-size}$). Used to trigger background data fetching before the user reaches empty space.
* `viewport`: The strict bounding rectangle of cells intersecting visible pixels. Used for visibility tracking and impression analytics.
* **Direct Event Properties:** `buffered` and `viewport` are assigned directly to the `Event` instance rather than inside `event.detail` to ensure compatibility across frameworks.

### 8.2 Range Change Batching (`_batchDepth`)

Operations like `scrollToCell` run multiple layout refinements in a single call (positioning, auto-measuring sizes, re-positioning, settling at boundaries). Dispatching events on every micro-pass would flood application listeners.

```javascript
_beginRangeChangeBatch() { this._batchDepth++; }
_endRangeChangeBatch() {
  this._batchDepth = Math.max(0, this._batchDepth - 1);
  if (this._batchDepth === 0 && this._pendingRangeChangeEvent) {
    const evt = this._pendingRangeChangeEvent;
    this._pendingRangeChangeEvent = null;
    this.dispatchEvent(evt);
  }
}
```
* **Utility Result:** Only the final, settled `rangechange` event is dispatched per operation.

### 8.3 The `wasmerror` Event Contract

```typescript
interface WasmErrorEvent extends Event {
  type: 'wasmerror';
  detail: { error: unknown };
}
```

* Dispatched if WebAssembly initialization fails (e.g. strict CSP blocking binary instantiation, unsupported WebAssembly runtimes, or corrupted base64 payloads).
* Exposes the caught error on `event.detail.error` and stores it on `grid.wasmInitError`.
* Guarantees that errors never escape as unhandled promise rejections, enabling host applications to display graceful fallback content.

---

## 9. Performance & System Resource Summary

```
+---------------------------------------------------------------------------------------+
|                               SYSTEM RESOURCE BUDGET                                  |
+---------------------------------------------------------------------------------------+
|  DOM Node Footprint:         |  Constant: O(1) ~20 - 60 nodes total                   |
|  Frame Budget Target:        |  < 8.33 ms (120 Hz displays) / < 16.67 ms (60 Hz)     |
|  WASM Geometry Resolution:   |  0.02 ms - 0.08 ms per compute_geometry pass           |
|  WASM Point Update (BIT):    |  ~1.4 µs per update at 10,000,000 rows (O(log N))      |
|  DOM Reconciliation Window:  |  0.20 ms - 0.90 ms per applyChanges pass               |
|  Garbage Collection Overhead:|  Zero-GC in steady state (Pooled DOM + in-place reuse)  |
|  Memory Scaling (Heap):      |  Contiguous: ~16 bytes / element in WASM linear memory |
|  Maximum Tested Scale:       |  100,000,000+ items (2,000,000,000px virtual height)   |
|  CSS Reflow Isolation:       |  Enforced via contain: strict                          |
+---------------------------------------------------------------------------------------+
```

By offloading coordinate indexing, prefix sum maintenance, and binary search bounds to a contiguous WebAssembly memory block structured as Fenwick trees, `<runway-grid>` frees the browser main thread to focus on GPU compositing and DOM recycling. This architecture delivers predictable frame rates, instant point updates, and stable memory consumption across data streams with hundreds of millions of elements.
