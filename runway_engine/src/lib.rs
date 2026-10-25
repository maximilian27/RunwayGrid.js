use wasm_bindgen::prelude::*;
use std::cmp::Ordering;

// Fenwick tree (Binary Indexed Tree) providing O(log N) point updates
// and O(log N) prefix-sum queries for virtual scroll dimensions.
#[derive(Clone, Debug)]
struct Fenwick {
    tree: Vec<f64>,   // 1-indexed internal BIT
    sizes: Vec<f64>,  // actual per-row/col sizes, needed to read back old values on update
}

impl Fenwick {
    fn new(default_size: f64, count: usize) -> Self {
        let sizes = vec![default_size; count];
        let mut tree = vec![0.0; count + 1];
        // One-time O(N) bulk-build (standard BIT construction trick).
        for i in 1..=count {
            tree[i] += sizes[i - 1];
            let parent = i + (i & i.wrapping_neg());
            if parent <= count {
                tree[parent] += tree[i];
            }
        }
        Fenwick { tree, sizes }
    }

    // Prefix sum of [0, index) — same contract as offset_of().
    fn prefix_sum(&self, index: usize) -> f64 {
        let mut index = index.min(self.sizes.len());
        let mut sum = 0.0;
        while index > 0 {
            sum += self.tree[index];
            index -= index & index.wrapping_neg();
        }
        sum
    }

    fn offset_of(&self, index: usize) -> f64 {
        if self.sizes.is_empty() {
            return 0.0;
        }
        self.prefix_sum(index)
    }

    fn total(&self) -> f64 {
        self.prefix_sum(self.sizes.len())
    }

    fn len(&self) -> usize {
        self.sizes.len()
    }

    fn is_empty(&self) -> bool {
        self.sizes.is_empty()
    }

    fn update_size(&mut self, index: usize, new_size: f64) -> bool {
        if index >= self.sizes.len() || !new_size.is_finite() {
            return false;
        }
        let old_size = self.sizes[index];
        if (old_size - new_size).abs() < 0.5 {
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

    fn append(&mut self, count: usize, default_size: f64) {
        if count == 0 {
            return;
        }
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

    fn remove_from_head(&mut self, count: usize) -> f64 {
        let count = count.min(self.sizes.len());
        if count == 0 {
            return 0.0;
        }
        let height_delta = self.prefix_sum(count);
        self.sizes.drain(0..count);
        self.rebuild_tree();
        height_delta
    }

    fn rebuild_tree(&mut self) {
        let count = self.sizes.len();
        self.tree = vec![0.0; count + 1];
        for i in 1..=count {
            self.tree[i] += self.sizes[i - 1];
            let parent = i + (i & i.wrapping_neg());
            if parent <= count {
                self.tree[parent] += self.tree[i];
            }
        }
    }

    fn binary_search(&self, target: f64) -> Result<usize, usize> {
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

// Runs the binary search twice (start/end of viewport) for a single axis, then
// expands the result by `buffer_size` on each side. Shared by both the row and column axes
// in `compute_geometry` so the dual-axis search stays symmetric and panic-free.
fn resolve_axis(fenwick: &Fenwick, scroll: f64, viewport_size: f64, buffer_size: usize) -> AxisRange {
    let total = fenwick.len();
    if total == 0 {
        return AxisRange { buffered_start: 0, buffered_end: 0, viewport_start: 0, viewport_end: 0, translate: 0.0 };
    }

    let max_scroll = (fenwick.total() - viewport_size).max(0.0);
    // A non-finite `scroll` (e.g. NaN slipping in from the caller) would otherwise propagate
    // into every offset below, so fall back to the start of the axis instead.
    let clamped_scroll = if scroll.is_finite() { scroll.min(max_scroll).max(0.0) } else { 0.0 };

    // `partial_cmp` returns `None` only for non-finite operands; falling back to `Equal` keeps
    // the search total (never panics) even if a NaN/Infinity ever slipped through, instead of
    // crashing the whole scroller.
    let start_index = match fenwick.binary_search(clamped_scroll) {
        Ok(index) => index + 1,
        Err(index) => index,
    }.min(total - 1);

    let scroll_end = clamped_scroll + viewport_size;
    let end_index = match fenwick.binary_search(scroll_end) {
        Ok(index) => index + 1,
        Err(index) => index,
    }.min(total);

    let buffered_start = if start_index > buffer_size { start_index - buffer_size } else { 0 };
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
    row_fenwick: Fenwick,
    col_fenwick: Fenwick,
}

#[wasm_bindgen]
impl VirtualScrollRegistry {
    #[wasm_bindgen(constructor)]
    pub fn new(total_rows: usize, total_cols: usize, default_row_size: f64, default_col_size: f64) -> VirtualScrollRegistry {
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
        let (start_row, end_row, viewport_start_row, viewport_end_row, translate_y) = if enable_vertical && !self.row_fenwick.is_empty() {
            let axis = resolve_axis(&self.row_fenwick, scroll_top, viewport_height, buffer_size);
            (axis.buffered_start, axis.buffered_end, axis.viewport_start, axis.viewport_end, axis.translate)
        } else {
            let fallback_end = self.row_fenwick.len().min(1);
            (0, fallback_end, 0, fallback_end, 0.0)
        };

        let (start_col, end_col, viewport_start_col, viewport_end_col, translate_x) = if enable_horizontal && !self.col_fenwick.is_empty() {
            let axis = resolve_axis(&self.col_fenwick, scroll_left, viewport_width, buffer_size);
            (axis.buffered_start, axis.buffered_end, axis.viewport_start, axis.viewport_end, axis.translate)
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

#[cfg(test)]
mod tests {
    use super::*;

    // Linear prefix-sum reference implementation for cross-validation
    struct LinearRegistry {
        sizes: Vec<f64>,
        prefix_sums: Vec<f64>,
    }

    impl LinearRegistry {
        fn new(count: usize, default_size: f64) -> Self {
            let sizes = vec![default_size; count];
            let mut prefix_sums = Vec::with_capacity(count);
            let mut running = 0.0;
            for _ in 0..count {
                running += default_size;
                prefix_sums.push(running);
            }
            LinearRegistry { sizes, prefix_sums }
        }

        fn offset_of(&self, index: usize) -> f64 {
            if index == 0 || self.prefix_sums.is_empty() {
                0.0
            } else if index >= self.prefix_sums.len() {
                *self.prefix_sums.last().unwrap()
            } else {
                self.prefix_sums[index - 1]
            }
        }

        fn total(&self) -> f64 {
            if self.prefix_sums.is_empty() { 0.0 } else { *self.prefix_sums.last().unwrap() }
        }

        fn update_size(&mut self, index: usize, new_size: f64) -> bool {
            if index >= self.sizes.len() || !new_size.is_finite() {
                return false;
            }
            let old_size = self.sizes[index];
            if (old_size - new_size).abs() < 0.5 {
                return false;
            }
            let delta = new_size - old_size;
            self.sizes[index] = new_size;
            let chunk = &mut self.prefix_sums[index..];
            for val in chunk.iter_mut() {
                *val += delta;
            }
            true
        }

        fn append(&mut self, count: usize, default_size: f64) {
            let mut running = self.total();
            for _ in 0..count {
                running += default_size;
                self.sizes.push(default_size);
                self.prefix_sums.push(running);
            }
        }

        fn remove_from_head(&mut self, count: usize) -> f64 {
            let count = count.min(self.sizes.len());
            if count == 0 {
                return 0.0;
            }
            let delta = self.prefix_sums[count - 1];
            self.sizes.drain(0..count);
            self.prefix_sums.drain(0..count);
            if delta.abs() > 1e-9 {
                for val in self.prefix_sums.iter_mut() {
                    *val -= delta;
                }
            }
            delta
        }

        fn resolve_axis(&self, scroll: f64, viewport_size: f64, buffer_size: usize) -> AxisRange {
            let total = self.prefix_sums.len();
            if total == 0 {
                return AxisRange { buffered_start: 0, buffered_end: 0, viewport_start: 0, viewport_end: 0, translate: 0.0 };
            }
            let max_scroll = (self.total() - viewport_size).max(0.0);
            let clamped_scroll = if scroll.is_finite() { scroll.min(max_scroll).max(0.0) } else { 0.0 };
            let start_index = match self.prefix_sums.binary_search_by(|probe| {
                probe.partial_cmp(&clamped_scroll).unwrap_or(Ordering::Equal)
            }) {
                Ok(index) => index + 1,
                Err(index) => index,
            }.min(total - 1);

            let scroll_end = clamped_scroll + viewport_size;
            let end_index = match self.prefix_sums.binary_search_by(|probe| {
                probe.partial_cmp(&scroll_end).unwrap_or(Ordering::Equal)
            }) {
                Ok(index) => index + 1,
                Err(index) => index,
            }.min(total);

            let buffered_start = if start_index > buffer_size { start_index - buffer_size } else { 0 };
            let buffered_end = (end_index + buffer_size).min(total);
            let start_offset = self.offset_of(buffered_start);

            AxisRange {
                buffered_start,
                buffered_end,
                viewport_start: start_index,
                viewport_end: end_index,
                translate: start_offset - clamped_scroll,
            }
        }
    }

    struct SimpleRng(u64);
    impl SimpleRng {
        fn new(seed: u64) -> Self { Self(seed) }
        fn next_u64(&mut self) -> u64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            self.0
        }
        fn next_usize(&mut self, max: usize) -> usize {
            (self.next_u64() as usize) % max
        }
        fn next_f64(&mut self, min: f64, max: f64) -> f64 {
            let t = (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64;
            min + t * (max - min)
        }
    }

    #[test]
    fn test_fenwick_vs_linear_randomized() {
        let count = 10_000;
        let mut fenwick = Fenwick::new(35.0, count);
        let mut linear = LinearRegistry::new(count, 35.0);

        let mut rng = SimpleRng::new(42);
        for _ in 0..200 {
            let idx = rng.next_usize(count + 10);
            let new_size = rng.next_f64(5.0, 150.0);
            let f_res = fenwick.update_size(idx, new_size);
            let l_res = linear.update_size(idx, new_size);
            assert_eq!(f_res, l_res);
        }

        assert!((fenwick.total() - linear.total()).abs() < 1e-6, "total mismatch: {} vs {}", fenwick.total(), linear.total());
        for i in 0..=(count + 5) {
            assert!((fenwick.offset_of(i) - linear.offset_of(i)).abs() < 1e-6, "offset mismatch at {}: {} vs {}", i, fenwick.offset_of(i), linear.offset_of(i));
        }

        // Test resolve_axis equivalence
        for scroll in [0.0, 10.0, 35.0, 100.5, 5000.0, 200_000.0, 400_000.0] {
            let f_axis = resolve_axis(&fenwick, scroll, 600.0, 5);
            let l_axis = linear.resolve_axis(scroll, 600.0, 5);
            assert_eq!(f_axis.buffered_start, l_axis.buffered_start);
            assert_eq!(f_axis.buffered_end, l_axis.buffered_end);
            assert_eq!(f_axis.viewport_start, l_axis.viewport_start);
            assert_eq!(f_axis.viewport_end, l_axis.viewport_end);
            assert!((f_axis.translate - l_axis.translate).abs() < 1e-9);
        }
    }

    #[test]
    fn test_fenwick_vs_linear_large_scale_spot_check() {
        let count = 5_000_000;
        let mut fenwick = Fenwick::new(40.0, count);
        let mut linear_sizes = vec![40.0; count];

        let mut rng = SimpleRng::new(12345);
        for _ in 0..50 {
            let idx = rng.next_usize(count);
            let new_size = rng.next_f64(10.0, 200.0);
            let updated_f = fenwick.update_size(idx, new_size);
            let old_size = linear_sizes[idx];
            if (old_size - new_size).abs() >= 0.5 {
                linear_sizes[idx] = new_size;
                assert!(updated_f);
            }
        }

        // Spot check offset_of at 5_000_000 and other critical checkpoints
        let spot_check_indices = [0, 1, 100, 1000, 50_000, 1_000_000, 2_500_000, 4_999_999, 5_000_000];
        for &idx in &spot_check_indices {
            let expected: f64 = linear_sizes[..idx.min(count)].iter().sum();
            let actual = fenwick.offset_of(idx);
            assert!((expected - actual).abs() < 1e-6, "Mismatch at idx {}: expected {}, got {}", idx, expected, actual);
        }
    }

    #[test]
    fn test_fenwick_append_and_remove() {
        let mut fenwick = Fenwick::new(40.0, 100);
        let mut linear = LinearRegistry::new(100, 40.0);

        fenwick.append(50, 60.0);
        linear.append(50, 60.0);

        assert_eq!(fenwick.len(), 150);
        assert!((fenwick.total() - linear.total()).abs() < 1e-6);
        for i in 0..=150 {
            assert!((fenwick.offset_of(i) - linear.offset_of(i)).abs() < 1e-6);
        }

        let f_delta = fenwick.remove_from_head(30);
        let l_delta = linear.remove_from_head(30);
        assert!((f_delta - l_delta).abs() < 1e-6);
        assert_eq!(fenwick.len(), 120);
        assert!((fenwick.total() - linear.total()).abs() < 1e-6);
        for i in 0..=120 {
            assert!((fenwick.offset_of(i) - linear.offset_of(i)).abs() < 1e-6);
        }
    }

    #[test]
    fn test_edge_cases() {
        // Zero count
        let mut empty = Fenwick::new(40.0, 0);
        assert_eq!(empty.len(), 0);
        assert!(empty.is_empty());
        assert_eq!(empty.total(), 0.0);
        assert_eq!(empty.offset_of(0), 0.0);
        assert_eq!(empty.offset_of(5), 0.0);
        assert!(!empty.update_size(0, 50.0));

        let empty_axis = resolve_axis(&empty, 100.0, 500.0, 5);
        assert_eq!(empty_axis.buffered_start, 0);
        assert_eq!(empty_axis.buffered_end, 0);
        assert_eq!(empty_axis.translate, 0.0);

        // Non-finite updates
        let mut f = Fenwick::new(40.0, 10);
        assert!(!f.update_size(0, f64::NAN));
        assert!(!f.update_size(0, f64::INFINITY));
        assert!(!f.update_size(0, f64::NEG_INFINITY));

        // Sub-0.5px delta short circuiting
        assert!(!f.update_size(0, 40.4));
        assert_eq!(f.offset_of(1), 40.0);
        assert!(f.update_size(0, 40.5));
        assert_eq!(f.offset_of(1), 40.5);

        // Out of bounds
        assert!(!f.update_size(10, 50.0));
    }

    #[test]
    fn test_virtual_scroll_registry_public_api() {
        let mut reg = VirtualScrollRegistry::new(100, 20, 50.0, 100.0);
        assert_eq!(reg.row_count(), 100);
        assert_eq!(reg.col_count(), 20);
        assert_eq!(reg.get_total_height(), 5000.0);
        assert_eq!(reg.get_total_width(), 2000.0);
        assert_eq!(reg.get_row_offset(10), 500.0);
        assert_eq!(reg.get_col_offset(5), 500.0);

        assert!(reg.update_row_height(0, 80.0));
        assert_eq!(reg.get_row_offset(1), 80.0);
        assert_eq!(reg.get_total_height(), 5030.0);

        assert!(reg.update_col_width(0, 150.0));
        assert_eq!(reg.get_col_offset(1), 150.0);
        assert_eq!(reg.get_total_width(), 2050.0);

        let geom = reg.compute_geometry(200.0, 300.0, 400.0, 500.0, 2, true, true);
        assert!(geom.viewport_start_row > 0);
        assert!(geom.viewport_end_row >= geom.viewport_start_row);
        assert!(geom.viewport_start_col > 0);
        assert!(geom.viewport_end_col >= geom.viewport_start_col);
    }
}
