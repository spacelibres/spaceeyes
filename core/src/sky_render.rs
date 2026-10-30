use crate::runtime::{CoreStore, DisplaySettings};
use bevy::{
    asset::RenderAssetUsages,
    camera::visibility::NoFrustumCulling,
    mesh::Indices,
    prelude::*,
    render::render_resource::{AsBindGroup, PrimitiveTopology},
    shader::ShaderRef,
};
#[derive(Asset, AsBindGroup, TypePath, Debug, Clone)]
pub(crate) struct SkyMaterial {
    #[uniform(0)]
    observer: Vec4,
}
impl Material for SkyMaterial {
    fn vertex_shader() -> ShaderRef {
        "shaders/starfield.wgsl".into()
    }
    fn fragment_shader() -> ShaderRef {
        "shaders/starfield.wgsl".into()
    }
    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Add
    }
    // Bevy adds this only to transparent sorting distance. Render sky before
    // transparent rings so their opacity attenuates the existing background.
    fn depth_bias(&self) -> f32 {
        1e30
    }
    fn enable_prepass() -> bool {
        false
    }
    fn enable_shadows() -> bool {
        false
    }
}
#[derive(Component)]
pub(crate) struct SkyLayer {
    key: (String, String),
    revision: u64,
    mesh: Handle<Mesh>,
    material: Handle<SkyMaterial>,
}
pub(crate) fn sync_sky(
    mut commands: Commands,
    store: Res<CoreStore>,
    settings: Res<DisplaySettings>,
    cameras: Query<&Transform, With<crate::renderer::DisplayCamera>>,
    existing: Query<(Entity, &SkyLayer)>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<SkyMaterial>>,
) {
    let Ok(core) = store.0.lock() else { return };
    let Ok(camera) = cameras.single() else { return };
    let t = camera.translation.as_dvec3() / settings.units_per_km;
    let p = settings.origin_km + bevy::math::DVec3::new(t.x, -t.z, t.y);
    let observer = Vec4::new(
        (p.x * 1e-13) as f32,
        (p.z * 1e-13) as f32,
        (-p.y * 1e-13) as f32,
        0.0,
    );
    for (entity, layer) in &existing {
        if core
            .starfields
            .get(&layer.key)
            .is_none_or(|v| v.revision != layer.revision)
        {
            commands.entity(entity).despawn();
            meshes.remove(layer.mesh.id());
            materials.remove(layer.material.id());
        } else if let Some(mut m) = materials.get_mut(&layer.material) {
            m.observer = observer;
        }
    }
    for (key, layer) in &core.starfields {
        if existing
            .iter()
            .any(|(_, old)| old.key == *key && old.revision == layer.revision)
        {
            continue;
        }
        let mut positions = Vec::new();
        let mut colors = Vec::new();
        let mut uv = Vec::new();
        let mut indices = Vec::new();
        for (i, p) in layer.spec.positions_km.chunks_exact(3).enumerate() {
            let pos = [
                (p[0] * 1e-13) as f32,
                (p[2] * 1e-13) as f32,
                (-p[1] * 1e-13) as f32,
            ];
            let lum = (301.28f64.ln()
                - 0.4 * layer.spec.absolute_magnitudes[i] as f64 * std::f64::consts::LN_10)
                .clamp(-1e30, 1e30) as f32;
            let c = &layer.spec.colors_rgb[i * 3..i * 3 + 3];
            for corner in [[0., 0.], [1., 0.], [1., 1.], [0., 1.]] {
                positions.push(pos);
                colors.push([c[0], c[1], c[2], lum]);
                uv.push(corner);
            }
            let b = i as u32 * 4;
            indices.extend([b, b + 1, b + 2, b, b + 2, b + 3]);
        }
        let mut mesh = Mesh::new(
            PrimitiveTopology::TriangleList,
            RenderAssetUsages::default(),
        );
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
        mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, colors);
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uv);
        mesh.insert_indices(Indices::U32(indices));
        let mesh = meshes.add(mesh);
        let material = materials.add(SkyMaterial { observer });
        commands.spawn((
            Mesh3d(mesh.clone()),
            MeshMaterial3d(material.clone()),
            Transform::default(),
            NoFrustumCulling,
            SkyLayer {
                key: key.clone(),
                revision: layer.revision,
                mesh,
                material,
            },
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_layers_are_batched_and_assets_released() {
        let shared = std::sync::Arc::new(std::sync::Mutex::new(crate::Core::default()));
        {
            let mut c = shared.lock().unwrap();
            c.open_session_with_permissions(
                "s",
                "p",
                crate::SessionPermissions {
                    visual_control: true,
                    ..default()
                },
            )
            .unwrap();
            c.set_starfield(
                "p",
                "s",
                "a",
                Some(crate::StarfieldSpec {
                    frame: "ICRF".into(),
                    source: "test".into(),
                    positions_km: vec![1e13; 30],
                    colors_rgb: vec![1.; 30],
                    magnitudes: vec![1.; 10],
                    absolute_magnitudes: vec![1.; 10],
                }),
            )
            .unwrap();
        }
        let mut app = App::new();
        app.insert_resource(CoreStore(shared.clone()))
            .insert_resource(DisplaySettings::default())
            .insert_resource(Assets::<Mesh>::default())
            .insert_resource(Assets::<SkyMaterial>::default())
            .add_systems(Update, sync_sky);
        app.world_mut()
            .spawn((crate::renderer::DisplayCamera, Transform::default()));
        app.update();
        assert_eq!(
            app.world_mut()
                .query::<&SkyLayer>()
                .iter(app.world())
                .count(),
            1
        );
        let meshes = app.world().resource::<Assets<Mesh>>();
        assert_eq!(meshes.len(), 1);
        assert_eq!(meshes.iter().next().unwrap().1.count_vertices(), 40);
        shared.lock().unwrap().release_session("s");
        app.update();
        assert_eq!(app.world().resource::<Assets<Mesh>>().len(), 0);
        assert_eq!(app.world().resource::<Assets<SkyMaterial>>().len(), 0);
    }
}
