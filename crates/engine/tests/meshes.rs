// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_engine::Engine;
use spaceeyes_foundation::{CoreError, FrameId, ObjectId, ResourceId, Revision};
use spaceeyes_geometry::{TriangleMesh, Vertex};
use spaceeyes_resources::ResourceError;
use spaceeyes_scene::{MeshInstance, SceneCommand, SceneObject};
use spaceeyes_time::TimeInstant;
fn mesh() -> TriangleMesh {
    TriangleMesh::new(
        vec![
            Vertex::new([-1.0, -1.0, -5.0], [0.0, 0.0, 1.0]).unwrap(),
            Vertex::new([1.0, -1.0, -5.0], [0.0, 0.0, 1.0]).unwrap(),
            Vertex::new([0.0, 1.0, -5.0], [0.0, 0.0, 1.0]).unwrap(),
        ],
        vec![0, 1, 2],
    )
    .unwrap()
}
#[test]
fn mesh_scene_reference_is_leased_transactionally_and_old_frames_stay_valid() {
    let mut e = Engine::new(TimeInstant::new("TT", "epoch", 0, 0).unwrap());
    let root = FrameId::new("root").unwrap();
    e.register_root_frame(root.clone()).unwrap();
    let object = ObjectId::new("mesh").unwrap();
    let resource = ResourceId::new("geometry").unwrap();
    e.register_mesh_resource(resource.clone(), mesh()).unwrap();
    e.submit_scene(
        Revision(0),
        &[
            SceneCommand::Create(SceneObject::new(object.clone())),
            SceneCommand::SetFrame {
                object: object.clone(),
                frame: Some(root.clone()),
            },
            SceneCommand::SetResources {
                object: object.clone(),
                resources: vec![resource.clone()],
            },
            SceneCommand::SetMesh {
                object: object.clone(),
                mesh: Some(MeshInstance::new(resource.clone(), [1.0, 0.0, 0.0]).unwrap()),
            },
        ],
    )
    .unwrap();
    assert_eq!(e.scene().get(&object).unwrap().resource_refs().len(), 1);
    assert_eq!(
        e.unregister_resource(&resource),
        Err(ResourceError::StillLeased)
    );
    let frame = e.publish_frame(&root).unwrap();
    assert_eq!(frame.meshes.len(), 1);
    let raw = ResourceId::new("raw").unwrap();
    e.register_resource(raw.clone(), 16).unwrap();
    let before = e.snapshot();
    assert_eq!(
        e.submit_scene(
            Revision(1),
            &[SceneCommand::SetMesh {
                object: object.clone(),
                mesh: Some(MeshInstance::new(raw.clone(), [1.0; 3]).unwrap())
            }]
        ),
        Err(CoreError::ResourceUnavailable)
    );
    assert_eq!(e.snapshot(), before);
    e.unregister_resource(&raw).unwrap();
    let restored = Engine::restore_project(&e.project_state(), &[]).unwrap();
    assert_eq!(
        restored.publish_frame(&root).unwrap().meshes[0]
            .geometry
            .indices(),
        &[0, 1, 2]
    );
    e.submit_scene(Revision(1), &[SceneCommand::Delete { object }])
        .unwrap();
    e.unregister_resource(&resource).unwrap();
    assert_eq!(e.resource_used_bytes(), 0);
    let prepared = spaceeyes_rendering::prepare(
        &frame,
        spaceeyes_rendering::View {
            origin_m: [0.0; 3],
            vertical_fov_radians: 1.0,
            aspect: 1.0,
            near_m: 0.1,
            far_m: 100.0,
        },
    )
    .unwrap();
    assert!(prepared.pick(0.0, 0.0).is_some());
}
#[test]
fn deferred_mesh_restore_does_not_block_unrelated_scene_edits() {
    let mut e = Engine::new(TimeInstant::new("TT", "epoch", 0, 0).unwrap());
    let root = FrameId::new("root").unwrap();
    e.register_root_frame(root.clone()).unwrap();
    let resource = ResourceId::new("mesh").unwrap();
    let object = ObjectId::new("object").unwrap();
    e.register_mesh_resource(resource.clone(), mesh()).unwrap();
    e.submit_scene(
        Revision(0),
        &[
            SceneCommand::Create(SceneObject::new(object.clone())),
            SceneCommand::SetFrame {
                object: object.clone(),
                frame: Some(root.clone()),
            },
            SceneCommand::SetMesh {
                object: object.clone(),
                mesh: Some(MeshInstance::new(resource.clone(), [1.0; 3]).unwrap()),
            },
        ],
    )
    .unwrap();
    let mut project = e.project_state();
    project.resources[0].mesh = None;
    let mut restored = Engine::restore_project(&project, &[]).unwrap();
    assert!(restored
        .publish_frame(&root)
        .unwrap()
        .unresolved
        .contains(&object));
    restored
        .submit_scene(
            restored.scene().revision(),
            &[SceneCommand::Create(SceneObject::new(
                ObjectId::new("unrelated").unwrap(),
            ))],
        )
        .unwrap();
    assert_eq!(restored.scene().len(), 2);
    restored
        .submit_scene(
            restored.scene().revision(),
            &[SceneCommand::Delete { object }],
        )
        .unwrap();
    restored.unregister_resource(&resource).unwrap();
    assert_eq!(restored.resource_used_bytes(), 0);
}
