// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Strict DYN byte decoder.
//!
//! This crate only turns DYN bytes into neutral `spaceeyes-astro` samples; it does
//! not interpolate, solve Kepler equations, read clocks or touch the host. Reusable
//! astronomy algorithms live in `spaceeyes-astro`, numeric helpers in
//! `spaceeyes-math`, and time scales in `spaceeyes-time`.

use std::fmt;

mod parse;

pub use parse::{parse_dyn, parse_dyn_segment, DynFile, DynHeader, DynInterval, DynSegment};
pub use spaceeyes_astro::{
    EphemerisPoint as DynPoint, LinPoint, OrbPoint, OriPoint, PosPoint, Quat, QuatPoint, Vec3,
};

/// Why DYN bytes were rejected. No partial value escapes.
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

/// The five DYN on-disk point layouts (a format detail, not a domain kind).
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

impl fmt::Display for DynError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnexpectedEnd { offset, needed, remaining } => write!(
                f,
                "dynamo reader: need {needed} byte(s) at offset {offset}, only {remaining} available"
            ),
            Self::UnsupportedVersion(version) => write!(f, "unsupported dynamo version {version}"),
            Self::InvalidPointType(name) => write!(f, "invalid dynamo point type \"{name}\""),
            Self::NameTooLong(max) => write!(f, "dynamo reader: point name exceeds {max} bytes"),
            Self::NonAsciiName(offset) => write!(f, "dynamo reader: point name is not ASCII at offset {offset}"),
            Self::InvalidHasPoints(flag) => write!(f, "invalid hasPoints flag {flag}"),
            Self::NegativePointCount(count) => write!(f, "negative point count {count}"),
            Self::PointCountTooLarge(count) => write!(f, "point count {count} is too large"),
            Self::PointBlockSize { expected, found } => write!(f, "point block size mismatch: expected {expected} bytes, found {found}"),
            Self::NegativeSegmentCount(count) => write!(f, "negative segment count {count}"),
            Self::SegmentTableSize { expected, found } => write!(f, "segment table size mismatch: expected {expected} bytes, found {found}"),
            Self::IndexInSegment => write!(f, "segment file unexpectedly contains an index"),
        }
    }
}

impl std::error::Error for DynError {}
