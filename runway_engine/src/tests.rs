use super::*;
use std::cmp::Ordering;

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
        if self.prefix_sums.is_empty() {
            0.0
        } else {
            *self.prefix_sums.last().unwrap()
        }
    }

    fn update_size(&mut self, index: usize, new_size: f64) -> bool {
        if index >= self.sizes.len() || !new_size.is_finite() {
            return false;
        }
        let old_size = self.sizes[index];
        if (old_size - new_size).abs() < SIZE_CHANGE_THRESHOLD {
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
            return AxisRange {
                buffered_start: 0,
                buffered_end: 0,
                viewport_start: 0,
                viewport_end: 0,
                translate: 0.0,
            };
        }
        let max_scroll = (self.total() - viewport_size).max(0.0);
        let clamped_scroll = if scroll.is_finite() {
            scroll.min(max_scroll).max(0.0)
        } else {
            0.0
        };
        let start_index = match self.prefix_sums.binary_search_by(|probe| {
            probe.partial_cmp(&clamped_scroll).unwrap_or(Ordering::Equal)
        }) {
            Ok(index) => index + 1,
            Err(index) => index,
        }
        .min(total - 1);

        let scroll_end = clamped_scroll + viewport_size;
        let end_index = match self.prefix_sums.binary_search_by(|probe| {
            probe.partial_cmp(&scroll_end).unwrap_or(Ordering::Equal)
        }) {
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
    fn new(seed: u64) -> Self {
        Self(seed)
    }
    fn next_u64(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
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

    assert!(
        (fenwick.total() - linear.total()).abs() < FLOAT_EPSILON,
        "total mismatch: {} vs {}",
        fenwick.total(),
        linear.total()
    );
    for i in 0..=(count + 5) {
        assert!(
            (fenwick.offset_of(i) - linear.offset_of(i)).abs() < FLOAT_EPSILON,
            "offset mismatch at {}: {} vs {}",
            i,
            fenwick.offset_of(i),
            linear.offset_of(i)
        );
    }

    // Test resolve_axis equivalence
    for scroll in [0.0, 10.0, 35.0, 100.5, 5000.0, 200_000.0, 400_000.0] {
        let f_axis = resolve_axis(&fenwick, scroll, 600.0, DEFAULT_BUFFER_SIZE);
        let l_axis = linear.resolve_axis(scroll, 600.0, DEFAULT_BUFFER_SIZE);
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
        if (old_size - new_size).abs() >= SIZE_CHANGE_THRESHOLD {
            linear_sizes[idx] = new_size;
            assert!(updated_f);
        }
    }

    // Spot check offset_of at 5_000_000 and other critical checkpoints
    let spot_check_indices = [
        0, 1, 100, 1000, 50_000, 1_000_000, 2_500_000, 4_999_999, 5_000_000,
    ];
    for &idx in &spot_check_indices {
        let expected: f64 = linear_sizes[..idx.min(count)].iter().sum();
        let actual = fenwick.offset_of(idx);
        assert!(
            (expected - actual).abs() < FLOAT_EPSILON,
            "Mismatch at idx {}: expected {}, got {}",
            idx,
            expected,
            actual
        );
    }
}

#[test]
fn test_fenwick_append_and_remove() {
    let mut fenwick = Fenwick::new(40.0, 100);
    let mut linear = LinearRegistry::new(100, 40.0);

    fenwick.append(50, 60.0);
    linear.append(50, 60.0);

    assert_eq!(fenwick.len(), 150);
    assert!((fenwick.total() - linear.total()).abs() < FLOAT_EPSILON);
    for i in 0..=150 {
        assert!((fenwick.offset_of(i) - linear.offset_of(i)).abs() < FLOAT_EPSILON);
    }

    let f_delta = fenwick.remove_from_head(30);
    let l_delta = linear.remove_from_head(30);
    assert!((f_delta - l_delta).abs() < FLOAT_EPSILON);
    assert_eq!(fenwick.len(), 120);
    assert!((fenwick.total() - linear.total()).abs() < FLOAT_EPSILON);
    for i in 0..=120 {
        assert!((fenwick.offset_of(i) - linear.offset_of(i)).abs() < FLOAT_EPSILON);
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

    let empty_axis = resolve_axis(&empty, 100.0, 500.0, DEFAULT_BUFFER_SIZE);
    assert_eq!(empty_axis.buffered_start, 0);
    assert_eq!(empty_axis.buffered_end, 0);
    assert_eq!(empty_axis.translate, 0.0);

    // Non-finite updates
    let mut f = Fenwick::new(40.0, 10);
    assert!(!f.update_size(0, f64::NAN));
    assert!(!f.update_size(0, f64::INFINITY));
    assert!(!f.update_size(0, f64::NEG_INFINITY));

    // Sub-threshold delta short circuiting
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

#[test]
fn test_constants_and_module_structure() {
    assert_eq!(SIZE_CHANGE_THRESHOLD, 0.5);
    assert_eq!(RESIZE_THRESHOLD, 0.5);
    assert_eq!(DEFAULT_BUFFER_SIZE, 5);
    assert_eq!(FLOAT_EPSILON, 1e-6);

    // Assert access through submodules
    assert_eq!(crate::constants::SIZE_CHANGE_THRESHOLD, 0.5);
    assert_eq!(crate::types::SIZE_CHANGE_THRESHOLD, 0.5);
    assert_eq!(crate::structs::SIZE_CHANGE_THRESHOLD, 0.5);

    // Verify GridGeometryResult derive traits
    let geom = GridGeometryResult {
        start_row: 0,
        end_row: 10,
        start_col: 0,
        end_col: 5,
        viewport_start_row: 1,
        viewport_end_row: 9,
        viewport_start_col: 1,
        viewport_end_col: 4,
        translate_x: 0.0,
        translate_y: 0.0,
    };
    let cloned = geom;
    assert_eq!(geom, cloned);
}
