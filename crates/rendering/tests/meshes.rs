// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_foundation::{FrameId, ObjectId, ResourceId, Revision};
use spaceeyes_geometry::{TriangleMesh, Vertex};
use spaceeyes_rendering::{prepare, View, ViewProjection};
use spaceeyes_scene::{MeshInstance, Scene, SceneCommand, SceneObject, Sphere};
use spaceeyes_snapshot::{FrameAvailability, FrameSnapshot, MeshAsset, ObjectPose};
use spaceeyes_spatial::{Quatd, RigidTransform, Vec3d};
use spaceeyes_time::{SimulationClock, TimeInstant};
use std::sync::Arc;
fn geometry() -> Arc<TriangleMesh> {
    Arc::new(
        TriangleMesh::new(
            [
                [-1.0, -1.0, 0.0],
                [1.0, -1.0, 0.0],
                [1.0, 1.0, 0.0],
                [-1.0, 1.0, 0.0],
            ]
            .into_iter()
            .map(|p| Vertex::new(p, [0.0, 0.0, 1.0]).unwrap())
            .collect(),
            vec![0, 1, 2, 0, 2, 3],
        )
        .unwrap(),
    )
}
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
    let resource = ResourceId::new("quad").unwrap();
    let mut scene = Scene::new();
    let mut poses = Vec::new();
    for (name, z, color) in [
        ("front", -5.0, [0.0, 1.0, 0.0]),
        ("back", -8.0, [1.0, 0.0, 0.0]),
    ] {
        let object = ObjectId::new(name).unwrap();
        scene
            .apply_transaction(
                scene.revision(),
                &[
                    SceneCommand::Create(SceneObject::new(object.clone())),
                    SceneCommand::SetMesh {
                        object: object.clone(),
                        mesh: Some(MeshInstance::new(resource.clone(), color).unwrap()),
                    },
                ],
            )
            .unwrap();
        poses.push(ObjectPose {
            object,
            transform: RigidTransform::new(Vec3d { x: 0.0, y: 0.0, z }, Quatd::IDENTITY).unwrap(),
        });
    }
    let object = ObjectId::new("sphere").unwrap();
    scene
        .apply_transaction(
            scene.revision(),
            &[
                SceneCommand::Create(SceneObject::new(object.clone())),
                SceneCommand::SetSphere {
                    object: object.clone(),
                    sphere: Some(Sphere::new(3.0, [0.0, 0.0, 1.0]).unwrap()),
                },
            ],
        )
        .unwrap();
    poses.push(ObjectPose {
        object,
        transform: RigidTransform::new(
            Vec3d {
                x: 0.0,
                y: 0.0,
                z: -10.0,
            },
            Quatd::IDENTITY,
        )
        .unwrap(),
    });
    FrameSnapshot {
        session: "test-session".into(),
        textures: vec![],
        sequence: 1,
        scene: scene.snapshot(),
        poses,
        meshes: vec![MeshAsset {
            resource,
            geometry: geometry(),
        }],
        clock: SimulationClock::new(TimeInstant::new("TT", "epoch", 0, 0).unwrap()).snapshot(),
        reference: FrameId::new("root").unwrap(),
        frame_graph_revision: Revision(1),
        resource_revision: 1,
        availability: FrameAvailability::Complete,
        unresolved: vec![],
    }
}
#[test]
fn transformed_mesh_picking_and_missing_asset_are_explicit() {
    let mut frame = frame();
    let prepared = prepare(&frame, view()).unwrap();
    assert_eq!(prepared.meshes.len(), 2);
    assert_eq!(prepared.spheres.len(), 1);
    assert_eq!(prepared.pick(0.0, 0.0).unwrap().object.as_str(), "front");
    assert_eq!(prepared.pick(0.25, 0.0).unwrap().object.as_str(), "sphere");
    let front = frame
        .poses
        .iter_mut()
        .find(|p| p.object.as_str() == "front")
        .unwrap();
    front.transform = RigidTransform::new(
        Vec3d {
            x: 4.0,
            y: 0.0,
            z: -5.0,
        },
        Quatd::IDENTITY,
    )
    .unwrap();
    let moved = prepare(&frame, view()).unwrap();
    assert_eq!(moved.pick(0.0, 0.0).unwrap().object.as_str(), "sphere"); // sphere surface is in front of the rear quad
    assert_eq!(moved.pick(0.8, 0.0).unwrap().object.as_str(), "front");
    frame.meshes.clear();
    assert!(prepare(&frame, view()).is_err());
}
#[test]
fn mesh_transform_preserves_large_camera_relative_origin() {
    let mut frame = frame();
    for pose in &mut frame.poses {
        pose.transform.translation_m.x += 1e12;
    }
    let mut view = view();
    view.origin_m[0] = 1e12;
    assert_eq!(
        prepare(&frame, view)
            .unwrap()
            .pick(0.0, 0.0)
            .unwrap()
            .object
            .as_str(),
        "front"
    );
}
#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
#[test]
fn mesh_gpu_depth_normals_and_shared_geometry_render_correctly() {
    use spaceeyes_rendering::gpu::GpuRenderer;
    use spaceeyes_resources::{ResourceBudget, ResourceManager};
    let renderer = pollster::block_on(GpuRenderer::new()).unwrap();
    let mut resources = ResourceManager::new(ResourceBudget {
        max_bytes: 2 * 1024 * 1024,
    });
    let mut frame = frame();
    let mut prepared = prepare(&frame, view()).unwrap();
    let pixels = renderer
        .render_rgba8(&prepared, 128, 128, &mut resources)
        .unwrap();
    let center = (64 * 128 + 64) * 4;
    assert!(pixels[center + 1] > 150 && pixels[center] < 10 && pixels[center + 2] < 10);
    let rim = (64 * 128 + 82) * 4;
    assert!(pixels[rim + 2] > 50 && pixels[rim + 1] < 10);
    prepared.meshes.reverse();
    assert_eq!(
        pixels,
        renderer
            .render_rgba8(&prepared, 128, 128, &mut resources)
            .unwrap()
    );
    let front = frame
        .poses
        .iter_mut()
        .find(|p| p.object.as_str() == "front")
        .unwrap();
    front.transform.rotation = Quatd {
        w: 0.8660254037844386,
        x: 0.0,
        y: 0.5,
        z: 0.0,
    };
    let rotated = prepare(&frame, view()).unwrap();
    let rotated = renderer
        .render_rgba8(&rotated, 128, 128, &mut resources)
        .unwrap();
    assert!(
        rotated[center + 1] > 20
            && f32::from(rotated[center + 1]) < f32::from(pixels[center + 1]) * 0.7
    );
    assert_eq!(resources.used_bytes(), 0);
}
