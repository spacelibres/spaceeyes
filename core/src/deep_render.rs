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
        -2e30
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
pub(crate) fn sync_environment(
    mut commands: Commands,
    store: Res<CoreStore>,
    server: Res<AssetServer>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<GalaxyMaterial>>,
    mut existing: Query<(Entity, &GalaxyLayer, &mut Visibility)>,
) {
    let Ok(mut core) = store.0.lock() else { return };
    let wanted = core
        .environment
        .as_ref()
        .map(|e| (e.spec.asset_id.clone(), e.spec.intensity, e.revision));
    let replacement_ready = existing.iter().any(|(_, l, _)| {
        wanted
            .as_ref()
            .is_some_and(|w| w.0 == l.key && w.2 == l.revision)
            && matches!(
                server.load_state(l.image.id()),
                bevy::asset::LoadState::Loaded
            )
    });
    for (entity, layer, mut visibility) in &mut existing {
        if wanted
            .as_ref()
            .is_none_or(|w| w.0 != layer.key || w.2 != layer.revision)
        {
            if wanted.is_some() && !replacement_ready {
                continue;
            }
            commands.entity(entity).despawn();
            meshes.remove(layer.mesh.id());
            materials.remove(layer.material.id());
            continue;
        }
        *visibility = if matches!(
            server.load_state(layer.image.id()),
            bevy::asset::LoadState::Loaded
        ) {
            Visibility::Inherited
        } else {
            Visibility::Hidden
        };
        if let Some(mut m) = materials.get_mut(&layer.material) {
            m.intensity = Vec4::new(wanted.as_ref().unwrap().1, 0.0, 0.0, 0.0);
        }
        core.environment_status = match server.load_state(layer.image.id()) {
            bevy::asset::LoadState::Loaded => serde_json::json!({"phase":"ready"}),
            bevy::asset::LoadState::Failed(e) => {
                serde_json::json!({"phase":"failed","detail":e.to_string()})
            }
            _ => serde_json::json!({"phase":"pending"}),
        };
    }
    if let Some((key, intensity, revision)) = wanted {
        if existing
            .iter()
            .any(|(_, l, _)| l.key == key && l.revision == revision)
        {
            return;
        }
        let Some(asset) = core.asset_descriptor(&key) else {
            return;
        };
        let image = server.load::<Image>(asset.path.clone());
        if matches!(
            server.load_state(image.id()),
            bevy::asset::LoadState::Failed(_)
        ) {
            server.reload(asset.path.clone());
        }
        let mesh = meshes.add(Rectangle::new(2.0, 2.0));
        let material = materials.add(GalaxyMaterial {
            image: image.clone(),
            intensity: Vec4::new(intensity, 0.0, 0.0, 0.0),
        });
        commands.spawn((
            Mesh3d(mesh.clone()),
            MeshMaterial3d(material.clone()),
            Transform::default(),
            NoFrustumCulling,
            Visibility::Hidden,
            GalaxyLayer {
                key,
                revision,
                mesh,
                material,
                image,
            },
        ));
    }
}
