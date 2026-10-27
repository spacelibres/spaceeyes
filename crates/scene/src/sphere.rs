//! Generic opaque sphere display parameters; no astronomical meaning is implied.
use spaceeyes_foundation::CoreError;
#[derive(Clone, Debug, PartialEq)]
pub struct Sphere {
    radius_m: f64,
    base_color: [f32; 3],
}
// Finite, immutable fields validated by the only constructor exclude NaN.
impl Eq for Sphere {}
impl Sphere {
    pub fn new(radius_m: f64, base_color: [f32; 3]) -> Result<Self, CoreError> {
        if !radius_m.is_finite()
            || radius_m <= 0.0
            || !base_color
                .iter()
                .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
        {
            return Err(CoreError::InvalidState);
        }
        Ok(Self {
            radius_m,
            base_color,
        })
    }
    pub fn radius_m(&self) -> f64 {
        self.radius_m
    }
    pub fn base_color(&self) -> [f32; 3] {
        self.base_color
    }
}
