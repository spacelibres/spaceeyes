// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Synthetic DYN byte writer shared by parser and evaluator tests. No NASA data.
#![allow(dead_code)]

use spaceeyes_dynamo::{Quat, Vec3};

#[derive(Default)]
pub struct Writer {
    pub bytes: Vec<u8>,
}

impl Writer {
    pub fn i16(&mut self, value: i16) -> &mut Self {
        self.bytes.extend_from_slice(&value.to_le_bytes());
        self
    }
    pub fn u8(&mut self, value: u8) -> &mut Self {
        self.bytes.push(value);
        self
    }
    pub fn i32(&mut self, value: i32) -> &mut Self {
        self.bytes.extend_from_slice(&value.to_le_bytes());
        self
    }
    pub fn f64(&mut self, value: f64) -> &mut Self {
        self.bytes.extend_from_slice(&value.to_le_bytes());
        self
    }
    pub fn ascii(&mut self, value: &str) -> &mut Self {
        self.bytes.extend_from_slice(value.as_bytes());
        self
    }
    pub fn name(&mut self, value: &str) -> &mut Self {
        self.ascii(value).u8(0)
    }
    pub fn bytes(&self) -> Vec<u8> {
        self.bytes.clone()
    }
}

pub fn header(
    version: u8,
    point_type: &str,
    digits: u8,
    gravitational: Option<(f64, f64)>,
    inline: bool,
) -> Writer {
    let mut writer = Writer::default();
    writer.i16(i16::from(version)).name(point_type);
    if version == 2 {
        writer.u8(digits);
    }
    if let Some((mu1, mu2)) = gravitational {
        writer.f64(mu1).f64(mu2);
    }
    writer.u8(u8::from(inline));
    writer
}

pub fn orbit_point(
    writer: &mut Writer,
    time: f64,
    axis: f64,
    eccentricity: f64,
    motion: f64,
    anomaly: f64,
) {
    orbit_point_with_quat(
        writer,
        time,
        axis,
        eccentricity,
        motion,
        anomaly,
        Quat::IDENTITY,
    );
}

pub fn orbit_point_with_quat(
    writer: &mut Writer,
    time: f64,
    axis: f64,
    eccentricity: f64,
    motion: f64,
    anomaly: f64,
    orientation: Quat,
) {
    writer
        .f64(time)
        .f64(axis)
        .f64(eccentricity)
        .f64(motion)
        .f64(anomaly)
        .f64(orientation.w)
        .f64(orientation.x)
        .f64(orientation.y)
        .f64(orientation.z);
}

pub fn pos_point(writer: &mut Writer, time: f64, position: [f64; 3], velocity: [f64; 3]) {
    writer.f64(time);
    for value in position {
        writer.f64(value);
    }
    for value in velocity {
        writer.f64(value);
    }
}

pub fn lin_point(writer: &mut Writer, time: f64, position: [f64; 3]) {
    writer.f64(time);
    for value in position {
        writer.f64(value);
    }
}

pub fn ori_point(writer: &mut Writer, time: f64, quat: Quat, angular: [f64; 3]) {
    writer
        .f64(time)
        .f64(quat.w)
        .f64(quat.x)
        .f64(quat.y)
        .f64(quat.z);
    for value in angular {
        writer.f64(value);
    }
}

pub fn quat_point(writer: &mut Writer, time: f64, quat: Quat) {
    writer
        .f64(time)
        .f64(quat.w)
        .f64(quat.x)
        .f64(quat.y)
        .f64(quat.z);
}

pub fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "expected {expected}, received {actual} (tolerance {tolerance})"
    );
}

pub fn close_vec(actual: Vec3, expected: [f64; 3], tolerance: f64) {
    close(actual.x, expected[0], tolerance);
    close(actual.y, expected[1], tolerance);
    close(actual.z, expected[2], tolerance);
}

/// Compare quaternions up to the `-q` equivalence.
pub fn close_quat(actual: Quat, expected: [f64; 4], tolerance: f64) {
    let dot = actual.w * expected[0]
        + actual.x * expected[1]
        + actual.y * expected[2]
        + actual.z * expected[3];
    let sign = if dot < 0.0 { -1.0 } else { 1.0 };
    close(actual.w, sign * expected[0], tolerance);
    close(actual.x, sign * expected[1], tolerance);
    close(actual.y, sign * expected[2], tolerance);
    close(actual.z, sign * expected[3], tolerance);
}
