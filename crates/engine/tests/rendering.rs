// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
#![cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
use spaceeyes_engine::Engine;
use spaceeyes_foundation::{FrameId, ObjectId, ResourceId, Revision};
use spaceeyes_rendering::gpu::GpuRenderer;
use spaceeyes_scene::{CameraState, SceneCommand, SceneObject};
use spaceeyes_time::TimeInstant;
#[test]
fn engine_owns_gpu_scratch_without_removing_persistent_resources() {
    let renderer = pollster::block_on(GpuRenderer::new()).unwrap();
    let mut e = Engine::new(TimeInstant::new("TT", "epoch", 0, 0).unwrap());
    let root = FrameId::new("root").unwrap();
    let camera = ObjectId::new("camera").unwrap();
    e.register_root_frame(root.clone()).unwrap();
    e.register_resource(ResourceId::new("persistent").unwrap(), 128)
        .unwrap();
    e.submit_scene(
        Revision(0),
        &[
            SceneCommand::Create(SceneObject::new(camera.clone())),
            SceneCommand::SetFrame {
                object: camera.clone(),
                frame: Some(root.clone()),
            },
            SceneCommand::SetCamera {
                object: camera.clone(),
                camera: Some(
                    CameraState::new([0.0; 3], [1.0, 0.0, 0.0, 0.0], 1.0, 0.1, 100.0).unwrap(),
                ),
            },
        ],
    )
    .unwrap();
    assert!(e.render_rgba8(&renderer, &root, &camera, 32, 32).is_err());
    e.start().unwrap();
    let before = e.snapshot();
    let pixels = e.render_rgba8(&renderer, &root, &camera, 32, 32).unwrap();
    assert_eq!(pixels.len(), 32 * 32 * 4);
    assert_eq!(e.resource_used_bytes(), 128);
    assert!(e.snapshot().resource_revision > before.resource_revision);
    assert_eq!(e.snapshot().sequence, before.sequence + 1);
    let before = e.snapshot();
    assert!(e.render_rgba8(&renderer, &root, &camera, 0, 32).is_err());
    assert_eq!(e.snapshot(), before);
    e.unregister_resource(&ResourceId::new("persistent").unwrap())
        .unwrap();
    e.shutdown();
    assert!(e.render_rgba8(&renderer, &root, &camera, 32, 32).is_err());
}

#[test]
fn gpu_or_staging_exhaustion_refuses_draw_without_partial_reservations() {
    use spaceeyes_rendering::RenderError;
    use spaceeyes_resources::ResourceLimits;
    let renderer = pollster::block_on(GpuRenderer::new()).unwrap();
    for (gpu, staging) in [(0, 1024 * 1024), (1024 * 1024, 0)] {
        let limits = ResourceLimits {
            total_bytes: 2 * 1024 * 1024,
            cpu_bytes: 1024 * 1024,
            gpu_bytes: gpu,
            staging_bytes: staging,
        };
        let mut e =
            Engine::with_resource_limits(TimeInstant::new("TT", "epoch", 0, 0).unwrap(), limits);
        let root = FrameId::new("root").unwrap();
        let camera = ObjectId::new("camera").unwrap();
        e.register_root_frame(root.clone()).unwrap();
        e.register_resource(ResourceId::new("asset").unwrap(), 128)
            .unwrap();
        e.submit_scene(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(camera.clone())),
                SceneCommand::SetFrame {
                    object: camera.clone(),
                    frame: Some(root.clone()),
                },
                SceneCommand::SetCamera {
                    object: camera.clone(),
                    camera: Some(
                        CameraState::new([0.0; 3], [1.0, 0.0, 0.0, 0.0], 1.0, 0.1, 100.0).unwrap(),
                    ),
                },
            ],
        )
        .unwrap();
        e.start().unwrap();
        let before = e.snapshot();
        assert_eq!(
            e.render_rgba8(&renderer, &root, &camera, 32, 32),
            Err(RenderError::Budget)
        );
        assert_eq!(e.snapshot(), before);
        assert_eq!(e.resource_usage().cpu_bytes, 128);
        assert_eq!(e.resource_usage().gpu_bytes, 0);
        assert_eq!(e.resource_usage().staging_bytes, 0);
    }
}
