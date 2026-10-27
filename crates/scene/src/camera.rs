// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Persistent camera parameters. Spatial pose belongs to the owning object's FrameId.
use spaceeyes_foundation::CoreError;

#[derive(Clone, Debug, PartialEq)]
pub struct CameraState {
    position_m: [f64; 3],
    orientation_wxyz: [f64; 4],
    vertical_fov_radians: f64,
    near_m: f64,
    far_m: f64,
}
// All floating-point fields are finite, validated at the only constructor, and immutable.
impl Eq for CameraState {}
impl CameraState {
    pub fn new(
        position_m: [f64; 3],
        orientation_wxyz: [f64; 4],
        vertical_fov_radians: f64,
        near_m: f64,
        far_m: f64,
    ) -> Result<Self, CoreError> {
        if !position_m
            .iter()
            .chain(orientation_wxyz.iter())
            .chain([vertical_fov_radians, near_m, far_m].iter())
            .all(|x| x.is_finite())
            || vertical_fov_radians <= 0.0
            || vertical_fov_radians >= std::f64::consts::PI
            || near_m <= 0.0
            || far_m <= near_m
        {
            return Err(CoreError::InvalidState);
        }
        let norm = orientation_wxyz.iter().fold(0.0f64, |n, x| n.hypot(*x));
        if !norm.is_finite() || norm <= 1e-12 {
            return Err(CoreError::InvalidState);
        }
        Ok(Self {
            position_m,
            orientation_wxyz: orientation_wxyz.map(|v| v / norm),
            vertical_fov_radians,
            near_m,
            far_m,
        })
    }
    pub fn position_m(&self) -> [f64; 3] {
        self.position_m
    }
    pub fn orientation_wxyz(&self) -> [f64; 4] {
        self.orientation_wxyz
    }
    pub fn vertical_fov_radians(&self) -> f64 {
        self.vertical_fov_radians
    }
    pub fn near_m(&self) -> f64 {
        self.near_m
    }
    pub fn far_m(&self) -> f64 {
        self.far_m
    }
}
