use bevy::{
    prelude::*,
    render::render_resource::{AsBindGroup, Face},
    shader::ShaderRef,
};
#[derive(Asset, AsBindGroup, TypePath, Debug, Clone)]
pub(crate) struct StellarMaterial {
    #[uniform(0)]
    pub parameters: Vec4,
    #[uniform(1)]
    pub tuning: [Vec4; 15],
    #[uniform(2)]
    pub profile: [Vec4; 64],
}
impl Material for StellarMaterial {
    fn vertex_shader() -> ShaderRef {
        "shaders/stellar.wgsl".into()
    }
    fn fragment_shader() -> ShaderRef {
        "shaders/stellar.wgsl".into()
    }
    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Premultiplied
    }
    fn enable_prepass() -> bool {
        false
    }
    fn enable_shadows() -> bool {
        false
    }
    fn specialize(
        _pipeline: &bevy::pbr::MaterialPipeline,
        _descriptor: &mut bevy::render::render_resource::RenderPipelineDescriptor,
        _layout: &bevy::mesh::MeshVertexBufferLayoutRef,
        _key: bevy::pbr::MaterialPipelineKey<Self>,
    ) -> Result<(), bevy::render::render_resource::SpecializedMeshPipelineError> {
        _descriptor.primitive.cull_mode = Some(Face::Front);
        Ok(())
    }
}

/// Surface-anchored magnetic arches, batched in one mesh per stellar representation.
#[cfg(test)]
pub(crate) fn prominence_mesh() -> Mesh {
    prominence_mesh_tuned(&default_settings())
}
fn prominence_mesh_tuned(v: &[Vec4; 15]) -> Mesh {
    let param = |i: usize| v[i / 4][i % 4];
    use bevy::{
        asset::RenderAssetUsages, mesh::Indices, render::render_resource::PrimitiveTopology,
    };
    let mut positions = Vec::<[f32; 3]>::new();
    let mut normals = Vec::<[f32; 3]>::new();
    let mut uvs = Vec::<[f32; 2]>::new();
    let mut indices = Vec::<u32>::new();
    for arch in 0..param(37) as usize {
        let z = 1.0 - 2.0 * (arch as f32 + 0.5) / param(37).max(1.);
        let angle = arch as f32 * 2.399963;
        let n = Vec3::new(
            (1. - z * z).sqrt() * angle.cos(),
            z,
            (1. - z * z).sqrt() * angle.sin(),
        );
        let tangent = n.any_orthonormal_vector();
        let binormal = n.cross(tangent);
        let spread = (0.035 + (arch % 5) as f32 * 0.013) * param(40);
        let height = (0.07 + (arch % 7) as f32 * 0.025) * param(39);
        for strand in 0..param(38) as usize {
            let base = positions.len() as u32;
            let lane = (strand as f32 - 2.) * 0.009;
            for step in 0..=48 {
                let t = step as f32 / 48.;
                let a = (t * 2. - 1.) * spread;
                let foot = (n + tangent * a + binormal * lane).normalize();
                let center = foot * (0.998 + height * (std::f32::consts::PI * t).sin());
                let width = (0.003 + 0.009 * (std::f32::consts::PI * t).sin()) * param(41);
                for side in 0..=6 {
                    let theta = side as f32 / 6. * std::f32::consts::TAU;
                    let radial = binormal * theta.cos() + foot * theta.sin();
                    positions.push((center + radial * width).to_array());
                    normals.push(radial.to_array());
                    uvs.push([
                        t,
                        side as f32 / 6. + arch as f32 * 2. + strand as f32 * 0.13,
                    ]);
                }
            }
            for step in 0..48u32 {
                for side in 0..6u32 {
                    let a = base + step * 7 + side;
                    let b = a + 7;
                    indices.extend([a, b, a + 1, a + 1, b, b + 1]);
                }
            }
        }
    }
    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::default(),
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    mesh.insert_indices(Indices::U32(indices));
    mesh
}

#[derive(Asset, AsBindGroup, TypePath, Debug, Clone)]
pub(crate) struct ProminenceMaterial {
    #[uniform(0)]
    pub parameters: Vec4,
    #[uniform(1)]
    pub tuning: [Vec4; 15],
    #[uniform(2)]
    pub profile: [Vec4; 64],
}
impl Material for ProminenceMaterial {
    fn fragment_shader() -> ShaderRef {
        "shaders/prominence.wgsl".into()
    }
    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Add
    }
    fn enable_prepass() -> bool {
        false
    }
    fn enable_shadows() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn arches_are_bounded_surface_anchored_and_batched() {
        let mesh = prominence_mesh();
        let bevy::mesh::VertexAttributeValues::Float32x3(p) =
            mesh.attribute(Mesh::ATTRIBUTE_POSITION).unwrap()
        else {
            panic!("positions")
        };
        assert!(p.len() < 50000);
        for v in p {
            let r = Vec3::from_array(*v).length();
            assert!(r.is_finite() && (0.99..1.24).contains(&r));
        }
        for strand in p.chunks_exact(49 * 7) {
            assert!((Vec3::from_array(strand[0]).length() - 1.).abs() < 0.006);
            assert!((Vec3::from_array(strand[48 * 7]).length() - 1.).abs() < 0.006);
        }
    }
}

/// Lightweight declaration; expensive geometry/materials exist only near the source.
#[derive(Component)]
pub(crate) struct StellarEmitter {
    pub source: String,
    pub clock: f32,
    pub parameters: Vec4,
}
struct ActivePlasma {
    root: Entity,
    proxy: Entity,
    arch_entity: Entity,
    geometry: [f32; 5],
    clock: f32,
    mesh: Handle<Mesh>,
    volume: Handle<StellarMaterial>,
    arches: Handle<ProminenceMaterial>,
}
#[derive(Resource, Default)]
pub(crate) struct StellarLod(std::collections::HashMap<Entity, ActivePlasma>);

#[cfg(test)]
fn plasma_near(distance: f32, active: bool) -> bool {
    distance.is_finite() && distance >= 0. && distance < if active { 10. } else { 8. }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn sync_stellar_lod(
    mut commands: Commands,
    store: Option<Res<crate::runtime::CoreStore>>,
    time: Option<Res<Time>>,
    surfaces: Query<&MeshMaterial3d<StandardMaterial>>,
    mut surface_materials: ResMut<Assets<StandardMaterial>>,
    mut emitters: Query<(Entity, &GlobalTransform, &mut StellarEmitter)>,
    cameras: Query<&GlobalTransform, With<crate::renderer::DisplayCamera>>,
    shared: Res<crate::render_assets::SharedVisuals>,
    mut state: ResMut<StellarLod>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut volumes: ResMut<Assets<StellarMaterial>>,
    mut arches: ResMut<Assets<ProminenceMaterial>>,
) {
    let camera = cameras.iter().next().map(GlobalTransform::translation);
    let mut retained = std::collections::HashSet::new();
    for (entity, transform, mut emitter) in &mut emitters {
        let radius = transform
            .to_scale_rotation_translation()
            .0
            .abs()
            .max_element();
        let distance = camera
            .filter(|_| radius.is_finite() && radius > 0.)
            .map_or(f32::INFINITY, |p| {
                p.distance(transform.translation()) / radius
            });
        let mut tuning = legacy_settings(emitter.parameters);
        // Untuned legacy calls use the generated profile in the external WGSL.
        // Tuned profiles arrive through the SDK; no numerical resource table in WASM.
        let mut profile = [Vec4::ZERO; 64];
        if let Some(store) = &store
            && let Ok(core) = store.0.lock()
            && let Some(t) = core.stellar_tuning(&emitter.source)
        {
            for (i, (key, _, _, _, _)) in crate::stellar_tuning::CONTROLS.iter().enumerate() {
                tuning[i / 4][i % 4] = t.value(key) as f32;
            }
            for (i, p) in profile.iter_mut().enumerate() {
                *p = Vec4::new(
                    t.profile.density[i] as f32,
                    t.profile.travel[i] as f32,
                    1.,
                    0.,
                );
            }
        }
        let param = |i: usize| tuning[i / 4][i % 4];
        if let Ok(handle) = surfaces.get(entity) {
            let color = param(4) as u32;
            let gain = param(3) * param(0);
            let r = ((color >> 16) & 255) as f32 / 255.;
            let g = ((color >> 8) & 255) as f32 / 255.;
            let b = (color & 255) as f32 / 255.;
            let base_color = Color::srgba(r * gain, g * gain, b * gain, param(0));
            let emissive = LinearRgba::new(r * gain, g * gain, b * gain, 1.);
            let changed = surface_materials.get(&handle.0).is_some_and(|m| {
                m.base_color != base_color
                    || m.emissive != emissive
                    || m.alpha_mode != AlphaMode::Mask(0.5)
            });
            if changed && let Some(mut surface) = surface_materials.get_mut(&handle.0) {
                surface.alpha_mode = AlphaMode::Mask(0.5);
                surface.base_color = base_color;
                surface.emissive = emissive;
            }
        }

        if param(7) < 0.5 {
            emitter.clock += time.as_ref().map_or(0., |t| t.delta_secs()) * param(5);
        }
        let geometry = [param(37), param(38), param(39), param(40), param(41)];
        if (param(1) == 0. && param(2) == 0.)
            || !distance.is_finite()
            || distance
                >= if state.0.contains_key(&entity) {
                    param(56)
                } else {
                    param(55)
                }
        {
            continue;
        }
        retained.insert(entity);
        let active = state.0.entry(entity).or_insert_with(|| {
            let mesh = meshes.add(prominence_mesh_tuned(&tuning));
            let volume = volumes.add(StellarMaterial {
                parameters: emitter.parameters,
                tuning,
                profile,
            });
            let material = arches.add(ProminenceMaterial {
                parameters: emitter.parameters,
                tuning,
                profile,
            });
            let root = commands
                .spawn((Transform::default(), Visibility::Inherited, ChildOf(entity)))
                .id();
            let arch_entity = commands
                .spawn((
                    Mesh3d(mesh.clone()),
                    MeshMaterial3d(material.clone()),
                    Transform::default(),
                    ChildOf(root),
                ))
                .id();
            let proxy = commands
                .spawn((
                    Mesh3d(shared.mesh.clone()),
                    MeshMaterial3d(volume.clone()),
                    Transform::from_scale(Vec3::splat(param(13))),
                    ChildOf(root),
                ))
                .id();
            ActivePlasma {
                root,
                proxy,
                arch_entity,
                geometry,
                clock: 0.,
                mesh,
                volume,
                arches: material,
            }
        });
        if active.geometry != geometry {
            if let Some(mut mesh) = meshes.get_mut(&active.mesh) {
                *mesh = prominence_mesh_tuned(&tuning);
            }
            active.geometry = geometry;
        }
        active.clock = emitter.clock;
        commands
            .entity(active.proxy)
            .insert(Transform::from_scale(Vec3::splat(param(13))));
        commands.entity(active.proxy).insert(if param(1) > 0. {
            Visibility::Inherited
        } else {
            Visibility::Hidden
        });
        commands
            .entity(active.arch_entity)
            .insert(if param(2) > 0. {
                Visibility::Inherited
            } else {
                Visibility::Hidden
            });
        let mut parameters = emitter.parameters;
        parameters.x = 1.;
        parameters.z = active.clock;
        parameters.x *= ((param(56) - distance) / (param(56) - param(57))).clamp(0., 1.);
        if let Some(mut material) = volumes.get_mut(&active.volume) {
            material.parameters = parameters;
            material.tuning = tuning;
            material.profile = profile;
        }
        if let Some(mut material) = arches.get_mut(&active.arches) {
            material.parameters = parameters;
            material.tuning = tuning;
            material.profile = profile;
        }
    }
    state.0.retain(|entity, active| {
        if retained.contains(entity) {
            return true;
        }
        commands.entity(active.root).try_despawn();
        meshes.remove(active.mesh.id());
        volumes.remove(active.volume.id());
        arches.remove(active.arches.id());
        false
    });
}

#[cfg(test)]
mod lod_tests {
    use super::*;
    #[test]
    fn distance_gate_has_hysteresis_and_rejects_invalid_values() {
        assert!(plasma_near(7.9, false));
        assert!(!plasma_near(8., false));
        assert!(plasma_near(9., true));
        assert!(!plasma_near(10., true));
        assert!(!plasma_near(f32::NAN, true));
        assert!(!plasma_near(f32::INFINITY, false));
        assert!(!plasma_near(-1., true));
    }
    #[test]
    fn approach_departure_and_source_removal_manage_owned_assets() {
        let mut app = App::new();
        app.add_plugins(bevy::transform::TransformPlugin)
            .init_resource::<Assets<Mesh>>()
            .init_resource::<Assets<StandardMaterial>>()
            .init_resource::<Assets<StellarMaterial>>()
            .init_resource::<Assets<ProminenceMaterial>>()
            .init_resource::<StellarLod>()
            .add_systems(
                PostUpdate,
                sync_stellar_lod.after(bevy::transform::TransformSystems::Propagate),
            );
        let sphere = app
            .world_mut()
            .resource_mut::<Assets<Mesh>>()
            .add(Sphere::new(1.));
        app.insert_resource(crate::render_assets::SharedVisuals { mesh: sphere });
        let source = app
            .world_mut()
            .spawn((
                Transform::default(),
                StellarEmitter {
                    parameters: Vec4::ONE,
                    source: String::new(),
                    clock: 0.,
                },
            ))
            .id();
        let camera = app
            .world_mut()
            .spawn((
                crate::renderer::DisplayCamera,
                Transform::from_xyz(0., 0., 20.),
            ))
            .id();
        app.update();
        assert!(app.world().resource::<StellarLod>().0.is_empty());
        assert_eq!(app.world().resource::<Assets<Mesh>>().len(), 1);
        let mut first = None;
        for (distance, expected) in [(7., 1), (9., 1), (11., 0), (6., 1)] {
            app.world_mut()
                .entity_mut(camera)
                .insert(Transform::from_xyz(0., 0., distance));
            app.update();
            let state = app.world().resource::<StellarLod>();
            assert_eq!(state.0.len(), expected);
            if distance == 7. {
                first = Some(state.0[&source].root);
            }
            if distance == 9. {
                assert_eq!(first, Some(state.0[&source].root));
            }
            assert_eq!(
                app.world().resource::<Assets<StellarMaterial>>().len(),
                expected
            );
            assert_eq!(
                app.world().resource::<Assets<ProminenceMaterial>>().len(),
                expected
            );
            assert_eq!(app.world().resource::<Assets<Mesh>>().len(), 1 + expected);
        }
        app.world_mut().entity_mut(source).despawn();
        app.update();
        assert!(app.world().resource::<StellarLod>().0.is_empty());
        assert_eq!(app.world().resource::<Assets<StellarMaterial>>().len(), 0);
        assert_eq!(
            app.world().resource::<Assets<ProminenceMaterial>>().len(),
            0
        );
        assert_eq!(app.world().resource::<Assets<Mesh>>().len(), 1);
    }
}

fn default_settings() -> [Vec4; 15] {
    let mut a = [Vec4::ZERO; 15];
    for (i, (_, _, _, v, _)) in crate::stellar_tuning::CONTROLS.iter().enumerate() {
        a[i / 4][i % 4] = *v as f32;
    }
    a
}

fn legacy_settings(parameters: Vec4) -> [Vec4; 15] {
    let mut settings = default_settings();
    settings[8 / 4][8 % 4] = parameters.x;
    settings[36 / 4][36 % 4] = parameters.x;
    settings[5 / 4][5 % 4] = parameters.y;
    if parameters.x <= 0. {
        settings[0][1] = 0.;
        settings[0][2] = 0.;
    }
    settings
}
#[cfg(test)]
mod legacy_tests {
    use super::*;
    #[test]
    fn legacy_parameters_seed_untuned_settings() {
        let off = legacy_settings(Vec4::new(0., 0., 0., 0.));
        assert_eq!(off[0][1], 0.);
        assert_eq!(off[0][2], 0.);
        assert_eq!(off[1][1], 0.);
        let custom = legacy_settings(Vec4::new(2.5, 0.7, 0., 0.));
        assert_eq!(custom[2][0], 2.5);
        assert_eq!(custom[1][1], 0.7);
    }
}
