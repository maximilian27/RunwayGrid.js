//! Core layout data structures and types for the Runway layout engine.

use std::cmp::Ordering;
use wasm_bindgen::prelude::*;

pub use crate::constants::*;

/// Fenwick tree (Binary Indexed Tree) providing O(log N) point updates
/// and O(log N) prefix-sum queries for virtual scroll dimensions.
#[derive(Clone, Debug)]
pub struct Fenwick {
    pub tree: Vec<f64>,   // 1-indexed internal BIT
    pub sizes: Vec<f64>,  // actual per-row/col sizes, needed to read back old values on update
}

impl Fenwick {
    pub fn new(default_size: f64, count: usize) -> Self {
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

    /// Prefix sum of [0, index) — same contract as `offset_of()`.
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
        if self.sizes.is_empty() {
            return 0.0;
        }
        self.prefix_sum(index)
    }

    pub fn total(&self) -> f64 {
        self.prefix_sum(self.sizes.len())
    }

    pub fn len(&self) -> usize {
        self.sizes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.sizes.is_empty()
    }

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

    pub fn append(&mut self, count: usize, default_size: f64) {
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

    pub fn remove_from_head(&mut self, count: usize) -> f64 {
        let count = count.min(self.sizes.len());
        if count == 0 {
            return 0.0;
        }
        let height_delta = self.prefix_sum(count);
        self.sizes.drain(0..count);
        self.rebuild_tree();
        height_delta
    }

    pub fn rebuild_tree(&mut self) {
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
}

/// Result of resolving the visible (+buffered) window for a single axis.
#[derive(Clone, Debug, PartialEq)]
pub struct AxisRange {
    pub buffered_start: usize,
    pub buffered_end: usize,
    /// Strict (unbuffered) bounds - the indices actually intersecting the visible pixels,
    /// i.e. `buffered_start`/`buffered_end` with the `buffer_size` padding removed.
    pub viewport_start: usize,
    pub viewport_end: usize,
    /// Pixel offset (translate) between the buffered window's start and the current scroll
    /// position on this axis.
    pub translate: f64,
}

/// Structured 2D geometry payload: the visible+buffered row/column bounds plus the pixel
/// translation needed to align the recycled DOM matrix with the current scroll position.
/// All fields are `Copy` primitives, so `wasm-bindgen` exposes them as plain readable/writable
/// properties on the JS side without any extra glue code.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GridGeometryResult {
    pub start_row: usize,
    pub end_row: usize,
    pub start_col: usize,
    pub end_col: usize,
    /// Strict (unbuffered) row/column bounds - only the indices whose pixels actually
    /// intersect the viewport, i.e. `start_row`/`end_row`/`start_col`/`end_col` without the
    /// `buffer_size` padding on either side.
    pub viewport_start_row: usize,
    pub viewport_end_row: usize,
    pub viewport_start_col: usize,
    pub viewport_end_col: usize,
    pub translate_x: f64,
    pub translate_y: f64,
}
