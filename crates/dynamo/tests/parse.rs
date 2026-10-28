// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Strict DYN parsing acceptance, ported from the fixed TS reference behavior.
use spaceeyes_dynamo::{
    parse_dyn, parse_dyn_segment, DynError, DynFile, DynPoint, PointType, Quat, Vec3,
};

#[derive(Default)]
struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    fn i16(&mut self, value: i16) -> &mut Self {
        self.bytes.extend_from_slice(&value.to_le_bytes());
        self
    }
    fn u8(&mut self, value: u8) -> &mut Self {
        self.bytes.push(value);
        self
    }
    fn i32(&mut self, value: i32) -> &mut Self {
        self.bytes.extend_from_slice(&value.to_le_bytes());
        self
    }
    fn f64(&mut self, value: f64) -> &mut Self {
        self.bytes.extend_from_slice(&value.to_le_bytes());
        self
    }
    fn ascii(&mut self, value: &str) -> &mut Self {
        self.bytes.extend_from_slice(value.as_bytes());
        self
    }
    fn name(&mut self, value: &str) -> &mut Self {
        self.ascii(value).u8(0)
    }
    fn bytes(&self) -> Vec<u8> {
        self.bytes.clone()
    }
}

fn header(
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

fn orbit_point(
    writer: &mut Writer,
    time: f64,
    axis: f64,
    eccentricity: f64,
    motion: f64,
    anomaly: f64,
) {
    writer
        .f64(time)
        .f64(axis)
        .f64(eccentricity)
        .f64(motion)
        .f64(anomaly)
        .f64(1.0)
        .f64(0.0)
        .f64(0.0)
        .f64(0.0);
}

fn pos_point(writer: &mut Writer, time: f64, position: [f64; 3], velocity: [f64; 3]) {
    writer.f64(time);
    for value in position {
        writer.f64(value);
    }
    for value in velocity {
        writer.f64(value);
    }
}

fn lin_point(writer: &mut Writer, time: f64, position: [f64; 3]) {
    writer.f64(time);
    for value in position {
        writer.f64(value);
    }
}

fn ori_point(writer: &mut Writer, time: f64, quat: [f64; 4], angular: [f64; 3]) {
    writer.f64(time);
    for value in quat {
        writer.f64(value);
    }
    for value in angular {
        writer.f64(value);
    }
}

fn quat_point(writer: &mut Writer, time: f64, quat: [f64; 4]) {
    writer.f64(time);
    for value in quat {
        writer.f64(value);
    }
}

#[test]
fn parses_an_inline_v2_orb_file_with_w_first_quaternions() {
    let mut writer = header(2, "orb", 3, Some((398_600.0, 1.327e11)), true);
    writer.i32(2);
    orbit_point(&mut writer, 0.0, 1.0, 0.0, 1.0, 0.0);
    orbit_point(&mut writer, 2.0 * std::f64::consts::PI, 1.0, 0.0, 1.0, 0.0);

    let file = parse_dyn(&writer.bytes()).unwrap();
    assert_eq!(file.header.version, 2);
    assert_eq!(file.header.point_type, PointType::Orb);
    assert_eq!(file.header.number_of_digits, 3);
    let gravitational = file.header.gravitational_parameters.unwrap();
    assert_eq!(gravitational.mu1, 398_600.0);
    assert_eq!(gravitational.mu2, 1.327e11);
    assert_eq!(file.points.len(), 2);
    let interval = file.interval.unwrap();
    assert_eq!(interval.min, 0.0);
    assert_eq!(interval.max, 2.0 * std::f64::consts::PI);
    assert!(file.segments.is_empty());

    let DynPoint::Orb(point) = &file.points[0] else {
        panic!("expected orb");
    };
    assert_eq!(point.semi_major_axis, 1.0);
    assert_eq!(
        point.orientation,
        Quat {
            w: 1.0,
            x: 0.0,
            y: 0.0,
            z: 0.0
        }
    );
}

#[test]
fn parses_v2_index_files_and_infers_segment_ends() {
    let mut writer = header(2, "pos", 0, None, false);
    writer.i32(3).f64(-50.0).f64(0.0).f64(100.0);

    let file = parse_dyn(&writer.bytes()).unwrap();
    assert!(file.points.is_empty());
    assert_eq!(file.interval, None);
    let bounds: Vec<(f64, f64)> = file
        .segments
        .iter()
        .map(|segment| (segment.start_time, segment.end_time))
        .collect();
    assert_eq!(
        bounds,
        vec![(-50.0, 0.0), (0.0, 100.0), (100.0, f64::INFINITY)]
    );
}

#[test]
fn parses_v1_index_files_with_explicit_ends() {
    let mut writer = header(1, "lin", 0, None, false);
    writer.i32(2).f64(-50.0).f64(0.0).f64(0.0).f64(100.0);

    let file = parse_dyn(&writer.bytes()).unwrap();
    let bounds: Vec<(f64, f64)> = file
        .segments
        .iter()
        .map(|segment| (segment.start_time, segment.end_time))
        .collect();
    assert_eq!(bounds, vec![(-50.0, 0.0), (0.0, 100.0)]);
}

#[test]
fn parses_a_continuation_segment_without_a_header() {
    let mut writer = Writer::default();
    writer.u8(1).i32(2);
    lin_point(&mut writer, 0.0, [0.0, 0.0, 0.0]);
    lin_point(&mut writer, 2.0, [4.0, 2.0, 0.0]);
    let points = parse_dyn_segment(&writer.bytes(), PointType::Lin).unwrap();
    assert_eq!(points.len(), 2);
    assert_eq!(points[1].kind(), PointType::Lin);
    assert_eq!(points[1].time(), 2.0);

    let truncated = Writer {
        bytes: writer.bytes()[..5].to_vec(),
    };
    assert!(matches!(
        parse_dyn_segment(&truncated.bytes(), PointType::Lin),
        Err(DynError::PointBlockSize {
            expected: 64,
            found: 0
        })
    ));
}

#[test]
fn parses_every_point_type_with_its_stride() {
    let strides = [
        (PointType::Orb, 72),
        (PointType::Pos, 56),
        (PointType::Lin, 32),
        (PointType::Ori, 64),
        (PointType::Quat, 40),
    ];
    for (point_type, stride) in strides {
        assert_eq!(point_type.stride(), stride);
    }

    let mut orb = header(2, "orb", 0, Some((1.0, 1.0)), true);
    orb.i32(1);
    orbit_point(&mut orb, 0.0, 1.0, 0.0, 1.0, 0.0);
    let mut pos = header(2, "pos", 0, None, true);
    pos.i32(1);
    pos_point(&mut pos, 0.0, [1.0, 2.0, 3.0], [4.0, 5.0, 6.0]);
    let mut lin = header(2, "lin", 0, None, true);
    lin.i32(1);
    lin_point(&mut lin, 0.0, [1.0, 2.0, 3.0]);
    let mut ori = header(2, "ori", 0, None, true);
    ori.i32(1);
    ori_point(&mut ori, 0.0, [1.0, 0.0, 0.0, 0.0], [0.0, 0.0, 1.0]);
    let mut quat = header(2, "quat", 0, None, true);
    quat.i32(1);
    quat_point(&mut quat, 0.0, [1.0, 0.0, 0.0, 0.0]);

    for (writer, expected) in [
        (orb, PointType::Orb),
        (pos, PointType::Pos),
        (lin, PointType::Lin),
        (ori, PointType::Ori),
        (quat, PointType::Quat),
    ] {
        let file = parse_dyn(&writer.bytes()).unwrap();
        assert_eq!(file.points.len(), 1);
        assert_eq!(file.points[0].kind(), expected);
    }
}

#[test]
fn rejects_malformed_headers_counts_and_trailing_bytes() {
    let mut version = Writer::default();
    version.i16(3).name("pos").u8(0);
    assert_eq!(
        parse_dyn(&version.bytes()),
        Err(DynError::UnsupportedVersion(3))
    );

    let mut name = Writer::default();
    name.i16(2).name("xyz").u8(0);
    assert!(matches!(
        parse_dyn(&name.bytes()),
        Err(DynError::InvalidPointType(ref value)) if value == "xyz"
    ));

    let mut unterminated = Writer::default();
    unterminated.i16(2).ascii("pos");
    assert!(matches!(
        parse_dyn(&unterminated.bytes()),
        Err(DynError::UnexpectedEnd { .. })
    ));

    let mut flag = Writer::default();
    flag.i16(2).name("pos").u8(0).u8(2);
    assert_eq!(parse_dyn(&flag.bytes()), Err(DynError::InvalidHasPoints(2)));

    let mut negative = header(2, "lin", 0, None, true);
    negative.i32(-1);
    assert_eq!(
        parse_dyn(&negative.bytes()),
        Err(DynError::NegativePointCount(-1))
    );

    let mut too_few = header(2, "lin", 0, None, true);
    too_few.i32(2).f64(0.0).f64(0.0).f64(0.0).f64(0.0);
    assert_eq!(
        parse_dyn(&too_few.bytes()),
        Err(DynError::PointBlockSize {
            expected: 64,
            found: 32
        })
    );

    let mut too_many = header(2, "lin", 0, None, true);
    too_many.i32(1);
    lin_point(&mut too_many, 0.0, [0.0, 0.0, 0.0]);
    lin_point(&mut too_many, 0.0, [1.0, 0.0, 0.0]);
    assert_eq!(
        parse_dyn(&too_many.bytes()),
        Err(DynError::PointBlockSize {
            expected: 32,
            found: 64
        })
    );

    let mut segment = header(2, "lin", 0, None, false);
    segment.i32(1).f64(0.0).f64(10.0);
    assert_eq!(
        parse_dyn(&segment.bytes()),
        Err(DynError::SegmentTableSize {
            expected: 8,
            found: 16
        })
    );

    let mut truncated_orb = Writer::default();
    truncated_orb.i16(2).name("orb").u8(0).u8(1);
    assert!(matches!(
        parse_dyn(&truncated_orb.bytes()),
        Err(DynError::UnexpectedEnd { .. })
    ));

    let mut long_name = Writer::default();
    long_name.i16(2).ascii("abcdefghijklmnop").u8(0);
    assert_eq!(
        parse_dyn(&long_name.bytes()),
        Err(DynError::NameTooLong(16))
    );

    let mut non_ascii = Writer::default();
    non_ascii.i16(2).u8(0xff).u8(0);
    assert!(matches!(
        parse_dyn(&non_ascii.bytes()),
        Err(DynError::NonAsciiName(_))
    ));

    assert!(matches!(
        parse_dyn(&[]),
        Err(DynError::UnexpectedEnd { .. })
    ));

    let mut index_segment = Writer::default();
    index_segment.u8(0);
    assert_eq!(
        parse_dyn_segment(&index_segment.bytes(), PointType::Lin),
        Err(DynError::IndexInSegment)
    );
}

#[test]
fn accepts_empty_point_blocks_and_segment_tables() {
    let mut empty = header(2, "quat", 0, None, true);
    empty.i32(0);
    let file: DynFile = parse_dyn(&empty.bytes()).unwrap();
    assert!(file.points.is_empty());
    assert_eq!(file.interval, None);

    let mut no_segments = header(2, "pos", 0, None, false);
    no_segments.i32(0);
    let file = parse_dyn(&no_segments.bytes()).unwrap();
    assert!(file.segments.is_empty());
}

#[test]
fn parsed_values_preserve_documented_units_and_order() {
    let mut writer = header(2, "pos", 4, None, true);
    writer.i32(1);
    pos_point(&mut writer, 12.5, [1.0, -2.0, 3.0], [4.0, 5.0, -6.0]);
    let file = parse_dyn(&writer.bytes()).unwrap();
    let DynPoint::Pos(point) = &file.points[0] else {
        panic!()
    };
    assert_eq!(point.time, 12.5);
    assert_eq!(
        point.position,
        Vec3 {
            x: 1.0,
            y: -2.0,
            z: 3.0
        }
    );
    assert_eq!(
        point.velocity,
        Vec3 {
            x: 4.0,
            y: 5.0,
            z: -6.0
        }
    );
}
