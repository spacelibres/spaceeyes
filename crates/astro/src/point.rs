// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Neutral ephemeris samples and astronomy algorithms.
//!
//! This crate owns interpolation, orbit geometry and Kepler solving. It knows
//! nothing about DYN bytes, files, networks, clocks or protocol messages: a data
//! format decoder maps its records into these types and calls the algorithms.

use spaceeyes_math::{Quatd as Quat, Vec3d as Vec3};

/// Identifies the physical meaning of an ephemeris sample.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PointKind {
    Orb,
    Pos,
    Lin,
    Ori,
    Quat,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OrbPoint {
    pub time: f64,
    pub semi_major_axis: f64,
    pub eccentricity: f64,
    pub mean_angular_motion: f64,
    pub mean_anomaly_at_epoch: f64,
    pub orientation: Quat,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PosPoint {
    pub time: f64,
    pub position: Vec3,
    pub velocity: Vec3,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LinPoint {
    pub time: f64,
    pub position: Vec3,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OriPoint {
    pub time: f64,
    pub orientation: Quat,
    pub angular_velocity: Vec3,
}

#[derive(Clone, Debug, PartialEq)]
pub struct QuatPoint {
    pub time: f64,
    pub orientation: Quat,
}

#[derive(Clone, Debug, PartialEq)]
pub enum EphemerisPoint {
    Orb(OrbPoint),
    Pos(PosPoint),
    Lin(LinPoint),
    Ori(OriPoint),
    Quat(QuatPoint),
}

impl EphemerisPoint {
    pub fn time(&self) -> f64 {
        match self {
            Self::Orb(point) => point.time,
            Self::Pos(point) => point.time,
            Self::Lin(point) => point.time,
            Self::Ori(point) => point.time,
            Self::Quat(point) => point.time,
        }
    }

    pub fn kind(&self) -> PointKind {
        match self {
            Self::Orb(_) => PointKind::Orb,
            Self::Pos(_) => PointKind::Pos,
            Self::Lin(_) => PointKind::Lin,
            Self::Ori(_) => PointKind::Ori,
            Self::Quat(_) => PointKind::Quat,
        }
    }
}

/// Closed time interval covered by a decoded window.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Interval {
    pub min: f64,
    pub max: f64,
}
