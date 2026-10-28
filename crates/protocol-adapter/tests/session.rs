// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Integration path uses only wire writes; direct Engine access is read-only frame publication.
use prost::Message;
use spaceeyes_engine::{CommandDispatcher, Engine};
use spaceeyes_foundation::{FrameId, ObjectId};
use spaceeyes_protocol_adapter::{generated as p, ProtocolAdapter, ProtocolError};
use spaceeyes_spatial::{ProviderRef, RigidTransform, SpatialError, TransformProvider};
use spaceeyes_time::TimeInstant;
use std::sync::Arc;
fn adapter(capacity: usize) -> ProtocolAdapter {
    ProtocolAdapter::new(
        CommandDispatcher::new(
            Engine::new(TimeInstant::new("TT", "prototype", 0, 0).unwrap()),
            "session".into(),
            capacity,
        )
        .unwrap(),
    )
    .unwrap()
}

#[test]
fn resource_stats_and_capabilities_report_actual_limits_without_mutation() {
    use spaceeyes_foundation::ResourceId;
    use spaceeyes_resources::ResourceLimits;
    let limits = ResourceLimits {
        total_bytes: 100,
        cpu_bytes: 60,
        gpu_bytes: 50,
        staging_bytes: 20,
    };
    let mut engine =
        Engine::with_resource_limits(TimeInstant::new("TT", "prototype", 0, 0).unwrap(), limits);
    engine
        .register_resource(ResourceId::new("asset").unwrap(), 40)
        .unwrap();
    engine
        .register_gpu_resource(ResourceId::new("surface").unwrap(), 30)
        .unwrap();
    let mut a = ProtocolAdapter::new(CommandDispatcher::new(engine, "session".into(), 16).unwrap())
        .unwrap();
    let request = p::QueryEnvelope {
        context: Some(context("stats")),
        payload: Some(p::query_envelope::Payload::ResourceStats(
            p::ResourceStatsQuery {},
        )),
    };
    let before = status(&a);
    let response = completed(query(&a, request.clone()));
    let p::response_envelope::Payload::ResourceStats(s) = response.payload.unwrap() else {
        panic!()
    };
    assert_eq!(
        (
            s.total_used_bytes,
            s.cpu_used_bytes,
            s.gpu_used_bytes,
            s.staging_used_bytes
        ),
        (70, 40, 30, 0)
    );
    assert_eq!(
        (
            s.total_limit_bytes,
            s.cpu_limit_bytes,
            s.gpu_limit_bytes,
            s.staging_limit_bytes
        ),
        (100, 60, 50, 20)
    );
    assert_eq!(s.resource_revision, before.resource_revision);
    let caps = completed(query(
        &a,
        p::QueryEnvelope {
            context: Some(context("caps")),
            payload: Some(p::query_envelope::Payload::Capabilities(
                p::CapabilitiesQuery {},
            )),
        },
    ));
    let p::response_envelope::Payload::Capabilities(caps) = caps.payload.unwrap() else {
        panic!()
    };
    let cap = caps.limits.unwrap();
    assert_eq!(
        (
            cap.max_resource_total_bytes,
            cap.max_resource_cpu_bytes,
            cap.max_resource_gpu_bytes,
            cap.max_resource_staging_bytes
        ),
        (100, 60, 50, 20)
    );
    assert_eq!(status(&a), before);
    assert_eq!(a.dispatcher().command_history_remaining(), 16);
    assert_eq!(a.dispatcher().events().count(), 0);
    completed(send(&mut a, lifecycle("stop", false)));
    let stopped = completed(query(&a, request));
    let p::response_envelope::Payload::ResourceStats(stopped) = stopped.payload.unwrap() else {
        panic!()
    };
    assert_eq!(
        (
            stopped.total_used_bytes,
            stopped.cpu_used_bytes,
            stopped.gpu_used_bytes,
            stopped.staging_used_bytes
        ),
        (0, 0, 0, 0)
    );
    assert_eq!(stopped.cpu_limit_bytes, 60);
}

#[test]
fn pick_queries_reject_missing_frames_invalid_coordinates_and_stopped_sessions_without_writes() {
    let mut a = adapter(16);
    let before = status(&a);
    let read = |a: &ProtocolAdapter, x: f32| {
        query(
            a,
            p::QueryEnvelope {
                context: Some(context("pick")),
                payload: Some(p::query_envelope::Payload::PickPresented(
                    p::PickPresentedQuery {
                        frame_sequence: 0,
                        x,
                        y: 0.0,
                    },
                )),
            },
        )
    };
    let error = |r: p::ResponseEnvelope| match r.payload.unwrap() {
        p::response_envelope::Payload::Error(e) => e.code,
        other => panic!("unexpected {other:?}"),
    };
    assert_eq!(error(read(&a, 0.0)), p::ErrorCode::SnapshotExpired as i32);
    for x in [f32::NAN, f32::INFINITY, -1.01, 1.01] {
        assert_eq!(error(read(&a, x)), p::ErrorCode::InvalidArgument as i32);
    }
    assert_eq!(status(&a), before);
    assert_eq!(a.dispatcher().command_history_remaining(), 16);
    assert_eq!(a.dispatcher().events().count(), 0);
    completed(send(&mut a, lifecycle("stop", false)));
    assert_eq!(error(read(&a, 0.0)), p::ErrorCode::EngineUnavailable as i32);
}
fn context(id: &str) -> p::RequestContext {
    p::RequestContext {
        request_id: id.into(),
        session_id: "session".into(),
        protocol_version: Some(p::ProtocolVersion {
            major: 1,
            minor: 0,
            schema_id: "spaceeyes.core.v1".into(),
        }),
        ..Default::default()
    }
}
fn frame(id: &str) -> Option<p::FrameId> {
    Some(p::FrameId { value: id.into() })
}
fn instant() -> Option<p::TimeInstant> {
    Some(p::TimeInstant {
        time_scale: p::TimeScale::Tt as i32,
        epoch_id: "prototype".into(),
        seconds: 0,
        nanos: 0,
    })
}
fn command(id: &str, payload: p::command_envelope::Payload) -> p::CommandEnvelope {
    p::CommandEnvelope {
        context: Some(context(id)),
        payload: Some(payload),
    }
}
fn root(id: &str, revision: u64) -> p::CommandEnvelope {
    command(
        id,
        p::command_envelope::Payload::Spatial(p::SpatialCommand {
            expected_revision: Some(revision),
            action: Some(p::spatial_command::Action::RegisterRoot(
                p::RegisterRootFrame {
                    frame_id: frame(id),
                },
            )),
        }),
    )
}
fn child(id: &str, parent: &str, revision: u64) -> p::CommandEnvelope {
    command(
        id,
        p::command_envelope::Payload::Spatial(p::SpatialCommand {
            expected_revision: Some(revision),
            action: Some(p::spatial_command::Action::RegisterChildSample(
                p::RegisterChildFrameSample {
                    frame_id: frame(id),
                    parent_id: frame(parent),
                    instant: instant(),
                    to_parent: Some(p::RigidTransform {
                        translation_m: Some(p::Vector3d {
                            x: 0.,
                            y: 0.,
                            z: -6.,
                        }),
                        rotation: Some(p::Quaterniond {
                            w: 2.,
                            x: 0.,
                            y: 0.,
                            z: 0.,
                        }),
                    }),
                },
            )),
        }),
    )
}
fn provider_frame(
    id: &str,
    parent: &str,
    revision: u64,
    provider_id: &str,
    provider_version: &str,
) -> p::CommandEnvelope {
    command(
        id,
        p::command_envelope::Payload::Spatial(p::SpatialCommand {
            expected_revision: Some(revision),
            action: Some(p::spatial_command::Action::RegisterProviderFrame(
                p::RegisterProviderFrame {
                    frame_id: frame(id),
                    parent_id: frame(parent),
                    provider: Some(p::ProviderIdentity {
                        provider_id: provider_id.into(),
                        provider_version: provider_version.into(),
                    }),
                },
            )),
        }),
    )
}
fn provider_sample(request: &str, revision: u64, nanos: u32, x: f64) -> p::CommandEnvelope {
    provider_sample_for(request, revision, nanos, x, "earth")
}
fn provider_sample_for(
    request: &str,
    revision: u64,
    nanos: u32,
    x: f64,
    id: &str,
) -> p::CommandEnvelope {
    command(
        request,
        p::command_envelope::Payload::Spatial(p::SpatialCommand {
            expected_revision: Some(revision),
            action: Some(p::spatial_command::Action::UpdateProviderFrameSample(
                p::UpdateProviderFrameSample {
                    frame_id: frame(id),
                    instant: Some(p::TimeInstant {
                        time_scale: p::TimeScale::Tt as i32,
                        epoch_id: "prototype".into(),
                        seconds: 0,
                        nanos,
                    }),
                    to_parent: Some(p::RigidTransform {
                        translation_m: Some(p::Vector3d { x, y: 0., z: 0. }),
                        rotation: Some(p::Quaterniond {
                            w: 1.,
                            x: 0.,
                            y: 0.,
                            z: 0.,
                        }),
                    }),
                },
            )),
        }),
    )
}
fn lifecycle(id: &str, start: bool) -> p::CommandEnvelope {
    command(
        id,
        p::command_envelope::Payload::Lifecycle(p::LifecycleCommand {
            action: Some(if start {
                p::lifecycle_command::Action::Start(p::StartEngine {})
            } else {
                p::lifecycle_command::Action::Stop(p::StopEngine {})
            }),
        }),
    )
}
fn send(a: &mut ProtocolAdapter, c: p::CommandEnvelope) -> p::ResponseEnvelope {
    p::ResponseEnvelope::decode(
        a.submit_bytes("host", &c.encode_to_vec())
            .unwrap()
            .as_slice(),
    )
    .unwrap()
}
fn query(a: &ProtocolAdapter, q: p::QueryEnvelope) -> p::ResponseEnvelope {
    p::ResponseEnvelope::decode(
        a.query_bytes("host", &q.encode_to_vec())
            .unwrap()
            .as_slice(),
    )
    .unwrap()
}
fn status_query() -> p::QueryEnvelope {
    p::QueryEnvelope {
        context: Some(context("read")),
        payload: Some(p::query_envelope::Payload::SessionStatus(
            p::SessionStatusQuery {},
        )),
    }
}
fn events_query(after_sequence: u64, max_events: u32) -> p::QueryEnvelope {
    p::QueryEnvelope {
        context: Some(context("events")),
        payload: Some(p::query_envelope::Payload::Events(p::EventsQuery {
            after_sequence,
            max_events,
        })),
    }
}
fn resolve(source: &str, target: &str) -> p::QueryEnvelope {
    p::QueryEnvelope {
        context: Some(context("resolve")),
        payload: Some(p::query_envelope::Payload::ResolveFrame(
            p::ResolveFrameQuery {
                source: frame(source),
                target: frame(target),
            },
        )),
    }
}
fn status(a: &ProtocolAdapter) -> p::SessionStatus {
    match query(a, status_query()).payload.unwrap() {
        p::response_envelope::Payload::Session(s) => s,
        other => panic!("{other:?}"),
    }
}
#[test]
fn events_query_replays_typed_events_and_rejects_foreign_cursors() {
    let mut a = adapter(4);
    completed(send(&mut a, root("root", 0)));
    let page = match completed(query(&a, events_query(0, 16))).payload.unwrap() {
        p::response_envelope::Payload::Events(page) => page,
        other => panic!("{other:?}"),
    };
    assert_eq!((page.next_sequence, page.replay_from), (1, 1));
    assert_eq!(page.events.len(), 1);
    let event = &page.events[0];
    assert_eq!(event.sequence, 1);
    assert_eq!(event.session_id, "session");
    assert_eq!(event.kind, p::CoreEventKind::FrameInvalidated as i32);
    assert_eq!(event.command_sequence, 1);
    assert_eq!(event.frame_graph_revision, 1);
    assert_eq!(event.time_generation, 0);

    let page = match completed(query(&a, events_query(1, 16))).payload.unwrap() {
        p::response_envelope::Payload::Events(page) => page,
        other => panic!("{other:?}"),
    };
    assert!(page.events.is_empty());
    assert_eq!(page.next_sequence, 1);
    assert_eq!(
        error(query(&a, events_query(9, 16))),
        p::ErrorCode::StaleGeneration
    );
    // Zero selects the default page size; an oversized page is rejected.
    let page = match completed(query(&a, events_query(0, 0))).payload.unwrap() {
        p::response_envelope::Payload::Events(page) => page,
        other => panic!("{other:?}"),
    };
    assert_eq!(page.events.len(), 1);
    assert_eq!(
        error(query(&a, events_query(0, 200))),
        p::ErrorCode::InvalidArgument
    );
}

fn coverage_query(frame: &str) -> p::QueryEnvelope {
    p::QueryEnvelope {
        context: Some(context("coverage")),
        payload: Some(p::query_envelope::Payload::FrameCoverage(
            p::FrameCoverageQuery {
                frame: self::frame(frame),
            },
        )),
    }
}

#[derive(Debug)]
struct Covered;
impl TransformProvider for Covered {
    fn provider_id(&self) -> &str {
        "test.provider"
    }
    fn version(&self) -> &str {
        "1"
    }
    fn resolve_at(&self, _instant: &TimeInstant) -> Result<RigidTransform, SpatialError> {
        Ok(RigidTransform::IDENTITY)
    }
    fn coverage(&self) -> Option<(TimeInstant, TimeInstant)> {
        Some((
            TimeInstant::new("TT", "prototype", 0, 0).unwrap(),
            TimeInstant::new("TT", "prototype", 10, 0).unwrap(),
        ))
    }
}

#[test]
fn frame_coverage_reports_declared_provider_range_only() {
    let instant = TimeInstant::new("TT", "prototype", 0, 0).unwrap();
    let mut engine = Engine::new(instant);
    engine
        .register_root_frame(FrameId::new("root").unwrap())
        .unwrap();
    let provider = ProviderRef::new(Arc::new(Covered)).unwrap();
    engine
        .register_dynamic_frame(
            FrameId::new("moving").unwrap(),
            FrameId::new("root").unwrap(),
            provider,
        )
        .unwrap();
    let a = ProtocolAdapter::new(CommandDispatcher::new(engine, "session".into(), 16).unwrap())
        .unwrap();
    let response = completed(query(&a, coverage_query("moving")));
    let p::response_envelope::Payload::FrameCoverage(coverage) = response.payload.unwrap() else {
        panic!()
    };
    assert!(coverage.covered);
    assert_eq!(coverage.provider_id, "test.provider");
    assert_eq!(coverage.provider_version, "1");
    assert_eq!(coverage.start.unwrap().seconds, 0);
    assert_eq!(coverage.end.unwrap().seconds, 10);
    assert_eq!(
        error(query(&a, coverage_query("missing"))),
        p::ErrorCode::UnknownFrame
    );
}
fn completed(r: p::ResponseEnvelope) -> p::ResponseEnvelope {
    assert_eq!(r.status, p::ResponseStatus::Completed as i32, "{r:?}");
    r
}
fn error(r: p::ResponseEnvelope) -> p::ErrorCode {
    assert_eq!(r.status, p::ResponseStatus::Rejected as i32);
    match r.payload.unwrap() {
        p::response_envelope::Payload::Error(e) => p::ErrorCode::try_from(e.code).unwrap(),
        other => panic!("{other:?}"),
    }
}

fn object_page(token: Option<&str>, size: u32) -> p::QueryEnvelope {
    p::QueryEnvelope {
        context: Some(context("objects")),
        payload: Some(p::query_envelope::Payload::ListObjects(
            p::ListObjectsQuery {
                page_token: token.map(str::to_owned),
                page_size: size,
            },
        )),
    }
}

fn setup_scene(a: &mut ProtocolAdapter) {
    completed(send(a, root("root", 0)));
    completed(send(a, child("body-frame", "root", 1)));
    let objects = [
        p::SceneObject {
            object_id: Some(p::ObjectId {
                value: "body".into(),
            }),
            frame_id: frame("body-frame"),
            visible: true,
            lifecycle: p::ObjectLifecycle::Active as i32,
            sphere: Some(p::SpherePrimitive {
                radius_m: 1.,
                base_color: Some(p::ColorRgb {
                    r: 1.,
                    g: 0.2,
                    b: 0.1,
                }),
                ..Default::default()
            }),
            ..Default::default()
        },
        p::SceneObject {
            object_id: Some(p::ObjectId {
                value: "camera".into(),
            }),
            frame_id: frame("root"),
            visible: true,
            lifecycle: p::ObjectLifecycle::Active as i32,
            camera: Some(p::CameraState {
                tracking: None,
                position_m: Some(p::Vector3d {
                    x: 0.,
                    y: 0.,
                    z: 0.,
                }),
                orientation: Some(p::Quaterniond {
                    w: 1.,
                    x: 0.,
                    y: 0.,
                    z: 0.,
                }),
                projection: Some(p::Projection {
                    kind: Some(p::projection::Kind::Perspective(p::PerspectiveProjection {
                        vertical_fov_radians: std::f64::consts::FRAC_PI_2,
                        near_m: 0.1,
                        far_m: 100.,
                    })),
                }),
            }),
            ..Default::default()
        },
    ];
    completed(send(
        a,
        command(
            "scene",
            p::command_envelope::Payload::SceneTransaction(p::SceneTransaction {
                expected_revision: Some(0),
                commands: objects
                    .into_iter()
                    .map(|o| p::SceneCommand {
                        action: Some(p::scene_command::Action::Create(p::CreateObject {
                            object: Some(Box::new(o)),
                        })),
                    })
                    .collect(),
            }),
        ),
    ));
}

#[test]
fn focus_requires_revision_and_generation_and_camera_queries_are_read_only() {
    let mut a = adapter(64);
    setup_scene(&mut a);
    let mut focus = command(
        "focus",
        p::command_envelope::Payload::Camera(p::CameraCommand {
            action: Some(p::camera_command::Action::Focus(p::FocusCamera {
                camera: Some(p::ObjectId {
                    value: "camera".into(),
                }),
                target: Some(p::ObjectId {
                    value: "body".into(),
                }),
                distance_m: 6.0,
                follow: true,
            })),
        }),
    );
    let before = status(&a);
    assert_eq!(
        error(send(&mut a, focus.clone())),
        p::ErrorCode::InvalidArgument
    );
    focus.context.as_mut().unwrap().time_generation = Some(0);
    assert_eq!(
        error(send(&mut a, focus.clone())),
        p::ErrorCode::InvalidArgument
    );
    focus.context.as_mut().unwrap().expected_scene_revision = Some(1);
    let receipt = completed(send(&mut a, focus.clone()));
    assert_eq!(receipt.committed_scene_revision, 2);
    assert_eq!(send(&mut a, focus.clone()), receipt);
    let current = status(&a);
    assert_eq!(current.clock, before.clock);
    let read = p::QueryEnvelope {
        context: Some(context("camera-read")),
        payload: Some(p::query_envelope::Payload::CameraState(
            p::CameraStateQuery {
                camera: Some(p::ObjectId {
                    value: "camera".into(),
                }),
            },
        )),
    };
    let history = a.dispatcher().command_history_remaining();
    let result = completed(query(&a, read.clone()));
    let p::response_envelope::Payload::Camera(info) = result.payload.unwrap() else {
        panic!()
    };
    assert_eq!(
        info.state.unwrap().tracking.unwrap().target.unwrap().value,
        "body"
    );
    assert_eq!(status(&a), current);
    assert_eq!(a.dispatcher().command_history_remaining(), history);
    focus.context.as_mut().unwrap().request_id = "conflict".into();
    assert_eq!(
        error(send(&mut a, focus.clone())),
        p::ErrorCode::RevisionConflict
    );
    focus.context.as_mut().unwrap().request_id = "stale".into();
    focus.context.as_mut().unwrap().time_generation = Some(99);
    assert_eq!(error(send(&mut a, focus)), p::ErrorCode::StaleGeneration);
    completed(send(&mut a, lifecycle("stop", false)));
    assert_eq!(error(query(&a, read)), p::ErrorCode::EngineUnavailable);
}
#[test]
fn fresh_wire_session_creates_resolves_and_prepares_pickable_scene() {
    let mut a = adapter(32);
    assert_eq!(status(&a).lifecycle, p::EngineLifecycle::Ready as i32);
    assert_eq!(status(&a).session_id, "session");
    setup_scene(&mut a);
    completed(send(&mut a, lifecycle("start", true)));
    let current = status(&a);
    assert_eq!(
        (
            current.lifecycle,
            current.object_count,
            current.scene_revision,
            current.frame_graph_revision
        ),
        (p::EngineLifecycle::Running as i32, 2, 1, 2)
    );
    let r = completed(query(&a, resolve("body-frame", "root")));
    let p::response_envelope::Payload::Frame(pose) = r.payload.unwrap() else {
        panic!()
    };
    assert_eq!(pose.instant, instant());
    assert_eq!(
        pose.transform
            .as_ref()
            .unwrap()
            .translation_m
            .as_ref()
            .unwrap()
            .z,
        -6.
    );
    assert_eq!(pose.transform.unwrap().rotation.unwrap().w, 1.);
    let snapshot = a
        .dispatcher()
        .engine()
        .publish_frame(&FrameId::new("root").unwrap())
        .unwrap();
    let prepared =
        spaceeyes_rendering::prepare_camera(&snapshot, &ObjectId::new("camera").unwrap(), 1.)
            .unwrap();
    assert_eq!(prepared.spheres.len(), 1);
    assert_eq!(
        prepared.pick(0., 0.).unwrap().object,
        ObjectId::new("body").unwrap()
    );
    assert_eq!(status(&a), current, "read path must preserve authority");
}
#[test]
fn spatial_preconditions_and_bad_inputs_never_partially_mutate() {
    let mut a = adapter(32);
    completed(send(&mut a, root("root", 0)));
    let before = status(&a);
    assert_eq!(
        error(send(&mut a, child("stale", "root", 0))),
        p::ErrorCode::RevisionConflict
    );
    assert_eq!(
        error(send(&mut a, child("missing", "absent", 1))),
        p::ErrorCode::InvalidArgument
    );
    let mut duplicate = root("root", 1);
    duplicate.context.as_mut().unwrap().request_id = "duplicate".into();
    assert_eq!(
        error(send(&mut a, duplicate)),
        p::ErrorCode::InvalidArgument
    );
    for bad in [f64::NAN, f64::INFINITY, 0.] {
        let mut c = child("invalid", "root", 1);
        let p::command_envelope::Payload::Spatial(s) = c.payload.as_mut().unwrap() else {
            panic!()
        };
        let p::spatial_command::Action::RegisterChildSample(s) = s.action.as_mut().unwrap() else {
            panic!()
        };
        s.to_parent.as_mut().unwrap().rotation.as_mut().unwrap().w = bad;
        assert_eq!(error(send(&mut a, c)), p::ErrorCode::InvalidArgument);
    }
    let mut c = root("no-revision", 1);
    let p::command_envelope::Payload::Spatial(s) = c.payload.as_mut().unwrap() else {
        panic!()
    };
    s.expected_revision = None;
    assert_eq!(error(send(&mut a, c)), p::ErrorCode::InvalidArgument);
    let mut c = child("stale-generation", "root", 1);
    c.context.as_mut().unwrap().time_generation = Some(99);
    assert_eq!(error(send(&mut a, c)), p::ErrorCode::StaleGeneration);
    assert_eq!(status(&a), before);
    assert_eq!(a.dispatcher().events().count(), 1);
}
#[test]
fn replay_returns_original_graph_and_lifecycle_receipts() {
    let mut a = adapter(32);
    let c = root("root", 0);
    let original = completed(send(&mut a, c.clone()));
    completed(send(&mut a, child("child", "root", 1)));
    assert_eq!(send(&mut a, c.clone()), original);
    let mut changed = c;
    let p::command_envelope::Payload::Spatial(s) = changed.payload.as_mut().unwrap() else {
        panic!()
    };
    s.expected_revision = Some(2);
    assert_eq!(
        error(send(&mut a, changed)),
        p::ErrorCode::IdempotencyConflict
    );
    let start = lifecycle("start", true);
    let receipt = completed(send(&mut a, start.clone()));
    completed(send(&mut a, lifecycle("stop", false)));
    assert_eq!(send(&mut a, start), receipt);
    assert_eq!(status(&a).lifecycle, p::EngineLifecycle::Stopped as i32);
    assert_eq!(
        error(send(&mut a, lifecycle("restart", true))),
        p::ErrorCode::InvalidArgument
    );
    assert_eq!(
        error(query(&a, resolve("root", "root"))),
        p::ErrorCode::EngineUnavailable
    );
    assert_eq!(
        error(send(&mut a, root("after-stop", 2))),
        p::ErrorCode::EngineUnavailable
    );
}
#[test]
fn queries_are_live_and_do_not_consume_command_history_or_events() {
    let mut a = adapter(1);
    let before = status(&a);
    for _ in 0..64 {
        assert_eq!(status(&a), before);
    }
    assert_eq!(a.dispatcher().events().count(), 0);
    let receipt = completed(send(&mut a, root("root", 0)));
    assert_eq!(status(&a).frame_graph_revision, 1);
    assert_eq!(
        query(&a, status_query()).command_sequence,
        receipt.command_sequence
    );
    assert_eq!(a.dispatcher().events().count(), 1);
    assert_eq!(
        error(send(&mut a, root("full", 1))),
        p::ErrorCode::ResourceExceeded
    );
    assert_eq!(status(&a).frame_graph_revision, 1);
}
#[test]
fn queries_validate_identity_version_size_and_read_preconditions() {
    let a = adapter(8);
    let before = status(&a);
    for change in 0..6 {
        let mut q = status_query();
        let c = q.context.as_mut().unwrap();
        match change {
            0 => c.session_id = "other".into(),
            1 => c.request_id.clear(),
            2 => c.protocol_version.as_mut().unwrap().major = 99,
            3 => c.expected_scene_revision = Some(1),
            4 => c.time_generation = Some(1),
            _ => c.request_id = "x".repeat(257),
        }
        let expected = match change {
            2 => p::ErrorCode::UnsupportedVersion,
            3 => p::ErrorCode::RevisionConflict,
            4 => p::ErrorCode::StaleGeneration,
            _ => p::ErrorCode::InvalidArgument,
        };
        assert_eq!(error(query(&a, q)), expected);
    }
    let r = p::ResponseEnvelope::decode(
        a.query_bytes("", &status_query().encode_to_vec())
            .unwrap()
            .as_slice(),
    )
    .unwrap();
    assert_eq!(error(r), p::ErrorCode::InvalidArgument);
    assert_eq!(
        a.query_bytes("host", &vec![0; 1024 * 1024 + 1]),
        Err(ProtocolError::MessageTooLarge)
    );
    assert_eq!(
        a.query_bytes("host", &[0xff]),
        Err(ProtocolError::InvalidContext)
    );
    assert_eq!(
        error(query(
            &a,
            p::QueryEnvelope {
                context: None,
                ..status_query()
            }
        )),
        p::ErrorCode::InvalidArgument
    );
    assert_eq!(
        error(query(
            &a,
            p::QueryEnvelope {
                payload: None,
                ..status_query()
            }
        )),
        p::ErrorCode::InvalidArgument
    );
    assert_eq!(
        error(query(&a, resolve(&"x".repeat(257), "root"))),
        p::ErrorCode::InvalidArgument
    );
    assert_eq!(status(&a), before);
    assert_eq!(a.dispatcher().command_sequence(), 0);
}
#[test]
fn seek_exposes_sample_coverage_without_inventing_positions() {
    let mut a = adapter(16);
    completed(send(&mut a, root("root", 0)));
    completed(send(&mut a, child("child", "root", 1)));
    completed(query(&a, resolve("child", "root")));
    let mut time = instant().unwrap();
    time.seconds = 1;
    completed(send(
        &mut a,
        command(
            "seek",
            p::command_envelope::Payload::Time(p::TimeCommand {
                action: Some(p::time_command::Action::Seek(p::SeekCommand {
                    instant: Some(time),
                })),
            }),
        ),
    ));
    assert_eq!(
        error(query(&a, resolve("child", "root"))),
        p::ErrorCode::TimeNotCovered
    );
    assert_eq!(
        error(query(&a, resolve("absent", "root"))),
        p::ErrorCode::UnknownFrame
    );
    let clock = status(&a).clock.unwrap();
    assert_eq!(clock.instant.unwrap().seconds, 1);
    let mut q = status_query();
    q.context.as_mut().unwrap().time_generation = Some(clock.generation - 1);
    assert_eq!(error(query(&a, q)), p::ErrorCode::StaleGeneration);
}
#[test]
fn stop_reclaims_registered_resources_and_readback_retains_exact_clock() {
    let mut a = adapter(16);
    let texture = command(
        "texture",
        p::command_envelope::Payload::Resource(p::ResourceCommand {
            action: Some(p::resource_command::Action::RegisterTexture(
                p::RegisterTextureResource {
                    resource_id: Some(p::ResourceId {
                        value: "texture".into(),
                    }),
                    texture: Some(p::TextureData {
                        width: 1,
                        height: 1,
                        rgba8: vec![255; 4],
                        color_space: p::TextureColorSpace::Srgb as i32,
                    }),
                },
            )),
        }),
    );
    let receipt = completed(send(&mut a, texture.clone()));
    assert_eq!(status(&a).resource_used_bytes, 4);
    completed(send(
        &mut a,
        command(
            "rate",
            p::command_envelope::Payload::Time(p::TimeCommand {
                action: Some(p::time_command::Action::SetRate(p::SetRateCommand {
                    rate: -0.25,
                })),
            }),
        ),
    ));
    completed(send(
        &mut a,
        command(
            "play",
            p::command_envelope::Payload::Time(p::TimeCommand {
                action: Some(p::time_command::Action::Play(p::PlayCommand {})),
            }),
        ),
    ));
    let clock = status(&a).clock.unwrap();
    assert_eq!((clock.rate_numerator, clock.rate_denominator), (-1, 4));
    assert_eq!(clock.mode, p::PlaybackMode::Playing as i32);
    completed(send(
        &mut a,
        command(
            "pause",
            p::command_envelope::Payload::Time(p::TimeCommand {
                action: Some(p::time_command::Action::Pause(p::PauseCommand {})),
            }),
        ),
    ));
    assert_eq!(
        status(&a).lifecycle,
        p::EngineLifecycle::Ready as i32,
        "Paused is not lifecycle"
    );
    completed(send(&mut a, lifecycle("stop", false)));
    assert_eq!(status(&a).resource_used_bytes, 0);
    assert_eq!(
        send(&mut a, texture),
        receipt,
        "replay is a receipt, not resource re-creation"
    );
    assert_eq!(status(&a).resource_used_bytes, 0);
}

#[test]
fn command_and_query_envelopes_cannot_cross_route_writes() {
    let mut a = adapter(8);
    completed(send(&mut a, root("root", 0)));
    let before = status(&a);
    // Distinct oneof tags are essential: a frame source must never decode as Time.play.
    let response = p::ResponseEnvelope::decode(
        a.submit_bytes("host", &resolve("root", "root").encode_to_vec())
            .unwrap()
            .as_slice(),
    )
    .unwrap();
    assert_eq!(error(response), p::ErrorCode::InvalidArgument);
    let response = p::ResponseEnvelope::decode(
        a.query_bytes("host", &root("accidental", 1).encode_to_vec())
            .unwrap()
            .as_slice(),
    )
    .unwrap();
    assert_eq!(error(response), p::ErrorCode::InvalidArgument);
    assert_eq!(status(&a), before);
    assert_eq!(a.dispatcher().command_sequence(), 1);
    assert_eq!(a.dispatcher().events().count(), 1);
}

#[test]
fn wire_rotation_and_inverse_resolution_preserve_transform_convention() {
    let mut a = adapter(8);
    completed(send(&mut a, root("root", 0)));
    let mut rotated = child("rotated", "root", 1);
    let p::command_envelope::Payload::Spatial(s) = rotated.payload.as_mut().unwrap() else {
        panic!()
    };
    let p::spatial_command::Action::RegisterChildSample(c) = s.action.as_mut().unwrap() else {
        panic!()
    };
    c.to_parent = Some(p::RigidTransform {
        translation_m: Some(p::Vector3d {
            x: 2.,
            y: 3.,
            z: 0.,
        }),
        rotation: Some(p::Quaterniond {
            w: 1.,
            x: 0.,
            y: 0.,
            z: 1.,
        }),
    });
    completed(send(&mut a, rotated));
    let r = completed(query(&a, resolve("root", "rotated")));
    let p::response_envelope::Payload::Frame(f) = r.payload.unwrap() else {
        panic!()
    };
    let t = f.transform.unwrap();
    let v = t.translation_m.unwrap();
    let q = t.rotation.unwrap();
    assert!((v.x + 3.).abs() < 1e-12 && (v.y - 2.).abs() < 1e-12 && v.z.abs() < 1e-12);
    assert!((q.w - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-12);
    assert!((q.z + std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-12);
    assert_eq!((q.x, q.y), (0., 0.));
    assert_eq!(f.frame_graph_revision, 2);
}

#[test]
fn capability_discovery_reports_executable_limits_and_live_history_without_writes() {
    let mut a = adapter(3);
    let capabilities = |a: &ProtocolAdapter| {
        let response = completed(query(
            a,
            p::QueryEnvelope {
                context: Some(context("discover")),
                payload: Some(p::query_envelope::Payload::Capabilities(
                    p::CapabilitiesQuery {},
                )),
            },
        ));
        let p::response_envelope::Payload::Capabilities(caps) = response.payload.unwrap() else {
            panic!()
        };
        caps
    };
    let before = status(&a);
    let caps = capabilities(&a);
    let limits = caps.limits.unwrap();
    assert_eq!(
        limits.max_message_bytes,
        spaceeyes_protocol_adapter::limits::MAX_MESSAGE_BYTES as u32
    );
    assert_eq!(limits.max_identifier_bytes, 256);
    assert_eq!(
        limits.max_texture_dimension,
        spaceeyes_geometry::MAX_TEXTURE_DIMENSION
    );
    assert_eq!(
        limits.max_mesh_vertices,
        spaceeyes_geometry::MAX_VERTICES as u32
    );
    assert_eq!(
        (
            limits.command_history_capacity,
            limits.command_history_remaining
        ),
        (3, 3)
    );
    let names: std::collections::HashSet<_> = caps.operations.iter().collect();
    assert_eq!(names.len(), caps.operations.len());
    assert_eq!(names.len(), 40);
    assert!(names.contains(&"query.project_export".to_string()));
    assert!(!names
        .iter()
        .any(|s| s.contains("live") || s.contains("canvas")));
    assert_eq!(status(&a), before);
    assert_eq!(a.dispatcher().events().count(), 0);
    completed(send(&mut a, root("root", 0)));
    assert_eq!(
        capabilities(&a).limits.unwrap().command_history_remaining,
        2
    );
    completed(send(&mut a, lifecycle("stop", false)));
    assert_eq!(
        capabilities(&a).limits.unwrap().command_history_remaining,
        1
    );
}
#[test]
fn capabilities_query_cannot_be_routed_as_command_or_cross_session_read() {
    let mut a = adapter(3);
    let q = p::QueryEnvelope {
        context: Some(context("discover")),
        payload: Some(p::query_envelope::Payload::Capabilities(
            p::CapabilitiesQuery {},
        )),
    };
    let before = status(&a);
    let response = p::ResponseEnvelope::decode(
        a.submit_bytes("host", &q.encode_to_vec())
            .unwrap()
            .as_slice(),
    )
    .unwrap();
    assert_eq!(error(response), p::ErrorCode::InvalidArgument);
    let mut wrong = q;
    wrong.context.as_mut().unwrap().session_id = "other".into();
    assert_eq!(error(query(&a, wrong)), p::ErrorCode::InvalidArgument);
    assert_eq!(status(&a), before);
    assert_eq!(a.dispatcher().command_sequence(), 0);
}

#[test]
fn host_frame_bounds_and_routing_reject_writes_without_clock_changes() {
    use spaceeyes_protocol_adapter::decode_host_frame;
    let valid = p::HostFrame {
        reference: frame("root"),
        camera: Some(p::ObjectId {
            value: "camera".into(),
        }),
        width: 2048,
        height: 1,
        elapsed_nanos: 250_000_000,
    };
    assert!(decode_host_frame(valid.clone()).is_ok());
    for invalid in [
        p::HostFrame {
            width: 0,
            ..valid.clone()
        },
        p::HostFrame {
            height: 2049,
            ..valid.clone()
        },
        p::HostFrame {
            elapsed_nanos: 250_000_001,
            ..valid.clone()
        },
        p::HostFrame {
            camera: None,
            ..valid.clone()
        },
    ] {
        assert!(decode_host_frame(invalid).is_err());
    }
    let envelope = p::HostFrameEnvelope {
        context: Some(context("host-frame")),
        frame: Some(valid),
    };
    let mut a = adapter(8);
    let before = status(&a);
    let response = p::ResponseEnvelope::decode(
        a.submit_bytes("host", &envelope.encode_to_vec())
            .unwrap()
            .as_slice(),
    )
    .unwrap();
    assert_eq!(error(response), p::ErrorCode::InvalidArgument);
    let response = p::ResponseEnvelope::decode(
        a.query_bytes("host", &envelope.encode_to_vec())
            .unwrap()
            .as_slice(),
    )
    .unwrap();
    assert_eq!(error(response), p::ErrorCode::InvalidArgument);
    assert_eq!(status(&a), before);
    assert_eq!(a.dispatcher().command_sequence(), 0);
}

#[test]
fn provider_sample_frames_require_identity_revision_and_instant_coverage() {
    let mut a = adapter(16);
    completed(send(&mut a, root("root", 0)));
    completed(send(
        &mut a,
        provider_frame("earth", "root", 1, "spaceeyes.nasa.dynamo", "0.0.1"),
    ));
    assert_eq!(
        error(query(&a, resolve("earth", "root"))),
        p::ErrorCode::ProviderUnavailable
    );

    let sample = provider_sample("sample", 2, 0, 3.0);
    let receipt = completed(send(&mut a, sample.clone()));
    let p::response_envelope::Payload::Spatial(spatial) = receipt.payload.unwrap() else {
        panic!()
    };
    assert_eq!(spatial.frame_graph_revision, 3);
    let replay = completed(send(&mut a, sample));
    let p::response_envelope::Payload::Spatial(spatial) = replay.payload.unwrap() else {
        panic!()
    };
    assert_eq!(spatial.frame_graph_revision, 3);

    let resolved = completed(query(&a, resolve("earth", "root")));
    let p::response_envelope::Payload::Frame(frame) = resolved.payload.unwrap() else {
        panic!()
    };
    assert_eq!(
        frame
            .transform
            .as_ref()
            .unwrap()
            .translation_m
            .as_ref()
            .unwrap()
            .x,
        3.0
    );

    assert_eq!(
        error(send(&mut a, provider_sample("stale", 2, 0, 4.0))),
        p::ErrorCode::RevisionConflict
    );
    completed(send(&mut a, provider_sample("future", 3, 5, 5.0)));
    assert_eq!(
        error(query(&a, resolve("earth", "root"))),
        p::ErrorCode::TimeNotCovered
    );
    assert_eq!(
        error(send(&mut a, provider_frame("bad", "root", 4, "", "0.0.1"))),
        p::ErrorCode::InvalidArgument
    );
    assert_eq!(
        error(send(
            &mut a,
            provider_sample_for("root-sample", 4, 0, 6.0, "root")
        )),
        p::ErrorCode::InvalidArgument
    );
}

#[test]
fn project_export_is_structured_and_restores_a_fresh_engine() {
    let mut a = adapter(16);
    setup_scene(&mut a);
    let read = |a: &ProtocolAdapter| {
        query(
            a,
            p::QueryEnvelope {
                context: Some(context("project-export")),
                payload: Some(p::query_envelope::Payload::ProjectExport(
                    p::ProjectExportQuery {},
                )),
            },
        )
    };
    let response = completed(read(&a));
    let p::response_envelope::Payload::Project(project) = response.payload.unwrap() else {
        panic!()
    };
    assert_eq!(project.schema_version, 1);
    assert_eq!(project.objects.len(), 2);
    assert_eq!(project.frames.len(), 2);
    assert_eq!(project.resources.len(), 0);
    let state = spaceeyes_protocol_adapter::decode_project(&project).unwrap();
    let restored = Engine::restore_project(&state, &[]).unwrap();
    assert_eq!(restored.scene().snapshot().objects.len(), 2);
    assert_eq!(
        restored.clock().instant(),
        &TimeInstant::new("TT", "prototype", 0, 0).unwrap()
    );
    completed(send(&mut a, lifecycle("stop", false)));
    assert_eq!(error(read(&a)), p::ErrorCode::EngineUnavailable);
}

#[test]
fn object_pagination_is_stable_ordered_and_bounded() {
    let mut a = adapter(8);
    setup_scene(&mut a);
    let first = completed(query(&a, object_page(None, 1)));
    let p::response_envelope::Payload::Objects(page) = first.payload.unwrap() else {
        panic!()
    };
    assert_eq!(page.objects.len(), 1);
    assert_eq!(page.objects[0].object_id.as_ref().unwrap().value, "body");
    assert_eq!(page.next_page_token, "body");
    assert_eq!(page.scene_revision, 1);

    let second = completed(query(&a, object_page(Some("body"), 1)));
    let p::response_envelope::Payload::Objects(page) = second.payload.unwrap() else {
        panic!()
    };
    assert_eq!(page.objects[0].object_id.as_ref().unwrap().value, "camera");
    assert_eq!(page.next_page_token, "");

    let between = completed(query(&a, object_page(Some("bodz"), 1)));
    let p::response_envelope::Payload::Objects(page) = between.payload.unwrap() else {
        panic!()
    };
    assert_eq!(page.objects[0].object_id.as_ref().unwrap().value, "camera");

    assert_eq!(
        error(query(&a, object_page(None, 257))),
        p::ErrorCode::InvalidArgument
    );
    let long = "x".repeat(257);
    assert_eq!(
        error(query(&a, object_page(Some(&long), 1))),
        p::ErrorCode::InvalidArgument
    );
    completed(send(&mut a, lifecycle("stop", false)));
    assert_eq!(
        error(query(&a, object_page(None, 1))),
        p::ErrorCode::EngineUnavailable
    );
}
