// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_foundation::{FrameId, ObjectId, Revision};
use spaceeyes_rendering::{prepare, View, ViewProjection};
use spaceeyes_scene::{LinePrimitive, Material, Scene, SceneCommand, SceneObject, Sphere};
use spaceeyes_snapshot::{FrameAvailability, FrameSnapshot, ObjectPose};
use spaceeyes_spatial::{FrameSample, Quatd, ReferenceFrameGraph, RigidTransform, Vec3d};
use spaceeyes_time::{SimulationClock, TimeInstant};

fn view() -> View {
    View {
        origin_m: [0.0; 3],
        projection: ViewProjection::Perspective {
            vertical_fov_radians: std::f64::consts::FRAC_PI_2,
        },
        aspect: 1.0,
        near_m: 0.1,
        far_m: 100.0,
    }
}

fn frame() -> FrameSnapshot {
    let instant = TimeInstant::new("TT", "explicit", 0, 0).unwrap();
    let root = FrameId::new("root").unwrap();
    let frame = FrameId::new("line-frame").unwrap();
    let glass_frame = FrameId::new("glass-frame").unwrap();
    let id = ObjectId::new("orbit").unwrap();
    let glass = ObjectId::new("glass").unwrap();
    let mut graph = ReferenceFrameGraph::new();
    graph.register_root(root.clone()).unwrap();
    for (child, z) in [(frame.clone(), -5.0), (glass_frame.clone(), -2.0)] {
        graph
            .register_child(
                child.clone(),
                root.clone(),
                FrameSample {
                    instant: instant.clone(),
                    to_parent: RigidTransform::new(Vec3d { x: 0.0, y: 0.0, z }, Quatd::IDENTITY)
                        .unwrap(),
                },
            )
            .unwrap();
    }
    let mut scene = Scene::new();
    scene
        .apply_transaction(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(id.clone())),
                SceneCommand::SetFrame {
                    object: id.clone(),
                    frame: Some(frame.clone()),
                },
                SceneCommand::SetLine {
                    object: id,
                    line: Some(
                        LinePrimitive::new(
                            vec![[-1.0, 0.0, 0.0], [0.0, 0.0, 0.0], [1.0, 0.0, 0.0]],
                            [1.0, 0.0, 0.0],
                        )
                        .unwrap(),
                    ),
                },
                SceneCommand::Create(SceneObject::new(glass.clone())),
                SceneCommand::SetFrame {
                    object: glass.clone(),
                    frame: Some(glass_frame.clone()),
                },
                SceneCommand::SetSphere {
                    object: glass,
                    sphere: Some(
                        Sphere::with_material(
                            0.1,
                            Material::new([0.0, 0.0, 1.0], None, Default::default(), false)
                                .unwrap()
                                .with_alpha(0.5)
                                .unwrap(),
                        )
                        .unwrap(),
                    ),
                },
            ],
        )
        .unwrap();
    let pose = graph.resolve(&frame, &root, &instant).unwrap();
    let glass_pose = graph.resolve(&glass_frame, &root, &instant).unwrap();
    FrameSnapshot {
        session: "test-session".into(),
        textures: vec![],
        meshes: vec![],
        sequence: 1,
        poses: vec![
            ObjectPose {
                object: ObjectId::new("orbit").unwrap(),
                transform: pose,
            },
            ObjectPose {
                object: ObjectId::new("glass").unwrap(),
                transform: glass_pose,
            },
        ],
        scene: scene.snapshot(),
        clock: SimulationClock::new(instant).snapshot(),
        reference: root,
        frame_graph_revision: graph.revision(),
        resource_revision: 0,
        availability: FrameAvailability::Complete,
        unresolved: vec![],
    }
}

#[test]
fn lines_prepare_in_camera_space_without_becoming_markers() {
    let prepared = prepare(&frame(), view()).unwrap();
    assert!(prepared.markers.is_empty());
    assert_eq!(prepared.lines.len(), 1);
    let line = &prepared.lines[0];
    assert_eq!(line.object.as_str(), "orbit");
    assert_eq!(line.color, [1.0, 0.0, 0.0]);
    assert_eq!(line.points[0][0], -1.0);
    assert_eq!(line.points[1][1], 0.0);
    assert_eq!(line.points[2][0], 1.0);
    // Depth is constant because the whole line lies in one plane.
    assert!(line.points.iter().all(|point| point[2] == -5.0));
    // A line has no pickable surface; the transparent sphere is pickable.
    assert_eq!(prepared.pick(0.0, 0.0).unwrap().object.as_str(), "glass");
    assert!(prepared.pick(0.9, 0.9).is_none());
}

#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
#[test]
fn gpu_draws_the_prepared_line() {
    use spaceeyes_rendering::gpu::GpuRenderer;
    use spaceeyes_resources::{ResourceBudget, ResourceManager};
    let renderer = pollster::block_on(GpuRenderer::new())
        .expect("a real GPU or Mesa Vulkan software adapter is required");
    let prepared = prepare(&frame(), view()).unwrap();
    let mut resources = ResourceManager::new(ResourceBudget {
        max_bytes: 1024 * 1024,
    });
    let pixels = renderer
        .render_rgba8(&prepared, 128, 128, &mut resources)
        .unwrap();
    let mut lit = 0;
    for y in 58..70 {
        for x in 40..88 {
            let index = (y * 128 + x) * 4;
            if pixels[index] > 120 && pixels[index + 1] < 80 {
                lit += 1;
            }
        }
    }
    assert!(lit > 10, "expected a visible red line, got {lit} pixels");
    let blended = (58..70).any(|y| {
        (58..70).any(|x| {
            let index = (y * 128 + x) * 4;
            pixels[index] > 30 && pixels[index + 2] > 30
        })
    });
    assert!(blended, "expected alpha blending toward purple");
    assert_eq!(resources.used_bytes(), 0);
}
