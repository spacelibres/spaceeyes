// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Elliptic orbit geometry for display. This is the same nearest-osculating-epoch
//! propagation the reference uses for orbit lines; it is not a full ephemeris and
//! must not be used to answer a scientific position query.

use crate::math::{normalize_quat, rotate_by_quat};
use crate::{DynHeader, DynInterval, DynPoint, EvaluationReason, OrbPoint, PointType, Vec3};

const TWO_PI: f64 = std::f64::consts::PI * 2.0;
const MIN_SAMPLES: u32 = 3;
const MAX_SAMPLES: u32 = 1024;

/// Solve `M = E - e sin(E)` for elliptic elements. The tight solver is for orbit
/// geometry; the ephemeris evaluator keeps the reference-compatible limit.
pub fn solve_eccentric_anomaly(mean_anomaly: f64, eccentricity: f64) -> f64 {
    let mut mean = mean_anomaly % TWO_PI;
    if mean > std::f64::consts::PI {
        mean -= TWO_PI;
    }
    if mean < -std::f64::consts::PI {
        mean += TWO_PI;
    }
    let mut anomaly = mean;
    for _ in 0..64 {
        let residual = anomaly - eccentricity * anomaly.sin() - mean;
        let derivative = 1.0 - eccentricity * anomaly.cos();
        let step = residual / derivative;
        anomaly -= step;
        if step.abs() < 1e-12 {
            break;
        }
    }
    anomaly
}

/// Position of an elliptic `orb` sample at `time`, in kilometres.
pub fn orbit_position_at(point: &OrbPoint, time: f64) -> Option<Vec3> {
    let OrbPoint {
        semi_major_axis,
        eccentricity,
        mean_angular_motion,
        mean_anomaly_at_epoch,
        ..
    } = *point;
    if !semi_major_axis.is_finite()
        || !eccentricity.is_finite()
        || !mean_angular_motion.is_finite()
        || !mean_anomaly_at_epoch.is_finite()
        || semi_major_axis <= 0.0
        || !(0.0..1.0).contains(&eccentricity)
    {
        return None;
    }
    let mean = mean_anomaly_at_epoch + mean_angular_motion * (time - point.time);
    if !mean.is_finite() {
        return None;
    }
    let anomaly = solve_eccentric_anomaly(mean, eccentricity);
    if !anomaly.is_finite() {
        return None;
    }
    let cosine = anomaly.cos();
    let sine = anomaly.sin();
    let local = Vec3 {
        x: semi_major_axis * (cosine - eccentricity),
        y: semi_major_axis * (1.0 - eccentricity * eccentricity).sqrt() * sine,
        z: 0.0,
    };
    let orientation = normalize_quat(point.orientation)?;
    let position = rotate_by_quat(local, orientation);
    position.is_finite().then_some(position)
}

/// Nearest orb sample epoch. Osculating elements are nearest-epoch propagated to
/// keep the display orbit close to the evaluated state.
pub fn nearest_orb_point(points: &[DynPoint], time: f64) -> Option<&OrbPoint> {
    let orb: Vec<&OrbPoint> = points
        .iter()
        .filter_map(|point| match point {
            DynPoint::Orb(value) => Some(value),
            _ => None,
        })
        .collect();
    nearest_in(&orb, time)
}

fn nearest_in<'a>(points: &[&'a OrbPoint], time: f64) -> Option<&'a OrbPoint> {
    if points.is_empty() {
        return None;
    }
    let mut lower = 0_usize;
    let mut upper = points.len() - 1;
    while upper - lower > 1 {
        let middle = (lower + upper) / 2;
        if points[middle].time <= time {
            lower = middle;
        } else {
            upper = middle.saturating_sub(1);
        }
    }
    let first = points[lower];
    let last = points[upper];
    if (first.time - time).abs() <= (last.time - time).abs() {
        Some(first)
    } else {
        Some(last)
    }
}

fn valid_orb(point: &OrbPoint) -> bool {
    point.time.is_finite()
        && point.semi_major_axis.is_finite()
        && point.eccentricity.is_finite()
        && point.mean_angular_motion.is_finite()
        && point.mean_anomaly_at_epoch.is_finite()
        && point.semi_major_axis > 0.0
        && (0.0..1.0).contains(&point.eccentricity)
        && normalize_quat(point.orientation).is_some()
}

/// Closed display polyline of the nearest elliptic osculating orbit, in km.
pub fn orbit_polyline(
    header: &DynHeader,
    points: &[DynPoint],
    interval: DynInterval,
    time: f64,
    samples: u32,
) -> Result<Vec<Vec3>, EvaluationReason> {
    if header.point_type != PointType::Orb
        || !time.is_finite()
        || !interval.min.is_finite()
        || !interval.max.is_finite()
        || interval.min > interval.max
        || points.len() < 2
        || !(MIN_SAMPLES..=MAX_SAMPLES).contains(&samples)
    {
        return Err(EvaluationReason::InvalidSamples);
    }
    let orb: Vec<&OrbPoint> = points
        .iter()
        .filter_map(|point| match point {
            DynPoint::Orb(value) => Some(value),
            _ => None,
        })
        .collect();
    if orb.len() != points.len() || !orb.iter().all(|point| valid_orb(point)) {
        return Err(EvaluationReason::InvalidSamples);
    }
    let sample = nearest_orb_point(points, time).ok_or(EvaluationReason::InvalidSamples)?;
    let motion = sample.mean_angular_motion.abs();
    if motion <= 0.0 {
        return Err(EvaluationReason::UnsupportedOrbit);
    }
    let period = TWO_PI / motion;
    let count = samples as usize;
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        let at = time + period * (index as f64) / (samples as f64);
        let position = orbit_position_at(sample, at).ok_or(EvaluationReason::UnsupportedOrbit)?;
        out.push(position);
    }
    Ok(out)
}
