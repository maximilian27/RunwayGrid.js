//! Layout engine constants.

/// Threshold in pixels below which row height or column width updates
/// are ignored to prevent sub-pixel layout thrashing and unnecessary prefix-sum recalculations.
pub const SIZE_CHANGE_THRESHOLD: f64 = 0.5;

/// Alias for `SIZE_CHANGE_THRESHOLD` matching resize listener nomenclature.
pub const RESIZE_THRESHOLD: f64 = SIZE_CHANGE_THRESHOLD;

/// Floating-point epsilon used for precision tolerance comparisons in tests and measurements.
pub const FLOAT_EPSILON: f64 = 1e-6;

/// Default buffer size for off-screen row and column pre-rendering.
pub const DEFAULT_BUFFER_SIZE: usize = 5;
