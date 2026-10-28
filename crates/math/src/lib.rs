// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Shared numeric types and algorithms. Domain crates own validation and state;
//! this crate owns vectors, quaternions, interpolation and the common helpers so
//! those implementations exist exactly once.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Vec3d {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3d {
    pub const ZERO: Self = Self {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    };

    pub fn finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }

    pub fn is_finite(self) -> bool {
        self.finite()
    }

    pub fn add_vec(self, rhs: Self) -> Self {
        Self {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
            z: self.z + rhs.z,
        }
    }

    pub fn sub_vec(self, rhs: Self) -> Self {
        Self {
            x: self.x - rhs.x,
            y: self.y - rhs.y,
            z: self.z - rhs.z,
        }
    }

    pub fn cross(self, rhs: Self) -> Self {
        Self {
            x: self.y * rhs.z - self.z * rhs.y,
            y: self.z * rhs.x - self.x * rhs.z,
            z: self.x * rhs.y - self.y * rhs.x,
        }
    }

    pub fn negated(self) -> Self {
        Self {
            x: -self.x,
            y: -self.y,
            z: -self.z,
        }
    }

    pub fn dot(self, rhs: Self) -> f64 {
        self.x * rhs.x + self.y * rhs.y + self.z * rhs.z
    }

    pub fn length(self) -> f64 {
        self.x.hypot(self.y).hypot(self.z)
    }

    pub fn scale(self, factor: f64) -> Self {
        Self {
            x: self.x * factor,
            y: self.y * factor,
            z: self.z * factor,
        }
    }
}

/// W-first quaternion, matching the DYN on-disk order and NASA's `set(w, x, y, z)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quatd {
    pub w: f64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Quatd {
    pub const IDENTITY: Self = Self {
        w: 1.0,
        x: 0.0,
        y: 0.0,
        z: 0.0,
    };

    pub fn finite(self) -> bool {
        self.w.is_finite() && self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }

    pub fn is_finite(self) -> bool {
        self.finite()
    }

    pub fn norm_squared(self) -> f64 {
        self.w * self.w + self.x * self.x + self.y * self.y + self.z * self.z
    }

    /// Largest absolute component, used as the first normalization scale.
    pub fn scale(self) -> f64 {
        self.w
            .abs()
            .max(self.x.abs())
            .max(self.y.abs())
            .max(self.z.abs())
    }

    /// Normalize by the largest component first so subnormal or huge finite
    /// quaternions keep their rotation instead of rounding or overflowing.
    pub fn normalized(self) -> Option<Self> {
        let maximum = self.scale();
        if !maximum.is_finite() || maximum == 0.0 {
            return None;
        }
        let w = self.w / maximum;
        let x = self.x / maximum;
        let y = self.y / maximum;
        let z = self.z / maximum;
        let length = w.hypot(x).hypot(y).hypot(z);
        if !length.is_finite() || length == 0.0 {
            return None;
        }
        Some(Self {
            w: w / length,
            x: x / length,
            y: y / length,
            z: z / length,
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

    /// Hamilton product; `a * b` applies `b` first when used as a rotation.
    pub fn multiply(self, other: Self) -> Self {
        Self {
            w: self.w * other.w - self.x * other.x - self.y * other.y - self.z * other.z,
            x: self.w * other.x + self.x * other.w + self.y * other.z - self.z * other.y,
            y: self.w * other.y - self.x * other.z + self.y * other.w + self.z * other.x,
            z: self.w * other.z + self.x * other.y - self.y * other.x + self.z * other.w,
        }
    }

    /// Active rotation of a vector by this quaternion.
    pub fn rotate(self, value: Vec3d) -> Vec3d {
        let vector = Self {
            w: 0.0,
            x: value.x,
            y: value.y,
            z: value.z,
        };
        let rotated = self.multiply(vector).multiply(self.conjugate());
        Vec3d {
            x: rotated.x,
            y: rotated.y,
            z: rotated.z,
        }
    }
}

pub fn quat_scale(value: Quatd) -> f64 {
    value.scale()
}

pub fn normalize_quat(value: Quatd) -> Option<Quatd> {
    value.normalized()
}

pub fn rotate_by_quat(value: Vec3d, quaternion: Quatd) -> Vec3d {
    quaternion.rotate(value)
}

pub fn scale(value: Vec3d, factor: f64) -> Vec3d {
    value.scale(factor)
}

pub fn mix(start: Vec3d, end: Vec3d, fraction: f64) -> Vec3d {
    Vec3d {
        x: (1.0 - fraction) * start.x + fraction * end.x,
        y: (1.0 - fraction) * start.y + fraction * end.y,
        z: (1.0 - fraction) * start.z + fraction * end.z,
    }
}

pub fn direction(value: Vec3d) -> Option<Vec3d> {
    let length = value.length();
    if !length.is_finite() || length == 0.0 {
        return None;
    }
    Some(Vec3d {
        x: value.x / length,
        y: value.y / length,
        z: value.z / length,
    })
}

fn clamp(value: f64) -> f64 {
    value.clamp(-1.0, 1.0)
}

/// Shortest-path quaternion interpolation with the reference linear threshold.
pub fn slerp_quat(start: Quatd, end: Quatd, fraction: f64) -> Option<Quatd> {
    let first = start.normalized()?;
    let last = end.normalized()?;
    let dot = first.dot(last);
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
    Quatd {
        w: start_weight * first.w + end_weight * last.w,
        x: start_weight * first.x + end_weight * last.x,
        y: start_weight * first.y + end_weight * last.y,
        z: start_weight * first.z + end_weight * last.z,
    }
    .normalized()
}

/// Interpolate vector directions spherically while interpolating magnitudes
/// linearly. Exactly opposite directions fall back to the linear limit.
pub fn slerp_vector(start: Vec3d, end: Vec3d, fraction: f64) -> Option<Vec3d> {
    let start_length = start.length();
    let end_length = end.length();
    if start_length == 0.0 || end_length == 0.0 {
        return Some(mix(start, end, fraction));
    }
    let first = direction(start)?;
    let last = direction(end)?;
    let cosine = clamp(first.dot(last));
    let angle = cosine.acos();
    if angle <= 0.017_453_277_77 || cosine < -1.0 + 1e-12 {
        return Some(mix(start, end, fraction));
    }
    let start_weight = ((1.0 - fraction) * angle).sin() / angle.sin();
    let end_weight = (fraction * angle).sin() / angle.sin();
    let length = (1.0 - fraction) * start_length + fraction * end_length;
    Some(Vec3d {
        x: (first.x * start_weight + last.x * end_weight) * length,
        y: (first.y * start_weight + last.y * end_weight) * length,
        z: (first.z * start_weight + last.z * end_weight) * length,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quaternion_rotation_matches_inverse_rotation() {
        let quat = Quatd {
            w: std::f64::consts::FRAC_1_SQRT_2,
            x: 0.0,
            y: 0.0,
            z: std::f64::consts::FRAC_1_SQRT_2,
        };
        let rotated = quat.rotate(Vec3d {
            x: 1.0,
            y: 0.0,
            z: 0.0,
        });
        assert!(rotated.x.abs() < 1e-12);
        assert!((rotated.y - 1.0).abs() < 1e-12);
    }

    #[test]
    fn slerp_is_shortest_path() {
        let start = Quatd::IDENTITY;
        let end = Quatd {
            w: std::f64::consts::FRAC_1_SQRT_2,
            x: 0.0,
            y: 0.0,
            z: std::f64::consts::FRAC_1_SQRT_2,
        };
        let mid = slerp_quat(start, end, 0.5).unwrap();
        let expected = std::f64::consts::PI / 8.0;
        assert!((mid.w - expected.cos()).abs() < 1e-12);
        assert!((mid.z - expected.sin()).abs() < 1e-12);
    }

    #[test]
    fn normalization_rejects_empty_and_non_finite() {
        assert!(Quatd {
            w: 0.0,
            x: 0.0,
            y: 0.0,
            z: 0.0
        }
        .normalized()
        .is_none());
        assert!(Quatd {
            w: f64::NAN,
            x: 0.0,
            y: 0.0,
            z: 0.0
        }
        .normalized()
        .is_none());
    }
}
