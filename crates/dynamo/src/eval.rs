// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Ephemeris evaluation for one DYN window. The implementation follows the
//! reference semantics exactly enough for differential comparison, including the
//! fixed Kepler iteration limit, the ori projection convention and barycentric
//! body factors.

use crate::math::{
    direction, mix, normalize_quat, quat_scale, rotate_by_quat, scale, slerp_quat, slerp_vector,
};
use crate::{DynHeader, DynInterval, DynPoint, OrbPoint, OriPoint, Quat, Vec3};

const KEPLER_ITERATIONS: usize = 20;
const KEPLER_TOLERANCE: f64 = 0.001_745_329_25;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EvaluationReason {
    OutOfRange,
    InvalidSamples,
    UnsupportedOrbit,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EvaluationKind {
    Position {
        position: Vec3,
        velocity: Vec3,
    },
    Orientation {
        orientation: Quat,
        angular_velocity: Vec3,
    },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EvaluationState {
    Ready(EvaluationKind),
    Unavailable(EvaluationReason),
}

/// Which body of a two-body pair the result is expressed for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Body {
    Primary,
    Secondary,
}

fn unavailable(reason: EvaluationReason) -> EvaluationState {
    EvaluationState::Unavailable(reason)
}

fn valid_sample(point: &DynPoint) -> bool {
    if !point.time().is_finite() {
        return false;
    }
    match point {
        DynPoint::Orb(value) => {
            value.semi_major_axis.is_finite()
                && value.eccentricity.is_finite()
                && value.mean_angular_motion.is_finite()
                && value.mean_anomaly_at_epoch.is_finite()
                && quat_scale(value.orientation).is_finite()
                && quat_scale(value.orientation) > 0.0
        }
        DynPoint::Pos(value) => value.position.is_finite() && value.velocity.is_finite(),
        DynPoint::Lin(value) => value.position.is_finite(),
        DynPoint::Ori(value) => {
            value.angular_velocity.is_finite()
                && quat_scale(value.orientation).is_finite()
                && quat_scale(value.orientation) > 0.0
        }
        DynPoint::Quat(value) => {
            quat_scale(value.orientation).is_finite() && quat_scale(value.orientation) > 0.0
        }
    }
}

/// Project an `ori` sample to `time` using `q * conj(axisAngle(omega, dt))`.
fn project_orientation(point: &OriPoint, time: f64) -> Option<Quat> {
    let first = normalize_quat(point.orientation)?;
    let magnitude = point
        .angular_velocity
        .x
        .hypot(point.angular_velocity.y)
        .hypot(point.angular_velocity.z);
    if magnitude == 0.0 {
        return Some(first);
    }
    let half_angle = (magnitude * (time - point.time)) / 2.0;
    let axis = direction(point.angular_velocity)?;
    let sine = -half_angle.sin();
    let delta = Quat {
        w: half_angle.cos(),
        x: axis.x * sine,
        y: axis.y * sine,
        z: axis.z * sine,
    };
    normalize_quat(first.multiply(delta))
}

/// Project osculating `orb` elements to `time`. Iteration limit and tolerance are
/// retained for differential compatibility with the reference, not as a
/// precision guarantee.
fn project_orbit(point: &OrbPoint, time: f64) -> Option<(Vec3, Vec3)> {
    let OrbPoint {
        eccentricity,
        semi_major_axis,
        mean_angular_motion,
        ..
    } = *point;
    if !semi_major_axis.is_finite()
        || !eccentricity.is_finite()
        || !mean_angular_motion.is_finite()
        || !point.mean_anomaly_at_epoch.is_finite()
        || semi_major_axis <= 0.0
        || eccentricity < 0.0
        || eccentricity == 1.0
    {
        return None;
    }
    let elliptic = eccentricity < 1.0;
    let mut mean = point.mean_anomaly_at_epoch + mean_angular_motion * (time - point.time);
    if !mean.is_finite() {
        return None;
    }
    if elliptic {
        mean =
            ((mean + std::f64::consts::PI) % (2.0 * std::f64::consts::PI)) - std::f64::consts::PI;
        if mean < -std::f64::consts::PI {
            mean += 2.0 * std::f64::consts::PI;
        }
    }
    let mut anomaly = if elliptic {
        if eccentricity >= 0.8 {
            mean.signum() * std::f64::consts::PI
        } else {
            mean
        }
    } else {
        ((2.0 * mean.abs()) / std::f64::consts::E + 1.8).ln() * if mean < 0.0 { -1.0 } else { 1.0 }
    };
    let mut converged = false;
    for _ in 0..KEPLER_ITERATIONS {
        let correction = if elliptic {
            (anomaly - eccentricity * anomaly.sin() - mean) / (eccentricity * anomaly.cos() - 1.0)
        } else {
            (anomaly - eccentricity * anomaly.sinh() + mean) / (eccentricity * anomaly.cosh() - 1.0)
        };
        anomaly += correction;
        if !anomaly.is_finite() {
            return None;
        }
        if correction.abs() < KEPLER_TOLERANCE {
            converged = true;
            break;
        }
    }
    if !converged {
        return None;
    }
    let (cosine, sine) = if elliptic {
        (anomaly.cos(), anomaly.sin())
    } else {
        (anomaly.cosh(), anomaly.sinh())
    };
    let minor_ratio = if elliptic {
        (1.0 - eccentricity * eccentricity).sqrt()
    } else {
        (eccentricity * eccentricity - 1.0).sqrt()
    };
    // The reference stores a positive semi-major-axis magnitude for hyperbolas.
    let radius =
        (if elliptic { 1.0 } else { -1.0 }) * semi_major_axis * (1.0 - eccentricity * cosine);
    let velocity_scale = (mean_angular_motion * semi_major_axis * semi_major_axis) / radius;
    if !velocity_scale.is_finite() {
        return None;
    }
    let orientation = normalize_quat(point.orientation)?;
    let position = rotate_by_quat(
        Vec3 {
            x: semi_major_axis
                * (if elliptic {
                    cosine - eccentricity
                } else {
                    eccentricity - cosine
                }),
            y: semi_major_axis * minor_ratio * sine,
            z: 0.0,
        },
        orientation,
    );
    let velocity = rotate_by_quat(
        Vec3 {
            x: -velocity_scale * sine,
            y: velocity_scale * minor_ratio * cosine,
            z: 0.0,
        },
        orientation,
    );
    if !position.is_finite() || !velocity.is_finite() {
        return None;
    }
    Some((position, velocity))
}

fn position_state(position: Vec3, velocity: Vec3) -> EvaluationState {
    if position.is_finite() && velocity.is_finite() {
        EvaluationState::Ready(EvaluationKind::Position { position, velocity })
    } else {
        unavailable(EvaluationReason::InvalidSamples)
    }
}

fn orientation_state(orientation: Quat, angular_velocity: Vec3) -> EvaluationState {
    if quat_scale(orientation).is_finite()
        && quat_scale(orientation) > 0.0
        && angular_velocity.is_finite()
    {
        EvaluationState::Ready(EvaluationKind::Orientation {
            orientation,
            angular_velocity,
        })
    } else {
        unavailable(EvaluationReason::InvalidSamples)
    }
}

/// Evaluate one ephemeris window at an explicit time.
///
/// Valid queries are the intersection of window coverage and sample coverage.
/// Endpoints are accepted; there is no extrapolation or stale fallback.
pub fn evaluate(
    header: &DynHeader,
    points: &[DynPoint],
    interval: DynInterval,
    time: f64,
    body: Option<Body>,
) -> EvaluationState {
    if !time.is_finite()
        || !interval.min.is_finite()
        || !interval.max.is_finite()
        || interval.min > interval.max
        || points.len() < 2
    {
        return unavailable(EvaluationReason::InvalidSamples);
    }
    let mut previous = f64::NEG_INFINITY;
    for point in points {
        if point.kind() != header.point_type || !valid_sample(point) || point.time() <= previous {
            return unavailable(EvaluationReason::InvalidSamples);
        }
        previous = point.time();
    }
    let first = &points[0];
    let last = &points[points.len() - 1];
    if time < interval.min || time > interval.max || time < first.time() || time > last.time() {
        return unavailable(EvaluationReason::OutOfRange);
    }

    let mut lower = 0_usize;
    let mut upper = points.len() - 2;
    while lower < upper {
        let middle = lower + (upper - lower).div_ceil(2);
        if points[middle].time() <= time {
            lower = middle;
        } else {
            upper = middle - 1;
        }
    }
    let start = &points[lower];
    let end = &points[lower + 1];
    let duration = end.time() - start.time();
    if !duration.is_finite() || duration <= 0.0 {
        return unavailable(EvaluationReason::InvalidSamples);
    }
    let fraction = ((time - start.time()) / duration).clamp(0.0, 1.0);

    match (start, end) {
        (DynPoint::Pos(start), DynPoint::Pos(end)) => {
            let remaining = 1.0 - fraction;
            let square = fraction * fraction;
            let position = Vec3 {
                x: (1.0 + 2.0 * fraction) * remaining * remaining * start.position.x
                    + duration * fraction * remaining * remaining * start.velocity.x
                    + square * (3.0 - 2.0 * fraction) * end.position.x
                    - duration * square * remaining * end.velocity.x,
                y: (1.0 + 2.0 * fraction) * remaining * remaining * start.position.y
                    + duration * fraction * remaining * remaining * start.velocity.y
                    + square * (3.0 - 2.0 * fraction) * end.position.y
                    - duration * square * remaining * end.velocity.y,
                z: (1.0 + 2.0 * fraction) * remaining * remaining * start.position.z
                    + duration * fraction * remaining * remaining * start.velocity.z
                    + square * (3.0 - 2.0 * fraction) * end.position.z
                    - duration * square * remaining * end.velocity.z,
            };
            let velocity = Vec3 {
                x: ((6.0 * (square - fraction)) / duration) * start.position.x
                    + (3.0 * square - 4.0 * fraction + 1.0) * start.velocity.x
                    - ((6.0 * (square - fraction)) / duration) * end.position.x
                    + (3.0 * square - 2.0 * fraction) * end.velocity.x,
                y: ((6.0 * (square - fraction)) / duration) * start.position.y
                    + (3.0 * square - 4.0 * fraction + 1.0) * start.velocity.y
                    - ((6.0 * (square - fraction)) / duration) * end.position.y
                    + (3.0 * square - 2.0 * fraction) * end.velocity.y,
                z: ((6.0 * (square - fraction)) / duration) * start.position.z
                    + (3.0 * square - 4.0 * fraction + 1.0) * start.velocity.z
                    - ((6.0 * (square - fraction)) / duration) * end.position.z
                    + (3.0 * square - 2.0 * fraction) * end.velocity.z,
            };
            position_state(position, velocity)
        }
        (DynPoint::Lin(start), DynPoint::Lin(end)) => {
            let velocity = Vec3 {
                x: (end.position.x - start.position.x) / duration,
                y: (end.position.y - start.position.y) / duration,
                z: (end.position.z - start.position.z) / duration,
            };
            position_state(mix(start.position, end.position, fraction), velocity)
        }
        (DynPoint::Quat(start), DynPoint::Quat(end)) => {
            let Some(orientation) = slerp_quat(start.orientation, end.orientation, fraction) else {
                return unavailable(EvaluationReason::InvalidSamples);
            };
            orientation_state(orientation, Vec3::ZERO)
        }
        (DynPoint::Ori(start), DynPoint::Ori(end)) => {
            let (Some(first), Some(last)) = (
                project_orientation(start, time),
                project_orientation(end, time),
            ) else {
                return unavailable(EvaluationReason::InvalidSamples);
            };
            let Some(orientation) = slerp_quat(first, last, fraction) else {
                return unavailable(EvaluationReason::InvalidSamples);
            };
            let Some(interpolated) =
                slerp_vector(start.angular_velocity, end.angular_velocity, fraction)
            else {
                return unavailable(EvaluationReason::InvalidSamples);
            };
            orientation_state(
                orientation,
                rotate_by_quat(scale(interpolated, -1.0), orientation),
            )
        }
        (DynPoint::Orb(start), DynPoint::Orb(end)) => {
            let (Some((start_position, start_velocity)), Some((end_position, end_velocity))) =
                (project_orbit(start, time), project_orbit(end, time))
            else {
                return unavailable(EvaluationReason::UnsupportedOrbit);
            };
            let mut factor = 1.0;
            if let Some(body) = body {
                let (primary, central) = match header.gravitational_parameters {
                    Some(parameters) => (parameters.mu1, parameters.mu2),
                    None => match body {
                        Body::Primary => (0.0, 1.0),
                        Body::Secondary => (1.0, 0.0),
                    },
                };
                if !primary.is_finite()
                    || !central.is_finite()
                    || primary < 0.0
                    || central < 0.0
                    || primary + central == 0.0
                {
                    return unavailable(EvaluationReason::InvalidSamples);
                }
                factor = match body {
                    Body::Primary => central / (primary + central),
                    Body::Secondary => -primary / (primary + central),
                };
            }
            position_state(
                scale(mix(start_position, end_position, fraction), factor),
                scale(mix(start_velocity, end_velocity, fraction), factor),
            )
        }
        _ => unavailable(EvaluationReason::InvalidSamples),
    }
}
