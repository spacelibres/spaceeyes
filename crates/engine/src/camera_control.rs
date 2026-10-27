// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! One-shot camera changes go through the same authoritative Scene transaction.
use crate::Engine;
use spaceeyes_foundation::{CoreError, ObjectId, Revision};
use spaceeyes_scene::{CameraState, CameraTracking, SceneCommand};
use spaceeyes_spatial::{Quatd, RigidTransform, SpatialError, Vec3d};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CameraControlError {
    Domain(CoreError),
    Spatial(SpatialError),
}
impl Engine {
    pub fn focus_camera(
        &mut self,
        expected_revision: Revision,
        camera: &ObjectId,
        target: &ObjectId,
        distance_m: f64,
        follow: bool,
    ) -> Result<Revision, CameraControlError> {
        use CameraControlError::{Domain, Spatial};
        if !matches!(
            self.state(),
            crate::EngineState::Ready | crate::EngineState::Running
        ) {
            return Err(Domain(CoreError::AlreadyStopped));
        }
        if self.scene().revision() != expected_revision {
            return Err(Domain(CoreError::RevisionConflict));
        }
        let object = self
            .scene()
            .get(camera)
            .ok_or(Domain(CoreError::UnknownObject))?;
        let state = object.camera().ok_or(Domain(CoreError::InvalidState))?;
        if !distance_m.is_finite() || distance_m <= state.near_m() || distance_m >= state.far_m() {
            return Err(Domain(CoreError::InvalidState));
        }
        let reference = object.frame().ok_or(Domain(CoreError::UnknownFrame))?;
        let target_object = self
            .scene()
            .get(target)
            .ok_or(Domain(CoreError::UnknownObject))?;
        if target_object.camera().is_some() {
            return Err(Domain(CoreError::InvalidState));
        }
        let target_reference = target_object
            .frame()
            .ok_or(Domain(CoreError::UnknownFrame))?;
        let frame = self.publish_frame(reference).map_err(Spatial)?;
        let anchor = match spaceeyes_rendering::target_anchor(&frame, target) {
            Ok(pose) => pose,
            Err(_) => {
                self.resolve_frame(target_reference, reference, self.clock().instant())
                    .map_err(Spatial)?;
                return Err(Domain(CoreError::ResourceUnavailable));
            }
        };
        let local = RigidTransform::new(
            Vec3d {
                x: 0.0,
                y: 0.0,
                z: distance_m,
            },
            Quatd::IDENTITY,
        )
        .map_err(Spatial)?;
        let pose = anchor.after(local);
        let position = pose.translation_m;
        let rotation = pose.rotation;
        let tracking = if follow {
            Some(CameraTracking::new(target.clone(), distance_m).map_err(Domain)?)
        } else {
            None
        };
        let next = CameraState::new_with_projection(
            [position.x, position.y, position.z],
            [rotation.w, rotation.x, rotation.y, rotation.z],
            state.projection(),
            state.near_m(),
            state.far_m(),
        )
        .map_err(Domain)?
        .with_tracking(tracking)
        .map_err(Domain)?;
        self.submit_scene(
            expected_revision,
            &[SceneCommand::SetCamera {
                object: camera.clone(),
                camera: Some(next),
            }],
        )
        .map_err(Domain)
    }
}
