// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Small, opaque display material; pixels remain owned by Resources.
use spaceeyes_foundation::{CoreError, ResourceId};
use spaceeyes_geometry::Sampling;
#[derive(Clone, Debug, PartialEq)]
pub struct Material {
    base_color: [f32; 3],
    texture: Option<ResourceId>,
    sampling: Sampling,
    unlit: bool,
    alpha: f32,
}
impl Eq for Material {}
impl Material {
    pub fn new(
        base_color: [f32; 3],
        texture: Option<ResourceId>,
        sampling: Sampling,
        unlit: bool,
    ) -> Result<Self, CoreError> {
        if !base_color
            .iter()
            .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
        {
            return Err(CoreError::InvalidState);
        }
        Ok(Self {
            base_color,
            texture,
            sampling,
            unlit,
            alpha: 1.0,
        })
    }
    /// Alpha is display-only and does not change ownership or scientific state.
    /// Values below 1.0 are drawn with alpha blending after opaque geometry.
    pub fn with_alpha(mut self, alpha: f32) -> Result<Self, CoreError> {
        if !alpha.is_finite() || !(0.0..=1.0).contains(&alpha) {
            return Err(CoreError::InvalidState);
        }
        self.alpha = alpha;
        Ok(self)
    }
    pub fn base_color(&self) -> [f32; 3] {
        self.base_color
    }
    pub fn texture(&self) -> Option<&ResourceId> {
        self.texture.as_ref()
    }
    pub fn sampling(&self) -> Sampling {
        self.sampling
    }
    pub fn unlit(&self) -> bool {
        self.unlit
    }
    pub fn alpha(&self) -> f32 {
        self.alpha
    }
}
