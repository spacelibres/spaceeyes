// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! C09: host-stamped wall-clock expiry for abandoned uploads.
use spaceeyes_engine::{Command, CommandDispatcher, Engine};
use spaceeyes_foundation::ResourceId;
use spaceeyes_resources::{
    upload_digest, ResourceError, UploadDescriptor, UploadFormat, UploadSource,
};
use spaceeyes_time::TimeInstant;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

fn instant() -> TimeInstant {
    TimeInstant::new("TT", "explicit", 0, 0).unwrap()
}

fn descriptor() -> UploadDescriptor {
    let bytes = b"abc";
    UploadDescriptor {
        resource_id: ResourceId::new("expiring").unwrap(),
        total_bytes: bytes.len() as u64,
        source: UploadSource {
            source_id: "fixture".into(),
            source_version: "1".into(),
            sha256: upload_digest(bytes),
        },
        format: UploadFormat::Blob,
    }
}

#[test]
fn engine_expiry_skips_unstamped_sessions_and_releases_stamped_ones() {
    let mut engine = Engine::new(instant());
    let stamped = engine.begin_upload_at("alice", descriptor(), 100).unwrap();
    let mut unstamped_descriptor = descriptor();
    unstamped_descriptor.resource_id = ResourceId::new("unstamped").unwrap();
    let unstamped = engine
        .begin_upload_at("alice", unstamped_descriptor, 0)
        .unwrap();
    assert!(engine.expire_uploads(109, 10).unwrap().is_empty());
    assert_eq!(
        engine.expire_uploads(110, 10).unwrap(),
        vec![stamped.upload_id.clone()]
    );
    assert_eq!(
        engine.upload_status("alice", &stamped.upload_id),
        Err(ResourceError::InvalidUpload)
    );
    assert!(engine.expire_uploads(u64::MAX, 1).unwrap().is_empty());
    assert!(engine.upload_status("alice", &unstamped.upload_id).is_ok());
}

#[test]
fn dispatcher_expires_uploads_before_the_next_command() {
    let now = Arc::new(AtomicU64::new(1_000));
    let clock = Arc::clone(&now);
    let mut dispatcher = CommandDispatcher::with_upload_clock(
        Engine::new(instant()),
        "session".into(),
        16,
        Box::new(move || clock.load(Ordering::Relaxed)),
    )
    .unwrap();
    dispatcher.set_upload_ttl(10);
    let begun = dispatcher
        .submit(
            "session",
            "host",
            "begin",
            Command::BeginUpload {
                descriptor: descriptor(),
            },
        )
        .unwrap();
    let id = begun.upload.expect("upload status").upload_id;
    dispatcher
        .submit(
            "session",
            "host",
            "append",
            Command::AppendUpload {
                upload_id: id.clone(),
                offset: 0,
                data: b"abc".to_vec(),
            },
        )
        .unwrap();
    now.store(1_009, Ordering::Relaxed);
    dispatcher
        .submit("session", "host", "play", Command::Play)
        .unwrap();
    assert!(dispatcher.engine().upload_status("host", &id).is_ok());
    now.store(1_010, Ordering::Relaxed);
    dispatcher
        .submit("session", "host", "step", Command::Step(1))
        .unwrap();
    assert_eq!(
        dispatcher.engine().upload_status("host", &id),
        Err(ResourceError::InvalidUpload)
    );
    assert_eq!(dispatcher.engine().resource_used_bytes(), 0);
}
