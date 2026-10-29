use crate::runtime::{CoreStore, SceneObject};
use crate::{VisualPhase, VisualSpec};
use bevy::asset::{LoadState, RecursiveDependencyLoadState, UntypedAssetId};
use bevy::gltf::GltfLoaderSettings;
use bevy::prelude::*;
use bevy::world_serialization::WorldInstanceReady;

#[derive(Resource)]
pub(crate) struct SharedVisuals {
    pub mesh: Handle<Mesh>,
    pub material: Handle<StandardMaterial>,
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
            },
            |visual| visual.spec,
        );
        core.record_visual_status(&object.id, revision, VisualPhase::Loading, None);
        let root = match spec {
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
            } => {
                let Some(descriptor) = core.asset_descriptor(&asset_id) else {
                    continue;
                };
                let image: Handle<Image> = assets.load(descriptor.path.clone());
                let material = materials.add(StandardMaterial {
                    base_color_texture: Some(image.clone()),
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
            } => {
                core.record_visual_status(&object.id, revision, VisualPhase::Ready, None);
                commands
                    .spawn((
                        Mesh3d(shared.mesh.clone()),
                        MeshMaterial3d(shared.material.clone()),
                        Transform::default(),
                        ChildOf(parent),
                    ))
                    .id()
            }
        };
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
