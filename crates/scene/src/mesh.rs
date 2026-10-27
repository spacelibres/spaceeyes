// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Scene holds logical mesh references; Resources owns geometry data.
use spaceeyes_foundation::{CoreError, ResourceId};
#[derive(Clone, Debug, PartialEq)]
pub struct MeshInstance {
    geometry: ResourceId,
    base_color: [f32; 3],
}
impl Eq for MeshInstance {}
impl MeshInstance {
    pub fn new(geometry: ResourceId, base_color: [f32; 3]) -> Result<Self, CoreError> {
        if !base_color
            .iter()
            .all(|c| c.is_finite() && (0.0..=1.0).contains(c))
        {
            return Err(CoreError::InvalidState);
        }
        Ok(Self {
            geometry,
            base_color,
        })
    }
    pub fn geometry(&self) -> &ResourceId {
        &self.geometry
    }
    pub fn base_color(&self) -> [f32; 3] {
        self.base_color
    }
}
