use prost::Message;
use spaceeyes_engine::{CommandDispatcher, Engine};
use spaceeyes_protocol_adapter::{generated as p, ProtocolAdapter};
use spaceeyes_time::TimeInstant;
fn adapter(capacity: usize) -> ProtocolAdapter {
    ProtocolAdapter::new(
        CommandDispatcher::new(
            Engine::new(TimeInstant::new("TT", "epoch", 0, 0).unwrap()),
            "session".into(),
            capacity,
        )
        .unwrap(),
    )
    .unwrap()
}
fn request(id: &str) -> p::CommandEnvelope {
    p::CommandEnvelope {
        context: Some(p::RequestContext {
            request_id: id.into(),
            session_id: "session".into(),
            protocol_version: Some(p::ProtocolVersion {
                major: 1,
                minor: 0,
                schema_id: "spaceeyes.core.v1".into(),
            }),
            expected_scene_revision: Some(0),
            ..Default::default()
        }),
        payload: Some(p::command_envelope::Payload::Scene(p::SceneCommand {
            action: Some(p::scene_command::Action::Create(p::CreateObject {
                object: Some(p::SceneObject {
                    object_id: Some(p::ObjectId {
                        value: "object".into(),
                    }),
                    visible: true,
                    lifecycle: p::ObjectLifecycle::Active as i32,
                    ..Default::default()
                }),
            })),
        })),
    }
}
fn send(a: &mut ProtocolAdapter, r: p::CommandEnvelope) -> p::ResponseEnvelope {
    p::ResponseEnvelope::decode(
        a.submit_bytes("authenticated-host", &r.encode_to_vec())
            .unwrap()
            .as_slice(),
    )
    .unwrap()
}
fn code(r: p::ResponseEnvelope) -> i32 {
    match r.payload.unwrap() {
        p::response_envelope::Payload::Error(e) => e.code,
        _ => panic!("expected error"),
    }
}
#[test]
fn wire_transaction_idempotency_conflict_and_bounded_history() {
    let mut a = adapter(2);
    let r = request("create");
    let first = send(&mut a, r.clone());
    assert_eq!(first.status, p::ResponseStatus::Completed as i32);
    assert_eq!(a.dispatcher().snapshot().scene.objects.len(), 1);
    assert_eq!(send(&mut a, r.clone()), first);
    let mut conflict = r;
    conflict.context.as_mut().unwrap().expected_scene_revision = Some(1);
    assert_eq!(
        code(send(&mut a, conflict)),
        p::ErrorCode::IdempotencyConflict as i32
    );
    let failed = send(&mut a, request("duplicate"));
    assert_eq!(code(failed), p::ErrorCode::RevisionConflict as i32);
    assert_eq!(
        code(send(&mut a, request("full"))),
        p::ErrorCode::ResourceExceeded as i32
    );
    assert_eq!(a.dispatcher().events().count(), 1);
}
#[test]
fn bad_version_missing_context_and_unsupported_commands_do_not_mutate() {
    let mut a = adapter(20);
    let mut r = request("version");
    r.context
        .as_mut()
        .unwrap()
        .protocol_version
        .as_mut()
        .unwrap()
        .major = 2;
    assert_eq!(
        code(send(&mut a, r)),
        p::ErrorCode::UnsupportedVersion as i32
    );
    let mut r = request("context");
    r.context = None;
    assert_eq!(code(send(&mut a, r)), p::ErrorCode::InvalidArgument as i32);
    let mut r = request("live");
    r.payload = Some(p::command_envelope::Payload::Time(p::TimeCommand {
        action: Some(p::time_command::Action::Live(p::LiveCommand {})),
    }));
    assert_eq!(code(send(&mut a, r)), p::ErrorCode::InvalidArgument as i32);
    assert!(a.dispatcher().snapshot().scene.objects.is_empty());
    assert!(a.submit_bytes("host", &vec![0; 1024 * 1024 + 1]).is_err());
}
#[test]
fn generation_preconditions_and_atomic_batch_are_enforced() {
    let mut a = adapter(20);
    let mut seek = request("seek");
    seek.payload = Some(p::command_envelope::Payload::Time(p::TimeCommand {
        action: Some(p::time_command::Action::Seek(p::SeekCommand {
            instant: Some(p::TimeInstant {
                time_scale: p::TimeScale::Tt as i32,
                epoch_id: "epoch".into(),
                seconds: 1,
                nanos: 0,
            }),
        })),
    }));
    seek.context.as_mut().unwrap().time_generation = Some(0);
    let receipt = send(&mut a, seek.clone());
    assert_eq!(receipt.status, p::ResponseStatus::Completed as i32);
    assert_eq!(send(&mut a, seek), receipt); // replay after generation changes is safe
    let mut stale = request("stale");
    stale.context.as_mut().unwrap().time_generation = Some(0);
    assert_eq!(
        code(send(&mut a, stale)),
        p::ErrorCode::StaleGeneration as i32
    );
    let mut batch = request("batch");
    let create = match batch.payload.take().unwrap() {
        p::command_envelope::Payload::Scene(c) => c,
        _ => unreachable!(),
    };
    batch.payload = Some(p::command_envelope::Payload::SceneTransaction(
        p::SceneTransaction {
            commands: vec![create.clone(), create],
            expected_revision: Some(0),
        },
    ));
    assert_eq!(
        send(&mut a, batch).status,
        p::ResponseStatus::Rejected as i32
    );
    assert!(a.dispatcher().snapshot().scene.objects.is_empty());
}
#[test]
fn fractional_rate_is_exact_and_tiny_unrepresentable_rate_is_rejected() {
    let mut a = adapter(20);
    let mut r = request("rate");
    r.payload = Some(p::command_envelope::Payload::Time(p::TimeCommand {
        action: Some(p::time_command::Action::SetRate(p::SetRateCommand {
            rate: 1.5,
        })),
    }));
    assert_eq!(
        send(&mut a, r.clone()).status,
        p::ResponseStatus::Completed as i32
    );
    assert_eq!(
        a.dispatcher().engine().clock().snapshot().rate,
        spaceeyes_time::PlaybackRate::new(3, 2).unwrap()
    );
    r.context.as_mut().unwrap().request_id = "tiny".into();
    r.payload = Some(p::command_envelope::Payload::Time(p::TimeCommand {
        action: Some(p::time_command::Action::SetRate(p::SetRateCommand {
            rate: 1e-15,
        })),
    }));
    assert_eq!(send(&mut a, r).status, p::ResponseStatus::Rejected as i32);
    assert_eq!(
        a.dispatcher().engine().clock().snapshot().rate,
        spaceeyes_time::PlaybackRate::new(3, 2).unwrap()
    );
}
#[test]
fn camera_proto_roundtrip_and_wire_update_are_validated_and_idempotent() {
    use spaceeyes_foundation::FrameId;
    use spaceeyes_protocol_adapter::{decode_camera, encode_camera};
    use spaceeyes_scene::CameraState;
    let mut engine = Engine::new(TimeInstant::new("TT", "epoch", 0, 0).unwrap());
    engine
        .register_root_frame(FrameId::new("root").unwrap())
        .unwrap();
    let mut a = ProtocolAdapter::new(CommandDispatcher::new(engine, "session".into(), 20).unwrap())
        .unwrap();
    let camera = CameraState::new([2.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0], 1.0, 0.1, 100.0).unwrap();
    let wire = encode_camera(&camera).encode_to_vec();
    assert_eq!(
        decode_camera(p::CameraState::decode(wire.as_slice()).unwrap()).unwrap(),
        camera
    );
    let mut r = request("camera-create");
    if let Some(p::command_envelope::Payload::Scene(c)) = &mut r.payload {
        if let Some(p::scene_command::Action::Create(c)) = &mut c.action {
            let object = c.object.as_mut().unwrap();
            object.frame_id = Some(p::FrameId {
                value: "root".into(),
            });
            object.camera = Some(encode_camera(&camera));
        }
    }
    let created = send(&mut a, r.clone());
    assert_eq!(created.status, p::ResponseStatus::Completed as i32);
    assert_eq!(send(&mut a, r), created);
    assert_eq!(
        a.dispatcher().snapshot().scene.objects[0].camera(),
        Some(&camera)
    );
    let mut r = request("camera-invalid");
    r.context.as_mut().unwrap().expected_scene_revision = Some(1);
    let mut invalid = encode_camera(&camera);
    invalid.position_m.as_mut().unwrap().x = f64::NAN;
    r.payload = Some(p::command_envelope::Payload::Scene(p::SceneCommand {
        action: Some(p::scene_command::Action::SetCamera(p::SetCameraState {
            object_id: Some(p::ObjectId {
                value: "object".into(),
            }),
            camera: Some(invalid),
        })),
    }));
    let before = a.dispatcher().snapshot();
    assert_eq!(
        send(&mut a, r.clone()).status,
        p::ResponseStatus::Rejected as i32
    );
    assert_eq!(a.dispatcher().snapshot(), before);
    r.context.as_mut().unwrap().request_id = "camera-remove".into();
    if let Some(p::command_envelope::Payload::Scene(c)) = &mut r.payload {
        if let Some(p::scene_command::Action::SetCamera(c)) = &mut c.action {
            c.camera = None;
        }
    }
    assert_eq!(send(&mut a, r).status, p::ResponseStatus::Completed as i32);
    assert!(a.dispatcher().snapshot().scene.objects[0]
        .camera()
        .is_none());
    let mut missing = encode_camera(&camera);
    missing.projection = None;
    assert!(decode_camera(missing).is_err());
}
#[test]
fn sphere_wire_command_roundtrip_and_invalid_geometry_roll_back() {
    use spaceeyes_foundation::FrameId;
    use spaceeyes_protocol_adapter::{decode_sphere, encode_sphere};
    use spaceeyes_scene::Sphere;
    let mut engine = Engine::new(TimeInstant::new("TT", "epoch", 0, 0).unwrap());
    engine
        .register_root_frame(FrameId::new("root").unwrap())
        .unwrap();
    let mut a = ProtocolAdapter::new(CommandDispatcher::new(engine, "session".into(), 20).unwrap())
        .unwrap();
    let sphere = Sphere::new(2.0, [0.0, 0.25, 1.0]).unwrap();
    let wire = encode_sphere(&sphere).encode_to_vec();
    assert_eq!(
        decode_sphere(p::SpherePrimitive::decode(wire.as_slice()).unwrap()).unwrap(),
        sphere
    );
    let mut r = request("sphere-create");
    if let Some(p::command_envelope::Payload::Scene(c)) = &mut r.payload {
        if let Some(p::scene_command::Action::Create(c)) = &mut c.action {
            let object = c.object.as_mut().unwrap();
            object.frame_id = Some(p::FrameId {
                value: "root".into(),
            });
            object.sphere = Some(encode_sphere(&sphere));
        }
    }
    let receipt = send(&mut a, r.clone());
    assert_eq!(receipt.status, p::ResponseStatus::Completed as i32);
    assert_eq!(send(&mut a, r), receipt);
    assert_eq!(
        a.dispatcher().snapshot().scene.objects[0].sphere(),
        Some(&sphere)
    );
    let mut r = request("sphere-invalid");
    r.context.as_mut().unwrap().expected_scene_revision = Some(1);
    r.payload = Some(p::command_envelope::Payload::Scene(p::SceneCommand {
        action: Some(p::scene_command::Action::SetSphere(p::SetSphere {
            object_id: Some(p::ObjectId {
                value: "object".into(),
            }),
            sphere: Some(p::SpherePrimitive {
                radius_m: -1.0,
                base_color: Some(p::ColorRgb {
                    r: 1.0,
                    g: 0.0,
                    b: 0.0,
                }),
            }),
        })),
    }));
    let before = a.dispatcher().snapshot();
    assert_eq!(
        send(&mut a, r.clone()).status,
        p::ResponseStatus::Rejected as i32
    );
    assert_eq!(a.dispatcher().snapshot(), before);
    r.context.as_mut().unwrap().request_id = "sphere-remove".into();
    if let Some(p::command_envelope::Payload::Scene(c)) = &mut r.payload {
        if let Some(p::scene_command::Action::SetSphere(c)) = &mut c.action {
            c.sphere = None;
        }
    }
    assert_eq!(send(&mut a, r).status, p::ResponseStatus::Completed as i32);
    assert!(a.dispatcher().snapshot().scene.objects[0]
        .sphere()
        .is_none());
    assert!(decode_sphere(p::SpherePrimitive {
        radius_m: 1.0,
        base_color: None
    })
    .is_err());
}
