// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Scene holds logical mesh references; Resources owns geometry data.
use crate::Material;
use spaceeyes_foundation::{CoreError, ResourceId};
#[derive(Clone, Debug, PartialEq)]
pub struct MeshInstance {
    geometry: ResourceId,
    material: Material,
}
impl Eq for MeshInstance {}
impl MeshInstance {
    pub fn new(geometry: ResourceId, base_color: [f32; 3]) -> Result<Self, CoreError> {
        Ok(Self::with_material(
            geometry,
            Material::new(base_color, None, Default::default(), false)?,
        ))
    }
    pub fn with_material(geometry: ResourceId, material: Material) -> Self {
        Self { geometry, material }
    }
    pub fn material(&self) -> &Material {
        &self.material
    }
    pub fn geometry(&self) -> &ResourceId {
        &self.geometry
    }
    pub fn base_color(&self) -> [f32; 3] {
        self.material.base_color()
    }
}
