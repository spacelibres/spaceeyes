use spaceeyes_engine::Engine;
use spaceeyes_foundation::{CoreError, FrameId, ObjectId, ResourceId, Revision};
use spaceeyes_resources::ResourceError;
use spaceeyes_scene::{SceneCommand, SceneObject};
use spaceeyes_snapshot::FrameAvailability;
use spaceeyes_time::TimeInstant;
fn engine() -> Engine {
    Engine::new(TimeInstant::new("TT", "explicit", 0, 0).unwrap())
}
fn id(s: &str) -> ObjectId {
    ObjectId::new(s).unwrap()
}
#[test]
fn scene_resource_changes_are_atomic_and_shared_leases_survive_deletion() {
    let mut e = engine();
    let r = ResourceId::new("shared").unwrap();
    e.register_resource(r.clone(), 8).unwrap();
    e.submit_scene(
        Revision(0),
        &[
            SceneCommand::Create(SceneObject::new(id("a"))),
            SceneCommand::Create(SceneObject::new(id("b"))),
            SceneCommand::SetResources {
                object: id("a"),
                resources: vec![r.clone()],
            },
            SceneCommand::SetResources {
                object: id("b"),
                resources: vec![r.clone()],
            },
        ],
    )
    .unwrap();
    let before = e.snapshot();
    assert_eq!(
        e.submit_scene(
            Revision(1),
            &[
                SceneCommand::Delete { object: id("a") },
                SceneCommand::SetResources {
                    object: id("b"),
                    resources: vec![ResourceId::new("missing").unwrap()]
                },
            ]
        ),
        Err(CoreError::ResourceUnavailable)
    );
    assert_eq!(e.snapshot(), before);
    e.submit_scene(Revision(1), &[SceneCommand::Delete { object: id("a") }])
        .unwrap();
    assert_eq!(e.unregister_resource(&r), Err(ResourceError::StillLeased));
    e.submit_scene(Revision(2), &[SceneCommand::Delete { object: id("b") }])
        .unwrap();
    e.unregister_resource(&r).unwrap();
}
#[test]
fn frame_removal_retains_objects_and_publishes_partial_state() {
    let mut e = engine();
    let root = FrameId::new("root").unwrap();
    let detached = FrameId::new("detached").unwrap();
    e.register_root_frame(root.clone()).unwrap();
    e.register_root_frame(detached.clone()).unwrap();
    let commands = [
        SceneCommand::Create(SceneObject::new(id("sample"))),
        SceneCommand::SetFrame {
            object: id("sample"),
            frame: Some(root.clone()),
        },
    ];
    e.submit_scene(Revision(0), &commands).unwrap();
    let complete = e.publish_frame(&root).unwrap();
    assert_eq!(complete.availability, FrameAvailability::Complete);
    assert_eq!(complete.poses.len(), 1);
    e.remove_frame(&root).unwrap();
    let frame = e.publish_frame(&detached).unwrap();
    assert_eq!(frame.availability, FrameAvailability::Partial);
    assert_eq!(frame.unresolved, vec![id("sample")]);
    assert_eq!(e.scene().len(), 1);
    assert_eq!(complete.availability, FrameAvailability::Complete); // old snapshot remains immutable
    assert_eq!(
        e.submit_scene(
            Revision(1),
            &[SceneCommand::SetFrame {
                object: id("sample"),
                frame: Some(root)
            }]
        ),
        Err(CoreError::UnknownFrame)
    );
}
#[test]
fn pending_loads_cannot_bind_and_shutdown_rejects_late_completion() {
    let mut e = engine();
    let resource = ResourceId::new("payload").unwrap();
    e.declare_resource(resource.clone(), 3).unwrap();
    let token = e.begin_resource_load(&resource).unwrap();
    assert_eq!(
        e.submit_scene(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(id("object"))),
                SceneCommand::SetResources {
                    object: id("object"),
                    resources: vec![resource.clone()]
                },
            ]
        ),
        Err(CoreError::ResourceUnavailable)
    );
    assert!(e.scene().is_empty());
    e.finish_resource_load(&token, vec![1, 2, 3]).unwrap();
    let lease = e.lease_resource(&resource).unwrap();
    assert_eq!(e.resource_bytes(&lease).unwrap(), &[1, 2, 3]);
    e.shutdown();
    assert_eq!(e.resource_used_bytes(), 0);
    assert_eq!(e.resource_bytes(&lease), Err(ResourceError::InvalidLease));
    assert_eq!(
        e.finish_resource_load(&token, vec![1, 2, 3]),
        Err(ResourceError::EngineUnavailable)
    );
}
#[test]
fn project_restore_creates_fresh_handles_and_task_generation() {
    let mut original = engine();
    let root = FrameId::new("root").unwrap();
    original.register_root_frame(root.clone()).unwrap();
    original
        .submit_scene(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(id("object"))),
                SceneCommand::SetFrame {
                    object: id("object"),
                    frame: Some(root.clone()),
                },
            ],
        )
        .unwrap();
    original.play().unwrap();
    original.advance_nanos(5).unwrap();
    let old = original.scene().handle(&id("object")).unwrap();
    let project = original.project_state();
    let restored = Engine::restore_project(&project, &[]).unwrap();
    assert_eq!(restored.clock().instant(), original.clock().instant());
    assert_eq!(restored.clock().mode(), spaceeyes_time::ClockMode::Paused);
    assert_eq!(
        restored.clock().generation().0,
        original.clock().generation().0 + 1
    );
    assert_eq!(
        restored.scene().get_by_handle(&old),
        Err(CoreError::InvalidHandle)
    );
    assert_eq!(
        restored.publish_frame(&root).unwrap().availability,
        FrameAvailability::Complete
    );
    let mut invalid = project;
    invalid.schema_version = 99;
    assert!(Engine::restore_project(&invalid, &[]).is_err());
    assert_eq!(original.scene().len(), 1);
}
#[test]
fn restore_missing_provider_and_loading_resource_stays_explicitly_partial() {
    use spaceeyes_resources::ResourceRecord;
    use spaceeyes_spatial::{FrameRecord, SpatialError};
    let mut e = engine();
    let root = FrameId::new("root").unwrap();
    e.register_root_frame(root.clone()).unwrap();
    e.submit_scene(
        Revision(0),
        &[
            SceneCommand::Create(SceneObject::new(id("object"))),
            SceneCommand::SetFrame {
                object: id("object"),
                frame: Some(root.clone()),
            },
        ],
    )
    .unwrap();
    let mut project = e.project_state();
    let unavailable = FrameId::new("missing-provider").unwrap();
    project.frames.push(FrameRecord {
        id: unavailable.clone(),
        parent: Some(root.clone()),
        sample: None,
        provider: Some(("external".into(), "1".into())),
    });
    let restored = Engine::restore_project(&project, &[]).unwrap();
    assert_eq!(
        restored.resolve_frame(&unavailable, &root, restored.clock().instant()),
        Err(SpatialError::MissingTransform)
    );
    // A saved reference to a removed frame also remains an unresolved object.
    project.frames.clear();
    let other = FrameId::new("other").unwrap();
    project.frames.push(FrameRecord {
        id: other.clone(),
        parent: None,
        sample: None,
        provider: None,
    });
    let restored = Engine::restore_project(&project, &[]).unwrap();
    assert_eq!(
        restored.publish_frame(&other).unwrap().availability,
        FrameAvailability::Partial
    );
    // Deferred CPU bytes stay declared, not Ready; stable logical references are preserved.
    let resource = ResourceId::new("deferred").unwrap();
    project.resources.push(ResourceRecord {
        id: resource.clone(),
        bytes: 4,
        data: None,
        logical_only: false,
    });
    let mut scene = spaceeyes_scene::Scene::new();
    scene.create(SceneObject::new(id("object"))).unwrap();
    scene
        .apply_transaction(
            scene.revision(),
            &[
                SceneCommand::SetResources {
                    object: id("object"),
                    resources: vec![resource.clone()],
                },
                SceneCommand::SetFrame {
                    object: id("object"),
                    frame: Some(other.clone()),
                },
            ],
        )
        .unwrap();
    project.scene = scene.snapshot();
    let mut restored = Engine::restore_project(&project, &[]).unwrap();
    assert_eq!(
        restored.publish_frame(&other).unwrap().availability,
        FrameAvailability::Partial
    );
    assert_eq!(
        restored.unregister_resource(&resource),
        Err(ResourceError::StillLeased)
    );
    let token = restored.begin_resource_load(&resource).unwrap();
    restored.finish_resource_load(&token, vec![0; 4]).unwrap();
    assert_eq!(
        restored.publish_frame(&other).unwrap().availability,
        FrameAvailability::Complete
    );
}
#[test]
fn sphere_frame_binding_and_project_restore_are_transactional() {
    use spaceeyes_scene::Sphere;
    let mut e = engine();
    let id = id("sphere");
    let sphere = Sphere::new(3.0, [0.2, 0.3, 0.9]).unwrap();
    assert_eq!(
        e.submit_scene(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(id.clone())),
                SceneCommand::SetSphere {
                    object: id.clone(),
                    sphere: Some(sphere.clone())
                }
            ]
        ),
        Err(CoreError::UnknownFrame)
    );
    assert!(e.scene().is_empty());
    let root = FrameId::new("root").unwrap();
    e.register_root_frame(root.clone()).unwrap();
    e.submit_scene(
        Revision(0),
        &[
            SceneCommand::Create(SceneObject::new(id.clone())),
            SceneCommand::SetFrame {
                object: id.clone(),
                frame: Some(root),
            },
            SceneCommand::SetSphere {
                object: id.clone(),
                sphere: Some(sphere.clone()),
            },
        ],
    )
    .unwrap();
    let before = e.snapshot();
    assert_eq!(
        e.submit_scene(
            Revision(1),
            &[SceneCommand::SetFrame {
                object: id.clone(),
                frame: None
            }]
        ),
        Err(CoreError::UnknownFrame)
    );
    assert_eq!(e.snapshot(), before);
    let restored = Engine::restore_project(&e.project_state(), &[]).unwrap();
    assert_eq!(restored.scene().get(&id).unwrap().sphere(), Some(&sphere));
}
