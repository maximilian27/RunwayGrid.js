use wasm_bindgen::prelude::*;
use std::cmp::Ordering;

// Builds a cumulative (prefix) sum vector for a dimension (rows or columns), all starting
// at the same default size. Kept as a free function so it can be reused for both axes.
fn build_prefix_sums(default_size: f64, count: usize) -> Vec<f64> {
    let mut prefix_sums = vec![0.0; count];
    let mut running_sum = 0.0;
    for i in 0..count {
        running_sum += default_size;
        prefix_sums[i] = running_sum;
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
    let len = prefix_sums.len();
    let chunk = &mut prefix_sums[index..len];
    for val in chunk.iter_mut() {
        *val += delta;
    }

    true
}

// Result of resolving the visible (+buffered) window for a single axis.
struct AxisRange {
    buffered_start: usize,
    buffered_end: usize,
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
        return AxisRange { buffered_start: 0, buffered_end: 0, translate: 0.0 };
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

    pub fn update_col_width(&mut self, index: usize, new_width: f64) -> bool {
        update_size(&mut self.col_widths, &mut self.col_prefix_sums, index, new_width)
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
        let (start_row, end_row, translate_y) = if enable_vertical && !self.row_heights.is_empty() {
            let axis = resolve_axis(&self.row_prefix_sums, scroll_top, viewport_height, buffer_size);
            (axis.buffered_start, axis.buffered_end, axis.translate)
        } else {
            (0, self.row_heights.len().min(1), 0.0)
        };

        let (start_col, end_col, translate_x) = if enable_horizontal && !self.col_widths.is_empty() {
            let axis = resolve_axis(&self.col_prefix_sums, scroll_left, viewport_width, buffer_size);
            (axis.buffered_start, axis.buffered_end, axis.translate)
        } else {
            (0, self.col_widths.len().min(1), 0.0)
        };

        GridGeometryResult {
            start_row,
            end_row,
            start_col,
            end_col,
            translate_x,
            translate_y,
        }
    }
}
