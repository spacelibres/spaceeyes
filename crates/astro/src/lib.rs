// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Astronomy algorithms over neutral ephemeris samples.
//!
//! Time scales and calendars live in `spaceeyes-time`; DYN byte decoding lives in
//! `spaceeyes-dynamo`. This crate owns the common interpolation, Kepler and orbit
//! geometry that any data source or future feature can reuse.

mod evaluate;
mod orbit;
mod point;

pub use evaluate::{
    evaluate, Body, EvaluationKind, EvaluationReason, EvaluationState, MassParameters,
};
pub use orbit::{nearest_orb_point, orbit_polyline, orbit_position_at, solve_eccentric_anomaly};
pub use point::{
    EphemerisPoint, Interval, LinPoint, OrbPoint, OriPoint, PointKind, PosPoint, QuatPoint,
};
pub use spaceeyes_math::{Quatd as Quat, Vec3d as Vec3};
