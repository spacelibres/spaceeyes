// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Algorithm-level acceptance for `spaceeyes-astro`; points are constructed
//! directly so these tests never depend on a file-format decoder.
use spaceeyes_astro::{
    evaluate, orbit_polyline, solve_eccentric_anomaly, EphemerisPoint, EvaluationKind,
    EvaluationReason, EvaluationState, Interval, OrbPoint, PosPoint, Quat, Vec3,
};

fn interval(min: f64, max: f64) -> Interval {
    Interval { min, max }
}

fn pos(time: f64, position: [f64; 3], velocity: [f64; 3]) -> EphemerisPoint {
    EphemerisPoint::Pos(PosPoint {
        time,
        position: Vec3 {
            x: position[0],
            y: position[1],
            z: position[2],
        },
        velocity: Vec3 {
            x: velocity[0],
            y: velocity[1],
            z: velocity[2],
        },
    })
}

fn orb(time: f64, motion: f64, anomaly: f64) -> EphemerisPoint {
    EphemerisPoint::Orb(OrbPoint {
        time,
        semi_major_axis: 1.0,
        eccentricity: 0.0,
        mean_angular_motion: motion,
        mean_anomaly_at_epoch: anomaly,
        orientation: Quat::IDENTITY,
    })
}

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "expected {expected}, received {actual}"
    );
}

#[test]
fn hermite_interpolates_position_and_velocity() {
    let points = [
        pos(0.0, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0]),
        pos(10.0, [10.0, 0.0, 0.0], [1.0, 0.0, 0.0]),
    ];
    let state = evaluate(&points, interval(0.0, 10.0), 5.0, None, None);
    let EvaluationState::Ready(EvaluationKind::Position { position, velocity }) = state else {
        panic!("{state:?}")
    };
    close(position.x, 5.0, 1e-12);
    close(velocity.x, 1.0, 1e-12);
}

#[test]
fn circular_orbit_samples_quarter_points() {
    let points = [orb(0.0, 1.0, 0.0), orb(10.0, 1.0, 1.0)];
    let line = orbit_polyline(&points, interval(0.0, 10.0), 0.0, 4).unwrap();
    assert_eq!(line.len(), 4);
    close(line[0].x, 1.0, 1e-12);
    close(line[1].y, 1.0, 1e-12);
    close(line[2].x, -1.0, 1e-12);
}

#[test]
fn out_of_range_and_unsupported_are_explicit() {
    let points = [orb(0.0, 1.0, 0.0), orb(10.0, 1.0, 1.0)];
    assert_eq!(
        evaluate(&points, interval(0.0, 10.0), 11.0, None, None),
        EvaluationState::Unavailable(EvaluationReason::OutOfRange)
    );
    let hyperbolic = [
        EphemerisPoint::Orb(OrbPoint {
            time: 0.0,
            semi_major_axis: 1.0,
            eccentricity: 2.0,
            mean_angular_motion: 1.0,
            mean_anomaly_at_epoch: 0.0,
            orientation: Quat::IDENTITY,
        }),
        EphemerisPoint::Orb(OrbPoint {
            time: 10.0,
            semi_major_axis: 1.0,
            eccentricity: 2.0,
            mean_angular_motion: 1.0,
            mean_anomaly_at_epoch: 1.0,
            orientation: Quat::IDENTITY,
        }),
    ];
    assert_eq!(
        orbit_polyline(&hyperbolic, interval(0.0, 10.0), 0.0, 4),
        Err(EvaluationReason::InvalidSamples)
    );
}

#[test]
fn kepler_solver_converges_to_the_equation() {
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
