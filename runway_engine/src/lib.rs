use wasm_bindgen::prelude::*;
use std::cmp::Ordering;

// Builds a cumulative (prefix) sum vector for a dimension (rows or columns), all starting
// at the same default size. Kept as a free function so it can be reused for both axes.
fn build_prefix_sums(default_size: f64, count: usize) -> Vec<f64> {
    let mut prefix_sums = Vec::with_capacity(count);
    let mut running_sum = 0.0;
    for _ in 0..count {
        running_sum += default_size;
        prefix_sums.push(running_sum);
    }
    prefix_sums
}

fn total_of(prefix_sums: &[f64]) -> f64 {
    if prefix_sums.is_empty() { 0.0 } else { *prefix_sums.last().unwrap() }
}

fn offset_of(prefix_sums: &[f64], index: usize) -> f64 {
    if index == 0 || prefix_sums.is_empty() {
        0.0
    } else if index >= prefix_sums.len() {
        *prefix_sums.last().unwrap()
    } else {
        prefix_sums[index - 1]
    }
}

// Applies a new measured size (row height or column width) to a single slot and keeps its
// prefix-sum vector consistent. Guards against non-finite measurements (NaN/Infinity), e.g.
// from a malformed ResizeObserver entry - letting one in would poison every value after it
// and make `binary_search_by`'s `partial_cmp(...).unwrap()` panic.
fn update_size(sizes: &mut [f64], prefix_sums: &mut [f64], index: usize, new_size: f64) -> bool {
    if index >= sizes.len() || !new_size.is_finite() {
        return false;
    }

    let old_size = sizes[index];
    if (old_size - new_size).abs() < 0.5 {
        return false;
    }

    let delta = new_size - old_size;
    sizes[index] = new_size;

    // Rust slice optimization: Sequential memory mutation loops are auto-vectorized by LLVM.
    let chunk = &mut prefix_sums[index..];
    for val in chunk.iter_mut() {
        *val += delta;
    }

    true
}

// Result of resolving the visible (+buffered) window for a single axis.
struct AxisRange {
    buffered_start: usize,
    buffered_end: usize,
    // Strict (unbuffered) bounds - the indices actually intersecting the visible pixels,
    // i.e. `buffered_start`/`buffered_end` with the `buffer_size` padding removed.
    viewport_start: usize,
    viewport_end: usize,
    // Pixel offset (translate) between the buffered window's start and the current scroll
    // position on this axis.
    translate: f64,
}

// Runs the O(log N) binary search twice (start/end of viewport) for a single axis, then
// expands the result by `buffer_size` on each side. Shared by both the row and column axes
// in `compute_geometry` so the dual-axis search stays symmetric and panic-free.
fn resolve_axis(prefix_sums: &[f64], scroll: f64, viewport_size: f64, buffer_size: usize) -> AxisRange {
    let total = prefix_sums.len();
    if total == 0 {
        return AxisRange { buffered_start: 0, buffered_end: 0, viewport_start: 0, viewport_end: 0, translate: 0.0 };
    }

    let max_scroll = (total_of(prefix_sums) - viewport_size).max(0.0);
    // A non-finite `scroll` (e.g. NaN slipping in from the caller) would otherwise propagate
    // into every offset below, so fall back to the start of the axis instead.
    let clamped_scroll = if scroll.is_finite() { scroll.min(max_scroll).max(0.0) } else { 0.0 };

    // `partial_cmp` returns `None` only for non-finite operands; falling back to `Equal` keeps
    // the search total (never panics) even if a NaN/Infinity ever slipped through, instead of
    // crashing the whole scroller.
    let start_index = match prefix_sums.binary_search_by(|probe| {
        probe.partial_cmp(&clamped_scroll).unwrap_or(Ordering::Equal)
    }) {
        Ok(index) => index + 1,
        Err(index) => index,
    }.min(total - 1);

    let scroll_end = clamped_scroll + viewport_size;
    let end_index = match prefix_sums.binary_search_by(|probe| {
        probe.partial_cmp(&scroll_end).unwrap_or(Ordering::Equal)
    }) {
        Ok(index) => index + 1,
        Err(index) => index,
    }.min(total);

    let buffered_start = if start_index > buffer_size { start_index - buffer_size } else { 0 };
    let buffered_end = (end_index + buffer_size).min(total);
    let start_offset = offset_of(prefix_sums, buffered_start);

    AxisRange {
        buffered_start,
        buffered_end,
        viewport_start: start_index,
        viewport_end: end_index,
        translate: start_offset - clamped_scroll,
    }
}

// Structured 2D geometry payload: the visible+buffered row/column bounds plus the pixel
// translation needed to align the recycled DOM matrix with the current scroll position.
// All fields are `Copy` primitives, so `wasm-bindgen` exposes them as plain readable/writable
// properties on the JS side without any extra glue code.
#[wasm_bindgen]
pub struct GridGeometryResult {
    pub start_row: usize,
    pub end_row: usize,
    pub start_col: usize,
    pub end_col: usize,
    // Strict (unbuffered) row/column bounds - only the indices whose pixels actually
    // intersect the viewport, i.e. `start_row`/`end_row`/`start_col`/`end_col` without the
    // `buffer_size` padding on either side.
    pub viewport_start_row: usize,
    pub viewport_end_row: usize,
    pub viewport_start_col: usize,
    pub viewport_end_col: usize,
    pub translate_x: f64,
    pub translate_y: f64,
}

#[wasm_bindgen]
pub struct VirtualScrollRegistry {
    row_heights: Vec<f64>,
    row_prefix_sums: Vec<f64>,
    col_widths: Vec<f64>,
    col_prefix_sums: Vec<f64>,
}

#[wasm_bindgen]
impl VirtualScrollRegistry {
    #[wasm_bindgen(constructor)]
    pub fn new(total_rows: usize, total_cols: usize, default_row_size: f64, default_col_size: f64) -> VirtualScrollRegistry {
        VirtualScrollRegistry {
            row_heights: vec![default_row_size; total_rows],
            row_prefix_sums: build_prefix_sums(default_row_size, total_rows),
            col_widths: vec![default_col_size; total_cols],
            col_prefix_sums: build_prefix_sums(default_col_size, total_cols),
        }
    }

    pub fn update_row_height(&mut self, index: usize, new_height: f64) -> bool {
        update_size(&mut self.row_heights, &mut self.row_prefix_sums, index, new_height)
    }

    // Non-destructively grows the row axis by `count` rows, each starting at
    // `default_size`. Continues `row_prefix_sums` from its last known cumulative
    // value instead of rebuilding from scratch, so every previously auto-measured
    // row height (and its resulting prefix sum) stays mathematically intact - this
    // is what allows infinite-scroll style appends to happen without resetting the
    // scroll position or discarding measured layout state.
    pub fn append_rows(&mut self, count: usize, default_size: f64) {
        let mut running_sum = total_of(&self.row_prefix_sums);
        self.row_heights.reserve(count);
        self.row_prefix_sums.reserve(count);
        for _ in 0..count {
            running_sum += default_size;
            self.row_heights.push(default_size);
            self.row_prefix_sums.push(running_sum);
        }
    }

    // Non-destructively shrinks the row axis by removing the first `count` rows - a
    // "sliding window" head-eviction, e.g. capping memory usage for an infinitely growing
    // infinite-scroll list. Clamps `count` to the current row count to stay panic-free, then
    // drains the removed slots from both `row_heights` and `row_prefix_sums` and re-bases
    // every remaining prefix sum by subtracting the removed total height, so the remaining
    // rows keep their exact relative offsets without needing a full rebuild. Returns the
    // exact pixel height removed, so the caller (JS) can counter-scroll by that same amount
    // and hide the mutation from the user.
    pub fn remove_rows_from_head(&mut self, count: usize) -> f64 {
        let count = count.min(self.row_heights.len());
        if count == 0 {
            return 0.0;
        }

        let height_delta = self.row_prefix_sums[count - 1];

        self.row_heights.drain(0..count);
        self.row_prefix_sums.drain(0..count);

        if height_delta.abs() > 1e-9 {
            // Rust slice optimization: Sequential memory mutation loops are auto-vectorized by LLVM.
            for val in self.row_prefix_sums.iter_mut() {
                *val -= height_delta;
            }
        }

        height_delta
    }

    pub fn update_col_width(&mut self, index: usize, new_width: f64) -> bool {
        update_size(&mut self.col_widths, &mut self.col_prefix_sums, index, new_width)
    }

    // Non-destructively grows the column axis by `count` columns, each starting at
    // `default_size`. Mirrors `append_rows`: continues `col_prefix_sums` from its last
    // known cumulative value instead of rebuilding from scratch, so every previously
    // auto-measured column width (and its resulting prefix sum) stays mathematically
    // intact - this is what allows infinite-scroll style appends to happen on the
    // horizontal axis without resetting the scroll position or discarding measured
    // layout state.
    pub fn append_cols(&mut self, count: usize, default_size: f64) {
        let mut running_sum = total_of(&self.col_prefix_sums);
        self.col_widths.reserve(count);
        self.col_prefix_sums.reserve(count);
        for _ in 0..count {
            running_sum += default_size;
            self.col_widths.push(default_size);
            self.col_prefix_sums.push(running_sum);
        }
    }

    // Non-destructively shrinks the column axis by removing the first `count` columns.
    // Mirrors `remove_rows_from_head`: clamps `count`, drains the removed slots from both
    // `col_widths` and `col_prefix_sums`, then re-bases every remaining prefix sum by
    // subtracting the removed total width. Returns the exact pixel width removed, so the
    // caller (JS) can counter-scroll the horizontal axis by that same amount.
    pub fn remove_cols_from_head(&mut self, count: usize) -> f64 {
        let count = count.min(self.col_widths.len());
        if count == 0 {
            return 0.0;
        }

        let width_delta = self.col_prefix_sums[count - 1];

        self.col_widths.drain(0..count);
        self.col_prefix_sums.drain(0..count);

        if width_delta.abs() > 1e-9 {
            // Rust slice optimization: Sequential memory mutation loops are auto-vectorized by LLVM.
            for val in self.col_prefix_sums.iter_mut() {
                *val -= width_delta;
            }
        }

        width_delta
    }

    pub fn get_total_height(&self) -> f64 {
        total_of(&self.row_prefix_sums)
    }

    pub fn get_total_width(&self) -> f64 {
        total_of(&self.col_prefix_sums)
    }

    pub fn get_row_offset(&self, index: usize) -> f64 {
        offset_of(&self.row_prefix_sums, index)
    }

    pub fn get_col_offset(&self, index: usize) -> f64 {
        offset_of(&self.col_prefix_sums, index)
    }

    pub fn row_count(&self) -> usize {
        self.row_heights.len()
    }

    pub fn col_count(&self) -> usize {
        self.col_widths.len()
    }

    // Executes two independent O(log N) binary searches - one per axis - to resolve the
    // visible+buffered row and column bounds, then packs both together with the pixel
    // translation needed to line up the recycled DOM matrix with the viewport. Either axis
    // can be switched off (`enable_vertical` / `enable_horizontal`) to collapse this back
    // into a plain single-axis list without touching that axis' prefix sums at all.
    pub fn compute_geometry(
        &self,
        scroll_top: f64,
        scroll_left: f64,
        viewport_height: f64,
        viewport_width: f64,
        buffer_size: usize,
        enable_vertical: bool,
        enable_horizontal: bool,
    ) -> GridGeometryResult {
        let (start_row, end_row, viewport_start_row, viewport_end_row, translate_y) = if enable_vertical && !self.row_heights.is_empty() {
            let axis = resolve_axis(&self.row_prefix_sums, scroll_top, viewport_height, buffer_size);
            (axis.buffered_start, axis.buffered_end, axis.viewport_start, axis.viewport_end, axis.translate)
        } else {
            let fallback_end = self.row_heights.len().min(1);
            (0, fallback_end, 0, fallback_end, 0.0)
        };

        let (start_col, end_col, viewport_start_col, viewport_end_col, translate_x) = if enable_horizontal && !self.col_widths.is_empty() {
            let axis = resolve_axis(&self.col_prefix_sums, scroll_left, viewport_width, buffer_size);
            (axis.buffered_start, axis.buffered_end, axis.viewport_start, axis.viewport_end, axis.translate)
        } else {
            let fallback_end = self.col_widths.len().min(1);
            (0, fallback_end, 0, fallback_end, 0.0)
        };

        GridGeometryResult {
            start_row,
            end_row,
            start_col,
            end_col,
            viewport_start_row,
            viewport_end_row,
            viewport_start_col,
            viewport_end_col,
            translate_x,
            translate_y,
        }
    }
}
