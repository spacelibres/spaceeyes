// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Generic opaque sphere display parameters; no astronomical meaning is implied.
use crate::Material;
use spaceeyes_foundation::CoreError;
#[derive(Clone, Debug, PartialEq)]
pub struct Sphere {
    radius_m: f64,
    material: Material,
}
// Finite, immutable fields validated by the only constructor exclude NaN.
impl Eq for Sphere {}
impl Sphere {
    pub fn new(radius_m: f64, base_color: [f32; 3]) -> Result<Self, CoreError> {
        Self::with_material(
            radius_m,
            Material::new(base_color, None, Default::default(), false)?,
        )
    }
    pub fn with_material(radius_m: f64, material: Material) -> Result<Self, CoreError> {
        if !radius_m.is_finite() || radius_m <= 0.0 {
            return Err(CoreError::InvalidState);
        }
        Ok(Self { radius_m, material })
    }
    pub fn material(&self) -> &Material {
        &self.material
    }
    pub fn radius_m(&self) -> f64 {
        self.radius_m
    }
    pub fn base_color(&self) -> [f32; 3] {
        self.material.base_color()
    }
}
