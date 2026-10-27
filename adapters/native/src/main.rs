// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Headless prototype host; no second simulation state, no NASA or assumed scientific epoch.
use spaceeyes_engine::Engine;
use spaceeyes_foundation::{FrameId, ObjectId, ResourceId, Revision};
use spaceeyes_geometry::{ColorSpace, TextureData, TriangleMesh, Vertex};
use spaceeyes_rendering::{gpu::GpuRenderer, prepare_camera};
use spaceeyes_scene::{CameraState, Material, MeshInstance, SceneCommand, SceneObject, Sphere};
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
    let texture = ResourceId::new("demo:checker-texture").unwrap();
    let pixels = (0..8)
        .flat_map(|y| {
            (0..8).flat_map(move |x| {
                if (x + y) % 2 == 0 {
                    [235, 160, 40, 255]
                } else {
                    [40, 90, 210, 255]
                }
            })
        })
        .collect();
    engine
        .register_texture_resource(
            texture.clone(),
            TextureData::new(8, 8, pixels, ColorSpace::Linear).map_err(|e| format!("{e:?}"))?,
        )
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
                        sphere: Some(if i == 0 {
                            Sphere::with_material(
                                *radius,
                                Material::new(
                                    [1.0; 3],
                                    Some(texture.clone()),
                                    Default::default(),
                                    false,
                                )
                                .unwrap(),
                            )
                            .unwrap()
                        } else {
                            Sphere::new(*radius, *color).map_err(|e| format!("{e:?}"))?
                        }),
                    },
                ],
            )
            .map_err(|e| format!("{e:?}"))?;
    }
    let geometry = ResourceId::new("demo:pyramid-geometry").unwrap();
    engine
        .register_mesh_resource(geometry.clone(), pyramid()?)
        .map_err(|e| format!("{e:?}"))?;
    let object = ObjectId::new("demo:pyramid").unwrap();
    let frame = FrameId::new("demo:pyramid-frame").unwrap();
    engine
        .register_child_frame(
            frame.clone(),
            root.clone(),
            FrameSample {
                instant: instant.clone(),
                to_parent: RigidTransform::new(
                    Vec3d {
                        x: 2.5,
                        y: 1.6,
                        z: -6.5,
                    },
                    Quatd::IDENTITY,
                )
                .unwrap(),
            },
        )
        .map_err(|e| format!("{e:?}"))?;
    engine
        .submit_scene(
            engine.scene().revision(),
            &[
                SceneCommand::Create(SceneObject::new(object.clone())),
                SceneCommand::SetFrame {
                    object: object.clone(),
                    frame: Some(frame),
                },
                SceneCommand::SetMesh {
                    object,
                    mesh: Some(MeshInstance::with_material(
                        geometry,
                        Material::new([1.0; 3], Some(texture), Default::default(), false).unwrap(),
                    )),
                },
            ],
        )
        .map_err(|e| format!("{e:?}"))?;
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
    assert_eq!(snapshot.scene.revision, Revision(5));
    let asset_bytes = engine.resource_used_bytes();
    let prepared = prepare_camera(&snapshot, &camera_id, 1.0).map_err(|e| format!("{e:?}"))?;
    let renderer = pollster::block_on(GpuRenderer::new()).map_err(|e| format!("{e:?}"))?;
    let pixels = engine
        .render_rgba8(&renderer, &root, &camera_id, 512, 512)
        .map_err(|e| format!("{e:?}"))?;
    let remaining_bytes = engine.resource_used_bytes();
    assert_eq!(
        remaining_bytes, asset_bytes,
        "drawing must preserve assets and reclaim only GPU scratch"
    );
    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    file.write_all(b"P6\n512 512\n255\n")
        .map_err(|e| e.to_string())?;
    for pixel in pixels.as_chunks::<4>().0.iter() {
        file.write_all(&pixel[..3]).map_err(|e| e.to_string())?;
    }
    engine.shutdown();
    println!(
        "Rendered {} spheres and {} mesh with depth testing on {}; image: {}; retained asset bytes: {}; temporary resource bytes: {}",
        prepared.spheres.len(),prepared.meshes.len(),
        renderer.adapter_name,
        path,
        asset_bytes,
        remaining_bytes-asset_bytes
    );
    Ok(())
}

fn pyramid() -> Result<TriangleMesh, String> {
    let points = [
        [-1.0, -0.8, -0.8],
        [1.0, -0.8, -0.8],
        [0.0, -0.8, 1.0],
        [0.0, 1.0, 0.0],
    ];
    let mut vertices = Vec::new();
    for [a, b, c] in [[0, 1, 2], [0, 3, 1], [1, 3, 2], [2, 3, 0]] {
        let u: [f64; 3] = std::array::from_fn(|i| points[b][i] - points[a][i]);
        let v: [f64; 3] = std::array::from_fn(|i| points[c][i] - points[a][i]);
        let normal = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ];
        for (index, uv) in [(a, [0.0, 1.0]), (b, [1.0, 1.0]), (c, [0.5, 0.0])] {
            vertices
                .push(Vertex::with_uv(points[index], normal, uv).map_err(|e| format!("{e:?}"))?);
        }
    }
    TriangleMesh::new(vertices, (0..12).collect()).map_err(|e| format!("{e:?}"))
}
