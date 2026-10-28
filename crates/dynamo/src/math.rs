// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Small vector/quaternion helpers with the reference implementation's semantics.
//! Every fallible helper returns `Option` so callers can report `invalid-samples`
//! instead of panicking on malformed input.

use crate::{Quat, Vec3};

pub(crate) fn scale(value: Vec3, factor: f64) -> Vec3 {
    Vec3 {
        x: value.x * factor,
        y: value.y * factor,
        z: value.z * factor,
    }
}

pub(crate) fn mix(start: Vec3, end: Vec3, fraction: f64) -> Vec3 {
    Vec3 {
        x: (1.0 - fraction) * start.x + fraction * end.x,
        y: (1.0 - fraction) * start.y + fraction * end.y,
        z: (1.0 - fraction) * start.z + fraction * end.z,
    }
}

pub(crate) fn quat_scale(value: Quat) -> f64 {
    value
        .w
        .abs()
        .max(value.x.abs())
        .max(value.y.abs())
        .max(value.z.abs())
}

/// Normalize by the largest component first so subnormal or huge finite
/// quaternions keep their rotation instead of rounding or overflowing.
pub(crate) fn normalize_quat(value: Quat) -> Option<Quat> {
    let maximum = quat_scale(value);
    if !maximum.is_finite() || maximum == 0.0 {
        return None;
    }
    let w = value.w / maximum;
    let x = value.x / maximum;
    let y = value.y / maximum;
    let z = value.z / maximum;
    let length = w.hypot(x).hypot(y).hypot(z);
    if !length.is_finite() || length == 0.0 {
        return None;
    }
    Some(Quat {
        w: w / length,
        x: x / length,
        y: y / length,
        z: z / length,
    })
}

pub(crate) fn rotate_by_quat(value: Vec3, quaternion: Quat) -> Vec3 {
    let (x, y, z, w) = (quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    let tx = 2.0 * (y * value.z - z * value.y);
    let ty = 2.0 * (z * value.x - x * value.z);
    let tz = 2.0 * (x * value.y - y * value.x);
    Vec3 {
        x: value.x + w * tx + (y * tz - z * ty),
        y: value.y + w * ty + (z * tx - x * tz),
        z: value.z + w * tz + (x * ty - y * tx),
    }
}

pub(crate) fn direction(value: Vec3) -> Option<Vec3> {
    let maximum = value.x.abs().max(value.y.abs()).max(value.z.abs());
    if !maximum.is_finite() || maximum == 0.0 {
        return None;
    }
    let x = value.x / maximum;
    let y = value.y / maximum;
    let z = value.z / maximum;
    let length = x.hypot(y).hypot(z);
    if !length.is_finite() || length == 0.0 {
        return None;
    }
    Some(Vec3 {
        x: x / length,
        y: y / length,
        z: z / length,
    })
}

fn clamp(value: f64) -> f64 {
    value.clamp(-1.0, 1.0)
}

/// Shortest-path quaternion interpolation with the reference linear threshold.
pub(crate) fn slerp_quat(start: Quat, end: Quat, fraction: f64) -> Option<Quat> {
    let first = normalize_quat(start)?;
    let last = normalize_quat(end)?;
    let dot = first.w * last.w + first.x * last.x + first.y * last.y + first.z * last.z;
    let sign = if dot < 0.0 { -1.0 } else { 1.0 };
    let angle = clamp(dot.abs()).acos();
    let spherical = dot.abs() <= 0.9995;
    let (start_weight, end_weight) = if spherical {
        (
            sign * ((1.0 - fraction) * angle).sin() / angle.sin(),
            (fraction * angle).sin() / angle.sin(),
        )
    } else {
        (sign * (1.0 - fraction), fraction)
    };
    normalize_quat(Quat {
        w: start_weight * first.w + end_weight * last.w,
        x: start_weight * first.x + end_weight * last.x,
        y: start_weight * first.y + end_weight * last.y,
        z: start_weight * first.z + end_weight * last.z,
    })
}

/// Interpolate vector directions spherically while interpolating magnitudes
/// linearly. Exactly opposite directions fall back to the linear limit.
pub(crate) fn slerp_vector(start: Vec3, end: Vec3, fraction: f64) -> Option<Vec3> {
    let start_length = start.x.hypot(start.y).hypot(start.z);
    let end_length = end.x.hypot(end.y).hypot(end.z);
    if start_length == 0.0 || end_length == 0.0 {
        return Some(mix(start, end, fraction));
    }
    let first = direction(start)?;
    let last = direction(end)?;
    let cosine = clamp(first.x * last.x + first.y * last.y + first.z * last.z);
    let angle = cosine.acos();
    if angle <= 0.017_453_277_77 || cosine < -1.0 + 1e-12 {
        return Some(mix(start, end, fraction));
    }
    let start_weight = ((1.0 - fraction) * angle).sin() / angle.sin();
    let end_weight = (fraction * angle).sin() / angle.sin();
    let length = (1.0 - fraction) * start_length + fraction * end_length;
    Some(Vec3 {
        x: (first.x * start_weight + last.x * end_weight) * length,
        y: (first.y * start_weight + last.y * end_weight) * length,
        z: (first.z * start_weight + last.z * end_weight) * length,
    })
}
