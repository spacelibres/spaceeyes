use bevy::{
    prelude::*,
    render::render_resource::{AsBindGroup, Face},
    shader::ShaderRef,
};
#[derive(Asset, AsBindGroup, TypePath, Debug, Clone)]
pub(crate) struct StellarMaterial {
    #[uniform(0)]
    pub parameters: Vec4,
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
pub(crate) fn prominence_mesh() -> Mesh {
    use bevy::{
        asset::RenderAssetUsages, mesh::Indices, render::render_resource::PrimitiveTopology,
    };
    let mut positions = Vec::<[f32; 3]>::new();
    let mut normals = Vec::<[f32; 3]>::new();
    let mut uvs = Vec::<[f32; 2]>::new();
    let mut indices = Vec::<u32>::new();
    for arch in 0..24 {
        let z = 1.0 - 2.0 * (arch as f32 + 0.5) / 24.;
        let angle = arch as f32 * 2.399963;
        let n = Vec3::new(
            (1. - z * z).sqrt() * angle.cos(),
            z,
            (1. - z * z).sqrt() * angle.sin(),
        );
        let tangent = n.any_orthonormal_vector();
        let binormal = n.cross(tangent);
        let spread = 0.035 + (arch % 5) as f32 * 0.013;
        let height = 0.07 + (arch % 7) as f32 * 0.025;
        for strand in 0..5 {
            let base = positions.len() as u32;
            let lane = (strand as f32 - 2.) * 0.009;
            for step in 0..=48 {
                let t = step as f32 / 48.;
                let a = (t * 2. - 1.) * spread;
                let foot = (n + tangent * a + binormal * lane).normalize();
                let center = foot * (0.998 + height * (std::f32::consts::PI * t).sin());
                let width = 0.003 + 0.009 * (std::f32::consts::PI * t).sin();
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
    pub parameters: Vec4,
}
struct ActivePlasma {
    root: Entity,
    mesh: Handle<Mesh>,
    volume: Handle<StellarMaterial>,
    arches: Handle<ProminenceMaterial>,
}
#[derive(Resource, Default)]
pub(crate) struct StellarLod(std::collections::HashMap<Entity, ActivePlasma>);

fn plasma_near(distance: f32, active: bool) -> bool {
    distance.is_finite() && distance >= 0. && distance < if active { 10. } else { 8. }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn sync_stellar_lod(
    mut commands: Commands,
    emitters: Query<(Entity, &GlobalTransform, &StellarEmitter)>,
    cameras: Query<&GlobalTransform, With<crate::renderer::DisplayCamera>>,
    shared: Res<crate::render_assets::SharedVisuals>,
    mut state: ResMut<StellarLod>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut volumes: ResMut<Assets<StellarMaterial>>,
    mut arches: ResMut<Assets<ProminenceMaterial>>,
) {
    let camera = cameras.iter().next().map(GlobalTransform::translation);
    let mut retained = std::collections::HashSet::new();
    for (entity, transform, emitter) in &emitters {
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
        if !plasma_near(distance, state.0.contains_key(&entity)) {
            continue;
        }
        retained.insert(entity);
        let active = state.0.entry(entity).or_insert_with(|| {
            let mesh = meshes.add(prominence_mesh());
            let volume = volumes.add(StellarMaterial {
                parameters: emitter.parameters,
            });
            let material = arches.add(ProminenceMaterial {
                parameters: emitter.parameters,
            });
            let root = commands
                .spawn((Transform::default(), Visibility::Inherited, ChildOf(entity)))
                .id();
            commands.spawn((
                Mesh3d(mesh.clone()),
                MeshMaterial3d(material.clone()),
                Transform::default(),
                ChildOf(root),
            ));
            commands.spawn((
                Mesh3d(shared.mesh.clone()),
                MeshMaterial3d(volume.clone()),
                Transform::from_scale(Vec3::splat(12.)),
                ChildOf(root),
            ));
            ActivePlasma {
                root,
                mesh,
                volume,
                arches: material,
            }
        });
        let mut parameters = emitter.parameters;
        parameters.x *= ((10. - distance) / 4.).clamp(0., 1.);
        if let Some(mut material) = volumes.get_mut(&active.volume) {
            material.parameters = parameters;
        }
        if let Some(mut material) = arches.get_mut(&active.arches) {
            material.parameters = parameters;
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
