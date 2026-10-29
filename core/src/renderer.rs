//! Built-in Bevy rendering with resources resolved through the host catalog.
use crate::SharedCore;
use crate::render_assets::{SharedVisuals, attach_visuals, poll_visuals, world_ready};
use crate::runtime::{CoreScenePlugin, CoreStore, DisplaySettings, sync_scene};
use bevy::asset::AssetMetaCheck;
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
    mut camera: Query<&mut Transform, With<DisplayCamera>>,
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
    for mut transform in &mut camera {
        let position = Quat::from_rotation_y(orbit.yaw)
            * Quat::from_rotation_x(orbit.pitch)
            * Vec3::new(0.0, 0.0, orbit.distance);
        *transform = Transform::from_translation(position).looking_at(Vec3::ZERO, Vec3::Y);
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
