// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_engine::{CameraControlError, Engine};
use spaceeyes_foundation::{CoreError, FrameId, ObjectId, Revision};
use spaceeyes_rendering::{prepare_camera, RenderError};
use spaceeyes_scene::{CameraState, SceneCommand, SceneObject, Sphere};
use spaceeyes_spatial::{
    ProviderRef, Quatd, RigidTransform, SpatialError, TransformProvider, Vec3d,
};
use spaceeyes_time::TimeInstant;
use std::sync::Arc;

fn id(value: &str) -> ObjectId {
    ObjectId::new(value).unwrap()
}
fn root() -> FrameId {
    FrameId::new("root").unwrap()
}
#[derive(Debug)]
struct Moving;
impl TransformProvider for Moving {
    fn provider_id(&self) -> &str {
        "synthetic-motion"
    }
    fn version(&self) -> &str {
        "test"
    }
    fn resolve_at(&self, instant: &TimeInstant) -> Result<RigidTransform, SpatialError> {
        if instant.seconds() > 100 {
            return Err(SpatialError::TimeNotCovered);
        }
        let angle = instant.seconds() as f64 * 0.1;
        RigidTransform::new(
            Vec3d {
                x: 1e12 + instant.seconds() as f64 * 2.0,
                y: 0.0,
                z: 0.0,
            },
            Quatd {
                w: angle.cos(),
                x: 0.0,
                y: angle.sin(),
                z: 0.0,
            },
        )
    }
}
fn engine() -> Engine {
    let mut e = Engine::new(TimeInstant::new("TT", "explicit", 0, 0).unwrap());
    e.register_root_frame(root()).unwrap();
    let body_frame = FrameId::new("body-frame").unwrap();
    e.register_dynamic_frame(
        body_frame.clone(),
        root(),
        ProviderRef::new(Arc::new(Moving)).unwrap(),
    )
    .unwrap();
    e.submit_scene(
        Revision(0),
        &[
            SceneCommand::Create(SceneObject::new(id("body"))),
            SceneCommand::SetFrame {
                object: id("body"),
                frame: Some(body_frame),
            },
            SceneCommand::SetSphere {
                object: id("body"),
                sphere: Some(Sphere::new(1.0, [1.0, 0.0, 0.0]).unwrap()),
            },
            SceneCommand::Create(SceneObject::new(id("camera"))),
            SceneCommand::SetFrame {
                object: id("camera"),
                frame: Some(root()),
            },
            SceneCommand::SetCamera {
                object: id("camera"),
                camera: Some(
                    CameraState::new([0.0, 0.0, 6.0], [1.0, 0.0, 0.0, 0.0], 1.0, 0.1, 100.0)
                        .unwrap(),
                ),
            },
        ],
    )
    .unwrap();
    e.start().unwrap();
    e
}
#[test]
fn focus_is_one_shot_while_follow_uses_each_explicit_time_and_rotation() {
    for follow in [false, true] {
        let mut e = engine();
        e.focus_camera(Revision(1), &id("camera"), &id("body"), 6.0, follow)
            .unwrap();
        let frame = e.publish_frame(&root()).unwrap();
        assert_eq!(
            prepare_camera(&frame, &id("camera"), 1.0)
                .unwrap()
                .pick(0.0, 0.0)
                .unwrap()
                .object,
            id("body")
        );
        e.step_nanos(10_000_000_000).unwrap();
        let frame = e.publish_frame(&root()).unwrap();
        let view = prepare_camera(&frame, &id("camera"), 1.0).unwrap();
        assert_eq!(view.pick(0.0, 0.0).is_some(), follow);
        if follow {
            let sphere = &view.spheres[0];
            assert!(sphere.center_camera[0].abs() < 0.001);
            assert!((sphere.center_camera[2] + 6.0).abs() < 0.001);
        }
    }
}
#[test]
fn invalid_focus_is_atomic_and_follow_targets_cannot_be_deleted_or_rebound_to_cameras() {
    let mut e = engine();
    for (revision, target, distance) in [
        (Revision(0), id("body"), 6.0),
        (Revision(1), id("missing"), 6.0),
        (Revision(1), id("camera"), 6.0),
        (Revision(1), id("body"), f64::NAN),
        (Revision(1), id("body"), 0.0),
        (Revision(1), id("body"), 101.0),
    ] {
        let before = e.snapshot();
        assert!(e
            .focus_camera(revision, &id("camera"), &target, distance, true)
            .is_err());
        assert_eq!(e.snapshot(), before);
    }
    e.focus_camera(Revision(1), &id("camera"), &id("body"), 6.0, true)
        .unwrap();
    let before = e.snapshot();
    assert_eq!(
        e.submit_scene(Revision(2), &[SceneCommand::Delete { object: id("body") }]),
        Err(CoreError::UnknownObject)
    );
    assert_eq!(e.snapshot(), before);
    let base = CameraState::new([0.0, 0.0, 6.0], [1.0, 0.0, 0.0, 0.0], 1.0, 0.1, 100.0).unwrap();
    assert_eq!(
        e.submit_scene(
            Revision(2),
            &[
                SceneCommand::SetSphere {
                    object: id("body"),
                    sphere: None
                },
                SceneCommand::SetCamera {
                    object: id("body"),
                    camera: Some(base.clone())
                },
            ]
        ),
        Err(CoreError::InvalidState)
    );
    assert_eq!(e.snapshot(), before);
    assert_eq!(
        e.submit_scene(
            Revision(2),
            &[
                SceneCommand::Delete { object: id("body") },
                SceneCommand::Create(SceneObject::new(id("body"))),
                SceneCommand::SetFrame {
                    object: id("body"),
                    frame: Some(root())
                },
            ]
        ),
        Err(CoreError::InvalidHandle)
    );
    assert_eq!(e.snapshot(), before);
    let saved = e.project_state();
    let restored = Engine::restore_project(&saved, &[]).unwrap();
    assert_eq!(
        restored.scene().get(&id("camera")).unwrap().camera(),
        e.scene().get(&id("camera")).unwrap().camera()
    );
    assert_eq!(
        prepare_camera(
            &restored.publish_frame(&root()).unwrap(),
            &id("camera"),
            1.0
        )
        .unwrap_err(),
        RenderError::CameraUnavailable
    );
    e.step_nanos(101_000_000_000).unwrap();
    assert_eq!(
        e.focus_camera(Revision(2), &id("camera"), &id("body"), 6.0, false),
        Err(CameraControlError::Spatial(SpatialError::TimeNotCovered))
    );
    e.submit_scene(
        Revision(2),
        &[
            SceneCommand::SetCamera {
                object: id("camera"),
                camera: Some(base),
            },
            SceneCommand::Delete { object: id("body") },
        ],
    )
    .unwrap();
}

#[test]
fn offset_mesh_focus_uses_referenced_geometry_center_not_parent_or_unused_vertices() {
    use spaceeyes_foundation::ResourceId;
    use spaceeyes_geometry::{TriangleMesh, Vertex};
    use spaceeyes_scene::MeshInstance;
    let mut e = engine();
    let geometry = ResourceId::new("offset-mesh").unwrap();
    e.register_mesh_resource(
        geometry.clone(),
        TriangleMesh::new(
            [
                [9.0, -1.0, 0.0],
                [11.0, -1.0, 0.0],
                [10.0, 1.0, 0.0],
                [1000.0, 0.0, 0.0],
            ]
            .into_iter()
            .map(|p| Vertex::new(p, [0.0, 0.0, 1.0]).unwrap())
            .collect(),
            vec![0, 1, 2],
        )
        .unwrap(),
    )
    .unwrap();
    e.submit_scene(
        Revision(1),
        &[
            SceneCommand::Create(SceneObject::new(id("mesh"))),
            SceneCommand::SetFrame {
                object: id("mesh"),
                frame: Some(root()),
            },
            SceneCommand::SetParent {
                object: id("mesh"),
                parent: Some(id("body")),
            },
            SceneCommand::SetMesh {
                object: id("mesh"),
                mesh: Some(MeshInstance::new(geometry, [1.0, 0.0, 0.0]).unwrap()),
            },
        ],
    )
    .unwrap();
    e.focus_camera(Revision(2), &id("camera"), &id("mesh"), 6.0, false)
        .unwrap();
    assert_eq!(
        e.scene()
            .get(&id("camera"))
            .unwrap()
            .camera()
            .unwrap()
            .position_m(),
        [10.0, 0.0, 6.0]
    );
    let view = prepare_camera(&e.publish_frame(&root()).unwrap(), &id("camera"), 1.0).unwrap();
    assert_eq!(view.pick(0.0, 0.0).unwrap().object, id("mesh"));
}
#[test]
fn following_has_no_frame_rate_integration_state() {
    let mut a = engine();
    let mut b = engine();
    for e in [&mut a, &mut b] {
        e.focus_camera(Revision(1), &id("camera"), &id("body"), 6.0, true)
            .unwrap();
        e.play().unwrap();
    }
    a.advance_nanos(1_000_000_000).unwrap();
    for _ in 0..10 {
        b.advance_nanos(100_000_000).unwrap();
        let _ = prepare_camera(&b.publish_frame(&root()).unwrap(), &id("camera"), 1.0).unwrap();
    }
    let av = prepare_camera(&a.publish_frame(&root()).unwrap(), &id("camera"), 1.0).unwrap();
    let bv = prepare_camera(&b.publish_frame(&root()).unwrap(), &id("camera"), 1.0).unwrap();
    assert_eq!(av.spheres[0].center_camera, bv.spheres[0].center_camera);
}
