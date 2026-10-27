use spaceeyes_foundation::{CoreError, ObjectId, Revision};
use spaceeyes_scene::{CameraState, Scene, SceneCommand, SceneObject, Sphere};
#[test]
fn sphere_parameters_reject_invalid_sizes_and_colors() {
    for radius in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        assert!(Sphere::new(radius, [1.0, 0.5, 0.0]).is_err());
    }
    for color in [
        [-0.1, 0.0, 0.0],
        [1.01, 0.0, 0.0],
        [f32::NAN, 0.0, 0.0],
        [0.0, 0.0, f32::INFINITY],
    ] {
        assert!(Sphere::new(1.0, color).is_err());
    }
    assert!(Sphere::new(1.0, [0.0, 1.0, 0.5]).is_ok());
}
#[test]
fn sphere_camera_conflicts_roll_back_and_component_removal_preserves_snapshot() {
    let mut scene = Scene::new();
    let id = ObjectId::new("body").unwrap();
    let sphere = Sphere::new(2.0, [0.0, 0.5, 1.0]).unwrap();
    scene
        .apply_transaction(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(id.clone())),
                SceneCommand::SetSphere {
                    object: id.clone(),
                    sphere: Some(sphere.clone()),
                },
            ],
        )
        .unwrap();
    let before = scene.snapshot();
    let camera = CameraState::new([0.0; 3], [1.0, 0.0, 0.0, 0.0], 1.0, 0.1, 10.0).unwrap();
    assert_eq!(
        scene.apply_transaction(
            Revision(1),
            &[
                SceneCommand::SetVisibility {
                    object: id.clone(),
                    visible: false
                },
                SceneCommand::SetCamera {
                    object: id.clone(),
                    camera: Some(camera)
                }
            ]
        ),
        Err(CoreError::InvalidState)
    );
    assert_eq!(scene.snapshot(), before);
    scene
        .apply_transaction(
            Revision(1),
            &[SceneCommand::SetSphere {
                object: id.clone(),
                sphere: None,
            }],
        )
        .unwrap();
    assert!(scene.get(&id).unwrap().sphere().is_none());
    assert_eq!(before.objects[0].sphere(), Some(&sphere));
}
