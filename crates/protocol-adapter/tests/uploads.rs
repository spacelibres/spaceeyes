// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use prost::Message;
use spaceeyes_engine::{CommandDispatcher, Engine};
use spaceeyes_protocol_adapter::{generated as p, ProtocolAdapter};
use spaceeyes_time::TimeInstant;
fn context(id: &str) -> p::RequestContext {
    p::RequestContext {
        request_id: id.into(),
        session_id: "uploads".into(),
        protocol_version: Some(p::ProtocolVersion {
            major: 1,
            minor: 0,
            schema_id: "spaceeyes.core.v1".into(),
        }),
        ..Default::default()
    }
}
fn send(
    a: &mut ProtocolAdapter,
    owner: &str,
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
        a.submit_bytes(owner, &request.encode_to_vec())
            .unwrap()
            .as_slice(),
    )
    .unwrap()
}
fn begin() -> p::resource_command::Action {
    p::resource_command::Action::BeginUpload(p::BeginResourceUpload {
        resource_id: Some(p::ResourceId {
            value: "asset".into(),
        }),
        total_bytes: 3,
        source: Some(p::ResourceSource {
            source_id: "fixture".into(),
            source_version: "v1".into(),
            sha256: vec![
                0xba, 0x78, 0x16, 0xbf, 0x8f, 0x01, 0xcf, 0xea, 0x41, 0x41, 0x40, 0xde, 0x5d, 0xae,
                0x22, 0x23, 0xb0, 0x03, 0x61, 0xa3, 0x96, 0x17, 0x7a, 0x9c, 0xb4, 0x10, 0xff, 0x61,
                0xf2, 0x00, 0x15, 0xad,
            ],
        }),
        format: p::ResourceUploadFormat::Bytes as i32,
        ..Default::default()
    })
}
fn code(response: p::ResponseEnvelope) -> p::ErrorCode {
    assert_eq!(response.status, p::ResponseStatus::Rejected as i32);
    let p::response_envelope::Payload::Error(e) = response.payload.unwrap() else {
        panic!()
    };
    p::ErrorCode::try_from(e.code).unwrap()
}
#[test]
fn upload_wire_retries_authorization_cancellation_and_readonly_queries() {
    let mut a = ProtocolAdapter::new(
        CommandDispatcher::new(
            Engine::new(TimeInstant::new("TT", "test", 0, 0).unwrap()),
            "uploads".into(),
            128,
        )
        .unwrap(),
    )
    .unwrap();
    let first = send(&mut a, "owner", "begin", begin());
    assert_eq!(
        first.status,
        p::ResponseStatus::Completed as i32,
        "{first:?}"
    );
    assert_eq!(send(&mut a, "owner", "begin", begin()), first);
    let p::response_envelope::Payload::Upload(s) = first.payload.unwrap() else {
        panic!()
    };
    let token = s.upload_id;
    let before = a.dispatcher().session_status();
    let remaining = a.dispatcher().command_history_remaining();
    let q = p::QueryEnvelope {
        context: Some(context("status")),
        payload: Some(p::query_envelope::Payload::Upload(p::ResourceUploadQuery {
            upload_id: token.clone(),
        })),
    };
    let response = p::ResponseEnvelope::decode(
        a.query_bytes("owner", &q.encode_to_vec())
            .unwrap()
            .as_slice(),
    )
    .unwrap();
    assert_eq!(response.status, p::ResponseStatus::Completed as i32);
    assert_eq!(a.dispatcher().session_status(), before);
    assert_eq!(a.dispatcher().command_history_remaining(), remaining);
    let forbidden = p::ResponseEnvelope::decode(
        a.query_bytes("intruder", &q.encode_to_vec())
            .unwrap()
            .as_slice(),
    )
    .unwrap();
    assert_eq!(code(forbidden), p::ErrorCode::PermissionDenied);
    let chunk = p::resource_command::Action::AppendUpload(p::AppendResourceUpload {
        upload_id: token.clone(),
        offset: 0,
        data: b"abc".to_vec(),
    });
    assert_eq!(
        code(send(&mut a, "intruder", "steal", chunk.clone())),
        p::ErrorCode::PermissionDenied
    );
    let appended = send(&mut a, "owner", "chunk", chunk.clone());
    assert_eq!(appended.status, p::ResponseStatus::Completed as i32);
    assert_eq!(send(&mut a, "owner", "chunk", chunk.clone()), appended);
    assert_eq!(
        code(send(&mut a, "owner", "duplicate-offset", chunk)),
        p::ErrorCode::InvalidArgument
    );
    let finish = p::resource_command::Action::FinishUpload(p::FinishResourceUpload {
        upload_id: token.clone(),
    });
    let done = send(&mut a, "owner", "finish", finish.clone());
    assert_eq!(done.status, p::ResponseStatus::Completed as i32, "{done:?}");
    assert_eq!(send(&mut a, "owner", "finish", finish.clone()), done);
    assert_eq!(a.dispatcher().engine().resource_usage().cpu_bytes, 3);
    assert_eq!(a.dispatcher().engine().resource_usage().staging_bytes, 0);
    assert_eq!(
        code(send(&mut a, "owner", "late", finish)),
        p::ErrorCode::InvalidArgument
    );
    let mut action = begin();
    if let p::resource_command::Action::BeginUpload(b) = &mut action {
        b.resource_id.as_mut().unwrap().value = "cancelled".into();
    }
    let response = send(&mut a, "owner", "begin-cancel", action);
    let p::response_envelope::Payload::Upload(s) = response.payload.unwrap() else {
        panic!()
    };
    let cancel = p::resource_command::Action::CancelUpload(p::CancelResourceUpload {
        upload_id: s.upload_id.clone(),
    });
    assert_eq!(
        send(&mut a, "owner", "cancel", cancel).status,
        p::ResponseStatus::Completed as i32
    );
    assert_eq!(a.dispatcher().engine().resource_usage().cpu_bytes, 3);
    assert_eq!(a.dispatcher().engine().resource_usage().staging_bytes, 0);
    let late = p::resource_command::Action::AppendUpload(p::AppendResourceUpload {
        upload_id: s.upload_id,
        offset: 0,
        data: b"abc".to_vec(),
    });
    assert_eq!(
        code(send(&mut a, "owner", "late-chunk", late)),
        p::ErrorCode::InvalidArgument
    );
}
