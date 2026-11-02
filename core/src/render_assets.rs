use crate::runtime::{CoreStore, SceneObject};
use crate::{VisualPhase, VisualSpec};
use bevy::asset::{LoadState, RecursiveDependencyLoadState, UntypedAssetId};
use bevy::gltf::GltfLoaderSettings;
use bevy::prelude::*;
use bevy::world_serialization::WorldInstanceReady;

#[derive(Resource)]
pub(crate) struct SharedVisuals {
    pub mesh: Handle<Mesh>,
}

// Resource representation must not select a different optical policy. This is
// the existing single-image fallback, not a substitute for source surface maps.
fn sphere_material(
    color: Option<[f32; 4]>,
    emissive: Option<[f32; 4]>,
    stellar: bool,
    stellar_gain: f32,
) -> StandardMaterial {
    StandardMaterial {
        unlit: stellar,
        base_color: color
            .map(|c| Color::srgba(c[0], c[1], c[2], c[3]))
            .unwrap_or(Color::WHITE),
        emissive: emissive
            .map(|c| {
                LinearRgba::new(
                    c[0] * stellar_gain,
                    c[1] * stellar_gain,
                    c[2] * stellar_gain,
                    c[3],
                )
            })
            .unwrap_or(LinearRgba::BLACK),
        metallic: 0.,
        perceptual_roughness: 0.9,
        ..default()
    }
}
#[derive(Component)]
pub(crate) struct AppliedVisual {
    revision: u64,
    root: Entity,
}
enum PendingAsset {
    Model(Handle<WorldAsset>),
    Texture(Handle<Image>),
}
impl PendingAsset {
    fn id(&self) -> UntypedAssetId {
        match self {
            Self::Model(handle) => handle.id().untyped(),
            Self::Texture(handle) => handle.id().untyped(),
        }
    }
}
#[derive(Component)]
pub(crate) struct VisualRoot {
    pub(crate) object: String,
    pub(crate) revision: u64,
    asset: PendingAsset,
    pub(crate) instance_ready: bool,
}
#[cfg(test)]
impl VisualRoot {
    pub(crate) fn joint_fixture(object: &str, revision: u64) -> Self {
        Self {
            object: object.into(),
            revision,
            asset: PendingAsset::Model(Handle::default()),
            instance_ready: true,
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn attach_visuals(
    mut commands: Commands,
    store: Res<CoreStore>,
    assets: Res<AssetServer>,
    shared: Res<SharedVisuals>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    query: Query<(Entity, &SceneObject, Option<&AppliedVisual>)>,
) {
    let Ok(mut core) = store.0.lock() else {
        return;
    };
    for (parent, object, applied) in &query {
        let assignment = core.visual_assignment(&object.id).cloned();
        let revision = assignment.as_ref().map_or(0, |visual| visual.revision);
        if applied.is_some_and(|old| old.revision == revision) {
            continue;
        }
        if let Some(old) = applied {
            commands.entity(old.root).despawn();
        }
        let spec = assignment.map_or(
            VisualSpec::Sphere {
                texture_asset: None,
                face_assets: None,
                ring_assets: None,
                ring_inner_radius_ratio: None,
                ring_outer_radius_ratio: None,
                color_rgba: None,
                emissive_rgba: None,
                stellar: None,
            },
            |visual| visual.spec,
        );
        core.record_visual_status(&object.id, revision, VisualPhase::Loading, None);
        let ring = match &spec {
            VisualSpec::Sphere {
                ring_assets: Some(ids),
                ring_inner_radius_ratio: Some(inner),
                ring_outer_radius_ratio: Some(outer),
                ..
            } => Some((ids.clone(), *inner as f32, *outer as f32)),
            _ => None,
        };
        let stellar = match &spec {
            VisualSpec::Sphere { stellar, .. } => stellar.clone(),
            _ => None,
        };
        let stellar_gain = match &spec {
            VisualSpec::Sphere {
                stellar: Some(s), ..
            } => 1.0 + s.corona_intensity * 0.6,
            _ => 1.0,
        };
        let root = match spec {
            VisualSpec::Sphere {
                face_assets: Some(face_assets),
                color_rgba,
                emissive_rgba,
                ..
            } => {
                let paths: Option<Vec<_>> = face_assets
                    .iter()
                    .map(|id| core.asset_descriptor(id).map(|asset| asset.path.clone()))
                    .collect();
                let Some(paths) = paths else {
                    continue;
                };
                let handles = std::array::from_fn(|i| assets.load::<Image>(paths[i].clone()));
                let material = materials.add(sphere_material(
                    color_rgba,
                    emissive_rgba,
                    stellar.is_some(),
                    stellar_gain,
                ));
                commands
                    .spawn((
                        Mesh3d(shared.mesh.clone()),
                        MeshMaterial3d(material.clone()),
                        Transform::default(),
                        Visibility::Hidden,
                        ChildOf(parent),
                        crate::face_texture::PendingFaces {
                            pixels: Vec::new(),
                            next_row: 0,
                            object: object.id.clone(),
                            revision,
                            handles,
                            material,
                        },
                    ))
                    .id()
            }

            VisualSpec::Model {
                asset_id, scene, ..
            } => {
                let Some(descriptor) = core.asset_descriptor(&asset_id) else {
                    continue;
                };
                let handle: Handle<WorldAsset> = assets
                    .load_builder()
                    .with_settings(|settings: &mut GltfLoaderSettings| {
                        settings.load_cameras = false;
                        settings.load_lights = false;
                    })
                    .load(
                        GltfAssetLabel::Scene(scene as usize).from_asset(descriptor.path.clone()),
                    );
                commands
                    .spawn((
                        WorldAssetRoot(handle.clone()),
                        Transform::default(),
                        Visibility::Hidden,
                        ChildOf(parent),
                        VisualRoot {
                            object: object.id.clone(),
                            revision,
                            asset: PendingAsset::Model(handle),
                            instance_ready: false,
                        },
                    ))
                    .id()
            }
            VisualSpec::Sphere {
                texture_asset: Some(asset_id),
                face_assets: _,
                ring_assets: _,
                ring_inner_radius_ratio: _,
                ring_outer_radius_ratio: _,
                color_rgba,
                emissive_rgba,
                ..
            } => {
                let Some(descriptor) = core.asset_descriptor(&asset_id) else {
                    continue;
                };
                let image: Handle<Image> = assets.load(descriptor.path.clone());
                let material = materials.add(StandardMaterial {
                    base_color_texture: Some(image.clone()),
                    emissive_texture: Some(image.clone()),
                    ..sphere_material(color_rgba, emissive_rgba, stellar.is_some(), stellar_gain)
                });
                commands
                    .spawn((
                        Mesh3d(shared.mesh.clone()),
                        MeshMaterial3d(material),
                        Transform::default(),
                        Visibility::Hidden,
                        ChildOf(parent),
                        VisualRoot {
                            object: object.id.clone(),
                            revision,
                            asset: PendingAsset::Texture(image),
                            instance_ready: true,
                        },
                    ))
                    .id()
            }
            VisualSpec::Sphere {
                texture_asset: None,
                face_assets: None,
                ring_assets: _,
                ring_inner_radius_ratio: _,
                ring_outer_radius_ratio: _,
                color_rgba,
                emissive_rgba,
                ..
            } => {
                core.record_visual_status(&object.id, revision, VisualPhase::Ready, None);
                commands
                    .spawn((
                        Mesh3d(shared.mesh.clone()),
                        MeshMaterial3d(materials.add(sphere_material(
                            color_rgba,
                            emissive_rgba,
                            stellar.is_some(),
                            stellar_gain,
                        ))),
                        Transform::default(),
                        ChildOf(parent),
                    ))
                    .id()
            }
        };
        if let Some(stellar) = stellar {
            commands
                .entity(root)
                .insert(crate::stellar_render::StellarEmitter {
                    source: object.id.clone(),
                    current_settings: [Vec4::ZERO; 19],
                    clock: 0.,
                    parameters: Vec4::new(stellar.corona_intensity, stellar.flow_speed, 0., 0.),
                });
        }
        if let Some((ids, inner, outer)) = ring {
            let Some(top_asset) = core.asset_descriptor(&ids[0]) else {
                continue;
            };
            let opacity_image = assets.load::<Image>(top_asset.path.clone());
            for (side, id) in ids.iter().enumerate() {
                let Some(asset) = core.asset_descriptor(id) else {
                    continue;
                };
                let image = assets.load::<Image>(asset.path.clone());
                commands.spawn((
                    ChildOf(root),
                    crate::ring_texture::PendingRing {
                        pixels: Vec::new(),
                        next_row: 0,
                        object: object.id.clone(),
                        revision,
                        image,
                        opacity_image: opacity_image.clone(),
                        inner,
                        outer,
                        bottom: side == 1,
                    },
                ));
            }
        }
        commands
            .entity(parent)
            .insert((Visibility::Inherited, AppliedVisual { revision, root }));
    }
}

pub(crate) fn world_ready(
    ready: On<WorldInstanceReady>,
    mut roots: Query<&mut VisualRoot>,
    store: Res<CoreStore>,
) {
    if let Ok(mut root) = roots.get_mut(ready.entity) {
        let Ok(core) = store.0.lock() else {
            return;
        };
        if core
            .visual_assignment(&root.object)
            .is_some_and(|visual| visual.revision == root.revision)
        {
            root.instance_ready = true;
        }
    }
}

pub(crate) fn poll_visuals(
    mut commands: Commands,
    store: Res<CoreStore>,
    assets: Res<AssetServer>,
    mut roots: Query<(Entity, &VisualRoot, &mut Visibility)>,
) {
    let Ok(mut core) = store.0.lock() else {
        return;
    };
    for (entity, root, mut visibility) in &mut roots {
        if core
            .visual_assignment(&root.object)
            .is_none_or(|visual| visual.revision != root.revision)
        {
            commands.entity(entity).despawn();
            continue;
        }
        let id = root.asset.id();
        let failure = match assets.get_load_state(id) {
            Some(LoadState::Failed(error)) => Some(error.to_string()),
            _ => match assets.get_recursive_dependency_load_state(id) {
                Some(RecursiveDependencyLoadState::Failed(error)) => Some(error.to_string()),
                _ => None,
            },
        };
        if let Some(error) = failure {
            *visibility = Visibility::Hidden;
            core.record_visual_status(
                &root.object,
                root.revision,
                VisualPhase::Failed,
                Some(error),
            );
        } else if root.instance_ready && assets.is_loaded_with_dependencies(id) {
            *visibility = Visibility::Inherited;
            core.record_visual_status(&root.object, root.revision, VisualPhase::Ready, None);
        }
    }
}

#[cfg(test)]
mod material_policy_tests {
    use super::*;
    use bevy::asset::AssetApp;
    use std::sync::{Arc, Mutex};

    #[test]
    fn sphere_asset_paths_keep_one_lit_material_policy() {
        let mut core = crate::Core::default();
        core.open_session_with_permissions(
            "s",
            "p",
            crate::SessionPermissions {
                visual_control: true,
                ..default()
            },
        )
        .unwrap();
        core.register_asset(
            "color",
            crate::AssetDescriptor {
                kind: crate::AssetKind::Texture,
                path: "test/color.png".into(),
            },
        )
        .unwrap();
        for (id, payload) in [
            ("plain", serde_json::json!({"kind":"sphere"})),
            (
                "image",
                serde_json::json!({"kind":"sphere","textureAsset":"color"}),
            ),
            (
                "faces",
                serde_json::json!({"kind":"sphere","faceAssets":["color","color","color","color","color","color"]}),
            ),
        ] {
            core.register_object("s", id).unwrap();
            core.set_visual(
                "s",
                "p",
                id,
                Some(serde_json::from_value(payload.clone()).unwrap()),
            )
            .unwrap();
            for stellar in [false, true] {
                let id = format!("{id}-{}", if stellar { "star" } else { "lit" });
                let mut payload = payload.clone();
                payload["colorRgba"] = serde_json::json!([0.2, 0.3, 0.4, 0.7]);
                payload["emissiveRgba"] = serde_json::json!([0.1, 0.2, 0.3, 0.4]);
                if stellar {
                    payload["stellar"] = serde_json::json!({"coronaIntensity":2.,"flowSpeed":0.5});
                }
                core.register_object("s", &id).unwrap();
                core.set_visual(
                    "s",
                    "p",
                    &id,
                    Some(serde_json::from_value(payload).unwrap()),
                )
                .unwrap();
            }
        }
        let ids: Vec<_> = core.object_ids().map(str::to_owned).collect();
        let mut app = App::new();
        app.add_plugins((MinimalPlugins, AssetPlugin::default()))
            .init_asset::<Image>()
            .init_resource::<Assets<StandardMaterial>>()
            .insert_resource(CoreStore(Arc::new(Mutex::new(core))))
            .insert_resource(SharedVisuals {
                mesh: Handle::default(),
            })
            .add_systems(Update, attach_visuals);
        for id in ids {
            app.world_mut().spawn(SceneObject { id });
        }
        app.update();
        let mut query = app.world_mut().query::<(&SceneObject, &AppliedVisual)>();
        let world = app.world();
        let materials = world.resource::<Assets<StandardMaterial>>();
        assert_eq!(materials.len(), 9);
        for (object, applied) in query.iter(world) {
            let handle = world
                .get::<MeshMaterial3d<StandardMaterial>>(applied.root)
                .unwrap();
            let material = materials.get(&handle.0).unwrap();
            let stellar = object.id.ends_with("-star");
            let explicit = stellar || object.id.ends_with("-lit");
            assert_eq!(material.unlit, stellar);
            assert_eq!(
                world
                    .get::<crate::stellar_render::StellarEmitter>(applied.root)
                    .is_some(),
                stellar
            );
            assert_eq!(
                material.base_color,
                if explicit {
                    Color::srgba(0.2, 0.3, 0.4, 0.7)
                } else {
                    Color::WHITE
                }
            );
            let gain = if stellar { 2.2 } else { 1. };
            assert_eq!(
                material.emissive,
                if explicit {
                    LinearRgba::new(0.1 * gain, 0.2 * gain, 0.3 * gain, 0.4)
                } else {
                    LinearRgba::BLACK
                }
            );
            if object.id.starts_with("image") {
                assert!(material.base_color_texture.is_some());
                assert_eq!(material.base_color_texture, material.emissive_texture);
            }
            assert_eq!(material.metallic, 0.);
            assert_eq!(
                material.perceptual_roughness, 0.9,
                "LOD/resource representation must not change surface roughness"
            );
        }
    }
}
