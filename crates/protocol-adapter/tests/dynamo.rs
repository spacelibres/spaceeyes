// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Wire-level acceptance for core DYN evaluation over uploaded resources.
use prost::Message;
use sha2::{Digest, Sha256};
use spaceeyes_engine::{CommandDispatcher, Engine};
use spaceeyes_protocol_adapter::{generated as p, ProtocolAdapter};
use spaceeyes_time::TimeInstant;

fn context(id: &str) -> p::RequestContext {
    p::RequestContext {
        request_id: id.into(),
        session_id: "dynamo".into(),
        protocol_version: Some(p::ProtocolVersion {
            major: 1,
            minor: 0,
            schema_id: "spaceeyes.core.v1".into(),
        }),
        ..Default::default()
    }
}

fn adapter() -> ProtocolAdapter {
    ProtocolAdapter::new(
        CommandDispatcher::new(
            Engine::new(TimeInstant::new("TDB", "J2000", 0, 0).unwrap()),
            "dynamo".into(),
            128,
        )
        .unwrap(),
    )
    .unwrap()
}

fn send(
    a: &mut ProtocolAdapter,
    id: &str,
    action: p::resource_command::Action,
) -> p::ResponseEnvelope {
    let request = p::CommandEnvelope {
        context: Some(context(id)),
        payload: Some(p::command_envelope::Payload::Resource(p::ResourceCommand {
            action: Some(action),
        })),
    };
    p::ResponseEnvelope::decode(
        a.submit_bytes("owner", &request.encode_to_vec())
            .unwrap()
            .as_slice(),
    )
    .unwrap()
}

fn upload(a: &mut ProtocolAdapter, resource: &str, bytes: &[u8]) {
    let begin = p::resource_command::Action::BeginUpload(p::BeginResourceUpload {
        resource_id: Some(p::ResourceId {
            value: resource.into(),
        }),
        total_bytes: bytes.len() as u64,
        source: Some(p::ResourceSource {
            source_id: "synthetic".into(),
            source_version: "v1".into(),
            sha256: Sha256::digest(bytes).to_vec(),
        }),
        format: p::ResourceUploadFormat::Bytes as i32,
        ..Default::default()
    });
    let started = send(a, &format!("begin:{resource}"), begin);
    assert_eq!(
        started.status,
        p::ResponseStatus::Completed as i32,
        "{started:?}"
    );
    let p::response_envelope::Payload::Upload(status) = started.payload.unwrap() else {
        panic!()
    };
    let appended = send(
        a,
        &format!("append:{resource}"),
        p::resource_command::Action::AppendUpload(p::AppendResourceUpload {
            upload_id: status.upload_id.clone(),
            offset: 0,
            data: bytes.to_vec(),
        }),
    );
    assert_eq!(
        appended.status,
        p::ResponseStatus::Completed as i32,
        "{appended:?}"
    );
    let finished = send(
        a,
        &format!("finish:{resource}"),
        p::resource_command::Action::FinishUpload(p::FinishResourceUpload {
            upload_id: status.upload_id,
        }),
    );
    assert_eq!(
        finished.status,
        p::ResponseStatus::Completed as i32,
        "{finished:?}"
    );
}

fn query(a: &ProtocolAdapter, query: p::EvaluateDynamoQuery) -> p::ResponseEnvelope {
    let envelope = p::QueryEnvelope {
        context: Some(context("dynamo-query")),
        payload: Some(p::query_envelope::Payload::EvaluateDynamo(query)),
    };
    p::ResponseEnvelope::decode(
        a.query_bytes("owner", &envelope.encode_to_vec())
            .unwrap()
            .as_slice(),
    )
    .unwrap()
}

fn code(response: p::ResponseEnvelope) -> p::ErrorCode {
    assert_eq!(response.status, p::ResponseStatus::Rejected as i32);
    let p::response_envelope::Payload::Error(error) = response.payload.unwrap() else {
        panic!()
    };
    p::ErrorCode::try_from(error.code).unwrap()
}

fn state(response: p::ResponseEnvelope) -> p::DynamoState {
    assert_eq!(
        response.status,
        p::ResponseStatus::Completed as i32,
        "{response:?}"
    );
    let p::response_envelope::Payload::Dynamo(state) = response.payload.unwrap() else {
        panic!()
    };
    state
}

fn instant(seconds: i64, nanos: u32) -> p::TimeInstant {
    p::TimeInstant {
        time_scale: p::TimeScale::Tdb as i32,
        epoch_id: "J2000".into(),
        seconds,
        nanos,
    }
}

struct Writer {
    bytes: Vec<u8>,
}
impl Writer {
    fn new() -> Self {
        Self { bytes: Vec::new() }
    }
    fn i16(mut self, value: i16) -> Self {
        self.bytes.extend_from_slice(&value.to_le_bytes());
        self
    }
    fn u8(mut self, value: u8) -> Self {
        self.bytes.push(value);
        self
    }
    fn i32(mut self, value: i32) -> Self {
        self.bytes.extend_from_slice(&value.to_le_bytes());
        self
    }
    fn f64(mut self, value: f64) -> Self {
        self.bytes.extend_from_slice(&value.to_le_bytes());
        self
    }
    fn ascii(mut self, value: &str) -> Self {
        self.bytes.extend_from_slice(value.as_bytes());
        self
    }
    fn name(mut self, value: &str) -> Self {
        self = self.ascii(value).u8(0);
        self
    }
    fn done(self) -> Vec<u8> {
        self.bytes
    }
}

fn header(version: i16, point_type: &str, inline: bool, gm: Option<(f64, f64)>) -> Writer {
    let mut writer = Writer::new().i16(version).name(point_type);
    if version == 2 {
        writer = writer.u8(0);
    }
    if let Some((mu1, mu2)) = gm {
        writer = writer.f64(mu1).f64(mu2);
    }
    writer.u8(u8::from(inline))
}

fn orb_bytes() -> Vec<u8> {
    let mut writer = header(2, "orb", true, Some((1.0, 1.0))).i32(2);
    for time in [0.0, 2.0 * std::f64::consts::PI] {
        writer = writer
            .f64(time)
            .f64(1.0)
            .f64(0.0)
            .f64(1.0)
            .f64(0.0)
            .f64(1.0)
            .f64(0.0)
            .f64(0.0)
            .f64(0.0);
    }
    writer.done()
}

fn quat_bytes() -> Vec<u8> {
    let mut writer = header(2, "quat", true, None).i32(2);
    writer = writer.f64(0.0).f64(1.0).f64(0.0).f64(0.0).f64(0.0);
    let half = std::f64::consts::FRAC_1_SQRT_2;
    writer = writer.f64(2.0).f64(half).f64(0.0).f64(0.0).f64(half);
    writer.done()
}

fn index_bytes() -> Vec<u8> {
    header(2, "pos", false, None).i32(1).f64(0.0).done()
}

#[test]
fn evaluates_an_uploaded_dynamo_window_without_mutating_authority() {
    let mut a = adapter();
    upload(&mut a, "dyn:orb", &orb_bytes());
    let before = a.dispatcher().session_status();
    let history = a.dispatcher().command_history_remaining();
    let events = a.dispatcher().events().count();

    let response = query(
        &a,
        p::EvaluateDynamoQuery {
            position: Some(p::ResourceId {
                value: "dyn:orb".into(),
            }),
            orientation: None,
            instant: Some(instant(0, 0)),
            body: p::DynamoBody::Unspecified as i32,
        },
    );
    let value = state(response);
    assert_eq!(value.status, p::DynamoStatus::Ready as i32);
    let position = value.position_m.unwrap();
    assert!((position.x - 1000.0).abs() < 1e-9);
    assert!(position.y.abs() < 1e-9);
    let velocity = value.velocity_mps.unwrap();
    assert!((velocity.y - 1000.0).abs() < 1e-9);
    let coverage = value.coverage.clone().unwrap();
    assert_eq!(coverage.start.unwrap().seconds, 0);
    assert_eq!(coverage.end.unwrap().seconds, 6);
    assert_eq!(value.source_id, "synthetic");
    assert_eq!(value.source_version, "v1");
    assert_eq!(a.dispatcher().session_status(), before);
    assert_eq!(a.dispatcher().command_history_remaining(), history);
    assert_eq!(a.dispatcher().events().count(), events);

    let out_of_range = state(query(
        &a,
        p::EvaluateDynamoQuery {
            position: Some(p::ResourceId {
                value: "dyn:orb".into(),
            }),
            orientation: None,
            instant: Some(instant(10, 0)),
            body: p::DynamoBody::Unspecified as i32,
        },
    ));
    assert_eq!(out_of_range.status, p::DynamoStatus::OutOfRange as i32);
    assert!(out_of_range.position_m.is_none());
}

#[test]
fn combines_position_and_orientation_sources() {
    let mut a = adapter();
    upload(&mut a, "dyn:orb", &orb_bytes());
    upload(&mut a, "dyn:ori", &quat_bytes());
    let combined = state(query(
        &a,
        p::EvaluateDynamoQuery {
            position: Some(p::ResourceId {
                value: "dyn:orb".into(),
            }),
            orientation: Some(p::ResourceId {
                value: "dyn:ori".into(),
            }),
            instant: Some(instant(0, 0)),
            body: p::DynamoBody::Unspecified as i32,
        },
    ));
    assert_eq!(combined.status, p::DynamoStatus::Ready as i32);
    assert!(combined.position_m.is_some());
    let orientation = combined.orientation.unwrap();
    assert!((orientation.w - 1.0).abs() < 1e-12);

    let angle = std::f64::consts::FRAC_PI_4;
    let at_one = state(query(
        &a,
        p::EvaluateDynamoQuery {
            position: None,
            orientation: Some(p::ResourceId {
                value: "dyn:ori".into(),
            }),
            instant: Some(instant(1, 0)),
            body: p::DynamoBody::Unspecified as i32,
        },
    ));
    let orientation = at_one.orientation.unwrap();
    assert!((orientation.w - (std::f64::consts::PI / 8.0).cos()).abs() < 1e-9);
    assert!((orientation.z - (std::f64::consts::PI / 8.0).sin()).abs() < 1e-9);
    assert!((at_one.coverage.unwrap().start.unwrap().seconds).abs() < 1);
    assert!(at_one.position_m.is_none());
    assert!((angle - std::f64::consts::FRAC_PI_4).abs() < 1e-12);
}

#[test]
fn rejects_wrong_scale_missing_wrong_type_and_index_resources() {
    let mut a = adapter();
    upload(&mut a, "dyn:orb", &orb_bytes());
    upload(&mut a, "dyn:ori", &quat_bytes());
    upload(&mut a, "dyn:index", &index_bytes());

    let wrong_scale = p::EvaluateDynamoQuery {
        position: Some(p::ResourceId {
            value: "dyn:orb".into(),
        }),
        orientation: None,
        instant: Some(p::TimeInstant {
            time_scale: p::TimeScale::Tt as i32,
            epoch_id: "J2000".into(),
            seconds: 0,
            nanos: 0,
        }),
        body: p::DynamoBody::Unspecified as i32,
    };
    assert_eq!(code(query(&a, wrong_scale)), p::ErrorCode::InvalidArgument);

    let missing = p::EvaluateDynamoQuery {
        position: Some(p::ResourceId {
            value: "dyn:missing".into(),
        }),
        orientation: None,
        instant: Some(instant(0, 0)),
        body: p::DynamoBody::Unspecified as i32,
    };
    assert_eq!(code(query(&a, missing)), p::ErrorCode::ProviderUnavailable);

    let wrong_type = p::EvaluateDynamoQuery {
        position: Some(p::ResourceId {
            value: "dyn:ori".into(),
        }),
        orientation: None,
        instant: Some(instant(0, 0)),
        body: p::DynamoBody::Unspecified as i32,
    };
    assert_eq!(code(query(&a, wrong_type)), p::ErrorCode::InvalidArgument);

    let index = p::EvaluateDynamoQuery {
        position: Some(p::ResourceId {
            value: "dyn:index".into(),
        }),
        orientation: None,
        instant: Some(instant(0, 0)),
        body: p::DynamoBody::Unspecified as i32,
    };
    assert_eq!(code(query(&a, index)), p::ErrorCode::InvalidArgument);

    let empty = p::EvaluateDynamoQuery {
        position: None,
        orientation: None,
        instant: Some(instant(0, 0)),
        body: p::DynamoBody::Unspecified as i32,
    };
    assert_eq!(code(query(&a, empty)), p::ErrorCode::InvalidArgument);
}

fn orbit_query(a: &ProtocolAdapter, query: p::DynamoOrbitQuery) -> p::ResponseEnvelope {
    let envelope = p::QueryEnvelope {
        context: Some(context("dynamo-orbit")),
        payload: Some(p::query_envelope::Payload::DynamoOrbit(query)),
    };
    p::ResponseEnvelope::decode(
        a.query_bytes("owner", &envelope.encode_to_vec())
            .unwrap()
            .as_slice(),
    )
    .unwrap()
}

#[test]
fn evaluates_an_uploaded_orbit_polyline() {
    let mut a = adapter();
    upload(&mut a, "dyn:orb", &orb_bytes());
    upload(&mut a, "dyn:ori", &quat_bytes());
    let response = orbit_query(
        &a,
        p::DynamoOrbitQuery {
            resource: Some(p::ResourceId {
                value: "dyn:orb".into(),
            }),
            instant: Some(instant(0, 0)),
            samples: 4,
        },
    );
    assert_eq!(
        response.status,
        p::ResponseStatus::Completed as i32,
        "{response:?}"
    );
    let p::response_envelope::Payload::DynamoOrbit(orbit) = response.payload.unwrap() else {
        panic!()
    };
    assert_eq!(orbit.points_m.len(), 4);
    assert!(orbit.closed);
    assert!((orbit.points_m[0].x - 1000.0).abs() < 1e-9);
    assert!(orbit.points_m[0].y.abs() < 1e-9);
    assert!(orbit.points_m[1].x.abs() < 1e-9);
    assert!((orbit.points_m[1].y - 1000.0).abs() < 1e-9);
    assert_eq!(orbit.coverage.unwrap().start.unwrap().seconds, 0);
    assert_eq!(orbit.source_id, "synthetic");
    assert_eq!(orbit.source_version, "v1");

    let too_few = orbit_query(
        &a,
        p::DynamoOrbitQuery {
            resource: Some(p::ResourceId {
                value: "dyn:orb".into(),
            }),
            instant: Some(instant(0, 0)),
            samples: 2,
        },
    );
    assert_eq!(code(too_few), p::ErrorCode::InvalidArgument);

    let wrong_type = orbit_query(
        &a,
        p::DynamoOrbitQuery {
            resource: Some(p::ResourceId {
                value: "dyn:ori".into(),
            }),
            instant: Some(instant(0, 0)),
            samples: 4,
        },
    );
    assert_eq!(code(wrong_type), p::ErrorCode::InvalidArgument);
}
