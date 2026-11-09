//! Per-object solar sample; display coordinates use B(x,y,z)=(x,z,-y).
use crate::{
    VisualSpec,
    runtime::{CoreStore, SceneObject},
};
use bevy::{
    math::DVec3,
    pbr::{ExtendedMaterial, MaterialExtension},
    prelude::*,
    render::render_resource::AsBindGroup,
    shader::ShaderRef,
};
use std::collections::{HashMap, HashSet};

pub(crate) fn solar_direction(sun: DVec3, body: DVec3) -> Option<Vec3> {
    let d = (sun - body).try_normalize()?;
    Some(Vec3::new(d.x as f32, d.z as f32, -d.y as f32))
}

pub(crate) type SolarMaterial = ExtendedMaterial<StandardMaterial, SolarSample>;
#[derive(Asset, AsBindGroup, Reflect, Debug, Clone)]
pub(crate) struct SolarSample {
    #[uniform(100)]
    pub direction: Vec4,
}
impl MaterialExtension for SolarSample {
    fn fragment_shader() -> ShaderRef {
        "shaders/solar-material.wgsl".into()
    }
}
#[derive(Clone, Copy, Hash, PartialEq, Eq)]
struct Key {
    owner: Entity,
    revision: u64,
    source: AssetId<StandardMaterial>,
}
#[derive(Component)]
pub(crate) struct SolarBinding {
    key: Key,
    body: String,
    source: Handle<StandardMaterial>,
}
#[derive(Resource, Default)]
pub(crate) struct SolarMaterials {
    owned: HashMap<Key, Handle<SolarMaterial>>,
}

pub(crate) fn sample(core: &crate::Core, id: &str) -> Vec4 {
    let epoch = core.clock().epoch();
    let Some(direction) = core
        .object_state_at("sun", epoch)
        .ok()
        .zip(core.object_state_at(id, epoch).ok())
        .and_then(|(sun, body)| {
            solar_direction(
                DVec3::from_array(sun.position_km),
                DVec3::from_array(body.position_km),
            )
        })
    else {
        return Vec4::ZERO;
    };
    direction.extend(1.)
}

/// One extension per (object revision, original material). Source maps and all
/// StandardMaterial fields remain authoritative, including asynchronous faces.
#[allow(clippy::too_many_arguments)]
pub(crate) fn sync_solar_materials(
    mut commands: Commands,
    store: Res<CoreStore>,
    sources: Res<Assets<StandardMaterial>>,
    mut materials: ResMut<Assets<SolarMaterial>>,
    mut events: MessageReader<AssetEvent<StandardMaterial>>,
    original: Query<(Entity, &MeshMaterial3d<StandardMaterial>)>,
    bound: Query<&SolarBinding>,
    hierarchy: Query<(Option<&ChildOf>, Option<&SceneObject>)>,
    mut cache: ResMut<SolarMaterials>,
) {
    let Ok(core) = store.0.lock() else {
        return;
    };
    let dirty: HashSet<_> = events
        .read()
        .filter_map(|event| match event {
            AssetEvent::Added { id }
            | AssetEvent::Modified { id }
            | AssetEvent::LoadedWithDependencies { id } => Some(*id),
            _ => None,
        })
        .collect();
    let mut active = HashSet::new();
    let mut directions = HashMap::new();
    for binding in &bound {
        active.insert(binding.key);
        let direction = *directions
            .entry(binding.body.as_str())
            .or_insert_with(|| sample(&core, &binding.body));
        if let Some(handle) = cache.owned.get(&binding.key)
            && let Some(mut material) = materials.get_mut(handle)
        {
            if material.extension.direction != direction {
                material.extension.direction = direction;
            }
            if dirty.contains(&binding.source.id())
                && let Some(source) = sources.get(&binding.source)
            {
                material.base = source.clone();
            }
        }
    }
    for (entity, handle) in &original {
        let Some(source) = sources.get(&handle.0) else {
            continue;
        };
        if source.unlit {
            continue;
        }
        let mut current = Some(entity);
        let mut owner = None;
        for _ in 0..128 {
            let Some(entity) = current else {
                break;
            };
            let Ok((parent, object)) = hierarchy.get(entity) else {
                break;
            };
            if let Some(object) = object {
                owner = Some((entity, object));
                break;
            }
            current = parent.map(ChildOf::parent);
        }
        let Some((owner, object)) = owner else {
            continue;
        };
        // Never attach to the procedural Sun's self-emissive surface.
        if core.visual_assignment(&object.id).is_some_and(|a| {
            matches!(
                a.spec,
                VisualSpec::Sphere {
                    stellar: Some(_),
                    ..
                }
            )
        }) {
            continue;
        }
        let revision = core.visual_assignment(&object.id).map_or(0, |a| a.revision);
        let key = Key {
            owner,
            revision,
            source: handle.0.id(),
        };
        active.insert(key);
        let direction = *directions
            .entry(object.id.as_str())
            .or_insert_with(|| sample(&core, &object.id));
        let material = cache
            .owned
            .entry(key)
            .or_insert_with(|| {
                materials.add(SolarMaterial {
                    base: source.clone(),
                    extension: SolarSample { direction },
                })
            })
            .clone();
        commands
            .entity(entity)
            .remove::<MeshMaterial3d<StandardMaterial>>()
            .insert((
                MeshMaterial3d(material),
                SolarBinding {
                    key,
                    body: object.id.clone(),
                    source: handle.0.clone(),
                },
            ));
    }
    cache.owned.retain(|key, handle| {
        if active.contains(key) {
            true
        } else {
            materials.remove(handle.id());
            false
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_source_maps_remain_isolated_per_body_and_owned_assets_are_released() {
        let mut core = crate::Core::default();
        core.open_session_with_permissions("s", "p", crate::SessionPermissions::default())
            .unwrap();
        for (id, x) in [("sun", 0.), ("earth", 1e8), ("mars", -1e8)] {
            core.register_object("s", id).unwrap();
            core.set_object_state(
                "s",
                id,
                crate::ObjectState {
                    position_km: [x, 0., 0.],
                    radius_km: 1.,
                    epoch_tdb_seconds: 0.,
                    coverage_tdb_seconds: [0., 1.],
                    orientation_wxyz: None,
                    frame: "ICRF".into(),
                    source: "lighting fixture".into(),
                },
            )
            .unwrap();
        }
        let mut app = App::new();
        app.insert_resource(CoreStore(std::sync::Arc::new(std::sync::Mutex::new(core))))
            .init_resource::<Assets<StandardMaterial>>()
            .init_resource::<Assets<SolarMaterial>>()
            .init_resource::<SolarMaterials>()
            .add_message::<AssetEvent<StandardMaterial>>()
            .add_systems(Update, sync_solar_materials);
        let source = app
            .world_mut()
            .resource_mut::<Assets<StandardMaterial>>()
            .add(StandardMaterial {
                metallic: 0.68,
                perceptual_roughness: 0.37,
                alpha_mode: AlphaMode::Blend,
                normal_map_texture: Some(Handle::default()),
                double_sided: true,
                ..default()
            });
        let earth = app
            .world_mut()
            .spawn((
                SceneObject { id: "earth".into() },
                MeshMaterial3d(source.clone()),
            ))
            .id();
        let mars = app
            .world_mut()
            .spawn((
                SceneObject { id: "mars".into() },
                MeshMaterial3d(source.clone()),
            ))
            .id();
        app.update();
        let a = app
            .world()
            .get::<MeshMaterial3d<SolarMaterial>>(earth)
            .unwrap()
            .0
            .clone();
        let b = app
            .world()
            .get::<MeshMaterial3d<SolarMaterial>>(mars)
            .unwrap()
            .0
            .clone();
        assert_ne!(a.id(), b.id());
        let assets = app.world().resource::<Assets<SolarMaterial>>();
        assert_eq!(
            assets.get(&a).unwrap().extension.direction,
            -Vec3::X.extend(-1.)
        );
        assert_eq!(
            assets.get(&b).unwrap().extension.direction,
            Vec3::X.extend(1.)
        );
        for material in [assets.get(&a).unwrap(), assets.get(&b).unwrap()] {
            assert_eq!(material.base.metallic, 0.68);
            assert_eq!(material.base.perceptual_roughness, 0.37);
            assert_eq!(material.base.alpha_mode, AlphaMode::Blend);
            assert!(material.base.double_sided);
            assert!(material.base.normal_map_texture.is_some());
        }
        app.world_mut()
            .resource_mut::<Assets<StandardMaterial>>()
            .get_mut(&source)
            .unwrap()
            .perceptual_roughness = 0.19;
        app.world_mut()
            .write_message(AssetEvent::<StandardMaterial>::Modified { id: source.id() });
        app.update();
        assert_eq!(
            app.world()
                .resource::<Assets<SolarMaterial>>()
                .get(&a)
                .unwrap()
                .base
                .perceptual_roughness,
            0.19
        );
        app.world_mut().entity_mut(earth).despawn();
        app.update();
        assert_eq!(app.world().resource::<Assets<SolarMaterial>>().len(), 1);
        app.world_mut().entity_mut(mars).despawn();
        app.update();
        assert_eq!(app.world().resource::<Assets<SolarMaterial>>().len(), 0);
        assert!(app.world().resource::<SolarMaterials>().owned.is_empty());
    }
    #[test]
    fn opposite_bodies_receive_opposite_sunlight_without_a_camera_origin() {
        let sun = DVec3::new(1e8, 2e8, 0.);
        assert!(
            solar_direction(sun, sun + DVec3::X * 1e8)
                .unwrap()
                .distance(-Vec3::X)
                < 1e-6
        );
        assert!(
            solar_direction(sun, sun - DVec3::X * 1e8)
                .unwrap()
                .distance(Vec3::X)
                < 1e-6
        );
        assert!(solar_direction(sun, sun).is_none());
    }
    #[test]
    fn scientific_subtraction_precedes_f32_and_is_translation_invariant() {
        let body = DVec3::new(3e8, -2e8, 7e7);
        let sun = body + DVec3::new(0.01, -0.02, 0.03);
        let a = solar_direction(sun, body).unwrap();
        let b = solar_direction(sun - body, DVec3::ZERO).unwrap();
        assert!(a.distance(b) < 1e-6);
    }
}
