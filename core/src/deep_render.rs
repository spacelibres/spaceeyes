use crate::runtime::CoreStore;
use bevy::{
    camera::visibility::NoFrustumCulling, prelude::*, render::render_resource::AsBindGroup,
    shader::ShaderRef,
};
#[derive(Asset, AsBindGroup, TypePath, Debug, Clone)]
pub(crate) struct GalaxyMaterial {
    #[texture(0)]
    #[sampler(1)]
    image: Handle<Image>,
    #[uniform(2)]
    intensity: Vec4,
    #[uniform(3)]
    tile: Vec4,
    #[uniform(4)]
    sampling: Vec4,
}
impl Material for GalaxyMaterial {
    fn vertex_shader() -> ShaderRef {
        "shaders/galaxy.wgsl".into()
    }
    fn fragment_shader() -> ShaderRef {
        "shaders/galaxy.wgsl".into()
    }
    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Blend
    }
    fn depth_bias(&self) -> f32 {
        -2e30 + self.intensity.w * 1e28
    }
    fn enable_prepass() -> bool {
        false
    }
    fn enable_shadows() -> bool {
        false
    }
}
#[derive(Component)]
pub(crate) struct GalaxyLayer {
    key: String,
    revision: u64,
    mesh: Handle<Mesh>,
    material: Handle<GalaxyMaterial>,
    image: Handle<Image>,
}
// Each tile rasterizes only its spherical patch; vertices carry ICRF directions,
// and the shader ignores camera translation. A <=5.625 degree grid bounds error.
fn tile_mesh(tile: Vec4) -> Mesh {
    use bevy::{
        asset::RenderAssetUsages, mesh::Indices, render::render_resource::PrimitiveTopology,
    };
    let nx = (tile.z * 64.0).ceil().max(1.0) as u32;
    let ny = (tile.w * 32.0).ceil().max(1.0) as u32;
    let mut positions = Vec::new();
    let mut uvs = Vec::new();
    let mut indices = Vec::new();
    for y in 0..=ny {
        for x in 0..=nx {
            let local = Vec2::new(x as f32 / nx as f32, y as f32 / ny as f32);
            let uv = tile.xy() + local * tile.zw();
            let lon = (0.5 - uv.x) * std::f32::consts::TAU;
            let lat = (0.5 - uv.y) * std::f32::consts::PI;
            positions.push([lat.cos() * lon.cos(), lat.sin(), -lat.cos() * lon.sin()]);
            uvs.push(local.to_array());
        }
    }
    for y in 0..ny {
        for x in 0..nx {
            let a = y * (nx + 1) + x;
            let b = a + 1;
            let c = a + nx + 1;
            let d = c + 1;
            indices.extend([a, c, b, b, c, d]);
        }
    }
    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::default(),
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    mesh.insert_indices(Indices::U32(indices));
    mesh
}
const MAX_TEXTURE_BYTES: usize = 64 * 1024 * 1024;
fn budget_target(mut wanted: u32, estimate: impl Fn(u32) -> usize) -> u32 {
    while wanted > 0 && estimate(wanted) > MAX_TEXTURE_BYTES {
        wanted -= 1;
    }
    wanted
}
fn admit_texture(used: &mut usize, bytes: usize) -> bool {
    if bytes > MAX_TEXTURE_BYTES.saturating_sub(*used) {
        false
    } else {
        *used += bytes;
        true
    }
}
fn tile_visible(x: u32, y: u32, w: u32, h: u32, rotation: Quat, fov: f32, aspect: f32) -> bool {
    let u = ((x * 256) as f32 + (256u32.min(w - x * 256)) as f32 * 0.5) / w as f32;
    let v = ((y * 256) as f32 + (256u32.min(h - y * 256)) as f32 * 0.5) / h as f32;
    let lon = (0.5 - u) * std::f32::consts::TAU;
    let lat = (0.5 - v) * std::f32::consts::PI;
    let d = Vec3::new(lat.cos() * lon.cos(), lat.sin(), -lat.cos() * lon.sin());
    let radius =
        (256.0 / w as f32 * std::f32::consts::TAU + 256.0 / h as f32 * std::f32::consts::PI) * 0.5;
    let half = ((fov * 0.5).tan() * (1.0 + aspect * aspect).sqrt()).atan();
    (rotation * Vec3::NEG_Z).dot(d) >= (half + radius).min(std::f32::consts::PI).cos()
}
// Bevy injects independent ECS resources and queries into this system.
#[allow(clippy::too_many_arguments)]
pub(crate) fn sync_environment(
    mut commands: Commands,
    mut lod: ResMut<crate::deep_lod::DeepSpaceLod>,
    cameras: Query<(Entity, &Transform, &Projection), With<crate::renderer::DisplayCamera>>,
    store: Res<CoreStore>,
    server: Res<AssetServer>,
    time: Res<Time>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<GalaxyMaterial>>,
    mut existing: Query<(Entity, &GalaxyLayer, &mut Visibility)>,
) {
    let Ok(mut core) = store.0.lock() else { return };
    let environment = core.environment.clone();
    let Some(env) = environment else {
        for (e, l, _) in &mut existing {
            commands.entity(e).despawn();
            meshes.remove(l.mesh.id());
            materials.remove(l.material.id());
        }
        for (e, _, _) in &cameras {
            commands
                .entity(e)
                .remove::<bevy::light::EnvironmentMapLight>();
        }
        lod.exposure = 0.0;
        lod.black = 0.0;
        lod.ready = lod.wanted;
        lod.blend = (lod.blend + time.delta_secs() * 3.0).min(1.0);
        if lod.blend == 1.0 {
            lod.current = lod.ready;
        }
        core.environment_status = serde_json::json!({"phase":"disabled","desiredLod":lod.wanted,"readyLod":lod.ready,"currentLod":lod.current,"blend":lod.blend,"loadedTiles":0,"gpuBytes":0});
        return;
    };
    let mut wanted = Vec::<(String, Vec4, Vec4, u32)>::new();
    let mut ibl_bytes = 0usize;
    let mut budget_limited = false;
    let mut effective = lod.wanted;
    if let Some(config) = &env.spec.lod {
        lod.exposure = config.exposure_ev;
        lod.black = config.black_level;
        if let (Some(d), Some(s)) = (
            core.asset_descriptor(&config.diffuse_asset_id),
            core.asset_descriptor(&config.specular_asset_id),
        ) {
            let diffuse_map = server.load::<Image>(d.path.clone());
            let specular_map = server.load::<Image>(s.path.clone());
            ibl_bytes = (32 * 32 * 6 + 128 * 128 * 6 * 4 / 3) * 8;
            for (e, _, _) in &cameras {
                commands.entity(e).insert(bevy::light::EnvironmentMapLight {
                    diffuse_map: diffuse_map.clone(),
                    specular_map: specular_map.clone(),
                    intensity: config.ibl_intensity,
                    // Prepared cubemaps already use the displayed ICRF basis.
                    rotation: Quat::IDENTITY,
                    affects_lightmapped_mesh_diffuse: true,
                });
            }
        }
        let camera = cameras.iter().next();
        let estimate = |target: u32| {
            let mut bytes = ibl_bytes;
            for level in [0, lod.current.min(target), target]
                .into_iter()
                .collect::<std::collections::BTreeSet<_>>()
            {
                let l = &config.levels[level as usize];
                for t in &l.tiles {
                    if level > 0
                        && camera.is_some_and(|(_, tr, p)| match p {
                            Projection::Perspective(p) => !tile_visible(
                                t.x,
                                t.y,
                                l.width,
                                l.height,
                                tr.rotation,
                                p.fov,
                                p.aspect_ratio,
                            ),
                            _ => false,
                        })
                    {
                        continue;
                    }
                    bytes += (256u32.min(l.width - t.x * 256) + 4) as usize
                        * (256u32.min(l.height - t.y * 256) + 4) as usize
                        * 8;
                }
            }
            bytes
        };
        effective = budget_target(lod.wanted, estimate);
        budget_limited = effective < lod.wanted;
        if lod.effective_target != Some(effective) {
            lod.effective_target = Some(effective);
            lod.blend = 0.0;
            lod.ready = lod.current;
        }
        // Keep a complete coarse sphere while fine visible tiles arrive. Bound both
        // requested and resident texture payloads before issuing AssetServer loads.
        for level in [0, lod.current.min(effective), effective]
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>()
        {
            let l = &config.levels[level as usize];
            for t in &l.tiles {
                if level > 0
                    && camera.is_some_and(|(_, tr, p)| match p {
                        Projection::Perspective(p) => !tile_visible(
                            t.x,
                            t.y,
                            l.width,
                            l.height,
                            tr.rotation,
                            p.fov,
                            p.aspect_ratio,
                        ),
                        _ => false,
                    })
                {
                    continue;
                }
                let tw = 256u32.min(l.width - t.x * 256);
                let th = 256u32.min(l.height - t.y * 256);
                let bytes = (tw + 4) as usize * (th + 4) as usize * 8;
                if !admit_texture(&mut ibl_bytes, bytes) {
                    budget_limited = true;
                    continue;
                }

                wanted.push((
                    t.asset_id.clone(),
                    Vec4::new(
                        (t.x * 256) as f32 / l.width as f32,
                        (t.y * 256) as f32 / l.height as f32,
                        tw as f32 / l.width as f32,
                        th as f32 / l.height as f32,
                    ),
                    Vec4::new(
                        2.0 / (tw + 4) as f32,
                        2.0 / (th + 4) as f32,
                        tw as f32 / (tw + 4) as f32,
                        th as f32 / (th + 4) as f32,
                    ),
                    level,
                ));
            }
        }
    } else {
        lod.exposure = 0.0;
        lod.black = 0.0;

        for (e, _, _) in &cameras {
            commands
                .entity(e)
                .remove::<bevy::light::EnvironmentMapLight>();
        }
        wanted.push((
            env.spec.asset_id.clone(),
            Vec4::new(0., 0., 1., 1.),
            Vec4::new(0., 0., 1., 1.),
            0,
        ));
    }
    let ready = wanted.iter().all(|(id, _, _, _)| {
        existing.iter().any(|(_, l, _)| {
            l.key == *id
                && l.revision == env.revision
                && matches!(
                    server.load_state(l.image.id()),
                    bevy::asset::LoadState::Loaded
                )
        })
    });
    if ready {
        lod.ready = effective;
        lod.blend = (lod.blend + time.delta_secs() * 3.0).min(1.0);
        if lod.blend == 1.0 {
            lod.current = lod.ready;
        }
    } else {
        lod.blend = 0.;
    }
    let mut loaded = 0;
    let mut error = None;
    for (e, l, mut vis) in &mut existing {
        let tile = wanted.iter().find(|(id, _, _, _)| *id == l.key);
        if l.revision != env.revision || tile.is_none() {
            commands.entity(e).despawn();
            meshes.remove(l.mesh.id());
            materials.remove(l.material.id());
            continue;
        }
        let Some((_, _, _, level)) = tile else {
            continue;
        };
        let is_ready = matches!(
            server.load_state(l.image.id()),
            bevy::asset::LoadState::Loaded
        );
        if let bevy::asset::LoadState::Failed(e) = server.load_state(l.image.id()) {
            error = Some(e.to_string());
        }
        *vis = if is_ready {
            loaded += 1;
            Visibility::Inherited
        } else {
            Visibility::Hidden
        };
        if let Some(mut m) = materials.get_mut(&l.material) {
            m.intensity = Vec4::new(
                env.spec.intensity * 2f32.powf(lod.exposure),
                lod.black,
                if *level == 0 {
                    1.0
                } else if *level == lod.current {
                    if lod.current > effective {
                        1.0 - lod.blend
                    } else {
                        1.0
                    }
                } else {
                    lod.blend
                },
                *level as f32,
            );
        }
    }
    for (id, tile, sampling, _) in &wanted {
        if existing
            .iter()
            .any(|(_, l, _)| l.key == *id && l.revision == env.revision)
        {
            continue;
        }
        let Some(asset) = core.asset_descriptor(id) else {
            continue;
        };
        let image = server.load::<Image>(asset.path.clone());
        let mesh = meshes.add(tile_mesh(*tile));
        let material = materials.add(GalaxyMaterial {
            image: image.clone(),
            intensity: Vec4::new(env.spec.intensity, 0., 0., 0.),
            tile: *tile,
            sampling: *sampling,
        });
        commands.spawn((
            Mesh3d(mesh.clone()),
            MeshMaterial3d(material.clone()),
            Transform::default(),
            NoFrustumCulling,
            Visibility::Hidden,
            GalaxyLayer {
                key: id.clone(),
                revision: env.revision,
                mesh,
                material,
                image,
            },
        ));
    }
    core.environment_status = serde_json::json!({"phase":if error.is_some(){"failed"}else if ready{"ready"}else{"pending"},"detail":error,"desiredLod":lod.wanted,"readyLod":lod.ready,"currentLod":lod.current,"blend":lod.blend,"loadedTiles":loaded,"gpuBytes":ibl_bytes,"budgetLimited":budget_limited});
}
#[cfg(test)]
mod tests {
    #[test]
    fn packed_cube_and_visible_panorama_share_world_directions() {
        // Same convention as prepare-galaxy-lod-audit.ts, without an extra rotation.
        for d in [
            Vec3::X,
            Vec3::Y,
            Vec3::Z,
            Vec3::NEG_X,
            Vec3::NEG_Y,
            Vec3::NEG_Z,
        ] {
            let u = (0.5 + d.z.atan2(d.x) / std::f32::consts::TAU).rem_euclid(1.0);
            let v = 0.5 - d.y.asin() / std::f32::consts::PI;
            let lon = (0.5 - u) * std::f32::consts::TAU;
            let lat = (0.5 - v) * std::f32::consts::PI;
            let displayed = Vec3::new(lat.cos() * lon.cos(), lat.sin(), -lat.cos() * lon.sin());
            assert!((displayed - d).length() < 1e-5);
        }
    }
    use super::*;
    #[test]
    fn oversized_view_falls_back_to_complete_level() {
        let effective = budget_target(6, |level| {
            (128usize << level) * (64usize << level) * 8 + 2 * 1024 * 1024
        });
        assert!(effective < 6);
        assert_eq!(effective, 4);
        assert_eq!(
            budget_target(effective, |level| (128usize << level)
                * (64usize << level)
                * 8
                + 2 * 1024 * 1024),
            effective
        );
    }
    #[test]
    fn full_sky_requests_cannot_exceed_residency_budget() {
        let mut used = (32 * 32 * 6 + 128 * 128 * 6 * 4 / 3) * 8;
        let mut admitted = 0;
        for _ in 0..684 {
            if admit_texture(&mut used, 260 * 260 * 8) {
                admitted += 1;
            }
        }
        assert!(used <= 64 * 1024 * 1024);
        assert!(admitted < 684);
        let before = used;
        assert!(!admit_texture(&mut used, usize::MAX));
        assert_eq!(used, before);
    }
    #[test]
    fn tile_mesh_has_bounded_angular_coverage_and_inward_winding() {
        let mesh = tile_mesh(Vec4::new(0.25, 0.25, 0.03125, 0.0625));
        assert_eq!(mesh.count_vertices(), 9);
        let positions = mesh
            .attribute(Mesh::ATTRIBUTE_POSITION)
            .unwrap()
            .as_float3()
            .unwrap();
        for p in positions {
            assert!((Vec3::from_array(*p).length() - 1.0).abs() < 1e-5);
        }
        let a = Vec3::from_array(positions[0]);
        let b = Vec3::from_array(positions[3]);
        let c = Vec3::from_array(positions[1]);
        assert!((b - a).cross(c - a).dot(a) < 0.0);
        assert!(tile_mesh(Vec4::new(0., 0., 1., 1.)).count_vertices() <= 2145);
    }
    #[test]
    fn disabled_environment_releases_mesh_material_and_entity() {
        let mut app = App::new();
        app.add_plugins((MinimalPlugins, bevy::asset::AssetPlugin::default()))
            .insert_resource(CoreStore(std::sync::Arc::new(std::sync::Mutex::new(
                crate::Core::default(),
            ))))
            .init_resource::<crate::deep_lod::DeepSpaceLod>()
            .insert_resource(Assets::<Mesh>::default())
            .insert_resource(Assets::<GalaxyMaterial>::default())
            .add_systems(Update, sync_environment);
        let mesh = app
            .world_mut()
            .resource_mut::<Assets<Mesh>>()
            .add(tile_mesh(Vec4::new(0., 0., 1., 1.)));
        let material = app
            .world_mut()
            .resource_mut::<Assets<GalaxyMaterial>>()
            .add(GalaxyMaterial {
                image: default(),
                intensity: Vec4::ONE,
                tile: Vec4::ONE,
                sampling: Vec4::ONE,
            });
        let entity = app
            .world_mut()
            .spawn((
                GalaxyLayer {
                    key: "gone".into(),
                    revision: 1,
                    mesh,
                    material,
                    image: default(),
                },
                Visibility::Inherited,
            ))
            .id();
        app.world_mut()
            .resource_mut::<crate::deep_lod::DeepSpaceLod>()
            .wanted = 5;
        app.update();
        assert_eq!(
            app.world()
                .resource::<crate::deep_lod::DeepSpaceLod>()
                .wanted,
            5
        );
        assert_eq!(
            app.world()
                .resource::<crate::deep_lod::DeepSpaceLod>()
                .ready,
            5
        );
        assert!(app.world().get_entity(entity).is_err());
        assert_eq!(app.world().resource::<Assets<Mesh>>().len(), 0);
        assert_eq!(app.world().resource::<Assets<GalaxyMaterial>>().len(), 0);
        app.init_asset::<Image>();
        let camera = app
            .world_mut()
            .spawn((
                crate::renderer::DisplayCamera,
                Transform::default(),
                Projection::default(),
                bevy::light::EnvironmentMapLight {
                    diffuse_map: default(),
                    specular_map: default(),
                    intensity: 1.0,
                    rotation: Quat::IDENTITY,
                    affects_lightmapped_mesh_diffuse: true,
                },
            ))
            .id();
        {
            let store = app.world().resource::<CoreStore>();
            let mut core = store.0.lock().unwrap();
            core.register_asset(
                "legacy",
                crate::AssetDescriptor {
                    kind: crate::AssetKind::Texture,
                    path: "legacy.webp".into(),
                },
            )
            .unwrap();
            core.environment = Some(crate::deep_space::EnvironmentLayer {
                owner: "test".into(),
                revision: 2,
                spec: crate::EnvironmentSpec {
                    asset_id: "legacy".into(),
                    frame: "ICRF".into(),
                    intensity: 1.,
                    lod: None,
                },
            });
        }
        {
            let mut lod = app
                .world_mut()
                .resource_mut::<crate::deep_lod::DeepSpaceLod>();
            lod.exposure = 4.;
            lod.black = 0.01;
        }
        app.update();
        assert!(
            app.world()
                .get::<bevy::light::EnvironmentMapLight>(camera)
                .is_none()
        );
        let lod = app.world().resource::<crate::deep_lod::DeepSpaceLod>();
        assert_eq!(lod.exposure, 0.);
        assert_eq!(lod.black, 0.);
    }
    #[test]
    fn tile_visibility_culls_opposite_hemisphere_and_handles_poles() {
        assert!(!tile_visible(
            0,
            8,
            8192,
            4096,
            Quat::IDENTITY,
            10f32.to_radians(),
            1.
        ));
        assert!(tile_visible(
            0,
            0,
            128,
            64,
            Quat::IDENTITY,
            45f32.to_radians(),
            1.
        ));
    }
}
