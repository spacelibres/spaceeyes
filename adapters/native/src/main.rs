//! Headless prototype host; no second simulation state, no NASA or assumed scientific epoch.
use spaceeyes_engine::Engine;
use spaceeyes_foundation::{FrameId, ObjectId, Revision};
use spaceeyes_rendering::{gpu::GpuRenderer, prepare_camera};
use spaceeyes_scene::{CameraState, SceneCommand, SceneObject, Sphere};
use spaceeyes_spatial::{FrameSample, Quatd, RigidTransform, Vec3d};
use spaceeyes_time::TimeInstant;
use std::io::Write;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    run().map_err(std::io::Error::other)?;
    Ok(())
}
fn run() -> Result<(), String> {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "/tmp/spaceeyes-frame.ppm".into());
    let instant = TimeInstant::new("TT", "PROTOTYPE_EXPLICIT_EPOCH", 0, 0).unwrap();
    let mut engine = Engine::new(instant.clone());
    let root = FrameId::new("demo:root").unwrap();
    engine
        .register_root_frame(root.clone())
        .map_err(|e| format!("{e:?}"))?;
    let objects = [
        ([-0.7, 0.0, -6.0], 1.35, [1.0, 0.35, 0.06]),
        ([0.4, 0.3, -10.0], 2.7, [0.08, 0.4, 1.0]),
        ([4.0, -0.4, -9.0], 1.0, [0.2, 0.85, 0.35]),
    ];
    for (i, ([x, y, z], radius, color)) in objects.iter().enumerate() {
        let object = ObjectId::new(format!("demo:sphere:{i}")).unwrap();
        let frame = FrameId::new(format!("demo:frame:{i}")).unwrap();
        engine
            .register_child_frame(
                frame.clone(),
                root.clone(),
                FrameSample {
                    instant: instant.clone(),
                    to_parent: RigidTransform::new(
                        Vec3d {
                            x: *x,
                            y: *y,
                            z: *z,
                        },
                        Quatd::IDENTITY,
                    )
                    .unwrap(),
                },
            )
            .map_err(|e| format!("{e:?}"))?;
        let revision = engine.scene().revision();
        engine
            .submit_scene(
                revision,
                &[
                    SceneCommand::Create(SceneObject::new(object.clone())),
                    SceneCommand::SetFrame {
                        object: object.clone(),
                        frame: Some(frame),
                    },
                    SceneCommand::SetSphere {
                        object,
                        sphere: Some(Sphere::new(*radius, *color).map_err(|e| format!("{e:?}"))?),
                    },
                ],
            )
            .map_err(|e| format!("{e:?}"))?;
    }
    let yaw_degrees = std::env::args()
        .nth(2)
        .unwrap_or_else(|| "0".into())
        .parse::<f64>()
        .map_err(|e| e.to_string())?;
    let camera_x = std::env::args()
        .nth(3)
        .unwrap_or_else(|| "0".into())
        .parse::<f64>()
        .map_err(|e| e.to_string())?;
    let half_angle = yaw_degrees.to_radians() * 0.5;
    let camera_id = ObjectId::new("demo:camera").unwrap();
    let camera = CameraState::new(
        [camera_x, 0.0, 0.0],
        [half_angle.cos(), 0.0, half_angle.sin(), 0.0],
        std::f64::consts::FRAC_PI_2,
        0.1,
        100.0,
    )
    .map_err(|e| format!("{e:?}"))?;
    engine
        .submit_scene(
            engine.scene().revision(),
            &[
                SceneCommand::Create(SceneObject::new(camera_id.clone())),
                SceneCommand::SetFrame {
                    object: camera_id.clone(),
                    frame: Some(root.clone()),
                },
                SceneCommand::SetCamera {
                    object: camera_id.clone(),
                    camera: Some(camera),
                },
            ],
        )
        .map_err(|e| format!("{e:?}"))?;
    engine.start().map_err(|e| format!("{e:?}"))?;
    let snapshot = engine.publish_frame(&root).map_err(|e| format!("{e:?}"))?;
    assert_eq!(snapshot.scene.revision, Revision(4));
    let prepared = prepare_camera(&snapshot, &camera_id, 1.0).map_err(|e| format!("{e:?}"))?;
    let renderer = pollster::block_on(GpuRenderer::new()).map_err(|e| format!("{e:?}"))?;
    let pixels = engine
        .render_rgba8(&renderer, &root, &camera_id, 512, 512)
        .map_err(|e| format!("{e:?}"))?;
    let remaining_bytes = engine.resource_used_bytes();
    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    file.write_all(b"P6\n512 512\n255\n")
        .map_err(|e| e.to_string())?;
    for pixel in pixels.as_chunks::<4>().0.iter() {
        file.write_all(&pixel[..3]).map_err(|e| e.to_string())?;
    }
    engine.shutdown();
    println!(
        "Rendered {} spheres with depth testing on {}; image: {}; temporary resource bytes: {}",
        prepared.spheres.len(),
        renderer.adapter_name,
        path,
        remaining_bytes
    );
    Ok(())
}
