use wasm_bindgen::prelude::*;

pub mod constants;
pub mod structs;
pub mod types;

pub use constants::*;
pub use types::*;

#[cfg(test)]
mod tests;

// Runs the binary search twice (start/end of viewport) for a single axis, then
// expands the result by `buffer_size` on each side. Shared by both the row and column axes
// in `compute_geometry` so the dual-axis search stays symmetric and panic-free.
pub fn resolve_axis(
    fenwick: &Fenwick,
    scroll: f64,
    viewport_size: f64,
    buffer_size: usize,
) -> AxisRange {
    let total = fenwick.len();
    if total == 0 {
        return AxisRange {
            buffered_start: 0,
            buffered_end: 0,
            viewport_start: 0,
            viewport_end: 0,
            translate: 0.0,
        };
    }

    let max_scroll = (fenwick.total() - viewport_size).max(0.0);
    // A non-finite `scroll` (e.g. NaN slipping in from the caller) would otherwise propagate
    // into every offset below, so fall back to the start of the axis instead.
    let clamped_scroll = if scroll.is_finite() {
        scroll.min(max_scroll).max(0.0)
    } else {
        0.0
    };

    // `partial_cmp` returns `None` only for non-finite operands; falling back to `Equal` keeps
    // the search total (never panics) even if a NaN/Infinity ever slipped through, instead of
    // crashing the whole scroller.
    let start_index = match fenwick.binary_search(clamped_scroll) {
        Ok(index) => index + 1,
        Err(index) => index,
    }
    .min(total - 1);

    let scroll_end = clamped_scroll + viewport_size;
    let end_index = match fenwick.binary_search(scroll_end) {
        Ok(index) => index + 1,
        Err(index) => index,
    }
    .min(total);

    let buffered_start = if start_index > buffer_size {
        start_index - buffer_size
    } else {
        0
    };
    let buffered_end = (end_index + buffer_size).min(total);
    let start_offset = fenwick.offset_of(buffered_start);

    AxisRange {
        buffered_start,
        buffered_end,
        viewport_start: start_index,
        viewport_end: end_index,
        translate: start_offset - clamped_scroll,
    }
}

#[wasm_bindgen]
pub struct VirtualScrollRegistry {
    row_fenwick: Fenwick,
    col_fenwick: Fenwick,
}

#[wasm_bindgen]
impl VirtualScrollRegistry {
    #[wasm_bindgen(constructor)]
    pub fn new(
        total_rows: usize,
        total_cols: usize,
        default_row_size: f64,
        default_col_size: f64,
    ) -> VirtualScrollRegistry {
        VirtualScrollRegistry {
            row_fenwick: Fenwick::new(default_row_size, total_rows),
            col_fenwick: Fenwick::new(default_col_size, total_cols),
        }
    }

    pub fn update_row_height(&mut self, index: usize, new_height: f64) -> bool {
        self.row_fenwick.update_size(index, new_height)
    }

    // Non-destructively grows the row axis by `count` rows, each starting at
    // `default_size`. Continues prefix sums from its last known cumulative
    // value instead of rebuilding from scratch, so every previously auto-measured
    // row height stays mathematically intact - this is what allows infinite-scroll
    // style appends to happen without resetting scroll position or layout state.
    pub fn append_rows(&mut self, count: usize, default_size: f64) {
        self.row_fenwick.append(count, default_size);
    }

    // Non-destructively shrinks the row axis by removing the first `count` rows - a
    // "sliding window" head-eviction, e.g. capping memory usage for an infinitely growing
    // infinite-scroll list. Clamps `count` to the current row count to stay panic-free, then
    // drains the removed slots from `sizes` and rebuilds the tree so the remaining
    // rows keep their exact relative offsets without needing a full rebuild. Returns the
    // exact pixel height removed, so the caller (JS) can counter-scroll by that same amount
    // and hide the mutation from the user.
    pub fn remove_rows_from_head(&mut self, count: usize) -> f64 {
        self.row_fenwick.remove_from_head(count)
    }

    pub fn update_col_width(&mut self, index: usize, new_width: f64) -> bool {
        self.col_fenwick.update_size(index, new_width)
    }

    // Non-destructively grows the column axis by `count` columns, each starting at
    // `default_size`. Mirrors `append_rows`: continues prefix sums from its last
    // known cumulative value instead of rebuilding from scratch.
    pub fn append_cols(&mut self, count: usize, default_size: f64) {
        self.col_fenwick.append(count, default_size);
    }

    // Non-destructively shrinks the column axis by removing the first `count` columns.
    // Mirrors `remove_rows_from_head`: clamps `count`, drains the removed slots, then
    // re-bases the tree. Returns the exact pixel width removed.
    pub fn remove_cols_from_head(&mut self, count: usize) -> f64 {
        self.col_fenwick.remove_from_head(count)
    }

    pub fn get_total_height(&self) -> f64 {
        self.row_fenwick.total()
    }

    pub fn get_total_width(&self) -> f64 {
        self.col_fenwick.total()
    }

    pub fn get_row_offset(&self, index: usize) -> f64 {
        self.row_fenwick.offset_of(index)
    }

    pub fn get_col_offset(&self, index: usize) -> f64 {
        self.col_fenwick.offset_of(index)
    }

    pub fn row_count(&self) -> usize {
        self.row_fenwick.len()
    }

    pub fn col_count(&self) -> usize {
        self.col_fenwick.len()
    }

    // Executes two independent binary searches - one per axis - to resolve the
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
        let (start_row, end_row, viewport_start_row, viewport_end_row, translate_y) =
            if enable_vertical && !self.row_fenwick.is_empty() {
                let axis =
                    resolve_axis(&self.row_fenwick, scroll_top, viewport_height, buffer_size);
                (
                    axis.buffered_start,
                    axis.buffered_end,
                    axis.viewport_start,
                    axis.viewport_end,
                    axis.translate,
                )
            } else {
                let fallback_end = self.row_fenwick.len().min(1);
                (0, fallback_end, 0, fallback_end, 0.0)
            };

        let (start_col, end_col, viewport_start_col, viewport_end_col, translate_x) =
            if enable_horizontal && !self.col_fenwick.is_empty() {
                let axis =
                    resolve_axis(&self.col_fenwick, scroll_left, viewport_width, buffer_size);
                (
                    axis.buffered_start,
                    axis.buffered_end,
                    axis.viewport_start,
                    axis.viewport_end,
                    axis.translate,
                )
            } else {
                let fallback_end = self.col_fenwick.len().min(1);
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
