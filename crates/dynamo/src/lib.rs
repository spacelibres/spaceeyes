// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! DYN decoding and evaluation for the Rust core.
//!
//! This crate owns the binary format and the ephemeris math. It is deliberately
//! free of network, filesystem, WASM and host bindings: a caller supplies bytes
//! and an explicit query time. The TypeScript package is a migration-time oracle,
//! not a runtime authority.
//!
//! Format summary (little-endian): i16 version (1 or 2), NUL-terminated point type
//! name (<= 16 ASCII bytes), u8 digits for v2, two f64 gravitational parameters
//! for `orb`, u8 has_points, then either an inline point block or a segment index.
//! Point records are W-first quaternions and fixed strides per type.

use std::fmt;

mod eval;
mod math;
mod parse;

pub use eval::{evaluate, Body, EvaluationKind, EvaluationReason, EvaluationState};
pub use parse::{parse_dyn, parse_dyn_segment, DynFile, DynHeader, DynInterval, DynSegment};

/// Why DYN bytes or an evaluation request were rejected. No partial value escapes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DynError {
    UnexpectedEnd {
        offset: usize,
        needed: usize,
        remaining: usize,
    },
    UnsupportedVersion(i16),
    InvalidPointType(String),
    NameTooLong(usize),
    NonAsciiName(usize),
    InvalidHasPoints(u8),
    NegativePointCount(i32),
    PointCountTooLarge(i32),
    PointBlockSize {
        expected: usize,
        found: usize,
    },
    NegativeSegmentCount(i32),
    SegmentTableSize {
        expected: usize,
        found: usize,
    },
    IndexInSegment,
}

/// The five DYN point layouts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PointType {
    Orb,
    Pos,
    Lin,
    Ori,
    Quat,
}

impl PointType {
    pub const ALL: [Self; 5] = [Self::Orb, Self::Pos, Self::Lin, Self::Ori, Self::Quat];

    pub fn name(self) -> &'static str {
        match self {
            Self::Orb => "orb",
            Self::Pos => "pos",
            Self::Lin => "lin",
            Self::Ori => "ori",
            Self::Quat => "quat",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "orb" => Some(Self::Orb),
            "pos" => Some(Self::Pos),
            "lin" => Some(Self::Lin),
            "ori" => Some(Self::Ori),
            "quat" => Some(Self::Quat),
            _ => None,
        }
    }

    /// Fixed record size in bytes, including the leading time.
    pub const fn stride(self) -> usize {
        match self {
            Self::Orb => 72,
            Self::Pos => 56,
            Self::Lin => 32,
            Self::Ori => 64,
            Self::Quat => 40,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    pub const ZERO: Self = Self {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    };

    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
}

/// W-first quaternion, matching the on-disk order and NASA's `set(w, x, y, z)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quat {
    pub w: f64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Quat {
    pub const IDENTITY: Self = Self {
        w: 1.0,
        x: 0.0,
        y: 0.0,
        z: 0.0,
    };

    pub fn is_finite(self) -> bool {
        self.w.is_finite() && self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }

    pub fn norm_squared(self) -> f64 {
        self.w * self.w + self.x * self.x + self.y * self.y + self.z * self.z
    }

    /// Unit quaternion; `None` for zero/non-finite input. Does not silently repair.
    pub fn normalized(self) -> Option<Self> {
        let norm = self.norm_squared().sqrt();
        if !norm.is_finite() || norm == 0.0 {
            return None;
        }
        Some(Self {
            w: self.w / norm,
            x: self.x / norm,
            y: self.y / norm,
            z: self.z / norm,
        })
    }

    pub fn conjugate(self) -> Self {
        Self {
            w: self.w,
            x: -self.x,
            y: -self.y,
            z: -self.z,
        }
    }

    pub fn dot(self, other: Self) -> f64 {
        self.w * other.w + self.x * other.x + self.y * other.y + self.z * other.z
    }

    /// Hamilton product; `q * p` applies `p` first, then `q`.
    pub fn multiply(self, other: Self) -> Self {
        Self {
            w: self.w * other.w - self.x * other.x - self.y * other.y - self.z * other.z,
            x: self.w * other.x + self.x * other.w + self.y * other.z - self.z * other.y,
            y: self.w * other.y - self.x * other.z + self.y * other.w + self.z * other.x,
            z: self.w * other.z + self.x * other.y - self.y * other.x + self.z * other.w,
        }
    }
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
pub enum DynPoint {
    Orb(OrbPoint),
    Pos(PosPoint),
    Lin(LinPoint),
    Ori(OriPoint),
    Quat(QuatPoint),
}

impl DynPoint {
    pub fn time(&self) -> f64 {
        match self {
            Self::Orb(point) => point.time,
            Self::Pos(point) => point.time,
            Self::Lin(point) => point.time,
            Self::Ori(point) => point.time,
            Self::Quat(point) => point.time,
        }
    }

    pub fn kind(&self) -> PointType {
        match self {
            Self::Orb(_) => PointType::Orb,
            Self::Pos(_) => PointType::Pos,
            Self::Lin(_) => PointType::Lin,
            Self::Ori(_) => PointType::Ori,
            Self::Quat(_) => PointType::Quat,
        }
    }
}

impl fmt::Display for DynError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnexpectedEnd {
                offset,
                needed,
                remaining,
            } => write!(
                f,
                "dynamo reader: need {needed} byte(s) at offset {offset}, only {remaining} available"
            ),
            Self::UnsupportedVersion(version) => {
                write!(f, "unsupported dynamo version {version}")
            }
            Self::InvalidPointType(name) => {
                write!(f, "invalid dynamo point type \"{name}\"")
            }
            Self::NameTooLong(max) => {
                write!(f, "dynamo reader: point name exceeds {max} bytes")
            }
            Self::NonAsciiName(offset) => {
                write!(f, "dynamo reader: point name is not ASCII at offset {offset}")
            }
            Self::InvalidHasPoints(flag) => write!(f, "invalid hasPoints flag {flag}"),
            Self::NegativePointCount(count) => write!(f, "negative point count {count}"),
            Self::PointCountTooLarge(count) => write!(f, "point count {count} is too large"),
            Self::PointBlockSize { expected, found } => write!(
                f,
                "point block size mismatch: expected {expected} bytes, found {found}"
            ),
            Self::NegativeSegmentCount(count) => write!(f, "negative segment count {count}"),
            Self::SegmentTableSize { expected, found } => write!(
                f,
                "segment table size mismatch: expected {expected} bytes, found {found}"
            ),
            Self::IndexInSegment => write!(f, "segment file unexpectedly contains an index"),
        }
    }
}

impl std::error::Error for DynError {}
