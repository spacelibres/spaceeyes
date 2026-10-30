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
    object: String,
    revision: u64,
    asset: PendingAsset,
    instance_ready: bool,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn attach_visuals(
    mut commands: Commands,
    store: Res<CoreStore>,
    assets: Res<AssetServer>,
    shared: Res<SharedVisuals>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut stellar_materials: ResMut<Assets<crate::stellar_render::StellarMaterial>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut prominence_materials: ResMut<Assets<crate::stellar_render::ProminenceMaterial>>,
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
                let material = materials.add(StandardMaterial {
                    unlit: stellar.is_some(),
                    base_color: color_rgba
                        .map(|c| Color::srgba(c[0], c[1], c[2], c[3]))
                        .unwrap_or(Color::WHITE),
                    emissive: emissive_rgba
                        .map(|c| {
                            LinearRgba::new(
                                c[0] * stellar_gain,
                                c[1] * stellar_gain,
                                c[2] * stellar_gain,
                                c[3],
                            )
                        })
                        .unwrap_or(LinearRgba::BLACK),
                    ..default()
                });
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
                    unlit: stellar.is_some(),
                    base_color_texture: Some(image.clone()),
                    emissive_texture: Some(image.clone()),
                    base_color: color_rgba
                        .map(|c| Color::srgba(c[0], c[1], c[2], c[3]))
                        .unwrap_or(Color::WHITE),
                    emissive: emissive_rgba
                        .map(|c| {
                            LinearRgba::new(
                                c[0] * stellar_gain,
                                c[1] * stellar_gain,
                                c[2] * stellar_gain,
                                c[3],
                            )
                        })
                        .unwrap_or(LinearRgba::BLACK),
                    perceptual_roughness: 0.9,
                    ..default()
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
                        MeshMaterial3d(
                            materials.add(StandardMaterial {
                                unlit: stellar.is_some(),
                                base_color: color_rgba
                                    .map(|c| Color::srgba(c[0], c[1], c[2], c[3]))
                                    .unwrap_or(Color::WHITE),
                                emissive: emissive_rgba
                                    .map(|c| {
                                        LinearRgba::new(
                                            c[0] * stellar_gain,
                                            c[1] * stellar_gain,
                                            c[2] * stellar_gain,
                                            c[3],
                                        )
                                    })
                                    .unwrap_or(LinearRgba::BLACK),
                                ..default()
                            }),
                        ),
                        Transform::default(),
                        ChildOf(parent),
                    ))
                    .id()
            }
        };
        if let Some(stellar) = stellar.filter(|s| s.corona_intensity > 0.0) {
            commands.spawn((
                Mesh3d(meshes.add(crate::stellar_render::prominence_mesh())),
                MeshMaterial3d(prominence_materials.add(
                    crate::stellar_render::ProminenceMaterial {
                        parameters: Vec4::new(stellar.corona_intensity, stellar.flow_speed, 0., 0.),
                    },
                )),
                Transform::default(),
                ChildOf(root),
            ));
            commands.spawn((
                Mesh3d(shared.mesh.clone()),
                MeshMaterial3d(
                    stellar_materials.add(crate::stellar_render::StellarMaterial {
                        parameters: Vec4::new(
                            stellar.corona_intensity,
                            stellar.flow_speed,
                            0.0,
                            0.0,
                        ),
                    }),
                ),
                Transform::from_scale(Vec3::splat(2.8)),
                ChildOf(root),
            ));
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
