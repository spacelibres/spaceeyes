// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Evaluator acceptance, ported from the fixed TS reference expectations.
mod common;

use common::*;
use spaceeyes_astro::{
    evaluate, Body, EvaluationKind, EvaluationReason, EvaluationState, Interval, MassParameters,
};
use spaceeyes_dynamo::{parse_dyn, DynPoint, Quat, Vec3};

struct Window {
    points: Vec<DynPoint>,
    interval: Interval,
    masses: Option<MassParameters>,
}
impl Window {
    fn new(bytes: &[u8]) -> Self {
        let file = parse_dyn(bytes).expect("valid synthetic file");
        let interval = file.interval.expect("inline interval");
        let masses = file
            .header
            .gravitational_parameters
            .map(|parameters| MassParameters {
                primary: parameters.mu1,
                secondary: parameters.mu2,
            });
        Self {
            points: file.points,
            interval,
            masses,
        }
    }

    fn eval(&self, time: f64) -> EvaluationState {
        evaluate(&self.points, self.interval, time, None, self.masses)
    }

    fn eval_body(&self, time: f64, body: Body) -> EvaluationState {
        evaluate(&self.points, self.interval, time, Some(body), self.masses)
    }
}

fn position(state: EvaluationState) -> (Vec3, Vec3) {
    match state {
        EvaluationState::Ready(EvaluationKind::Position { position, velocity }) => {
            (position, velocity)
        }
        other => panic!("expected position, got {other:?}"),
    }
}

fn orientation(state: EvaluationState) -> (Quat, Vec3) {
    match state {
        EvaluationState::Ready(EvaluationKind::Orientation {
            orientation,
            angular_velocity,
        }) => (orientation, angular_velocity),
        other => panic!("expected orientation, got {other:?}"),
    }
}

fn circular_orb(gm1: f64, gm2: f64) -> Window {
    let mut writer = header(2, "orb", 0, Some((gm1, gm2)), true);
    writer.i32(2);
    orbit_point(&mut writer, 0.0, 1.0, 0.0, 1.0, 0.0);
    orbit_point(&mut writer, 2.0 * std::f64::consts::PI, 1.0, 0.0, 1.0, 0.0);
    Window::new(&writer.bytes())
}

#[test]
fn evaluates_a_circular_orbit_at_endpoints_and_mid_span() {
    let window = circular_orb(1.0, 1.0);
    let (position_at_zero, velocity_at_zero) = position(window.eval(0.0));
    close_vec(position_at_zero, [1.0, 0.0, 0.0], 1e-12);
    close_vec(velocity_at_zero, [0.0, 1.0, 0.0], 1e-12);

    let (position_at_quarter, velocity_at_quarter) =
        position(window.eval(std::f64::consts::FRAC_PI_2));
    close_vec(position_at_quarter, [0.0, 1.0, 0.0], 1e-12);
    close_vec(velocity_at_quarter, [-1.0, 0.0, 0.0], 1e-12);

    let (position_at_one, velocity_at_one) = position(window.eval(1.0));
    close_vec(position_at_one, [1.0_f64.cos(), 1.0_f64.sin(), 0.0], 1e-9);
    close_vec(velocity_at_one, [-1.0_f64.sin(), 1.0_f64.cos(), 0.0], 1e-9);
}

#[test]
fn applies_barycentric_body_factors_to_orbit_results() {
    let window = circular_orb(1.0, 3.0);
    let relative = position(window.eval(0.0)).0;
    let primary = position(window.eval_body(0.0, Body::Primary)).0;
    let central = position(window.eval_body(0.0, Body::Secondary)).0;
    close_vec(relative, [1.0, 0.0, 0.0], 1e-12);
    close_vec(primary, [0.75, 0.0, 0.0], 1e-12);
    close_vec(central, [-0.25, 0.0, 0.0], 1e-12);
}

#[test]
fn uses_cubic_hermite_interpolation_for_pos_samples() {
    let mut writer = header(2, "pos", 0, None, true);
    writer.i32(2);
    pos_point(&mut writer, 0.0, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0]);
    pos_point(&mut writer, 10.0, [10.0, 0.0, 0.0], [1.0, 0.0, 0.0]);
    let window = Window::new(&writer.bytes());
    for (time, expected) in [
        (0.0, [0.0, 0.0, 0.0]),
        (5.0, [5.0, 0.0, 0.0]),
        (10.0, [10.0, 0.0, 0.0]),
    ] {
        let (position, velocity) = position(window.eval(time));
        close_vec(position, expected, 1e-12);
        close_vec(velocity, [1.0, 0.0, 0.0], 1e-12);
    }
}

#[test]
fn uses_clamped_linear_interpolation_for_lin_samples() {
    let mut writer = header(2, "lin", 0, None, true);
    writer.i32(2);
    lin_point(&mut writer, 0.0, [0.0, 0.0, 0.0]);
    lin_point(&mut writer, 2.0, [4.0, 2.0, 0.0]);
    let window = Window::new(&writer.bytes());
    let (position, velocity) = position(window.eval(1.0));
    close_vec(position, [2.0, 1.0, 0.0], 1e-12);
    close_vec(velocity, [2.0, 1.0, 0.0], 1e-12);
}

#[test]
fn slerps_quaternion_samples_and_handles_the_negative_equivalence() {
    for sign in [1.0, -1.0] {
        let mut writer = header(2, "quat", 0, None, true);
        writer.i32(2);
        quat_point(&mut writer, 0.0, Quat::IDENTITY);
        quat_point(
            &mut writer,
            2.0,
            Quat {
                w: sign * std::f64::consts::FRAC_1_SQRT_2,
                x: 0.0,
                y: 0.0,
                z: sign * std::f64::consts::FRAC_1_SQRT_2,
            },
        );
        let window = Window::new(&writer.bytes());
        let (actual, angular) = orientation(window.eval(1.0));
        close_quat(
            actual,
            [
                (std::f64::consts::PI / 8.0).cos(),
                0.0,
                0.0,
                (std::f64::consts::PI / 8.0).sin(),
            ],
            1e-12,
        );
        close_vec(angular, [0.0, 0.0, 0.0], 1e-12);
    }
}

#[test]
fn projects_ori_samples_and_negates_the_interpolated_velocity() {
    let mut writer = header(2, "ori", 0, None, true);
    writer.i32(2);
    ori_point(
        &mut writer,
        0.0,
        Quat::IDENTITY,
        [0.0, 0.0, std::f64::consts::FRAC_PI_2],
    );
    ori_point(
        &mut writer,
        2.0,
        Quat::IDENTITY,
        [0.0, 0.0, std::f64::consts::FRAC_PI_2],
    );
    let window = Window::new(&writer.bytes());
    for time in [0.0, 1.0, 2.0] {
        let (actual, angular) = orientation(window.eval(time));
        close_quat(actual, [1.0, 0.0, 0.0, 0.0], 1e-12);
        close_vec(angular, [0.0, 0.0, -std::f64::consts::FRAC_PI_2], 1e-12);
    }
}

#[test]
fn slerps_non_degenerate_ori_samples_between_projected_endpoints() {
    let mut writer = header(2, "ori", 0, None, true);
    writer.i32(2);
    ori_point(&mut writer, 0.0, Quat::IDENTITY, [0.0, 0.0, 0.0]);
    ori_point(
        &mut writer,
        2.0,
        Quat {
            w: std::f64::consts::FRAC_1_SQRT_2,
            x: 0.0,
            y: 0.0,
            z: std::f64::consts::FRAC_1_SQRT_2,
        },
        [0.0, 0.0, 0.0],
    );
    let window = Window::new(&writer.bytes());
    let (actual, angular) = orientation(window.eval(1.0));
    close_quat(
        actual,
        [
            (std::f64::consts::PI / 8.0).cos(),
            0.0,
            0.0,
            (std::f64::consts::PI / 8.0).sin(),
        ],
        1e-12,
    );
    close_vec(angular, [0.0, 0.0, 0.0], 1e-12);
}

#[test]
fn rejects_out_of_range_duplicate_mismatched_and_non_finite_windows() {
    let window = circular_orb(1.0, 1.0);
    assert_eq!(
        window.eval(-1.0),
        EvaluationState::Unavailable(EvaluationReason::OutOfRange)
    );
    assert_eq!(
        window.eval(2.0 * std::f64::consts::PI + 1.0),
        EvaluationState::Unavailable(EvaluationReason::OutOfRange)
    );
    assert_eq!(
        window.eval(f64::NAN),
        EvaluationState::Unavailable(EvaluationReason::InvalidSamples)
    );

    let mut duplicate = header(2, "lin", 0, None, true);
    duplicate.i32(2);
    lin_point(&mut duplicate, 0.0, [0.0, 0.0, 0.0]);
    lin_point(&mut duplicate, 0.0, [1.0, 0.0, 0.0]);
    assert_eq!(
        Window::new(&duplicate.bytes()).eval(0.0),
        EvaluationState::Unavailable(EvaluationReason::InvalidSamples)
    );

    let mut mixed = Window::new(&duplicate.bytes());
    mixed.points[0] = DynPoint::Pos(spaceeyes_dynamo::PosPoint {
        time: mixed.points[0].time(),
        position: Vec3::ZERO,
        velocity: Vec3::ZERO,
    });
    assert_eq!(
        mixed.eval(0.0),
        EvaluationState::Unavailable(EvaluationReason::InvalidSamples)
    );

    let mut zero_quat = header(2, "quat", 0, None, true);
    zero_quat.i32(2);
    quat_point(
        &mut zero_quat,
        0.0,
        Quat {
            w: 0.0,
            x: 0.0,
            y: 0.0,
            z: 0.0,
        },
    );
    quat_point(&mut zero_quat, 1.0, Quat::IDENTITY);
    assert_eq!(
        Window::new(&zero_quat.bytes()).eval(0.0),
        EvaluationState::Unavailable(EvaluationReason::InvalidSamples)
    );

    let mut single = header(2, "lin", 0, None, true);
    single.i32(1);
    lin_point(&mut single, 0.0, [0.0, 0.0, 0.0]);
    assert_eq!(
        Window::new(&single.bytes()).eval(0.0),
        EvaluationState::Unavailable(EvaluationReason::InvalidSamples)
    );

    let mut nan_position = header(2, "pos", 0, None, true);
    nan_position.i32(2);
    pos_point(&mut nan_position, 0.0, [f64::NAN, 0.0, 0.0], [0.0; 3]);
    pos_point(&mut nan_position, 1.0, [0.0; 3], [0.0; 3]);
    assert_eq!(
        Window::new(&nan_position.bytes()).eval(0.0),
        EvaluationState::Unavailable(EvaluationReason::InvalidSamples)
    );

    let mut reversed = window;
    reversed.interval = Interval { min: 2.0, max: 0.0 };
    assert_eq!(
        reversed.eval(1.0),
        EvaluationState::Unavailable(EvaluationReason::InvalidSamples)
    );
}

#[test]
fn rejects_parabola_non_positive_axis_and_invalid_gravity_ratios() {
    let mut parabola = header(2, "orb", 0, Some((1.0, 1.0)), true);
    parabola.i32(2);
    orbit_point(&mut parabola, 0.0, 1.0, 1.0, 1.0, 0.0);
    orbit_point(&mut parabola, 1.0, 1.0, 1.0, 1.0, 1.0);
    assert_eq!(
        Window::new(&parabola.bytes()).eval(0.0),
        EvaluationState::Unavailable(EvaluationReason::UnsupportedOrbit)
    );

    let mut zero_axis = header(2, "orb", 0, Some((1.0, 1.0)), true);
    zero_axis.i32(2);
    orbit_point(&mut zero_axis, 0.0, 0.0, 0.0, 1.0, 0.0);
    orbit_point(&mut zero_axis, 1.0, 0.0, 0.0, 1.0, 1.0);
    assert_eq!(
        Window::new(&zero_axis.bytes()).eval(0.0),
        EvaluationState::Unavailable(EvaluationReason::UnsupportedOrbit)
    );

    let negative_gravity = circular_orb(-1.0, 1.0);
    assert_eq!(
        negative_gravity.eval_body(0.0, Body::Primary),
        EvaluationState::Unavailable(EvaluationReason::InvalidSamples)
    );
}

#[test]
fn evaluates_hyperbolic_orbits_without_extrapolating() {
    let mut writer = header(2, "orb", 0, Some((1.0, 1.0)), true);
    writer.i32(2);
    orbit_point(&mut writer, 0.0, 1.0, 2.0, 1.0, 0.0);
    orbit_point(&mut writer, 2.0, 1.0, 2.0, 1.0, 0.0);
    let window = Window::new(&writer.bytes());
    let (position, velocity) = position(window.eval(0.0));
    close_vec(position, [1.0, 0.0, 0.0], 1e-9);
    close_vec(velocity, [0.0, 3.0_f64.sqrt(), 0.0], 1e-9);
}
