use spaceeyes_foundation::{FrameId, ObjectId};
use spaceeyes_rendering::{prepare, View};
use spaceeyes_scene::{Scene, SceneCommand, SceneObject};
use spaceeyes_snapshot::{FrameAvailability, FrameSnapshot, ObjectPose};
use spaceeyes_spatial::{Quatd, RigidTransform, Vec3d};
use spaceeyes_time::{SimulationClock, TimeInstant};
fn frame() -> FrameSnapshot {
    let mut scene = Scene::new();
    let id = ObjectId::new("marker").unwrap();
    scene.create(SceneObject::new(id.clone())).unwrap();
    FrameSnapshot {
        sequence: 1,
        scene: scene.snapshot(),
        clock: SimulationClock::new(TimeInstant::new("TT", "epoch", 0, 0).unwrap()).snapshot(),
        reference: FrameId::new("root").unwrap(),
        frame_graph_revision: spaceeyes_foundation::Revision(1),
        resource_revision: 0,
        availability: FrameAvailability::Complete,
        poses: vec![ObjectPose {
            object: id,
            transform: RigidTransform::new(
                Vec3d {
                    x: 1e12,
                    y: 0.0,
                    z: -10.0,
                },
                Quatd::IDENTITY,
            )
            .unwrap(),
        }],
        unresolved: vec![],
    }
}
fn view() -> View {
    View {
        origin_m: [1e12, 0.0, 0.0],
        vertical_fov_radians: std::f64::consts::FRAC_PI_2,
        aspect: 1.0,
        near_m: 0.1,
        far_m: 100.0,
    }
}
#[test]
fn camera_relative_projection_visibility_and_stale_picking() {
    let mut frame = frame();
    let prepared = prepare(&frame, view()).unwrap();
    assert_eq!(prepared.markers.len(), 1);
    assert_eq!(prepared.markers[0].ndc[0], 0.0);
    let hit = prepared.pick(0.0, 0.0).unwrap();
    hit.validate(&frame).unwrap();
    assert!(prepared.pick(0.03, 0.03).is_none()); // outside triangle, inside its bounding box
    frame.sequence += 1;
    assert!(hit.validate(&frame).is_err());
    let mut scene = Scene::new();
    let id = ObjectId::new("marker").unwrap();
    scene.create(SceneObject::new(id.clone())).unwrap();
    scene
        .apply_transaction(
            scene.revision(),
            &[SceneCommand::SetVisibility {
                object: id,
                visible: false,
            }],
        )
        .unwrap();
    frame.scene = scene.snapshot();
    assert!(prepare(&frame, view()).unwrap().markers.is_empty());
    let mut invalid = view();
    invalid.near_m = f64::NAN;
    assert!(prepare(&frame, invalid).is_err());
}
#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
#[test]
fn gpu_draw_readback_and_budget_cleanup() {
    use spaceeyes_rendering::gpu::GpuRenderer;
    use spaceeyes_resources::{ResourceBudget, ResourceManager};
    let renderer = pollster::block_on(GpuRenderer::new())
        .expect("a real GPU or Mesa Vulkan software adapter is required");
    println!("adapter: {}", renderer.adapter_name);
    let prepared = prepare(&frame(), view()).unwrap();
    let mut resources = ResourceManager::new(ResourceBudget {
        max_bytes: 1024 * 1024,
    });
    let pixels = renderer
        .render_rgba8(&prepared, 128, 128, &mut resources)
        .unwrap();
    assert_eq!(pixels.len(), 128 * 128 * 4);
    let center = (64 * 128 + 64) * 4;
    assert!(pixels[center] > 200 && pixels[center + 1] > 80 && pixels[center + 2] < 10);
    assert_eq!(&pixels[..4], &[0, 0, 0, 255]);
    assert_eq!(resources.used_bytes(), 0);
    let empty = spaceeyes_rendering::PreparedFrame {
        markers: vec![],
        ..prepared.clone()
    };
    let pixels = renderer
        .render_rgba8(&empty, 128, 128, &mut resources)
        .unwrap();
    assert!(pixels
        .as_chunks::<4>()
        .0
        .iter()
        .all(|p| *p == [0, 0, 0, 255]));
    let mut tiny = ResourceManager::new(ResourceBudget { max_bytes: 1 });
    assert!(renderer
        .render_rgba8(&prepared, 128, 128, &mut tiny)
        .is_err());
    assert_eq!(tiny.used_bytes(), 0);
}
#[test]
fn persistent_camera_composes_frame_and_local_rotation_without_drawing_itself() {
    use spaceeyes_rendering::prepare_camera;
    use spaceeyes_scene::CameraState;
    let mut frame = frame();
    let camera_id = ObjectId::new("camera").unwrap();
    let marker = ObjectId::new("marker").unwrap();
    let half = std::f64::consts::FRAC_1_SQRT_2;
    let camera = CameraState::new(
        [0.0; 3],
        [half, 0.0, half, 0.0],
        std::f64::consts::FRAC_PI_2,
        0.1,
        100.0,
    )
    .unwrap();
    let mut scene = Scene::new();
    scene
        .apply_transaction(
            spaceeyes_foundation::Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(marker.clone())),
                SceneCommand::Create(SceneObject::new(camera_id.clone())),
                SceneCommand::SetCamera {
                    object: camera_id.clone(),
                    camera: Some(camera),
                },
            ],
        )
        .unwrap();
    frame.scene = scene.snapshot();
    // Frame Z rotation maps the camera's local -X viewing direction to world -Y.
    frame.poses = vec![
        ObjectPose {
            object: camera_id.clone(),
            transform: RigidTransform::new(
                Vec3d::ZERO,
                Quatd {
                    w: half,
                    x: 0.0,
                    y: 0.0,
                    z: half,
                },
            )
            .unwrap(),
        },
        ObjectPose {
            object: marker.clone(),
            transform: RigidTransform::new(
                Vec3d {
                    x: 0.0,
                    y: -10.0,
                    z: 0.0,
                },
                Quatd::IDENTITY,
            )
            .unwrap(),
        },
    ];
    let prepared = prepare_camera(&frame, &camera_id, 1.0).unwrap();
    assert_eq!(prepared.markers.len(), 1);
    assert_eq!(prepared.markers[0].object, marker);
    assert!(prepared.markers[0].ndc[0].abs() < 1e-6 && prepared.markers[0].ndc[1].abs() < 1e-6);
    assert!(prepared.pick(0.0, 0.0).is_some());
    assert!(prepare_camera(&frame, &camera_id, 0.0).is_err());
    frame.poses.retain(|p| p.object != camera_id);
    assert!(prepare_camera(&frame, &camera_id, 1.0).is_err());
}
#[test]
fn persistent_camera_subtracts_large_origins_before_gpu_conversion() {
    use spaceeyes_rendering::prepare_camera;
    use spaceeyes_scene::CameraState;
    let mut frame = frame();
    let camera_id = ObjectId::new("camera").unwrap();
    let mut scene = Scene::new();
    scene
        .create(SceneObject::new(ObjectId::new("marker").unwrap()))
        .unwrap();
    scene.create(SceneObject::new(camera_id.clone())).unwrap();
    scene
        .apply_transaction(
            scene.revision(),
            &[SceneCommand::SetCamera {
                object: camera_id.clone(),
                camera: Some(
                    CameraState::new(
                        [1e12, 0.0, 0.0],
                        [1.0, 0.0, 0.0, 0.0],
                        std::f64::consts::FRAC_PI_2,
                        0.1,
                        100.0,
                    )
                    .unwrap(),
                ),
            }],
        )
        .unwrap();
    frame.scene = scene.snapshot();
    frame.poses.push(ObjectPose {
        object: camera_id.clone(),
        transform: RigidTransform::IDENTITY,
    });
    let prepared = prepare_camera(&frame, &camera_id, 1.0).unwrap();
    assert_eq!(prepared.markers[0].ndc[0], 0.0);
    let old = frame.clone();
    scene
        .apply_transaction(
            scene.revision(),
            &[SceneCommand::SetCamera {
                object: camera_id.clone(),
                camera: Some(
                    CameraState::new(
                        [1e12 + 2.0, 0.0, 0.0],
                        [1.0, 0.0, 0.0, 0.0],
                        std::f64::consts::FRAC_PI_2,
                        0.1,
                        100.0,
                    )
                    .unwrap(),
                ),
            }],
        )
        .unwrap();
    frame.scene = scene.snapshot();
    frame.sequence += 1;
    let moved = prepare_camera(&frame, &camera_id, 1.0).unwrap();
    assert!((moved.markers[0].ndc[0] + 0.2).abs() < 1e-6);
    assert_eq!(
        prepare_camera(&old, &camera_id, 1.0).unwrap().markers[0].ndc[0],
        0.0
    );
    assert!(prepared.pick(0.0, 0.0).unwrap().validate(&frame).is_err());
}
