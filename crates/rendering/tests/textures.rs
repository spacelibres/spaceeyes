// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_foundation::{FrameId, ObjectId, ResourceId, Revision};
use spaceeyes_geometry::{ColorSpace, Sampling, TextureData, TriangleMesh, Vertex};
#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
use spaceeyes_geometry::{TextureAddress, TextureFilter};
use spaceeyes_rendering::{prepare, View};
#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
use spaceeyes_scene::Sphere;
use spaceeyes_scene::{Material, MeshInstance, Scene, SceneCommand, SceneObject};
use spaceeyes_snapshot::{FrameAvailability, FrameSnapshot, MeshAsset, ObjectPose, TextureAsset};
use spaceeyes_spatial::{Quatd, RigidTransform, Vec3d};
use spaceeyes_time::{SimulationClock, TimeInstant};
use std::sync::Arc;
fn quad(scale: f64, uv: Option<[f32; 2]>) -> Arc<TriangleMesh> {
    Arc::new(
        TriangleMesh::new(
            [
                ([-scale, -scale, 0.0], [0.0, 1.0]),
                ([scale, -scale, 0.0], [1.0, 1.0]),
                ([scale, scale, 0.0], [1.0, 0.0]),
                ([-scale, scale, 0.0], [0.0, 0.0]),
            ]
            .into_iter()
            .map(|(p, t)| Vertex::with_uv(p, [0.0, 0.0, 1.0], uv.unwrap_or(t)).unwrap())
            .collect(),
            vec![0, 1, 2, 0, 2, 3],
        )
        .unwrap(),
    )
}
fn view() -> View {
    View {
        origin_m: [0.0; 3],
        vertical_fov_radians: std::f64::consts::FRAC_PI_2,
        aspect: 1.0,
        near_m: 0.1,
        far_m: 100.0,
    }
}
fn frame(texture: TextureData, sampling: Sampling, uv: Option<[f32; 2]>) -> FrameSnapshot {
    let object = ObjectId::new("quad").unwrap();
    let geo = ResourceId::new("geometry").unwrap();
    let tex = ResourceId::new("texture").unwrap();
    let mut scene = Scene::new();
    scene
        .apply_transaction(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(object.clone())),
                SceneCommand::SetMesh {
                    object: object.clone(),
                    mesh: Some(MeshInstance::with_material(
                        geo.clone(),
                        Material::new([1.0; 3], Some(tex.clone()), sampling, true).unwrap(),
                    )),
                },
            ],
        )
        .unwrap();
    FrameSnapshot {
        session: "test-session".into(),
        sequence: 1,
        scene: scene.snapshot(),
        poses: vec![ObjectPose {
            object,
            transform: RigidTransform::new(
                Vec3d {
                    x: 0.0,
                    y: 0.0,
                    z: -2.0,
                },
                Quatd::IDENTITY,
            )
            .unwrap(),
        }],
        meshes: vec![MeshAsset {
            resource: geo,
            geometry: quad(2.0, uv),
        }],
        textures: vec![TextureAsset {
            resource: tex,
            texture: Arc::new(texture),
        }],
        clock: SimulationClock::new(TimeInstant::new("TT", "epoch", 0, 0).unwrap()).snapshot(),
        reference: FrameId::new("root").unwrap(),
        frame_graph_revision: Revision(0),
        resource_revision: 1,
        availability: FrameAvailability::Complete,
        unresolved: vec![],
    }
}
#[test]
fn texture_preparation_preserves_uv_and_requires_the_snapshot_asset() {
    let mut frame = frame(
        TextureData::new(1, 1, vec![255; 4], ColorSpace::Linear).unwrap(),
        Default::default(),
        None,
    );
    let prepared = prepare(&frame, view()).unwrap();
    assert_eq!(prepared.meshes[0].geometry.vertices()[0].uv(), [0.0, 1.0]);
    assert!(prepared.meshes[0].material.texture.is_some());
    assert!(prepared.pick(0.0, 0.0).is_some());
    frame.textures.clear();
    assert!(prepare(&frame, view()).is_err());
}
#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
fn render(renderer: &spaceeyes_rendering::gpu::GpuRenderer, frame: &FrameSnapshot) -> Vec<u8> {
    let mut resources =
        spaceeyes_resources::ResourceManager::new(spaceeyes_resources::ResourceBudget {
            max_bytes: 2 * 1024 * 1024,
        });
    let pixels = renderer
        .render_rgba8(&prepare(frame, view()).unwrap(), 128, 128, &mut resources)
        .unwrap();
    assert_eq!(resources.used_bytes(), 0);
    pixels
}
#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
fn pixel(pixels: &[u8], x: usize, y: usize) -> [u8; 3] {
    let p = (y * 128 + x) * 4;
    [pixels[p], pixels[p + 1], pixels[p + 2]]
}
#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
#[test]
fn gpu_texture_uv_origin_and_quadrant_colors_are_correct() {
    let renderer = pollster::block_on(spaceeyes_rendering::gpu::GpuRenderer::new()).unwrap();
    let frame = frame(
        TextureData::new(
            2,
            2,
            vec![
                255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
            ],
            ColorSpace::Linear,
        )
        .unwrap(),
        Default::default(),
        None,
    );
    let pixels = render(&renderer, &frame);
    assert_eq!(pixel(&pixels, 32, 32), [255, 0, 0]);
    assert_eq!(pixel(&pixels, 96, 32), [0, 255, 0]);
    assert_eq!(pixel(&pixels, 32, 96), [0, 0, 255]);
    assert_eq!(pixel(&pixels, 96, 96), [255; 3]);
}
#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
#[test]
fn gpu_nearest_linear_clamp_and_repeat_sampling_are_distinct() {
    let renderer = pollster::block_on(spaceeyes_rendering::gpu::GpuRenderer::new()).unwrap();
    let texture = TextureData::new(
        2,
        1,
        vec![255, 0, 0, 255, 0, 0, 255, 255],
        ColorSpace::Linear,
    )
    .unwrap();
    let nearest = frame(texture.clone(), Default::default(), Some([0.5, 0.5]));
    assert_eq!(pixel(&render(&renderer, &nearest), 64, 64), [0, 0, 255]);
    let linear = frame(
        texture.clone(),
        Sampling {
            filter: TextureFilter::Linear,
            address: TextureAddress::Clamp,
        },
        Some([0.5, 0.5]),
    );
    let color = pixel(&render(&renderer, &linear), 64, 64);
    assert!(color[0].abs_diff(128) <= 1 && color[2].abs_diff(128) <= 1 && color[1] == 0);
    let clamp = frame(texture.clone(), Default::default(), Some([1.25, 0.5]));
    assert_eq!(pixel(&render(&renderer, &clamp), 64, 64), [0, 0, 255]);
    let repeat = frame(
        texture,
        Sampling {
            filter: TextureFilter::Nearest,
            address: TextureAddress::Repeat,
        },
        Some([1.25, 0.5]),
    );
    assert_eq!(pixel(&render(&renderer, &repeat), 64, 64), [255, 0, 0]);
}
#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
#[test]
fn gpu_srgb_decode_and_base_color_multiplication_are_explicit() {
    let renderer = pollster::block_on(spaceeyes_rendering::gpu::GpuRenderer::new()).unwrap();
    for (space, expected) in [(ColorSpace::Linear, 128), (ColorSpace::Srgb, 55)] {
        let frame = frame(
            TextureData::new(1, 1, vec![128, 128, 128, 255], space).unwrap(),
            Default::default(),
            None,
        );
        let color = pixel(&render(&renderer, &frame), 64, 64);
        assert!(color[0].abs_diff(expected) <= 1);
    }
    let mut frame = frame(
        TextureData::new(1, 1, vec![128, 128, 128, 255], ColorSpace::Linear).unwrap(),
        Default::default(),
        None,
    );
    let mut prepared = prepare(&frame, view()).unwrap();
    prepared.meshes[0].material.base_color = [0.5, 1.0, 1.0];
    let mut resources =
        spaceeyes_resources::ResourceManager::new(spaceeyes_resources::ResourceBudget {
            max_bytes: 2 * 1024 * 1024,
        });
    let color = pixel(
        &renderer
            .render_rgba8(&prepared, 128, 128, &mut resources)
            .unwrap(),
        64,
        64,
    );
    assert!(color[0].abs_diff(64) <= 1 && color[1].abs_diff(128) <= 1);
    frame.textures.clear();
    assert!(prepare(&frame, view()).is_err());
}
#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
#[test]
fn gpu_uv_interpolation_is_perspective_correct() {
    let renderer = pollster::block_on(spaceeyes_rendering::gpu::GpuRenderer::new()).unwrap();
    let texels = (0..32).flat_map(|i| [i * 8, 0, 0, 255]).collect();
    let mut frame = frame(
        TextureData::new(32, 1, texels, ColorSpace::Linear).unwrap(),
        Default::default(),
        None,
    );
    frame.meshes[0].geometry = quad(1.0, None);
    frame.poses[0].transform = RigidTransform::new(
        Vec3d {
            x: 0.0,
            y: 0.0,
            z: -5.0,
        },
        Quatd {
            w: 0.8660254037844386,
            x: 0.0,
            y: 0.5,
            z: 0.0,
        },
    )
    .unwrap();
    let x = (67.5 / 128.0) * 2.0 - 1.0;
    let sin = 3.0f64.sqrt() / 2.0;
    let t = 2.5 / (0.5 - sin * x);
    let local_x = 0.5 * t * x - sin * (5.0 - t);
    let u = (local_x + 1.0) * 0.5;
    let expected = (u * 32.0).floor() as u8 * 8;
    let color = pixel(&render(&renderer, &frame), 67, 64);
    assert!(
        color[0].abs_diff(expected) <= 2,
        "actual {color:?}, expected red {expected}"
    );
}
#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
#[test]
fn sphere_texture_rotates_with_object_instead_of_camera() {
    let renderer = pollster::block_on(spaceeyes_rendering::gpu::GpuRenderer::new()).unwrap();
    let mut frame = frame(
        TextureData::new(
            4,
            1,
            vec![
                255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
            ],
            ColorSpace::Linear,
        )
        .unwrap(),
        Default::default(),
        None,
    );
    let object = ObjectId::new("sphere").unwrap();
    let mut scene = Scene::new();
    scene
        .apply_transaction(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(object.clone())),
                SceneCommand::SetSphere {
                    object: object.clone(),
                    sphere: Some(
                        Sphere::with_material(
                            1.2,
                            Material::new(
                                [1.0; 3],
                                Some(ResourceId::new("texture").unwrap()),
                                Default::default(),
                                true,
                            )
                            .unwrap(),
                        )
                        .unwrap(),
                    ),
                },
            ],
        )
        .unwrap();
    frame.scene = scene.snapshot();
    frame.poses = vec![ObjectPose {
        object,
        transform: RigidTransform::new(
            Vec3d {
                x: 0.0,
                y: 0.0,
                z: -4.0,
            },
            Quatd::IDENTITY,
        )
        .unwrap(),
    }];
    frame.meshes.clear();
    let first = render(&renderer, &frame);
    let half = std::f64::consts::FRAC_1_SQRT_2;
    frame.poses[0].transform.rotation = Quatd {
        w: half,
        x: 0.0,
        y: half,
        z: 0.0,
    };
    let second = render(&renderer, &frame);
    assert_ne!(pixel(&first, 64, 64), pixel(&second, 64, 64));
}
