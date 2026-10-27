// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! One immutable picking view of a successfully presented frame, never scene authority.
use crate::SessionStatus;
use spaceeyes_rendering::{PreparedFrame, RenderError};
use spaceeyes_scene::SceneObject;
use spaceeyes_snapshot::FrameSnapshot;

pub struct PresentedSelection {
    prepared: PreparedFrame,
    objects: Vec<SceneObject>,
    status: SessionStatus,
}
impl PresentedSelection {
    pub fn new(frame: &FrameSnapshot, prepared: PreparedFrame, status: SessionStatus) -> Self {
        Self {
            prepared,
            objects: frame.scene.objects.clone(),
            status,
        }
    }
    pub fn pick(
        &self,
        current: &SessionStatus,
        sequence: u64,
        x: f32,
        y: f32,
    ) -> Result<Option<&SceneObject>, RenderError> {
        if !x.is_finite() || !y.is_finite() || x.abs() > 1.0 || y.abs() > 1.0 {
            return Err(RenderError::InvalidFrame);
        }
        if current != &self.status || sequence != self.status.frame_sequence {
            return Err(RenderError::StalePick);
        }
        Ok(self
            .prepared
            .pick(x, y)
            .and_then(|pick| self.objects.iter().find(|o| o.id() == &pick.object)))
    }
}
