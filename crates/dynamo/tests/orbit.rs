// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Elliptic orbit geometry acceptance (display-only, km).
mod common;

use common::*;
use spaceeyes_dynamo::{
    nearest_orb_point, orbit_polyline, orbit_position_at, parse_dyn, solve_eccentric_anomaly,
    DynFile, DynPoint, EvaluationReason, Quat,
};

fn orb_file(quat: Quat, eccentricity: f64, motion: f64) -> DynFile {
    let mut writer = header(2, "orb", 0, Some((1.0, 1.0)), true);
    writer.i32(2);
    orbit_point_with_quat(&mut writer, 0.0, 1.0, eccentricity, motion, 0.0, quat);
    orbit_point_with_quat(&mut writer, 10.0, 1.0, eccentricity, motion, 1.0, quat);
    parse_dyn(&writer.bytes()).unwrap()
}

#[test]
fn samples_a_circular_orbit_quarter_points() {
    let file = orb_file(Quat::IDENTITY, 0.0, 1.0);
    let line = orbit_polyline(&file.header, &file.points, file.interval.unwrap(), 0.0, 4).unwrap();
    assert_eq!(line.len(), 4);
    close(line[0].x, 1.0, 1e-12);
    close(line[0].y, 0.0, 1e-12);
    close(line[1].x, 0.0, 1e-12);
    close(line[1].y, 1.0, 1e-12);
    close(line[2].x, -1.0, 1e-12);
    close(line[2].y, 0.0, 1e-12);
    close(line[3].x, 0.0, 1e-12);
    close(line[3].y, -1.0, 1e-12);
}

#[test]
fn rotated_orbit_applies_the_orientation() {
    let quat = Quat {
        w: std::f64::consts::FRAC_1_SQRT_2,
        x: 0.0,
        y: 0.0,
        z: std::f64::consts::FRAC_1_SQRT_2,
    };
    let file = orb_file(quat, 0.0, 1.0);
    let line = orbit_polyline(&file.header, &file.points, file.interval.unwrap(), 0.0, 4).unwrap();
    close(line[0].x, 0.0, 1e-12);
    close(line[0].y, 1.0, 1e-12);
}

#[test]
fn eccentric_orbit_starts_at_periapsis() {
    let file = orb_file(Quat::IDENTITY, 0.5, 1.0);
    let DynPoint::Orb(point) = &file.points[0] else {
        panic!()
    };
    let position = orbit_position_at(point, 0.0).unwrap();
    close(position.x, 0.5, 1e-12);
    close(position.y, 0.0, 1e-12);
}

#[test]
fn nearest_sample_uses_distance_and_ties_the_earlier_epoch() {
    let file = orb_file(Quat::IDENTITY, 0.0, 1.0);
    assert_eq!(nearest_orb_point(&file.points, 4.0).unwrap().time, 0.0);
    assert_eq!(nearest_orb_point(&file.points, 6.0).unwrap().time, 10.0);
    assert_eq!(nearest_orb_point(&file.points, 5.0).unwrap().time, 0.0);
    assert!(nearest_orb_point(&[], 0.0).is_none());
}

#[test]
fn kepler_solver_residual_is_tight() {
    for (mean, eccentricity) in [(0.0, 0.0), (1.0, 0.5), (-2.0, 0.8), (3.0, 0.2)] {
        let anomaly = solve_eccentric_anomaly(mean, eccentricity);
        let wrapped = {
            let mut value = mean % (2.0 * std::f64::consts::PI);
            if value > std::f64::consts::PI {
                value -= 2.0 * std::f64::consts::PI;
            }
            if value < -std::f64::consts::PI {
                value += 2.0 * std::f64::consts::PI;
            }
            value
        };
        let residual = anomaly - eccentricity * anomaly.sin() - wrapped;
        assert!(residual.abs() < 1e-11, "{residual}");
    }
}

#[test]
fn rejects_invalid_orbit_requests() {
    let file = orb_file(Quat::IDENTITY, 0.0, 1.0);
    assert_eq!(
        orbit_polyline(&file.header, &file.points, file.interval.unwrap(), 0.0, 2),
        Err(EvaluationReason::InvalidSamples)
    );
    assert_eq!(
        orbit_polyline(
            &file.header,
            &file.points,
            file.interval.unwrap(),
            0.0,
            2048
        ),
        Err(EvaluationReason::InvalidSamples)
    );
    assert_eq!(
        orbit_polyline(
            &file.header,
            &file.points,
            file.interval.unwrap(),
            f64::NAN,
            4
        ),
        Err(EvaluationReason::InvalidSamples)
    );

    let mut zero_motion = header(2, "orb", 0, Some((1.0, 1.0)), true);
    zero_motion.i32(2);
    orbit_point(&mut zero_motion, 0.0, 1.0, 0.0, 0.0, 0.0);
    orbit_point(&mut zero_motion, 10.0, 1.0, 0.0, 0.0, 1.0);
    let file = parse_dyn(&zero_motion.bytes()).unwrap();
    assert_eq!(
        orbit_polyline(&file.header, &file.points, file.interval.unwrap(), 0.0, 4),
        Err(EvaluationReason::UnsupportedOrbit)
    );

    let mut parabola = header(2, "orb", 0, Some((1.0, 1.0)), true);
    parabola.i32(2);
    orbit_point(&mut parabola, 0.0, 1.0, 1.0, 1.0, 0.0);
    orbit_point(&mut parabola, 10.0, 1.0, 1.0, 1.0, 1.0);
    let file = parse_dyn(&parabola.bytes()).unwrap();
    assert_eq!(
        orbit_polyline(&file.header, &file.points, file.interval.unwrap(), 0.0, 4),
        Err(EvaluationReason::InvalidSamples)
    );

    let mut non_orb = header(2, "lin", 0, None, true);
    non_orb.i32(2);
    lin_point(&mut non_orb, 0.0, [0.0, 0.0, 0.0]);
    lin_point(&mut non_orb, 1.0, [1.0, 0.0, 0.0]);
    let file = parse_dyn(&non_orb.bytes()).unwrap();
    assert_eq!(
        orbit_polyline(&file.header, &file.points, file.interval.unwrap(), 0.0, 4),
        Err(EvaluationReason::InvalidSamples)
    );
}
