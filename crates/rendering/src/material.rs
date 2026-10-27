// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Read-only prepared material. Asset identity/ownership stays in Resources.
use crate::RenderError;
use spaceeyes_foundation::ResourceId;
use spaceeyes_geometry::{Sampling, TextureData};
use spaceeyes_snapshot::FrameSnapshot;
use std::sync::Arc;
#[derive(Clone, Debug)]
pub struct DrawMaterial {
    pub base_color: [f32; 3],
    pub texture: Option<Arc<TextureData>>,
    pub sampling: Sampling,
    pub unlit: bool,
}
impl DrawMaterial {
    pub fn plain(base_color: [f32; 3]) -> Self {
        Self {
            base_color,
            texture: None,
            sampling: Default::default(),
            unlit: false,
        }
    }
    pub(crate) fn prepare(
        frame: &FrameSnapshot,
        base_color: [f32; 3],
        texture: Option<&ResourceId>,
        sampling: Sampling,
        unlit: bool,
    ) -> Result<Self, RenderError> {
        let texture = texture
            .map(|id| {
                frame
                    .textures
                    .iter()
                    .find(|asset| &asset.resource == id)
                    .map(|asset| asset.texture.clone())
                    .ok_or(RenderError::InvalidFrame)
            })
            .transpose()?;
        Ok(Self {
            base_color,
            texture,
            sampling,
            unlit,
        })
    }
}
