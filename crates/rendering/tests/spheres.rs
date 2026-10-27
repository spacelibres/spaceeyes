// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_foundation::{FrameId, ObjectId};
use spaceeyes_rendering::{mesh, prepare, View};
use spaceeyes_scene::{Scene, SceneCommand, SceneObject, Sphere};
use spaceeyes_snapshot::{FrameAvailability, FrameSnapshot, ObjectPose};
use spaceeyes_spatial::{FrameSample, Quatd, ReferenceFrameGraph, RigidTransform, Vec3d};
use spaceeyes_time::{SimulationClock, TimeInstant};
fn view() -> View {
    View {
        origin_m: [0.0; 3],
        vertical_fov_radians: std::f64::consts::FRAC_PI_2,
        aspect: 1.0,
        near_m: 0.1,
        far_m: 100.0,
    }
}
fn frame(objects: &[(&str, [f64; 3], f64, [f32; 3])]) -> FrameSnapshot {
    let t = TimeInstant::new("TT", "explicit", 0, 0).unwrap();
    let mut scene = Scene::new();
    let mut graph = ReferenceFrameGraph::new();
    let root = FrameId::new("root").unwrap();
    graph.register_root(root.clone()).unwrap();
    for (name, [x, y, z], radius, color) in objects {
        let id = ObjectId::new(*name).unwrap();
        let f = FrameId::new(*name).unwrap();
        graph
            .register_child(
                f.clone(),
                root.clone(),
                FrameSample {
                    instant: t.clone(),
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
            .unwrap();
        scene
            .apply_transaction(
                scene.revision(),
                &[
                    SceneCommand::Create(SceneObject::new(id.clone())),
                    SceneCommand::SetFrame {
                        object: id.clone(),
                        frame: Some(f),
                    },
                    SceneCommand::SetSphere {
                        object: id,
                        sphere: Some(Sphere::new(*radius, *color).unwrap()),
                    },
                ],
            )
            .unwrap();
    }
    let scene = scene.snapshot();
    let poses = scene
        .objects
        .iter()
        .map(|object| ObjectPose {
            object: object.id().clone(),
            transform: graph.resolve(object.frame().unwrap(), &root, &t).unwrap(),
        })
        .collect();
    FrameSnapshot {
        textures: vec![],
        meshes: vec![],
        sequence: 1,
        scene,
        poses,
        clock: SimulationClock::new(t).snapshot(),
        reference: root,
        frame_graph_revision: graph.revision(),
        resource_revision: 0,
        availability: FrameAvailability::Complete,
        unresolved: vec![],
    }
}
fn overlapping() -> FrameSnapshot {
    frame(&[
        ("a-near", [0.0, 0.0, -5.0], 1.0, [1.0, 0.15, 0.0]),
        ("z-far", [0.0, 0.0, -10.0], 2.5, [0.0, 0.25, 1.0]),
    ])
}
#[test]
fn mesh_has_bounded_indices_outward_triangles_and_unit_normals() {
    let mesh = mesh::unit_sphere(mesh::SPHERE_SLICES, mesh::SPHERE_STACKS).unwrap();
    assert_eq!(mesh.indices.len(), mesh::SPHERE_DRAW_VERTICES as usize);
    assert_eq!(mesh.vertices.len(), 33 * 17);
    for v in &mesh.vertices {
        assert!((v.normal.iter().map(|x| x * x).sum::<f32>() - 1.0).abs() < 2e-6);
        assert_eq!(v.normal, v.position);
    }
    for t in mesh.indices.as_chunks::<3>().0 {
        let [a, b, c] = t.map(|i| mesh.vertices[i as usize].position);
        let u: [f32; 3] = std::array::from_fn(|i| b[i] - a[i]);
        let v: [f32; 3] = std::array::from_fn(|i| c[i] - a[i]);
        let normal = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ];
        assert!(normal.iter().zip(a).map(|(n, a)| n * a).sum::<f32>() > 0.0);
    }
    assert!(mesh::unit_sphere(2, 16).is_err());
    assert!(mesh::unit_sphere(32, 65).is_err());
}
#[test]
fn mesh_picking_chooses_front_surface_and_respects_clip_planes() {
    let prepared = prepare(&overlapping(), view()).unwrap();
    assert!(prepared.markers.is_empty());
    assert_eq!(prepared.spheres.len(), 2);
    assert_eq!(prepared.pick(0.0, 0.0).unwrap().object.as_str(), "a-near");
    assert_eq!(prepared.pick(0.23, 0.0).unwrap().object.as_str(), "z-far");
    assert!(prepared.pick(0.5, 0.0).is_none());
    let mut reversed = prepared.clone();
    reversed.spheres.reverse();
    assert_eq!(reversed.pick(0.0, 0.0), prepared.pick(0.0, 0.0));
    let crossing = frame(&[("clipped", [0.0, 0.0, -1.2], 0.5, [1.0, 0.0, 0.0])]);
    let mut v = view();
    v.near_m = 1.0;
    let prepared = prepare(&crossing, v).unwrap();
    assert_eq!(prepared.spheres.len(), 1);
    assert!(prepared.pick(0.0, 0.0).is_some()); // the back surface remains beyond the near plane
    let behind = frame(&[("hidden", [0.0, 0.0, 1.0], 0.5, [1.0, 0.0, 0.0])]);
    assert!(prepare(&behind, v).unwrap().spheres.is_empty());
}
#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
#[test]
fn gpu_depth_occlusion_is_independent_of_submission_order_and_cleans_budget() {
    use spaceeyes_rendering::gpu::GpuRenderer;
    use spaceeyes_resources::{ResourceBudget, ResourceManager};
    let renderer = pollster::block_on(GpuRenderer::new()).unwrap();
    let mut resources = ResourceManager::new(ResourceBudget {
        max_bytes: 2 * 1024 * 1024,
    });
    let mut prepared = prepare(&overlapping(), view()).unwrap();
    let pixels = renderer
        .render_rgba8(&prepared, 128, 128, &mut resources)
        .unwrap();
    let center = (64 * 128 + 64) * 4;
    assert!(pixels[center] > pixels[center + 2] * 3);
    let ring = (64 * 128 + 78) * 4;
    assert!(pixels[ring + 2] > pixels[ring] * 3 && pixels[ring + 2] > 30);
    prepared.spheres.reverse();
    let reversed = renderer
        .render_rgba8(&prepared, 128, 128, &mut resources)
        .unwrap();
    assert_eq!(pixels, reversed);
    assert_eq!(resources.used_bytes(), 0);
    let mut tiny = ResourceManager::new(ResourceBudget { max_bytes: 200_000 });
    assert!(renderer
        .render_rgba8(&prepared, 128, 128, &mut tiny)
        .is_err());
    assert_eq!(tiny.used_bytes(), 0);
    prepared.spheres[0].radius_m = f64::NAN;
    assert!(renderer
        .render_rgba8(&prepared, 128, 128, &mut resources)
        .is_err());
    assert_eq!(resources.used_bytes(), 0);
}
#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
#[test]
fn gpu_clips_triangles_across_near_plane_instead_of_dropping_sphere() {
    use spaceeyes_rendering::gpu::GpuRenderer;
    use spaceeyes_resources::{ResourceBudget, ResourceManager};
    let renderer = pollster::block_on(GpuRenderer::new()).unwrap();
    let mut resources = ResourceManager::new(ResourceBudget {
        max_bytes: 2 * 1024 * 1024,
    });
    let frame = frame(&[("crossing", [0.0, 0.0, -1.2], 0.5, [0.1, 1.0, 0.1])]);
    let mut v = view();
    v.near_m = 1.0;
    let prepared = prepare(&frame, v).unwrap();
    let pixels = renderer
        .render_rgba8(&prepared, 128, 128, &mut resources)
        .unwrap();
    let center = (64 * 128 + 64) * 4;
    assert!(pixels[center + 1] > 20);
    assert_eq!(resources.used_bytes(), 0);
}
