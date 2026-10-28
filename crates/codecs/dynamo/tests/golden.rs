// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Differential acceptance against a snapshot produced by the fixed TypeScript
//! reference (`packages/nasa-dynamo/scripts/emit-golden.mjs`). The fixture is
//! synthetic and contains no NASA data. Regenerate only when the oracle changes.

use spaceeyes_astro::{
    evaluate, Body, EvaluationKind, EvaluationReason, EvaluationState, MassParameters,
};
use spaceeyes_dynamo::{parse_dyn, Quat, Vec3};

const TOLERANCE: f64 = 1e-9;

fn decode_hex(text: &str) -> Vec<u8> {
    assert!(text.len().is_multiple_of(2), "odd hex length");
    (0..text.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&text[index..index + 2], 16).expect("hex"))
        .collect()
}

fn numbers(text: &str) -> Vec<f64> {
    if text.is_empty() {
        return Vec::new();
    }
    text.split(',')
        .map(|value| value.parse::<f64>().expect("number"))
        .collect()
}

fn assert_close(actual: f64, expected: f64, name: &str) {
    assert!(
        (actual - expected).abs() <= TOLERANCE,
        "{name}: expected {expected}, received {actual}"
    );
}

fn assert_vector(actual: Vec3, expected: &[f64], name: &str) {
    assert_eq!(expected.len(), 3, "{name}: vector width");
    assert_close(actual.x, expected[0], name);
    assert_close(actual.y, expected[1], name);
    assert_close(actual.z, expected[2], name);
}

fn assert_quaternion(actual: Quat, expected: &[f64], name: &str) {
    assert_eq!(expected.len(), 4, "{name}: quaternion width");
    let dot = actual.w * expected[0]
        + actual.x * expected[1]
        + actual.y * expected[2]
        + actual.z * expected[3];
    let sign = if dot < 0.0 { -1.0 } else { 1.0 };
    assert_close(actual.w, sign * expected[0], name);
    assert_close(actual.x, sign * expected[1], name);
    assert_close(actual.y, sign * expected[2], name);
    assert_close(actual.z, sign * expected[3], name);
}

#[test]
fn rust_evaluator_matches_the_typescript_oracle_snapshot() {
    let fixture = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/golden/synthetic.tsv"
    ))
    .expect("golden fixture");
    let mut checked = 0_usize;
    for line in fixture.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('|').collect();
        assert_eq!(fields.len(), 8, "fixture field count: {line}");
        let name = fields[0];
        let bytes = decode_hex(fields[1]);
        let time: f64 = fields[2].parse().expect("time");
        let body = match fields[3] {
            "0" => None,
            "1" => Some(Body::Primary),
            "2" => Some(Body::Secondary),
            other => panic!("{name}: body {other}"),
        };
        let file = parse_dyn(&bytes).unwrap_or_else(|error| panic!("{name}: {error}"));
        let interval = file.interval.expect("inline interval");
        let masses = file
            .header
            .gravitational_parameters
            .map(|parameters| MassParameters {
                primary: parameters.mu1,
                secondary: parameters.mu2,
            });
        let state = evaluate(&file.points, interval, time, body, masses);
        match fields[4] {
            "unavailable" => {
                let expected = match fields[5] {
                    "out-of-range" => EvaluationReason::OutOfRange,
                    "invalid-samples" => EvaluationReason::InvalidSamples,
                    "unsupported-orbit" => EvaluationReason::UnsupportedOrbit,
                    other => panic!("{name}: reason {other}"),
                };
                assert_eq!(state, EvaluationState::Unavailable(expected), "{name}");
            }
            "ready" => {
                let values = numbers(fields[7]);
                match (fields[6], state) {
                    (
                        "position",
                        EvaluationState::Ready(EvaluationKind::Position { position, velocity }),
                    ) => {
                        assert_eq!(values.len(), 6, "{name}: values");
                        assert_vector(position, &values[..3], name);
                        assert_vector(velocity, &values[3..], name);
                    }
                    (
                        "orientation",
                        EvaluationState::Ready(EvaluationKind::Orientation {
                            orientation,
                            angular_velocity,
                        }),
                    ) => {
                        assert_eq!(values.len(), 7, "{name}: values");
                        assert_quaternion(orientation, &values[..4], name);
                        assert_vector(angular_velocity, &values[4..], name);
                    }
                    (kind, other) => panic!("{name}: expected {kind}, got {other:?}"),
                }
            }
            other => panic!("{name}: status {other}"),
        }
        checked += 1;
    }
    assert_eq!(checked, 23, "golden case count");
}
