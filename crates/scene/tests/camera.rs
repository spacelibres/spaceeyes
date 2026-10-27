// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_foundation::{ObjectId, Revision};
use spaceeyes_scene::{CameraState, Scene, SceneCommand, SceneObject};
fn camera() -> CameraState {
    CameraState::new([1.0, 2.0, 3.0], [2.0, 0.0, 0.0, 0.0], 1.0, 0.1, 100.0).unwrap()
}

#[test]
fn tracking_distances_are_finite_positive_and_inside_projection() {
    use spaceeyes_scene::CameraTracking;
    let target = ObjectId::new("body").unwrap();
    for distance in [f64::NAN, f64::INFINITY, 0.0, -1.0] {
        assert!(CameraTracking::new(target.clone(), distance).is_err());
    }
    for distance in [0.01, 0.1, 100.0, 101.0] {
        assert!(camera()
            .with_tracking(Some(CameraTracking::new(target.clone(), distance).unwrap()))
            .is_err());
    }
    let tracked = camera()
        .with_tracking(Some(CameraTracking::new(target.clone(), 6.0).unwrap()))
        .unwrap();
    assert_eq!(tracked.tracking().unwrap().target(), &target);
    assert!(tracked.with_tracking(None).unwrap().tracking().is_none());
}
#[test]
fn camera_is_normalized_and_rejects_invalid_pose_or_projection() {
    assert_eq!(camera().orientation_wxyz(), [1.0, 0.0, 0.0, 0.0]);
    for (p, q, fov, near, far) in [
        ([f64::NAN, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0], 1.0, 0.1, 10.0),
        ([0.0; 3], [0.0; 4], 1.0, 0.1, 10.0),
        ([0.0; 3], [f64::INFINITY, 0.0, 0.0, 0.0], 1.0, 0.1, 10.0),
        (
            [0.0; 3],
            [1.0, 0.0, 0.0, 0.0],
            std::f64::consts::PI,
            0.1,
            10.0,
        ),
        ([0.0; 3], [1.0, 0.0, 0.0, 0.0], 1.0, 0.0, 10.0),
        ([0.0; 3], [1.0, 0.0, 0.0, 0.0], 1.0, 10.0, 1.0),
    ] {
        assert!(CameraState::new(p, q, fov, near, far).is_err());
    }
}
#[test]
fn orthographic_cameras_require_a_positive_half_height() {
    use spaceeyes_scene::CameraProjection;
    let camera =
        CameraState::new_orthographic([0.0; 3], [1.0, 0.0, 0.0, 0.0], 2.0, 0.1, 100.0).unwrap();
    assert_eq!(
        camera.projection(),
        CameraProjection::Orthographic { half_height_m: 2.0 }
    );
    for half_height in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        assert!(CameraState::new_orthographic(
            [0.0; 3],
            [1.0, 0.0, 0.0, 0.0],
            half_height,
            0.1,
            100.0,
        )
        .is_err());
    }
}
#[test]
fn camera_component_is_snapshotted_and_removable() {
    let id = ObjectId::new("camera").unwrap();
    let mut scene = Scene::new();
    scene
        .apply_transaction(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(id.clone())),
                SceneCommand::SetCamera {
                    object: id.clone(),
                    camera: Some(camera()),
                },
            ],
        )
        .unwrap();
    let before = scene.snapshot();
    scene
        .apply_transaction(
            Revision(1),
            &[SceneCommand::SetCamera {
                object: id.clone(),
                camera: None,
            }],
        )
        .unwrap();
    assert!(scene.get(&id).unwrap().camera().is_none());
    assert_eq!(before.objects[0].camera(), Some(&camera()));
}
