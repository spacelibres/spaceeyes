use crate::{CoreError, SharedCore, VisualSpec};
use bevy::math::DVec3;
use bevy::prelude::*;
use std::collections::{HashMap, HashSet};

/// Conjugate the scientific body-local -> ICRF rotation by the display basis B(x,y,z)=(x,z,-y).
pub(crate) fn display_rotation(orientation_wxyz: Option<[f64; 4]>) -> Quat {
    orientation_wxyz
        .map(|[w, x, y, z]| Quat::from_xyzw(x as f32, z as f32, -y as f32, w as f32))
        .unwrap_or(Quat::IDENTITY)
}

#[derive(Resource)]
pub struct CoreStore(pub SharedCore);

/// ICRF x/y/z to display x/z/-y, local origin subtracted in f64 before f32.
#[derive(Resource, Clone)]
pub struct DisplaySettings {
    pub(crate) origin_km: DVec3,
    pub(crate) units_per_km: f64,
}

impl DisplaySettings {
    pub fn new(origin_km: [f64; 3], units_per_km: f64) -> Result<Self, CoreError> {
        let origin_km = DVec3::from_array(origin_km);
        if !origin_km.is_finite() || !units_per_km.is_finite() || units_per_km <= 0.0 {
            return Err(CoreError::InvalidState);
        }
        Ok(Self {
            origin_km,
            units_per_km,
        })
    }
}

impl Default for DisplaySettings {
    fn default() -> Self {
        Self {
            origin_km: DVec3::ZERO,
            units_per_km: 1.0,
        }
    }
}

#[derive(Component)]
pub struct SceneObject {
    pub id: String,
}

#[derive(Resource, Default)]
pub struct SyncReport {
    pub visible: usize,
    pub unavailable: Vec<(String, CoreError)>,
    pub core_unavailable: bool,
}

pub struct CoreScenePlugin(pub SharedCore);
impl Plugin for CoreScenePlugin {
    fn build(&self, app: &mut App) {
        app.insert_resource(CoreStore(self.0.clone()))
            .init_resource::<DisplaySettings>()
            .init_resource::<SyncReport>()
            .add_systems(Update, sync_scene);
    }
}

pub fn create_headless_app(core: SharedCore) -> App {
    let mut app = App::new();
    app.add_plugins((MinimalPlugins, TransformPlugin, CoreScenePlugin(core)));
    app
}

pub(crate) fn sync_scene(
    store: Res<CoreStore>,
    settings: Res<DisplaySettings>,
    mut commands: Commands,
    mut query: Query<(Entity, &SceneObject, &mut Transform)>,
    mut report: ResMut<SyncReport>,
) {
    report.visible = 0;
    report.unavailable.clear();
    report.core_unavailable = false;
    let Ok(mut core) = store.0.lock() else {
        report.core_unavailable = true;
        for (entity, _, _) in &query {
            commands.entity(entity).despawn();
        }
        return;
    };
    let existing: HashMap<String, Entity> = query
        .iter()
        .map(|(entity, object, _)| (object.id.clone(), entity))
        .collect();
    let mut visible = HashSet::new();
    let ids: Vec<String> = core.object_ids().map(str::to_owned).collect();
    for id in &ids {
        let state = match core.object_state_at(id, core.clock().epoch()) {
            Ok(state) => state,
            Err(error) => {
                core.suspend_visual(id, format!("{error:?}"));
                report.unavailable.push((id.to_owned(), error));
                continue;
            }
        };
        let relative =
            (DVec3::from_array(state.position_km) - settings.origin_km) * settings.units_per_km;
        let translation = DVec3::new(relative.x, relative.z, -relative.y).as_vec3();
        let scale_km = match core.visual_assignment(id).map(|visual| &visual.spec) {
            Some(VisualSpec::Model {
                scale_km_per_unit, ..
            }) => *scale_km_per_unit,
            _ => state.radius_km,
        };
        let radius = (scale_km * settings.units_per_km) as f32;
        if !translation.is_finite() || !radius.is_finite() || radius <= 0.0 {
            core.suspend_visual(id, "InvalidState: display transform".into());
            report
                .unavailable
                .push((id.to_owned(), CoreError::InvalidState));
            continue;
        }
        let rotation = display_rotation(state.orientation_wxyz);
        let transform = Transform::from_translation(translation)
            .with_rotation(rotation)
            .with_scale(Vec3::splat(radius));
        if let Some(entity) = existing.get(id) {
            if let Ok((_, _, mut current)) = query.get_mut(*entity) {
                *current = transform;
            }
        } else {
            commands.spawn((SceneObject { id: id.to_owned() }, transform));
        }
        visible.insert(id.to_owned());
        report.visible += 1;
    }
    for (id, entity) in existing {
        if !visible.contains(&id) {
            commands.entity(entity).despawn();
        }
    }
}
