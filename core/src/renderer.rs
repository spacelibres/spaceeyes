//! Built-in Bevy rendering with resources resolved through the host catalog.
use crate::render_assets::{SharedVisuals, attach_visuals, poll_visuals, world_ready};
use crate::runtime::SceneObject;
use crate::runtime::{CoreScenePlugin, CoreStore, DisplaySettings, sync_scene};
use crate::{SharedCore, VisualPhase, VisualSpec};
use bevy::asset::AssetMetaCheck;
use bevy::camera::primitives::Aabb;
use bevy::input::mouse::{AccumulatedMouseMotion, MouseScrollUnit, MouseWheel};
use bevy::math::DVec3;
use bevy::prelude::*;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

#[derive(Resource)]
struct RendererStop(Arc<AtomicBool>);
#[derive(Component)]
struct DisplayCamera;
type FramingNodes<'w, 's> = Query<
    'w,
    's,
    (
        &'static Transform,
        Option<&'static Children>,
        Option<&'static Aabb>,
    ),
    Without<DisplayCamera>,
>;
#[derive(Resource)]
struct OrbitView {
    target: Option<String>,
    yaw: f32,
    pitch: f32,
    distance: f32,
}
impl Default for OrbitView {
    fn default() -> Self {
        Self {
            target: None,
            yaw: 0.0,
            pitch: 0.0,
            distance: 4.0,
        }
    }
}

pub(crate) fn create_browser_app(core: SharedCore, stop: Arc<AtomicBool>, canvas: &str) -> App {
    let mut app = App::new();
    app.add_plugins(
        DefaultPlugins
            .set(AssetPlugin {
                // Host catalogs contain source assets, not Bevy processor sidecars.
                meta_check: AssetMetaCheck::Never,
                ..default()
            })
            .set(WindowPlugin {
                primary_window: Some(Window {
                    title: "SpaceEyes core verification — synthetic geometry".into(),
                    canvas: Some(canvas.into()),
                    fit_canvas_to_parent: true,
                    ..default()
                }),
                ..default()
            }),
    )
    .add_plugins(CoreScenePlugin(core))
    .insert_resource(RendererStop(stop))
    .init_resource::<OrbitView>()
    .add_systems(Startup, setup)
    .add_systems(
        Update,
        (orbit_input, update_focus).chain().before(sync_scene),
    )
    .add_systems(
        Update,
        (attach_visuals, poll_visuals).chain().after(sync_scene),
    )
    .add_observer(world_ready)
    .add_systems(Update, stop_renderer);
    app
}

fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    commands.insert_resource(SharedVisuals {
        mesh: meshes.add(Sphere::new(1.0)),
        material: materials.add(StandardMaterial {
            perceptual_roughness: 0.9,
            ..default()
        }),
    });
    commands.spawn((
        Camera3d::default(),
        DisplayCamera,
        Transform::from_xyz(0.0, 0.0, 4.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
    commands.spawn((
        DirectionalLight {
            illuminance: 10_000.0,
            shadow_maps_enabled: true,
            ..default()
        },
        Transform::from_xyz(4.0, 4.0, 8.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
}

fn update_focus(
    store: Res<CoreStore>,
    mut settings: ResMut<DisplaySettings>,
    mut orbit: ResMut<OrbitView>,
    mut camera: Query<(&mut Transform, &mut Projection), With<DisplayCamera>>,
    objects: Query<(Entity, &SceneObject)>,
    nodes: FramingNodes,
) {
    let Ok(core) = store.0.lock() else {
        return;
    };
    let Some(id) = core.focused_object() else {
        return;
    };
    let Ok(state) = core.object_state_at(id, core.clock().epoch()) else {
        return;
    };
    settings.origin_km = DVec3::from_array(state.position_km);
    settings.units_per_km = 1.0 / state.radius_km;
    if orbit.target.as_deref() != Some(id) {
        *orbit = OrbitView {
            target: Some(id.to_owned()),
            ..default()
        };
    }
    let mut center = Vec3::ZERO;
    let mut radius = 1.0;
    if let Some(assignment) = core.visual_assignment(id)
        && let VisualSpec::Model {
            scale_km_per_unit, ..
        } = assignment.spec
        && core.visual_status(id).ok().flatten().is_some_and(|status| {
            status.revision == assignment.revision && status.phase == VisualPhase::Ready
        })
        && let Some((entity, _)) = objects.iter().find(|(_, object)| object.id == id)
        && let Ok((_, Some(children), _)) = nodes.get(entity)
    {
        let scale = (scale_km_per_unit * settings.units_per_km) as f32;
        let mut stack: Vec<_> = children
            .iter()
            .map(|child| (child, Mat4::from_scale(Vec3::splat(scale))))
            .collect();
        let mut min = Vec3::splat(f32::INFINITY);
        let mut max = Vec3::splat(f32::NEG_INFINITY);
        while let Some((entity, parent)) = stack.pop() {
            let Ok((transform, children, bounds)) = nodes.get(entity) else {
                continue;
            };
            let matrix = parent * transform.to_matrix();
            if let Some(bounds) = bounds {
                let (lo, hi) = transformed_bounds(bounds, matrix);
                min = min.min(lo);
                max = max.max(hi);
            }
            if let Some(children) = children {
                stack.extend(children.iter().map(|child| (child, matrix)));
            }
        }
        if min.is_finite() && max.is_finite() {
            center = (min + max) * 0.5;
            radius = ((max - min).length() * 0.5).max(1e-7);
        }
    }
    for (mut transform, mut projection) in &mut camera {
        if let Projection::Perspective(p) = &mut *projection {
            p.near = (radius * 0.01).max(1e-9);
        }
        let position = Quat::from_rotation_y(orbit.yaw)
            * Quat::from_rotation_x(orbit.pitch)
            * Vec3::new(0.0, 0.0, orbit.distance * radius);
        *transform = Transform::from_translation(center + position).looking_at(center, Vec3::Y);
    }
}

fn orbit_input(
    buttons: Res<ButtonInput<MouseButton>>,
    motion: Res<AccumulatedMouseMotion>,
    mut wheel: MessageReader<MouseWheel>,
    mut orbit: ResMut<OrbitView>,
) {
    if buttons.pressed(MouseButton::Left) {
        orbit.yaw -= motion.delta.x * 0.005;
        orbit.pitch = (orbit.pitch - motion.delta.y * 0.005).clamp(-1.5, 1.5);
    }
    for event in wheel.read() {
        let amount = match event.unit {
            MouseScrollUnit::Line => event.y,
            MouseScrollUnit::Pixel => event.y * 0.01,
        };
        orbit.distance = (orbit.distance * (-amount * 0.1).exp()).clamp(1.2, 1000.0);
    }
}

fn stop_renderer(stop: Res<RendererStop>, mut exit: MessageWriter<AppExit>) {
    if stop.0.load(Ordering::Acquire) {
        exit.write(AppExit::Success);
    }
}

#[cfg(test)]
mod framing_tests {
    use super::*;
    #[test]
    fn transformed_bounds_include_offset_rotation_and_scale() {
        let bounds = Aabb::from_min_max(Vec3::new(2.0, -1.0, -1.0), Vec3::new(4.0, 1.0, 1.0));
        let matrix = Mat4::from_scale_rotation_translation(
            Vec3::splat(2.0),
            Quat::from_rotation_z(std::f32::consts::FRAC_PI_2),
            Vec3::X,
        );
        let (min, max) = transformed_bounds(&bounds, matrix);
        assert!(((min + max) * 0.5 - Vec3::new(1.0, 6.0, 0.0)).length() < 1e-5);
        assert!((max - min - Vec3::splat(4.0)).length() < 1e-5);
    }
}

fn transformed_bounds(bounds: &Aabb, matrix: Mat4) -> (Vec3, Vec3) {
    let mut min = Vec3::splat(f32::INFINITY);
    let mut max = Vec3::splat(f32::NEG_INFINITY);
    for x in [-1.0, 1.0] {
        for y in [-1.0, 1.0] {
            for z in [-1.0, 1.0] {
                let point = matrix.transform_point3(
                    Vec3::from(bounds.center)
                        + Vec3::from(bounds.half_extents) * Vec3::new(x, y, z),
                );
                min = min.min(point);
                max = max.max(point);
            }
        }
    }
    (min, max)
}
#[cfg(test)]
mod camera_lifecycle_tests {
    use super::*;
    use crate::{AssetDescriptor, AssetKind, Core, ObjectState, SessionPermissions};
    use std::sync::Mutex;
    #[test]
    fn replacement_and_target_switch_reframe_without_changing_scientific_radius() {
        let shared = Arc::new(Mutex::new(Core::default()));
        {
            let mut core = shared.lock().unwrap();
            core.open_session_with_permissions(
                "s",
                "p",
                SessionPermissions {
                    camera_control: true,
                    visual_control: true,
                    ..default()
                },
            )
            .unwrap();
            for id in ["body:a", "body:b"] {
                core.register_object("s", id).unwrap();
                core.set_object_state(
                    "s",
                    id,
                    ObjectState {
                        position_km: [0.0; 3],
                        radius_km: 2.0,
                        epoch_tdb_seconds: 0.0,
                        coverage_tdb_seconds: [0.0, 10.0],
                        frame: "ICRF".into(),
                        source: "test".into(),
                    },
                )
                .unwrap();
            }
            core.register_asset(
                "model:a",
                AssetDescriptor {
                    kind: AssetKind::Model,
                    path: "a.glb".into(),
                },
            )
            .unwrap();
            core.set_visual(
                "s",
                "p",
                "body:a",
                Some(VisualSpec::Model {
                    asset_id: "model:a".into(),
                    scene: 0,
                    scale_km_per_unit: 0.002,
                }),
            )
            .unwrap();
            let revision = core.visual_assignment("body:a").unwrap().revision;
            core.record_visual_status("body:a", revision, VisualPhase::Ready, None);
            core.focus("s", "p", "body:a").unwrap();
        }
        let mut app = App::new();
        app.insert_resource(CoreStore(shared.clone()))
            .init_resource::<DisplaySettings>()
            .init_resource::<OrbitView>()
            .add_systems(Update, update_focus);
        let camera = app
            .world_mut()
            .spawn((DisplayCamera, Transform::default(), Projection::default()))
            .id();
        let object = app
            .world_mut()
            .spawn((
                SceneObject {
                    id: "body:a".into(),
                },
                Transform::default(),
            ))
            .id();
        let mesh = app
            .world_mut()
            .spawn((
                Transform::from_xyz(3.0, 0.0, 0.0),
                Aabb::from_min_max(-Vec3::ONE, Vec3::ONE),
                ChildOf(object),
            ))
            .id();
        app.update();
        let first = app.world().get::<Transform>(camera).unwrap().translation;
        assert!((first.x - 0.003).abs() < 1e-6);
        {
            let mut core = shared.lock().unwrap();
            core.set_visual(
                "s",
                "p",
                "body:a",
                Some(VisualSpec::Model {
                    asset_id: "model:a".into(),
                    scene: 0,
                    scale_km_per_unit: 0.002,
                }),
            )
            .unwrap();
        }
        app.update();
        assert_eq!(
            app.world().get::<Transform>(camera).unwrap().translation,
            Vec3::new(0.0, 0.0, 4.0)
        );
        {
            let mut core = shared.lock().unwrap();
            let revision = core.visual_assignment("body:a").unwrap().revision;
            core.record_visual_status("body:a", revision, VisualPhase::Ready, None);
        }
        app.world_mut()
            .entity_mut(mesh)
            .insert(Transform::from_xyz(6.0, 0.0, 0.0).with_scale(Vec3::splat(2.0)));
        app.update();
        let replacement = app.world().get::<Transform>(camera).unwrap().translation;
        assert!((replacement.x - 0.006).abs() < 1e-6);
        assert!((replacement.z / first.z - 2.0).abs() < 1e-5);
        shared.lock().unwrap().focus("s", "p", "body:b").unwrap();
        app.update();
        assert_eq!(
            app.world().get::<Transform>(camera).unwrap().translation,
            Vec3::new(0.0, 0.0, 4.0)
        );
        assert_eq!(
            shared
                .lock()
                .unwrap()
                .object_state_at("body:a", 0.0)
                .unwrap()
                .radius_km,
            2.0
        );
    }
}
