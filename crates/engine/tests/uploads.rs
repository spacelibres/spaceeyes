// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_engine::{Engine, EngineState};
use spaceeyes_foundation::{CoreError, ObjectId, ResourceId, Revision};
use spaceeyes_resources::{ResourceError, UploadDescriptor, UploadFormat, UploadSource};
use spaceeyes_scene::{SceneCommand, SceneObject};
use spaceeyes_time::TimeInstant;
fn engine() -> Engine {
    Engine::new(TimeInstant::new("TT", "epoch", 0, 0).unwrap())
}
fn descriptor() -> UploadDescriptor {
    UploadDescriptor {
        resource_id: ResourceId::new("upload:fixture").unwrap(),
        total_bytes: 3,
        format: UploadFormat::Blob,
        source: UploadSource {
            source_id: "fixture".into(),
            source_version: "1".into(),
            sha256: [
                0xba, 0x78, 0x16, 0xbf, 0x8f, 0x01, 0xcf, 0xea, 0x41, 0x41, 0x40, 0xde, 0x5d, 0xae,
                0x22, 0x23, 0xb0, 0x03, 0x61, 0xa3, 0x96, 0x17, 0x7a, 0x9c, 0xb4, 0x10, 0xff, 0x61,
                0xf2, 0x00, 0x15, 0xad,
            ],
        },
    }
}
#[test]
fn engine_upload_queries_and_rejections_do_not_advance_snapshot() {
    let mut e = engine();
    let s = e.begin_upload("alice", descriptor()).unwrap();
    assert_eq!(e.snapshot().sequence, 1);
    let before = e.snapshot();
    assert_eq!(e.upload_status("alice", &s.upload_id).unwrap(), s);
    assert_eq!(e.snapshot(), before);
    assert_eq!(
        e.append_upload("bob", &s.upload_id, 0, b"abc"),
        Err(ResourceError::PermissionDenied)
    );
    assert_eq!(
        e.finish_upload("alice", &s.upload_id),
        Err(ResourceError::InvalidSize)
    );
    assert_eq!(e.snapshot(), before);
    e.append_upload("alice", &s.upload_id, 0, b"abc").unwrap();
    assert_eq!(e.snapshot().sequence, 2);
    e.finish_upload("alice", &s.upload_id).unwrap();
    assert_eq!(e.snapshot().sequence, 3);
    assert_eq!(e.resource_usage().cpu_bytes, 3);
    assert_eq!(e.project_state().resources.len(), 1);
}
#[test]
fn uploading_resource_cannot_enter_scene_and_shutdown_clears_sessions() {
    let mut e = engine();
    let d = descriptor();
    let s = e.begin_upload("alice", d.clone()).unwrap();
    let before = e.snapshot();
    let object = ObjectId::new("object").unwrap();
    assert_eq!(
        e.submit_scene(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(object.clone())),
                SceneCommand::SetResources {
                    object,
                    resources: vec![d.resource_id]
                },
            ]
        ),
        Err(CoreError::ResourceUnavailable)
    );
    assert_eq!(e.snapshot(), before);
    assert!(e.project_state().resources.is_empty());
    e.shutdown();
    assert_eq!(e.state(), EngineState::Stopped);
    assert_eq!(e.resource_used_bytes(), 0);
    assert_eq!(
        e.append_upload("alice", &s.upload_id, 0, b"abc"),
        Err(ResourceError::EngineUnavailable)
    );
    assert_eq!(
        e.upload_status("alice", &s.upload_id),
        Err(ResourceError::EngineUnavailable)
    );
}
#[test]
fn invalid_complete_upload_releases_budget_and_advances_consistent_revisions() {
    let mut e = engine();
    let s = e.begin_upload("alice", descriptor()).unwrap();
    e.append_upload("alice", &s.upload_id, 0, b"abd").unwrap();
    let before = e.snapshot();
    assert_eq!(
        e.finish_upload("alice", &s.upload_id),
        Err(ResourceError::DigestMismatch)
    );
    assert_eq!(e.snapshot().sequence, before.sequence + 1);
    assert_eq!(e.snapshot().resource_revision, before.resource_revision + 1);
    assert_eq!(e.resource_used_bytes(), 0);
    let s = e.begin_upload("alice", descriptor()).unwrap();
    e.cancel_upload("alice", &s.upload_id).unwrap();
    let before = e.snapshot();
    assert_eq!(
        e.finish_upload("alice", &s.upload_id),
        Err(ResourceError::InvalidUpload)
    );
    assert_eq!(e.snapshot(), before);
}
